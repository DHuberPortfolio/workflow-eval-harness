#!/usr/bin/env node
// Would AI judges bill per token? Run by the wfeval skill before any judge starts, and kept here
// rather than in the harness: scoring starts no program and calls no model (test/judges.test.js, Q15).
//
//   plan     a Claude plan login: judges run on the plan's allowance, with no stop
//   api      billed per token: stop, and let the person decide
//   unknown  not shown to be a plan: stop and ask, because a wrong guess spends someone's money
//
// Inside the desktop app `claude auth status` does not settle it: the same session read as a Max
// login and minutes later as logged out, and the docs do not say why. So a plan reading is remembered
// for that account, and so is a person's answer (--confirm-plan), which makes it one question per
// account at most. Nothing remembered outranks an API key: the environment and the login type are
// read first, every time.
//
// Prints one line of JSON: { "route", "why" }. Prints nothing about who is logged in, and remembers
// a hash of the account id, not the id.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PLANS = ['pro', 'max', 'team', 'enterprise'];
const CLOUD = ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];
const MEMORY = path.join(os.homedir(), '.claude', 'wfeval-route.json');
const on = v => typeof v === 'string' && v !== '' && v !== '0' && v.toLowerCase() !== 'false';
const accountOf = env => (env.CLAUDE_CODE_ACCOUNT_UUID ? crypto.createHash('sha256').update(env.CLAUDE_CODE_ACCOUNT_UUID).digest('hex') : null);
const isPlan = s => Boolean(s) && s.authMethod === 'claude.ai' && PLANS.includes(s.subscriptionType) && (!s.apiProvider || s.apiProvider === 'firstParty');

// env: the environment. status: what `claude auth status` printed, or null if it could not be read.
// remembered: { account }, this machine's note of a plan login, or null.
function routeOf(env, status, remembered = null) {
  for (const k of CLOUD) if (on(env[k])) return { route: 'api', why: k + ' sends calls to a cloud account, billed per token' };
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) {
    if (env[k]) return { route: 'api', why: k + ' is set, and it is used instead of a plan login' };
  }
  if (status && ['api_key', 'api_key_helper', 'third_party'].includes(status.authMethod)) return { route: 'api', why: 'logged in with ' + status.authMethod };
  if (status && status.apiProvider && status.apiProvider !== 'firstParty') return { route: 'api', why: 'calls go through ' + status.apiProvider };
  if (isPlan(status)) return { route: 'plan', why: 'logged in to a Claude plan' };
  const account = accountOf(env);
  if (remembered && account && remembered.account === account) return { route: 'plan', why: 'this account was confirmed as a Claude plan' };
  return { route: 'unknown', why: status ? 'a login that is not clearly a plan' : 'could not read the login type' };
}

// The desktop app keeps its own copy of claude, which is not on PATH.
function bundled(env) {
  const roots = [env.APPDATA && path.join(env.APPDATA, 'Claude', 'claude-code'),
    path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude-code')].filter(Boolean);
  const found = [];
  for (const root of roots) {
    let versions = [];
    try { versions = fs.readdirSync(root); } catch (e) { continue; }
    for (const v of versions) {
      let builds = [];
      try { builds = fs.readdirSync(path.join(root, v)); } catch (e) { continue; }
      for (const b of builds) {
        for (const name of ['claude.exe', 'claude']) {
          const p = path.join(root, v, b, name);
          try { found.push({ p, at: fs.statSync(p).mtimeMs }); } catch (e) { /* not this name */ }
        }
      }
    }
  }
  return found.sort((a, b) => b.at - a.at).map(x => x.p);
}

// The first answer that names a login method wins. "none" is an answer too, so a logged-out reading
// from the first copy found is not retried across every copy installed.
function authStatus(env) {
  const parsed = r => { try { return JSON.parse(r.stdout); } catch (e) { return null; } };
  const onPath = parsed(spawnSync('claude auth status', { encoding: 'utf8', timeout: 15000, shell: true, env }));
  if (onPath) return onPath;
  for (const exe of bundled(env)) {
    const s = parsed(spawnSync(exe, ['auth', 'status'], { encoding: 'utf8', timeout: 15000, env }));
    if (s) return s;
  }
  return null;
}

function remembered() {
  try { return JSON.parse(fs.readFileSync(MEMORY, 'utf8')); } catch (e) { return null; }
}
function remember(env) {
  const account = accountOf(env);
  if (!account) return false;
  fs.writeFileSync(MEMORY, JSON.stringify({ account, route: 'plan', on: new Date().toISOString().slice(0, 10) }) + '\n');
  return true;
}

if (require.main === module) {
  const env = process.env;
  const status = authStatus(env);
  if (process.argv[2] === '--confirm-plan') {
    // A person said so. It still cannot outrank a key or an API login: see routeOf.
    const r = routeOf(env, status, null);
    if (r.route === 'api') console.log(JSON.stringify(r));
    else console.log(JSON.stringify(remember(env) ? { route: 'plan', why: 'remembered for this account' } : { route: 'unknown', why: 'no account id in this session, so nothing can be remembered' }));
  } else {
    const r = routeOf(env, status, remembered());
    if (isPlan(status) && r.route === 'plan') remember(env);
    console.log(JSON.stringify(r));
  }
}

module.exports = { routeOf, accountOf };

// The command line itself: exit codes that hold for every command (bin/wfeval.js main).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cli = args => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'wfeval.js'), ...args], { encoding: 'utf8' });

// The usage text promises 2 for a bad command and 1 for problems in the files. An option a
// command does not have, or one left without its value, is a bad command, for every command.
test('an unknown option, or an option without its value, is a bad command: exit 2, with no advice about "--"', () => {
  for (const args of [['score', '--bogus'], ['monitor', '--bogus'], ['estimate', '--pick'], ['agree', '--keys', '--seed'], ['whatif', '--hold']]) {
    const r = cli(args);
    assert.equal(r.status, 2, args.join(' ') + ': ' + r.stderr);
    assert.match(r.stderr, /^bad command: /, args.join(' '));
    assert.match(r.stderr, /wfeval --help/);
    assert.doesNotMatch(r.stderr, /To specify a positional argument/);
  }
});

test('an unknown command is a bad command (exit 2); a missing file is an input problem (exit 1)', () => {
  assert.equal(cli(['scroe']).status, 2);
  const r = cli(['check', '--config', path.join(__dirname, 'no-such-config.json')]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^error: /);
});

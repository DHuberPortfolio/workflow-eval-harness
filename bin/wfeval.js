#!/usr/bin/env node
// CLI entry. Parses arguments, dispatches to a subcommand, sets the exit code.
// No metric logic lives here - this file only connects the terminal to src/.
const fs = require('node:fs');
const { parseArgs } = require('node:util');
const { loadConfig, SEVERITIES } = require('../src/config.js');
const { loadRun } = require('../src/load.js');
const { scoreRun, varianceRun, compareRun } = require('../src/score.js');
const { renderTerminal, renderVariance, renderCompare } = require('../src/report/terminal.js');
const { resultsJson } = require('../src/report/json.js');

const USAGE = `usage: wfeval <command> [options]

commands:
  check     --config <file> [--pred <file> --key <file>] [--lenient]
            validate a config, and optionally read a predictions file and answer key

  score     --config <file> --pred <file> --key <file> [--lenient]
            [--json <file>] [--html <file>] [--quiet] [--fail-on <severity>]
            score one run. --fail-on critical|high|medium|low exits with code 3 when a
            silent error or safeguard failure at or above that severity is found (for CI)

  variance  --config <file> --key <file> <run> <run> [<run> ...] [--lenient] [--json <file>]
            several runs of identical code: mean and spread of every metric, and the
            records that behave differently from run to run

  compare   --config <file> --key <file> --before <file> --after <file>
            [--noise <run> --noise <run> ...] [--lenient] [--json <file>]
            what changed between two runs, and whether it is bigger than the noise
            of repeated identical runs (give those with --noise)

  whatif    (not built yet)

exit codes: 0 done · 1 input problems (listed) · 2 bad command · 3 --fail-on triggered`;

const MODE = values => (values.lenient ? 'lenient' : 'strict');
function need(values, names, cmd) {
  const missing = names.filter(n => !values[n]);
  if (missing.length) throw new Error(cmd + ' needs ' + missing.map(n => '--' + n + ' <file>').join(' '));
}
function writeFile(file, text) {
  fs.writeFileSync(file, text);
  console.error('wrote ' + file);
}

function score(args) {
  const { values } = parseArgs({ args, options: {
    config: { type: 'string' }, pred: { type: 'string' }, key: { type: 'string' }, lenient: { type: 'boolean' },
    json: { type: 'string' }, html: { type: 'string' }, quiet: { type: 'boolean' }, 'fail-on': { type: 'string' },
  } });
  need(values, ['config', 'pred', 'key'], 'score');
  const failOn = values['fail-on'];
  if (failOn !== undefined && !SEVERITIES.includes(failOn)) throw new Error('--fail-on must be one of: ' + SEVERITIES.join(', '));

  const results = scoreRun({ config: loadConfig(values.config), predPath: values.pred, keyPath: values.key, mode: MODE(values) });
  if (!values.quiet) process.stdout.write(renderTerminal(results));
  if (values.json) writeFile(values.json, JSON.stringify(resultsJson(results), null, 2) + '\n');
  if (values.html) writeFile(values.html, require('../src/report/html.js').renderHtml(results));

  if (failOn) {
    const limit = SEVERITIES.indexOf(failOn);
    const r = results.routing;
    const hits = [
      ...r.silent_errors.records.filter(x => SEVERITIES.indexOf(x.severity) <= limit).map(x => x.id + ' (' + x.severity + ')'),
      ...(SEVERITIES.indexOf('critical') <= limit ? r.safeguard_failures.detail.map(d => d.id + ' (safeguard)') : []),
    ];
    if (hits.length) { console.error('fail-on ' + failOn + ': ' + hits.join(', ')); return 3; }
  }
  return 0;
}

function check(args) {
  const { values } = parseArgs({ args, options: {
    config: { type: 'string' }, pred: { type: 'string' }, key: { type: 'string' }, lenient: { type: 'boolean' },
  } });
  if (!values.config) throw new Error('check needs --config <file>');
  if (Boolean(values.pred) !== Boolean(values.key)) throw new Error('--pred and --key go together');
  const c = loadConfig(values.config);
  const outs = Object.entries(c.outputs).map(([n, o]) => n + ' (' + o.type + ')').join(', ');
  const routes = Object.entries(c.routing.map).map(([d, cls]) => d + ' -> ' + cls).join(', ');
  console.log('config OK  ' + values.config);
  for (const which of ['predictions', 'key']) {
    const i = c.input[which];
    const bits = [];
    if (i.format) bits.push('format ' + i.format);
    if (i.records_at) bits.push('records at "' + i.records_at + '"');
    if (i.unwrap) bits.push('each record inside "' + i.unwrap + '"');
    if (i.delimiter) bits.push('cells split on ' + JSON.stringify(i.delimiter));
    if (bits.length) console.log('  input       ' + which + ': ' + bits.join(', '));
  }
  console.log('  outputs     ' + outs);
  console.log('  routing     ' + routes);
  console.log('  wrong when  ' + c.wrong_when);
  console.log('  traps       ' + (c.trap_field ? 'read from key field "' + c.trap_field + '"' : 'not set'));
  const t = c.thresholds;
  if (!t) {
    console.log('  thresholds  not set');
  } else {
    const gates = Object.entries(t.auto_publish).map(([f, v]) => f + ' >= ' + v).join(', ') || 'none';
    console.log('  floor       ' + (t.floor === null ? 'not set' : t.floor) + '   provisional below ' + (t.provisional_below === null ? 'not set' : t.provisional_below));
    console.log('  auto gate   ' + gates + '  (compares the ' + t.gate_uses + ' value)');
  }
  if (!values.pred) return;

  const mode = values.lenient ? 'lenient' : 'strict';
  const run = loadRun({ config: c, predPath: values.pred, keyPath: values.key, mode });
  console.log('data OK  (' + mode + ' mode)');
  console.log('  predictions ' + run.predictions.length + ' records   ' + values.pred);
  console.log('  answer key  ' + run.key.length + ' records   ' + values.key);
  const count = field => ['auto', 'review', 'block', 'exclude']
    .map(cls => cls + ' ' + run.records.filter(r => r[field] === cls).length).join(' · ');
  console.log('  matched     ' + run.records.length + ' records');
  console.log('  routed      ' + count('route_class'));
  if (c.routing.gold_field) console.log('  should be   ' + count('gold_class'));
  for (const level of ['warn', 'fix']) {
    const found = run.problems.filter(i => i.level === level);
    if (found.length === 0) continue;
    console.log('  ' + (level === 'warn' ? 'warnings' : 'cleaned up') + ' (' + found.length + ')');
    for (const i of found) console.log('    [' + i.trap + '] ' + i.where + ': ' + i.message);
  }
}

function variance(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    config: { type: 'string' }, key: { type: 'string' }, lenient: { type: 'boolean' }, json: { type: 'string' },
  } });
  need(values, ['config', 'key'], 'variance');
  const v = varianceRun({ config: loadConfig(values.config), keyPath: values.key, predPaths: positionals, mode: MODE(values) });
  process.stdout.write(renderVariance(v));
  if (values.json) writeFile(values.json, JSON.stringify(resultsJson(v), null, 2) + '\n');
}

function compare(args) {
  const { values } = parseArgs({ args, options: {
    config: { type: 'string' }, key: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' },
    noise: { type: 'string', multiple: true }, lenient: { type: 'boolean' }, json: { type: 'string' },
  } });
  need(values, ['config', 'key', 'before', 'after'], 'compare');
  const c = compareRun({
    config: loadConfig(values.config), keyPath: values.key, beforePath: values.before, afterPath: values.after,
    noisePaths: values.noise || [], mode: MODE(values),
  });
  process.stdout.write(renderCompare(c));
  if (values.json) writeFile(values.json, JSON.stringify(resultsJson(c), null, 2) + '\n');
}

const COMMANDS = { check, score, variance, compare };

function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help') { console.log(USAGE); return 0; }
  if (!COMMANDS[cmd]) { console.error('unknown or unbuilt command: ' + cmd + '\n\n' + USAGE); return 2; }
  try {
    return COMMANDS[cmd](rest) || 0;
  } catch (e) {
    console.error('error: ' + e.message);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));

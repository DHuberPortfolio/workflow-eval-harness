#!/usr/bin/env node
// CLI entry. Parses arguments, dispatches to a subcommand, sets the exit code.
// No metric logic lives here - this file only connects the terminal to src/.
const fs = require('node:fs');
const { parseArgs } = require('node:util');
const { loadConfig, addGroupBy, SEVERITIES } = require('../src/config.js');
const { loadRun } = require('../src/load.js');
const { loadRulings } = require('../src/rulings.js');
const { scoreRun, varianceRun, compareRun, scoreGradesRun } = require('../src/score.js');
const { renderTerminal, renderVariance, renderCompare, renderWhatif, renderGrades } = require('../src/report/terminal.js');
const { resultsJson } = require('../src/report/json.js');

const USAGE = `usage: wfeval <command> [options]

commands:
  check     --config <file> [--pred <file> --key <file>] [--lenient]
            validate a config, and optionally read a predictions file and answer key

  score     --config <file> --pred <file> --key <file> [--lenient] [--rulings <file>]
            [--json <file>] [--html <file>] [--quiet] [--fail-on <severity>]
            [--target <percent> [--chance 0.8|0.9|0.95]] [--group-by <field> ...]
            score one run. --fail-on critical|high|medium|low exits with code 3 when a
            silent error or safeguard failure at or above that severity is found (for CI).
            --target 5 says whether the silent error rate is shown to be under 5%, and if
            not, how many records would show it. --group-by channel gives the rates again
            for each value of the answer key's "channel" (repeatable). Lists the possible
            key gaps: applied values the answer key does not list. --rulings reads a person's
            rulings on them (add, reject, pending): adds join the key for scoring (the key
            file is never changed), rejected gaps are no longer listed, and with pending
            rulings the silent error rate is also given as if they were all added

  score     --grades <file> [--second-reviewer <file>] [--lenient]
            [--json <file>] [--quiet] [--fail-on <severity>]
            score a person's grades of free-text fields (saved by the page wfeval grade
            writes): invented and missing rates per field, per section and per form, and
            two reviewers' agreement. --fail-on high trips on an invented field, medium
            on a missing one too

  grade     --config <grading config> --pred <file> --out <page.html>
            write one self-contained HTML page in which a person grades each free-text
            field faithful, invented or missing against its source, and saves the grades

  variance  --config <file> --key <file> <run> <run> [<run> ...] [--lenient] [--json <file>]
            [--rulings <file>]
            several runs of identical code: mean and spread of every metric, the records
            that behave differently from run to run, and the possible key gaps, each with
            its ruling when --rulings is given

  compare   --config <file> --key <file> --before <file> --after <file>
            [--noise <run> --noise <run> ...] [--after-key <file>] [--rulings <file>]
            [--lenient] [--json <file>]
            what changed between two runs: record by record, the records each outcome
            fixed and broke, judged on their own; and every rate, judged against the
            noise of repeated identical runs (give those with --noise). --after-key scores
            --after against another answer key: give the same run as --before and --after
            to see what a new key changes. --rulings applies to both keys

  rate      <wrong> <tested> [--target <percent> [--chance 0.8|0.9|0.95]] [--json <file>]
            the likely range for any count (2 of 15), and with --target, how many
            records would show the rate is under it

  whatif    --config <file> --pred <file> --key <file> (--gate | --floor)
            [--output <name>] [--from <n>] [--to <n>] [--step <n>] [--lenient] [--json <file>]
            what the numbers would be at other thresholds. --gate sweeps the auto-publish
            gate (all gated outputs, or one with --output); --floor sweeps the value floor

exit codes: 0 done · 1 input problems (listed) · 2 bad command · 3 --fail-on triggered`;

const MODE = values => (values.lenient ? 'lenient' : 'strict');
function need(values, names, cmd) {
  const missing = names.filter(n => !values[n]);
  if (missing.length) throw new Error(cmd + ' needs ' + missing.map(n => '--' + n + ' <file>').join(' '));
}
// --target 5 and --chance 0.9, checked before any file is read.
function targetOptions(values) {
  if (values.target === undefined) {
    if (values.chance !== undefined) throw new Error('--chance goes with --target <percent>');
    return {};
  }
  const target = Number(values.target);
  if (!(target > 0 && target < 100)) throw new Error('--target must be a percentage above 0 and below 100, got ' + JSON.stringify(values.target));
  const chance = values.chance === undefined ? 0.8 : Number(values.chance);
  if (![0.8, 0.9, 0.95].includes(chance)) throw new Error('--chance must be 0.8, 0.9 or 0.95');
  return { target, chance };
}
function writeFile(file, text) {
  fs.writeFileSync(file, text);
  console.error('wrote ' + file);
}
// --rulings <file>: read and checked once, before any run is scored (traps I12, I13).
const rulingsOf = (values, config) => (values.rulings ? loadRulings(values.rulings, config, MODE(values)) : null);

function score(args) {
  const { values } = parseArgs({ args, options: {
    config: { type: 'string' }, pred: { type: 'string' }, key: { type: 'string' }, lenient: { type: 'boolean' },
    json: { type: 'string' }, html: { type: 'string' }, quiet: { type: 'boolean' }, 'fail-on': { type: 'string' },
    grades: { type: 'string' }, 'second-reviewer': { type: 'string' }, target: { type: 'string' }, chance: { type: 'string' },
    'group-by': { type: 'string', multiple: true }, rulings: { type: 'string' },
  } });
  const failOn = values['fail-on'];
  if (failOn !== undefined && !SEVERITIES.includes(failOn)) throw new Error('--fail-on must be one of: ' + SEVERITIES.join(', '));
  if (values.grades || values['second-reviewer']) return scoreGrades(values, failOn);
  need(values, ['config', 'pred', 'key'], 'score');

  let config = loadConfig(values.config);
  if (values['group-by']) config = addGroupBy(config, values['group-by']);
  const results = scoreRun({ config, predPath: values.pred, keyPath: values.key, mode: MODE(values), rulings: rulingsOf(values, config), ...targetOptions(values) });
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

// score --grades: a person's grades of free-text fields, scored as labels.
function scoreGrades(values, failOn) {
  if (!values.grades) throw new Error('--second-reviewer goes with --grades <file>');
  const extra = ['config', 'pred', 'key', 'html', 'group-by', 'rulings'].filter(k => values[k]);
  if (extra.length) throw new Error('score --grades reads everything from the grades file; it does not take ' + extra.map(k => '--' + k).join(' '));
  const g = scoreGradesRun({ gradesPath: values.grades, secondPath: values['second-reviewer'] || null, mode: MODE(values) });
  if (!values.quiet) process.stdout.write(renderGrades(g));
  if (values.json) writeFile(values.json, JSON.stringify(resultsJson(g), null, 2) + '\n');
  if (failOn) {
    const limit = SEVERITIES.indexOf(failOn);
    const hits = [...g.invented.map(x => ({ ...x, severity: g.severity.invented })), ...g.missing.map(x => ({ ...x, severity: g.severity.missing }))]
      .filter(x => SEVERITIES.indexOf(x.severity) <= limit).map(x => x.form + ' ' + x.field + ' (' + x.severity + ')');
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
    if (i.any_of_separator) bits.push('alternatives (any_of) split on ' + JSON.stringify(i.any_of_separator));
    if (bits.length) console.log('  input       ' + which + ': ' + bits.join(', '));
  }
  console.log('  outputs     ' + outs);
  for (const [n, o] of Object.entries(c.outputs).filter(([, x]) => x.decline)) {
    const how = [o.decline.values.length ? 'value ' + o.decline.values.join(' or ') : null, o.decline.field ? 'field "' + o.decline.field + '" true' : null].filter(Boolean);
    console.log('  declines    ' + n + ' declined when ' + how.join(', or ') +
      (o.decline.values.length ? '; in the answer key, ' + o.decline.values.join(' or ') + ' means declining is correct' : '; the answer key cannot say to decline'));
  }
  for (const [n, groups] of Object.entries(c.equivalents)) {
    console.log('  equivalents ' + n + ': ' + groups.map(g => g.slice(1).join(', ') + ' read as ' + g[0]).join('; '));
  }
  console.log('  routing     ' + routes);
  console.log('  wrong when  ' + c.wrong_when);
  console.log('  traps       ' + (c.trap_field ? 'read from key field "' + c.trap_field + '"' : 'not set'));
  const groups = Object.entries(c.groups).map(([n, g]) => n + ' (' + g.from + ' field "' + g.field + '")');
  if (groups.length) console.log('  groups      ' + groups.join(', '));
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
    config: { type: 'string' }, key: { type: 'string' }, lenient: { type: 'boolean' }, json: { type: 'string' }, rulings: { type: 'string' },
  } });
  need(values, ['config', 'key'], 'variance');
  const config = loadConfig(values.config);
  const v = varianceRun({ config, keyPath: values.key, predPaths: positionals, mode: MODE(values), rulings: rulingsOf(values, config) });
  process.stdout.write(renderVariance(v));
  if (values.json) writeFile(values.json, JSON.stringify(resultsJson(v), null, 2) + '\n');
}

function compare(args) {
  const { values } = parseArgs({ args, options: {
    config: { type: 'string' }, key: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' },
    noise: { type: 'string', multiple: true }, lenient: { type: 'boolean' }, json: { type: 'string' },
    'after-key': { type: 'string' }, rulings: { type: 'string' },
  } });
  need(values, ['config', 'key', 'before', 'after'], 'compare');
  const config = loadConfig(values.config);
  const c = compareRun({
    config, keyPath: values.key, afterKeyPath: values['after-key'] || null, beforePath: values.before, afterPath: values.after,
    noisePaths: values.noise || [], mode: MODE(values), rulings: rulingsOf(values, config),
  });
  process.stdout.write(renderCompare(c));
  if (values.json) writeFile(values.json, JSON.stringify(resultsJson(c), null, 2) + '\n');
}

function whatif(args) {
  const { values } = parseArgs({ args, options: {
    config: { type: 'string' }, pred: { type: 'string' }, key: { type: 'string' }, lenient: { type: 'boolean' },
    gate: { type: 'boolean' }, floor: { type: 'boolean' }, output: { type: 'string' },
    from: { type: 'string' }, to: { type: 'string' }, step: { type: 'string' }, json: { type: 'string' },
  } });
  need(values, ['config', 'pred', 'key'], 'whatif');
  if (Boolean(values.gate) === Boolean(values.floor)) throw new Error('whatif needs exactly one of --gate or --floor');
  const config = loadConfig(values.config);
  const { paired } = scoreRun({ config, predPath: values.pred, keyPath: values.key, mode: MODE(values) });
  const opts = {};
  for (const k of ['from', 'to', 'step']) {
    if (values[k] === undefined) continue;
    opts[k] = Number(values[k]);
    if (!Number.isFinite(opts[k])) throw new Error('--' + k + ' must be a number');
  }
  const { gateSweep, floorSweep } = require('../src/metrics/whatif.js');
  const w = values.gate ? gateSweep(paired, config, { ...opts, outputs: values.output ? [values.output] : null }) : floorSweep(paired, config, opts);
  process.stdout.write(renderWhatif(w));
  if (values.json) writeFile(values.json, JSON.stringify(resultsJson({ inputs: { predictions: values.pred, key: values.key }, ...w }), null, 2) + '\n');
}

// grade: the page in which a person grades free-text fields. Reads files, writes one file;
// never calls a model or the network.
function grade(args) {
  const { values } = parseArgs({ args, options: {
    config: { type: 'string' }, pred: { type: 'string' }, out: { type: 'string' }, lenient: { type: 'boolean' },
  } });
  need(values, ['config', 'pred', 'out'], 'grade');
  const { loadGradingConfig, readForms } = require('../src/grading.js');
  const { renderGradingPage } = require('../src/report/grading-page.js');
  const config = loadGradingConfig(values.config);
  const { forms, fingerprint, problems } = readForms({ config, predPath: values.pred, mode: MODE(values) });
  for (const i of problems.filter(x => x.level !== 'stop')) console.error(i.level + ' [' + i.trap + '] ' + i.where + ': ' + i.message);
  writeFile(values.out, renderGradingPage(forms, config, { fingerprint, forms_file: require('node:path').basename(values.pred) }));
  console.error(forms.length + ' form(s), ' + forms.length * config.fields.length + ' field(s) to grade. Open the page in a browser; it saves a grades file for: wfeval score --grades <file>');
}

// rate: the likely range for a bare count, and what a target needs. No files.
function rateCmd(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    target: { type: 'string' }, chance: { type: 'string' }, json: { type: 'string' },
  } });
  const [wrong, tested] = positionals.map(Number);
  if (positionals.length !== 2 || !positionals.every(s => /^\d+$/.test(s)) || tested < 1 || wrong > tested) {
    throw new Error('rate needs two whole numbers: the mistakes, then the records tested (0 <= mistakes <= tested, tested >= 1)');
  }
  const { rate } = require('../src/metrics/stats.js');
  const { targetCheck } = require('../src/metrics/target.js');
  const { renderRate } = require('../src/report/terminal.js');
  const opts = targetOptions(values);
  const x = { kind: 'rate', rate: rate(wrong, tested), target: opts.target === undefined ? null : targetCheck(wrong, tested, opts.target, { chance: opts.chance }) };
  process.stdout.write(renderRate(x));
  if (values.json) writeFile(values.json, JSON.stringify(resultsJson(x), null, 2) + '\n');
}

const COMMANDS = { check, score, variance, compare, whatif, grade, rate: rateCmd };

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

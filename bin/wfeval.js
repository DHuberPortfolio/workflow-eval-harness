#!/usr/bin/env node
// CLI entry. Parses arguments, dispatches to a subcommand, sets the exit code.
// No metric logic lives here - this file only connects the terminal to src/.
const { parseArgs } = require('node:util');
const { loadConfig } = require('../src/config.js');
const { loadRun } = require('../src/load.js');

const USAGE = `usage: wfeval <command> [options]

commands:
  check     --config <file> [--pred <file> --key <file>] [--lenient]
            validate a config, and optionally read a predictions file and answer key
  score     (not built yet)
  variance  (not built yet)
  compare   (not built yet)
  whatif    (not built yet)`;

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
  for (const level of ['warn', 'fix']) {
    const found = run.problems.filter(i => i.level === level);
    if (found.length === 0) continue;
    console.log('  ' + (level === 'warn' ? 'warnings' : 'cleaned up') + ' (' + found.length + ')');
    for (const i of found) console.log('    [' + i.trap + '] ' + i.where + ': ' + i.message);
  }
}

const COMMANDS = { check };

function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help') { console.log(USAGE); return 0; }
  if (!COMMANDS[cmd]) { console.error('unknown or unbuilt command: ' + cmd + '\n\n' + USAGE); return 2; }
  try {
    COMMANDS[cmd](rest);
    return 0;
  } catch (e) {
    console.error('error: ' + e.message);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));

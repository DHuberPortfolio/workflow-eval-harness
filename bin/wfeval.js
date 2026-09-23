#!/usr/bin/env node
// CLI entry. Parses arguments, dispatches to a subcommand, sets the exit code.
// No metric logic lives here - this file only connects the terminal to src/.
const { parseArgs } = require('node:util');
const { loadConfig } = require('../src/config.js');

const USAGE = `usage: wfeval <command> [options]

commands:
  check     --config <file>                      validate a config file
  score     (not built yet)
  variance  (not built yet)
  compare   (not built yet)
  whatif    (not built yet)`;

function check(args) {
  const { values } = parseArgs({ args, options: { config: { type: 'string' } } });
  if (!values.config) throw new Error('check needs --config <file>');
  const c = loadConfig(values.config);
  const outs = Object.entries(c.outputs).map(([n, o]) => n + ' (' + o.type + ')').join(', ');
  const routes = Object.entries(c.routing.map).map(([d, cls]) => d + ' -> ' + cls).join(', ');
  console.log('config OK  ' + values.config);
  console.log('  outputs     ' + outs);
  console.log('  routing     ' + routes);
  console.log('  wrong when  ' + c.wrong_when);
  console.log('  traps       ' + (c.trap_field ? 'read from key field "' + c.trap_field + '"' : 'not set'));
  const t = c.thresholds;
  if (!t) { console.log('  thresholds  not set'); return; }
  const gates = Object.entries(t.auto_publish).map(([f, v]) => f + ' >= ' + v).join(', ') || 'none';
  console.log('  floor       ' + (t.floor === null ? 'not set' : t.floor) + '   provisional below ' + (t.provisional_below === null ? 'not set' : t.provisional_below));
  console.log('  auto gate   ' + gates + '  (compares the ' + t.gate_uses + ' value)');
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

// A real-traffic mix for `score --mix <file>` (traps G18-G21): which group to weight, and each
// of its labels' share of real traffic.
//
//   { "group": "channel", "shares": { "email": 0.7, "chat": 0.3 } }
//
// The group is one the run already has (the config's groups, or --group-by). Shares may be
// fractions, percentages or counts (a month's traffic per channel): they are divided by their
// total. Read and checked here, before any run is scored; whether the labels match the run's is
// checked against the run (metrics/mix.js), since only the run knows its labels.

const { problems } = require('./problems.js');
const { readText } = require('./text.js');
const { isObj, describe } = require('./values.js');

const KEYS = ['group', 'shares'];
const SHAPE = '{ "group": "<group>", "shares": { "<label>": <share>, ... } }';

// Reads and checks a mix file against the config (trap G18). Every problem here stops, in lenient
// mode too: a weight the tool guessed would move the estimate where no report shows it. Throws
// one error listing them all. Returns { file, group, shares: [{ label, given }] }, in the file's
// order (JSON.parse puts labels that look like whole numbers, "1" and "2", first).
function loadMix(file, config) {
  const p = problems('strict');
  let raw;
  try {
    raw = JSON.parse(readText(file).replace(/^﻿/, ''));   // A3: a byte-order mark
  } catch (e) {
    p.stop('G18', file, (e.code ? 'cannot read the mix file: ' : 'not valid JSON: ') + e.message);
    p.throwIfStopped();
  }
  if (!isObj(raw)) {
    p.stop('G18', file, 'expected ' + SHAPE + ', got ' + describe(raw));
    p.throwIfStopped();
  }
  for (const k of Object.keys(raw)) if (!KEYS.includes(k)) p.stop('G18', file, 'unknown key "' + k + '" (allowed: ' + KEYS.join(', ') + ')');

  const names = Object.keys(config.groups);
  const group = typeof raw.group === 'string' ? raw.group.trim() : '';
  if (group === '') p.stop('G18', file, 'needs "group": the name of a group from the config\'s groups or --group-by');
  else if (names.length === 0) p.stop('G18', file, 'this run has no groups: name the group with --group-by <field> or in the config\'s groups');
  else if (!names.includes(group)) p.stop('G18', file, 'group "' + group + '" is not a group of this run (groups: ' + names.join(', ') + ')');

  const shares = [];
  if (!isObj(raw.shares)) {
    p.stop('G18', file, raw.shares === undefined ? 'needs "shares": ' + SHAPE : '"shares" must be an object: { "<label>": <share>, ... }, got ' + describe(raw.shares));
  } else if (Object.keys(raw.shares).length === 0) {
    p.stop('G18', file, '"shares" is empty: give each group of the run its share of real traffic');
  } else {
    for (const [label, given] of Object.entries(raw.shares)) {
      // Text is never read as a number: "0.9" would be compared and added as text (E2).
      if (typeof given !== 'number' || !Number.isFinite(given)) p.stop('G18', file, 'the share for "' + label + '" is ' + describe(given) + '; a share must be a number (a fraction, a percentage or a count)');
      else if (given < 0) p.stop('G18', file, 'the share for "' + label + '" is negative (' + given + ')');
      else shares.push({ label, given });
    }
    if (shares.length === Object.keys(raw.shares).length && shares.every(x => x.given === 0)) p.stop('G18', file, 'every share is 0: there is nothing to weight by');
    // Each a number, and still too big to add up (1e308 twice): divided by an Infinity total, every
    // weight would be 0, and the report would print "Infinity records' worth".
    const total = shares.reduce((t, x) => t + x.given, 0);
    if (!Number.isFinite(total)) p.stop('G18', file, 'the shares add up to more than a number can hold (' + total + '): write them smaller, as fractions or percentages');
  }
  p.throwIfStopped();
  return { file, group, shares };
}

module.exports = { loadMix };

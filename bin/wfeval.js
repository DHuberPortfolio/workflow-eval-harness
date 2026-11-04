#!/usr/bin/env node
// CLI entry. Parses arguments, dispatches to a subcommand, sets the exit code.
// No metric logic lives here - this file only connects the terminal to src/.
const fs = require('node:fs');
const { parseArgs: parseOptions } = require('node:util');
// Each command loads the modules it uses: --help needs none of them, and most commands a few.
const loadConfig = file => require('../src/config.js').loadConfig(file);

const USAGE = `usage: wfeval <command> [options]

commands:
  check     --config <file> [--pred <file> --key <file>] [--lenient]
            validate a config, and optionally read a predictions file and answer key

  score     --config <file> --pred <file> --key <file> [--lenient] [--rulings <file>]
            [--json <file>] [--html <file>] [--quiet] [--fail-on <severity>]
            [--target <percent> [--chance 0.8|0.9|0.95]] [--group-by <field> ...]
            [--cluster-by <field>] [--mix <file>] [--held-out] [--show-held-out]
            score one run. --fail-on critical|high|medium|low exits with code 3 when a silent
            error, silent omission or safeguard failure at or above that severity is found, or
            when nothing was evaluated (for CI).
            --target 5 says whether the silent error rate is shown to be under 5%, and if
            not, how many records would show it. --group-by channel gives the rates again
            for each value of the answer key's "channel" (repeatable). --cluster-by story
            adds the silent error rate's likely range counting each value of the answer
            key's "story" as one cluster of records that go together. --mix real.json
            weights each label of one group by its share of real traffic (the file:
            { "group": "channel", "shares": { "email": 0.7, "chat": 0.3 } }) and gives the
            silent error rate that mix would see, beside this golden set's: a reweighting,
            not a measurement (the group comes from --group-by or the config's groups).
            Lists the possible key gaps: applied values the answer key does not list.
            --rulings reads a person's rulings on them (add, reject or pending; and remove,
            keep or replace for what suspects lists): adds, removes and replaces change the
            key for scoring (the key file is never changed), rejected gaps are no longer
            listed, and with pending rulings the silent error rate is also given as if they
            were all made, with how far it could go however they are ruled

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
            [--rulings <file>] [--held-out] [--show-held-out]
            several runs of identical code: mean and spread of every metric, the worst
            run's silent error rate (the one to quote), how many different records were a
            silent error in at least one run, the records that behave differently from run
            to run, and the possible key gaps, each with its ruling when --rulings is given

  compare   --config <file> --key <file> --before <file> --after <file>
            [--noise <run> --noise <run> ...] [--after-key <file>] [--rulings <file>]
            [--lenient] [--json <file>] [--fail-if-worse <outcomes>] [--held-out] [--show-held-out]
            what changed between two runs: record by record, the records each outcome
            fixed and broke, judged on their own; and every rate, judged against the
            noise of repeated identical runs (give those with --noise). --after-key scores
            --after against another answer key: give the same run as --before and --after
            to see what a new key changes. --rulings applies to both keys.
            --fail-if-worse silent-errors,misroutes exits with code 3 when any of those
            paired outcomes is judged worse (for CI). Takes silent-errors, silent-omissions,
            unnecessary-reviews, misroutes or any; an outcome this compare does not
            measure stops. "unclear" never fails: most small changes are unclear

  rate      <wrong> <tested> [--target <percent> [--chance 0.8|0.9|0.95]] [--json <file>]
            the likely range for any count (2 of 15), and with --target, how many
            records would show the rate is under it

  whatif    --config <file> --pred <file> --key <file>
            (--gate | --floor | --policies <file> | --hold-if <rule> ...)
            [--output <name>] [--from <n>] [--to <n>] [--step <n>]
            [--lenient] [--json <file>] [--target <percent> [--confidence 0.9|0.95|0.99]]
            [--held-out] [--show-held-out]
            what the numbers would be at other thresholds. --gate sweeps the auto-publish
            gate (all gated outputs, or one with --output); --floor sweeps the value floor.
            --gate --target 5 marks the gates certified under 5%: each tested on its own
            records, with the chance that any certified gate is really at or above 5% held
            to 1 - confidence (default 0.95) across all the gates tried.
            --policies <file> compares named routing policies side by side with the run as
            it was: rules that send a record to a person (hold_if) and threshold changes
            (docs/CONFIG.md). --hold-if adds one more policy without a file, and works
            alone; repeat it for "or": codes=B (states B) · codes=* (any value) ·
            codes=*@0.85 (any value at 0.85 or more) · codes.unapplied=B · field:match<0.5 ·
            field:match>=0.5 · field:client=north,west · clauses joined by " and ".
            --target certifies the policies as --gate certifies gates

  estimate  --config <file> --pred <file> --judge-key <file> --key <file> [--lenient]
            [--json <file>] [--target <percent> [--fail-if-not-shown]] [--picks <picks.json>]
            the silent error rate when an AI judge wrote the answer key for every record that
            went out without review (it need not grade the others) and a person checked some
            of them (--key: the person's answer key for those). Each
            judge verdict group's rate comes from the person's checks, its weight from the
            judge: a wrong judge widens the range, it does not bias the estimate. Valid when
            the checks were picked at random (from all the records out, or within each verdict
            group) and made without seeing the judge's verdict. Also gives the judge alone,
            the person alone, how often they agree, and the records where they disagree.
            --target 5 says whether the estimate is shown under 5%, and if not, roughly how
            many more checks, in which verdict group, would show it. --fail-if-not-shown exits
            with code 3 when the whole range is not under the target (for scheduled jobs).
            --picks picks.json (saved by --pick --json) checks that the person checked exactly
            the picked records

  estimate  --config <file> --pred <file> --judge-key <file> --pick <n> [--seed <n>]
            [--lenient] [--json <file>]
            before checking: which n records out without review the person should check,
            split between the judge's verdicts the way that gives the narrowest range and
            chosen at random within each (the same --seed picks the same records). Listed in
            the run's order, so the list does not show the judge's verdicts: check them without
            looking at those, then run estimate with --key

  monitor   (--config <file> <period file> [<period file> ...] [--keys <dir>] | --counts <file>)
            [--target <percent>] [--acceptable <percent>] [--alarming <percent>]
            [--false-alarm-every <records>] [--period-size <records>] [--since <period>]
            [--fail-on-alarm] [--watch silent-errors|silent-omissions]
            [--segment-by <field> [--segments <a,b,...>]]
            [--lenient] [--json <file>]
            live samples over time: one period per file, in time order, each holding that
            period's checked records with the person's answers (named after the file:
            2026-W41.json is "2026-W41"; --keys keys/ reads each period's answers from the
            file of the same name in keys/), or a counts file scored elsewhere (period,
            out_without_review, silent_errors; JSON or .csv). Says whether the silent error
            rate has gone up (an alarm, and when the rise likely started) and whether it is
            shown under --target, valid however often you look. --acceptable is the rate it
            normally runs at (default: half the target), --alarming the rise to flag (default:
            double the acceptable rate). --false-alarm-every 2000 (the default) allows on
            average at most one false alarm per 2,000 records checked, for periods of the
            median size so far, or of --period-size. --since restarts the alarm at a period
            after a fix (the bound keeps counting every period). --fail-on-alarm exits with
            code 3 on an alarm (for scheduled jobs)
            --watch silent-omissions watches the records the workflow blocked or suppressed
            instead (a person checks a sample of those too; counts file: blocked_or_suppressed,
            silent_omissions): the share of them wrongly left out, the answer key saying they
            should have gone out or to a person (not score's silent omission rate, whose base
            is the records that should have been seen). --target and the other settings then
            apply to that share.
            --segment-by channel gives each value of a field (a channel, a customer) its own
            alarm and bound beside the whole's (run files: read from the answer key as score
            --group-by reads it, or a group the config names; a counts file: the column of that
            name, one row per period and segment). The alarms share --false-alarm-every; the
            whole and the segments are shown under the target as one family (at most 5% that
            anything is wrongly shown). --segments chat,email,phone names the segments before
            the first period ((other) pools the rest), so a printed "shown" never changes;
            without it, "shown" is provisional. --fail-on-alarm counts every segment's alarm

  agree     --config <file> --keys <key> <key> [<key> ...] [--names <a,b,...>] [--output <name> ...]
            [--lenient] [--json <file>] [--resamples <n>] [--seed <n>] [--write-key <file>]
  agree     --grades <file> <file> [<file> ...] [--names <a,b,...>] [--lenient] [--json <file>]
            [--resamples <n>] [--seed <n>]
            how far the people who made the answer keys (or graded free text) agree:
            Krippendorff's alpha per output, for any number of graders, with its likely range,
            each pair of graders, and the records they labelled differently. Records labelled
            by one grader only are left out and counted. --output compares only those outputs
            ("route" is the routing gold field). --write-key majority.json also writes a
            majority answer key: per record and output, the value most graders gave; records
            with a tie, or labelled by one grader, are left out and listed to settle

  suspects  --config <file> --key <file> <run> [<run> ...] [--rulings <file>] [--top <n>]
            [--write-rulings <new file>] [--show-held-out] [--lenient] [--json <file>]
            the answer-key entries one or more runs disagree with, the likeliest key errors
            first, for a person to rule on: values the key may be missing, values it may list
            wrongly, and labels it may have wrong. Each comes with why, in the numbers the
            ranking used, measured on the key's other records. --top 20 (the default) lists
            that many; --json has them all. --rulings reads earlier rulings: ruled entries are
            not listed again, pending ones show their status. --write-rulings writes a new
            rulings file (never over an existing one): the --rulings file's rulings, then the
            listed suspects as pending, with by and on to fill in

  with a split in the config (docs/CONFIG.md, "A tuning half and a held-out half"): score,
            compare, variance and whatif report the tuning half only, and say what a look at the
            held-out half would be (whatif chooses on the tuning half). --held-out looks at it:
            its rates only, never which records, and whatif checks its choice there. Each look
            is counted in split.log and makes the next one's test stricter; without a log, no
            claim is made. --fail-on and --fail-if-worse read the held-out half only with
            --held-out. suspects lists the tuning half's suspects only, ranked on the tuning
            half's records. --show-held-out lists the held-out records too (a look), and the log
            records which it listed

exit codes: 0 done · 1 a problem in the files or an option's value (listed) · 2 bad command
            (an unknown command or option, an option given without a value or with an empty one,
            or a single-value option given twice) · 3 --fail-on, --fail-if-worse, --fail-on-alarm
            or --fail-if-not-shown triggered, or read nothing`;

// Options as Node reads them, with two things it lets through (trap P19): an empty value (--rulings=,
// what an unset shell variable gives) would be read as no option at all, and of a value given twice
// the last would win unseen. Each is a bad command (exit 2), like an option without its value.
function badCommand(message) {
  return Object.assign(new Error(message), { code: 'ERR_PARSE_ARGS_WFEVAL' });
}
function parseArgs({ args, options, allowPositionals = false }) {
  const asLists = Object.fromEntries(Object.entries(options).map(([k, o]) => [k, o.type === 'string' ? { ...o, multiple: true } : o]));
  const { values, positionals } = parseOptions({ args, options: asLists, allowPositionals });
  for (const [k, v] of Object.entries(values)) {
    if (options[k].type !== 'string') continue;
    if (v.includes('')) throw badCommand('--' + k + ' was given no value');
    if (options[k].multiple) continue;
    if (v.length > 1) throw badCommand('--' + k + ' was given twice: it takes one value');
    values[k] = v[0];
  }
  return { values, positionals };
}

// ---------- What reaches the terminal ----------
// Every report goes through report(), and everything else through print(), line() and say(), so
// model text reaches a terminal with its control characters shown as text (trap P12). A reader that
// goes away (| head) ends the report and nothing else: the exit code stays the one the run earned (P24).
let watching = false;
function print(text) {
  if (!watching) {
    watching = true;
    process.stdout.on('error', e => { if (!require('../src/text.js').closedReader(e)) throw e; });
  }
  process.stdout.write(require('../src/text.js').escapeControls(text, true));
}
const report = (render, results, ...rest) => print(render(require('../src/text.js').forTerminal(results), ...rest));
const line = text => print(require('../src/text.js').escapeControls(text, false) + '\n');
const say = text => console.error(require('../src/text.js').escapeControls(text, false));

// Trap P18: an output option naming an input would replace it, an answer key a person wrote among
// them, and nothing could bring it back. Refused before any work. outputs: { option: file }; inputs:
// { what it is called: a file or a list of them }. Two names of one file are the same file: resolved,
// through any link, and without regard to case on Windows.
function sameFileKey(file) {
  const nodePath = require('node:path');
  let p = nodePath.resolve(file);
  try { p = fs.realpathSync.native(p); } catch { /* not there yet */ }
  return process.platform === 'win32' ? p.toLowerCase() : p;
}
// Two names for one file: the same path once resolved, or, for two that exist, the same place on the
// disk (a hard link, or a share's name for a local folder: no path shows those). Some disks give
// every file the number 0, and that says nothing.
function oneFile(a, b) {
  if (sameFileKey(a) === sameFileKey(b)) return true;
  try {
    const x = fs.statSync(a, { bigint: true });
    const y = fs.statSync(b, { bigint: true });
    return x.ino !== 0n && x.ino === y.ino && x.dev === y.dev;
  } catch { return false; }
}
function apart(outputs, inputs) {
  const given = Object.entries(outputs).filter(([, f]) => f !== undefined).map(([option, file]) => ({ option, file }));
  given.forEach((x, i) => {
    const before = given.slice(0, i).find(y => oneFile(y.file, x.file));
    if (before) throw new Error(x.option + ' ' + x.file + ' is the same file as ' + before.option + ': name two files');
    for (const [what, files] of Object.entries(inputs)) {
      for (const f of [].concat(files)) {
        if (f !== undefined && f !== null && oneFile(f, x.file)) throw new Error(x.option + ' ' + x.file + ' is the same file as ' + what + ': it would replace it. Name another file');
      }
    }
  });
}
// A config, and with it the files it names: inputs as well.
function configFor(file, outputs) {
  const config = loadConfig(file);
  apart(outputs, { 'a file the config names': config.named_files });
  return config;
}

const MODE = values => (values.lenient ? 'lenient' : 'strict');
function need(values, names, cmd) {
  const missing = names.filter(n => !values[n]);
  if (missing.length) throw new Error(cmd + ' needs ' + missing.map(n => '--' + n + ' <file>').join(' '));
}
// A number as a person writes one. Number() also reads 0x10 as 16, and spaces around one as nothing,
// and a value read some other way than it was meant is a setting nobody chose (trap P27).
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const decimal = text => (DECIMAL.test(text) ? Number(text) : NaN);
// --target 5 and --chance 0.9, checked before any file is read.
function targetPercent(values) {
  const target = decimal(values.target);
  if (!(target > 0 && target < 100)) throw new Error('--target must be a percentage above 0 and below 100, got ' + JSON.stringify(values.target));
  return target;
}
function targetOptions(values) {
  if (values.target === undefined) {
    if (values.chance !== undefined) throw new Error('--chance goes with --target <percent>');
    return {};
  }
  const target = targetPercent(values);
  const chance = values.chance === undefined ? 0.8 : decimal(values.chance);
  if (![0.8, 0.9, 0.95].includes(chance)) throw new Error('--chance must be 0.8, 0.9 or 0.95');
  return { target, chance };
}
// whatif --gate --target 5 [--confidence 0.99]: the gates certified under 5%, checked the same way.
function certifyOptions(values) {
  if (values.target === undefined) {
    if (values.confidence !== undefined) throw new Error('--confidence goes with --target <percent>');
    return {};
  }
  if (values.floor) throw new Error('--target goes with --gate or --policies: the floor what-if certifies nothing');
  const target = targetPercent(values);
  const confidence = values.confidence === undefined ? 0.95 : decimal(values.confidence);
  if (![0.9, 0.95, 0.99].includes(confidence)) throw new Error('--confidence must be 0.9, 0.95 or 0.99');
  return { target, confidence };
}
function writeFile(file, text) {
  fs.writeFileSync(file, text);
  say('wrote ' + file);
}
function writeJson(file, results) {
  const { resultsJson } = require('../src/report/json.js');
  writeFile(file, JSON.stringify(resultsJson(results), null, 2) + '\n');
}
// --rulings <file>: read and checked once, before any run is scored (traps I12, I13).
const rulingsOf = (values, config) => (values.rulings ? require('../src/rulings.js').loadRulings(values.rulings, config, MODE(values)) : null);
// config.split: the report is the tuning half's. --held-out looks at the held-out half too (a look,
// recorded in split.log: trap O25), and --show-held-out lists its records (a look as well). Nothing
// without a split, so those runs are as before.
function splitOptions(values, config) {
  if (!config.split) {
    if (values['show-held-out']) throw new Error('--show-held-out goes with a split in the config (split): there is no held-out half to show');
    if (values['held-out']) throw new Error('--held-out goes with a split in the config (split): there is no held-out half to look at');
    return {};
  }
  const show = Boolean(values['show-held-out']);
  const held = show || Boolean(values['held-out']);
  return { applySplit: true, heldOut: held, look: held, showHeldOut: show };
}
// With a split, a rulings file's stop counts held-out records instead of naming them (trap O6).
function splitRulingsOf(values, config) {
  try { return rulingsOf(values, config); } catch (e) {
    throw config.split && !values['show-held-out'] ? require('../src/score.js').maskLoadStop(e, config, values.key) : e;
  }
}

function score(args) {
  const { values } = parseArgs({ args, options: {
    config: { type: 'string' }, pred: { type: 'string' }, key: { type: 'string' }, lenient: { type: 'boolean' },
    json: { type: 'string' }, html: { type: 'string' }, quiet: { type: 'boolean' }, 'fail-on': { type: 'string' },
    grades: { type: 'string' }, 'second-reviewer': { type: 'string' }, target: { type: 'string' }, chance: { type: 'string' },
    'group-by': { type: 'string', multiple: true }, rulings: { type: 'string' },
    // Collected as a list only to refuse a second one: the last would otherwise win unseen.
    'cluster-by': { type: 'string', multiple: true },
    mix: { type: 'string' },
    'show-held-out': { type: 'boolean' }, 'held-out': { type: 'boolean' },
  } });
  const { addGroupBy, addClusterBy, SEVERITIES } = require('../src/config.js');
  const failOn = values['fail-on'];
  if (failOn !== undefined && !SEVERITIES.includes(failOn)) throw new Error('--fail-on must be one of: ' + SEVERITIES.join(', '));
  if (values.grades || values['second-reviewer']) return scoreGrades(values, failOn);
  need(values, ['config', 'pred', 'key'], 'score');
  const outputs = { '--json': values.json, '--html': values.html };
  apart(outputs, { '--config': values.config, '--pred': values.pred, '--key': values.key, '--rulings': values.rulings, '--mix': values.mix });
  const clusterBy = values['cluster-by'] || [];
  if (clusterBy.length > 1) throw new Error('--cluster-by takes one field: a record is in one cluster, got ' + clusterBy.map(c => JSON.stringify(c)).join(', '));

  let config = configFor(values.config, outputs);
  if (values['group-by']) config = addGroupBy(config, values['group-by']);
  if (clusterBy.length) config = addClusterBy(config, clusterBy[0]);
  // --mix <file>: read and checked before the run is scored, against the groups --group-by added (trap G18).
  const mix = values.mix ? require('../src/mix.js').loadMix(values.mix, config) : null;
  const { scoreRun } = require('../src/score.js');
  // What this command was told to read: a stop if no record has it, where a table alone would warn.
  const needs = { clusters: clusterBy.length > 0, groups: [...(values['group-by'] || []), ...(mix ? [mix.group] : [])] };
  const results = scoreRun({ config, predPath: values.pred, keyPath: values.key, mode: MODE(values), rulings: splitRulingsOf(values, config), mix, ...targetOptions(values),
    ...splitOptions(values, config), needs });
  if (!values.quiet) report(require('../src/report/terminal.js').renderTerminal, results);
  if (values.json) writeJson(values.json, results);
  if (values.html) writeFile(values.html, require('../src/report/html.js').renderHtml(results));

  if (failOn) {
    // A gate that read nothing has not passed (trap P2).
    if (results.nothing_evaluated) { say('fail-on ' + failOn + ': nothing was evaluated: ' + results.nothing_evaluated.why); return 3; }
    const limit = SEVERITIES.indexOf(failOn);
    const r = results.routing;
    const within = x => SEVERITIES.indexOf(x.severity) <= limit;
    const hits = [
      ...r.silent_errors.records.filter(within).map(x => x.id + ' (' + x.severity + ')'),
      // A record left out unseen is a silent error too: one kind goes out, the other never does (trap P4).
      ...(r.silent_omissions ? r.silent_omissions.records.filter(within).map(x => x.id + ' (' + x.severity + ', silent omission)') : []),
      ...(SEVERITIES.indexOf('critical') <= limit ? r.safeguard_failures.detail.map(d => d.id + ' (safeguard)') : []),
    ];
    // config.split with --held-out: the held-out half's silent errors and safeguard failures stop a
    // build too, counted, never named. Without it the half is not read, and the gate is the tuning half's.
    if (results.split && !results.split.looked) say('fail-on: the tuning half only' + (results.split.not_looked ? ': ' + results.split.not_looked : '; --held-out reads the held-out half too (a look)'));
    if (results.split && results.split.looked) {
      const h = results.split.held_out;
      const counted = by => Object.entries(by).filter(([s]) => SEVERITIES.indexOf(s) <= limit).reduce((a, [, k]) => a + k, 0);
      const n = counted(h.silent_errors.by_severity);
      if (n) hits.push(n + ' held-out record(s) (' + failOn + ' or worse)');
      const left = h.omissions_by_severity ? counted(h.omissions_by_severity) : 0;
      if (left) hits.push(left + ' held-out record(s) (' + failOn + ' or worse, silent omission)');
      if (SEVERITIES.indexOf('critical') <= limit && h.safeguard_failures) hits.push(h.safeguard_failures + ' held-out record(s) (safeguard)');
    }
    if (hits.length) { say('fail-on ' + failOn + ': ' + hits.join(', ')); return 3; }
  }
  return 0;
}

// score --grades: a person's grades of free-text fields, scored as labels.
function scoreGrades(values, failOn) {
  if (!values.grades) throw new Error('--second-reviewer goes with --grades <file>');
  const extra = ['config', 'pred', 'key', 'html', 'group-by', 'cluster-by', 'rulings', 'mix', 'show-held-out', 'held-out'].filter(k => values[k]);
  if (extra.length) throw new Error('score --grades reads everything from the grades file; it does not take ' + extra.map(k => '--' + k).join(' '));
  apart({ '--json': values.json }, { '--grades': values.grades, '--second-reviewer': values['second-reviewer'] });
  const { SEVERITIES } = require('../src/config.js');
  const { scoreGradesRun } = require('../src/score.js');
  const g = scoreGradesRun({ gradesPath: values.grades, secondPath: values['second-reviewer'] || null, mode: MODE(values) });
  if (!values.quiet) report(require('../src/report/terminal.js').renderGrades, g);
  if (values.json) writeJson(values.json, g);
  if (failOn) {
    if (g.nothing_evaluated) { say('fail-on ' + failOn + ': nothing was evaluated: ' + g.nothing_evaluated.why); return 3; }
    const limit = SEVERITIES.indexOf(failOn);
    const hits = [...g.invented.map(x => ({ ...x, severity: g.severity.invented })), ...g.missing.map(x => ({ ...x, severity: g.severity.missing }))]
      .filter(x => SEVERITIES.indexOf(x.severity) <= limit).map(x => x.form + ' ' + x.field + ' (' + x.severity + ')');
    if (hits.length) { say('fail-on ' + failOn + ': ' + hits.join(', ')); return 3; }
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
  line('config OK  ' + values.config);
  for (const which of ['predictions', 'key']) {
    const i = c.input[which];
    const bits = [];
    if (i.format) bits.push('format ' + i.format);
    if (i.records_at) bits.push('records at "' + i.records_at + '"');
    if (i.unwrap) bits.push('each record inside "' + i.unwrap + '"');
    if (i.delimiter) bits.push('cells split on ' + JSON.stringify(i.delimiter));
    if (i.any_of_separator) bits.push('alternatives (any_of) split on ' + JSON.stringify(i.any_of_separator));
    if (bits.length) line('  input       ' + which + ': ' + bits.join(', '));
  }
  line('  outputs     ' + outs);
  for (const [n, o] of Object.entries(c.outputs).filter(([, x]) => x.decline)) {
    const how = [o.decline.values.length ? 'value ' + o.decline.values.join(' or ') : null, o.decline.field ? 'field "' + o.decline.field + '" true' : null].filter(Boolean);
    line('  declines    ' + n + ' declined when ' + how.join(', or ') +
      (o.decline.values.length ? '; in the answer key, ' + o.decline.values.join(' or ') + ' means declining is correct' : '; the answer key cannot say to decline'));
  }
  for (const [n, groups] of Object.entries(c.equivalents)) {
    line('  equivalents ' + n + ': ' + groups.map(g => g.slice(1).join(', ') + ' read as ' + g[0]).join('; '));
  }
  line('  routing     ' + routes);
  line('  wrong when  ' + c.wrong_when);
  line('  traps       ' + (c.trap_field ? 'read from key field "' + c.trap_field + '"' : 'not set'));
  const groups = Object.entries(c.groups).map(([n, g]) => n + ' (' + g.from + ' field "' + g.field + '")');
  if (groups.length) line('  groups      ' + groups.join(', '));
  if (c.clusters) line('  clusters    ' + c.clusters.from + ' field "' + c.clusters.field + '" (the silent error rate\'s range also counts clusters)');
  // config.split: how the halves are drawn, and with the files, how each kind of record splits.
  if (c.split) {
    const s = c.split;
    line('  split       ' + (s.hash === 'crc32' ? 'odd CRC-32 checksums held out (half)' : Number((s.held_out * 100).toPrecision(3)) + '% held out by sha256' + (s.salt ? ' (salt "' + s.salt + '")' : '')) +
      ', by ' + (s.by === 'id' ? 'each record\'s own id' : 'cluster, a duplicate\'s primary, or id') + '; looks ' + (s.log ? 'counted in ' + s.log : 'not counted (no split.log)'));
    // Without the files, the looks the log holds so far (with them, the next look's share, below).
    if (s.log && !values.pred) line('  looks       ' + require('../src/report/split.js').nextLookWords(require('../src/split-log.js').lookStatus(c)));
  }
  const t = c.thresholds;
  if (!t) {
    line('  thresholds  not set');
  } else {
    const gates = Object.entries(t.auto_publish).map(([f, v]) => f + ' >= ' + (typeof v === 'string' ? 'each record\'s own "' + v + '"' : v)).join(', ') || 'none';
    line('  floor       ' + (t.floor === null ? 'not set' : t.floor) + '   provisional below ' + (t.provisional_below === null ? 'not set' : t.provisional_below));
    line('  auto gate   ' + gates + '  (compares the ' + t.gate_uses + ' value)');
  }
  if (!values.pred) return;

  const mode = values.lenient ? 'lenient' : 'strict';
  // config.split: warnings and stops count held-out records instead of naming them, as score's do (trap O6).
  const { loadRun } = require('../src/load.js');
  let run;
  try { run = loadRun({ config: c, predPath: values.pred, keyPath: values.key, mode }); } catch (e) {
    throw c.split ? require('../src/score.js').maskLoadStop(e, c, values.key, require('../src/split.js').plainNote) : e;
  }
  line('data OK  (' + mode + ' mode)');
  line('  predictions ' + run.predictions.length + ' records   ' + values.pred);
  line('  answer key  ' + run.key.length + ' records   ' + values.key);
  const count = field => ['auto', 'review', 'block', 'exclude']
    .map(cls => cls + ' ' + run.records.filter(r => r[field] === cls).length).join(' · ');
  line('  matched     ' + run.records.length + ' records');
  line('  routed      ' + count('route_class'));
  if (c.routing.gold_field) line('  should be   ' + count('gold_class'));
  // config.split: the halves and the balance of each kind of record, before anyone looks at a result
  // (check shows none, so it is not a look). A split beyond chance is best redrawn now, with a new salt.
  if (c.split) {
    const { splitOf, balanceOf, maskProblems, plainNote } = require('../src/split.js');
    const halves = splitOf(run.records, c);
    const b = balanceOf(run.records, c, halves);
    maskProblems(run.problems, halves.held_out, plainNote);
    line('  halves      tuning ' + halves.tuning.length + ' · held out ' + halves.held_out.length +
      (halves.straddling.duplicates || halves.straddling.clusters ? ' · straddling: ' + halves.straddling.duplicates + ' duplicate(s), ' + halves.straddling.clusters + ' cluster(s)' : ''));
    for (const d of b.dimensions) {
      line('  ' + d.name.padEnd(11) + ' ' + d.labels.map(x => x.label + ' ' + x.held_out + '/' + x.records + (x.beyond_chance ? ' (beyond chance)' : '')).join(' · ') + '  (held out / records)');
    }
    if (b.beyond_chance.length) line('  ! split beyond what chance gives (O5): before anyone looks at either half, a new split.salt draws another split');
    // The looks so far, and the next one's share (read from split.log, which check never writes).
    const lk = require('../src/split-log.js').lookStatus(c, halves.held_out);
    if (lk.counted) line('  looks       ' + require('../src/report/split.js').nextLookWords(lk));
  }
  for (const level of ['warn', 'fix']) {
    const found = run.problems.filter(i => i.level === level);
    if (found.length === 0) continue;
    line('  ' + (level === 'warn' ? 'warnings' : 'cleaned up') + ' (' + found.length + ')');
    for (const i of found) line('    [' + i.trap + '] ' + i.where + ': ' + i.message);
  }
}

function variance(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    config: { type: 'string' }, key: { type: 'string' }, lenient: { type: 'boolean' }, json: { type: 'string' }, rulings: { type: 'string' },
    'show-held-out': { type: 'boolean' }, 'held-out': { type: 'boolean' },
  } });
  need(values, ['config', 'key'], 'variance');
  const outputs = { '--json': values.json };
  apart(outputs, { '--config': values.config, '--key': values.key, '--rulings': values.rulings, 'a run': positionals });
  const config = configFor(values.config, outputs);
  const { varianceRun } = require('../src/score.js');
  const { renderVariance } = require('../src/report/terminal.js');
  const v = varianceRun({ config, keyPath: values.key, predPaths: positionals, mode: MODE(values), rulings: splitRulingsOf(values, config), ...splitOptions(values, config) });
  report(renderVariance, v);
  if (values.json) writeJson(values.json, v);
}

function compare(args) {
  const { values } = parseArgs({ args, options: {
    config: { type: 'string' }, key: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' },
    noise: { type: 'string', multiple: true }, lenient: { type: 'boolean' }, json: { type: 'string' },
    'after-key': { type: 'string' }, rulings: { type: 'string' },
    // Repeatable, and the lists add up: a second flag never silently replaces the first.
    'fail-if-worse': { type: 'string', multiple: true },
    'show-held-out': { type: 'boolean' }, 'held-out': { type: 'boolean' },
  } });
  const { gateNames, worseOutcomes, GATE_OUTCOMES } = require('../src/metrics/runs.js');
  const gates = values['fail-if-worse'] ? gateNames(values['fail-if-worse']) : null;
  need(values, ['config', 'key', 'before', 'after'], 'compare');
  const outputs = { '--json': values.json };
  apart(outputs, { '--config': values.config, '--key': values.key, '--before': values.before, '--after': values.after, '--noise': values.noise, '--after-key': values['after-key'], '--rulings': values.rulings });
  const config = configFor(values.config, outputs);
  const { compareRun } = require('../src/score.js');
  const { renderCompare } = require('../src/report/terminal.js');
  const c = compareRun({
    config, keyPath: values.key, afterKeyPath: values['after-key'] || null, beforePath: values.before, afterPath: values.after,
    noisePaths: values.noise || [], mode: MODE(values), rulings: splitRulingsOf(values, config), ...splitOptions(values, config),
    // Read before a look is recorded: a gate that cannot be read has shown nothing (trap P23).
    beforeLook: gates ? paired => worseOutcomes(paired, gates) : null,
  });
  // Read before the report is printed, so a named outcome this compare does not measure stops
  // as an input problem instead of following a report that looks like a pass (trap I19).
  const worse = gates ? worseOutcomes(c.paired, gates) : [];
  // config.split with --held-out: the held-out half's paired verdicts stop a build too (counts only,
  // no ids). An outcome the held-out half does not measure (no record in both runs) is checked on the
  // tuning half only, and a note says so. Without --held-out the half is not read.
  if (gates && c.split && !c.split.looked) say('fail-if-worse: the tuning half only' + (c.split.not_looked ? ': ' + c.split.not_looked : '; --held-out reads the held-out half too (a look)'));
  if (gates && c.split && c.split.looked) {
    const measured = new Set(c.split.held_out.paired.outcomes.filter(o => o.verdict !== 'not measured').map(o => o.name));
    const named = gates.includes('any') ? Object.keys(GATE_OUTCOMES) : gates;
    const skipped = named.filter(g => !measured.has(GATE_OUTCOMES[g]));
    if (skipped.length && !gates.includes('any')) say('fail-if-worse: the held-out half does not measure ' + skipped.join(', ') + ' (no record in both runs): checked on the tuning half only');
    if (measured.size === 0 && gates.includes('any')) say('fail-if-worse: the held-out half does not measure any outcome (no record in both runs): checked on the tuning half only');
    const usable = gates.includes('any') ? (measured.size ? ['any'] : []) : gates.filter(g => !skipped.includes(g));
    if (usable.length) worse.push(...worseOutcomes(c.split.held_out.paired, usable).map(o => ({ ...o, flag: o.flag + ' on the held-out half' })));
  }
  report(renderCompare, c);
  if (values.json) writeJson(values.json, c);
  // A run that evaluated nothing has nothing to compare, whatever the outcomes say (trap P2).
  if (gates && c.nothing_evaluated) {
    for (const x of c.nothing_evaluated) say('fail-if-worse ' + gates.join(',') + ': nothing was evaluated in ' + x.file + ': ' + x.why);
    return 3;
  }
  if (worse.length) {
    say('fail-if-worse ' + gates.join(',') + ': ' + worse.map(o => o.flag + ' (fixed ' + o.fixed + ', broke ' + o.broke + ')').join(', '));
    return 3;
  }
  return 0;
}

function whatif(args) {
  const { values } = parseArgs({ args, options: {
    config: { type: 'string' }, pred: { type: 'string' }, key: { type: 'string' }, lenient: { type: 'boolean' },
    gate: { type: 'boolean' }, floor: { type: 'boolean' }, output: { type: 'string' },
    from: { type: 'string' }, to: { type: 'string' }, step: { type: 'string' }, json: { type: 'string' },
    target: { type: 'string' }, confidence: { type: 'string' },
    policies: { type: 'string' }, 'hold-if': { type: 'string', multiple: true },
    'show-held-out': { type: 'boolean' }, 'held-out': { type: 'boolean' },
  } });
  need(values, ['config', 'pred', 'key'], 'whatif');
  const outputs = { '--json': values.json };
  apart(outputs, { '--config': values.config, '--pred': values.pred, '--key': values.key, '--policies': values.policies });
  const holdIf = values['hold-if'] || [];
  if (holdIf.length && (values.gate || values.floor)) throw new Error('--hold-if goes with --policies or alone, not with --gate or --floor');
  const policyMode = Boolean(values.policies) || holdIf.length > 0;
  if ([values.gate, values.floor, policyMode].filter(Boolean).length !== 1) throw new Error('whatif needs exactly one of --gate, --floor or --policies (or --hold-if)');
  const sweepOnly = ['output', 'from', 'to', 'step'].filter(k => values[k] !== undefined);
  if (policyMode && sweepOnly.length) throw new Error(sweepOnly.map(k => '--' + k).join(' ') + ' go(es) with --gate or --floor: a policy names its own thresholds');
  const certify = certifyOptions(values);
  let config = configFor(values.config, outputs);
  // Policies are read and checked before the run (E10-E13, E17), and name the prediction fields
  // the run must keep (policyFields); what only the records can show is checked after (E14-E16, E19).
  let policies = null;
  const p = require('../src/problems.js').problems(MODE(values));
  if (policyMode) {
    const { loadPolicies, parseHoldIf, policyFields } = require('../src/policy.js');
    policies = values.policies ? loadPolicies(values.policies, config, p) : [];
    if (holdIf.length) {
      const name = 'hold if ' + holdIf.join(' or ');
      if (policies.some(x => x.name === name)) throw new Error('the policies file already has a policy named "' + name + '"');
      policies.push({ name, hold_if: holdIf.map(t => parseHoldIf(t, config, p)), auto_publish: null, auto_publish_cap: null });
    }
    config = policyFields(config, policies);
  }
  // The run's own warnings and clean-ups (a record's own threshold read as text, say) are shown
  // below the what-if, as score shows them.
  // With config.split, paired is the tuning half's records: every sweep below runs on it (trap O16).
  const splitLook = splitOptions(values, config);
  const { scoreRun } = require('../src/score.js');
  const { renderWhatif } = require('../src/report/terminal.js');
  const { paired, problems: loaded, split } = scoreRun({ config, predPath: values.pred, keyPath: values.key, mode: MODE(values),
    applySplit: Boolean(splitLook.applySplit), showHeldOut: Boolean(splitLook.showHeldOut), parts: 'paired', needs: { movable: !policyMode } });
  // config.split: the choice made on the tuning half, checked on the held-out half (src/split-whatif.js).
  const heldOutCheck = (w, kind) => require('../src/split-whatif.js').heldOutWhatif(w, {
    split, config, kind, policies: policies || [], ...splitLook, mode: MODE(values),
    files: { predictions: values.pred, key: values.key, policies: values.policies || null },
    options: { kind, hold_if: holdIf, ...Object.fromEntries(['output', 'from', 'to', 'step', 'target', 'confidence'].map(k => [k, values[k] ?? null])) },
  });
  if (policyMode) {
    const { checkPolicyData } = require('../src/policy.js');
    const { policySweep } = require('../src/metrics/policy.js');
    // One file passed as both, by name or by content: its key-side fields are the key's (E17).
    const sameFile = require('node:path').resolve(values.pred) === require('node:path').resolve(values.key) ||
      fs.readFileSync(values.pred).equals(fs.readFileSync(values.key));
    // With a split, the policies are checked against every record (a value stated only in the held-out half is no typo).
    checkPolicyData(policies, split ? split.every : paired, config, p, { sameFile });
    // Its warnings name records: a held-out one is counted instead (trap O6).
    if (split && !splitLook.showHeldOut) require('../src/split.js').maskProblems(p.items, split.hidden);
    p.throwIfStopped();
    const w = { ...policySweep(paired, config, policies, certify), problems: [...loaded, ...p.items] };
    if (split) w.split = heldOutCheck(w, 'policies');
    report(renderWhatif, w);
    if (values.json) writeJson(values.json, { inputs: { predictions: values.pred, key: values.key, ...(values.policies ? { policies: values.policies } : {}) }, ...w });
    return;
  }
  const opts = {};
  for (const k of ['from', 'to', 'step']) {
    if (values[k] === undefined) continue;
    opts[k] = decimal(values[k]);
    if (!Number.isFinite(opts[k])) throw new Error('--' + k + ' must be a number');
  }
  const { gateSweep, floorSweep } = require('../src/metrics/whatif.js');
  const w = values.gate ? gateSweep(paired, config, { ...opts, ...certify, outputs: values.output ? [values.output] : null }) : floorSweep(paired, config, opts);
  if (split) {
    w.problems = [];
    w.split = heldOutCheck(w, values.gate ? 'gate' : 'floor');
    loaded.push(...w.problems);
    delete w.problems;
  }
  report(renderWhatif, { ...w, problems: loaded });
  if (values.json) writeJson(values.json, { inputs: { predictions: values.pred, key: values.key }, ...w });
}

// grade: the page in which a person grades free-text fields. Reads files, writes one file;
// never calls a model or the network.
function grade(args) {
  const { values } = parseArgs({ args, options: {
    config: { type: 'string' }, pred: { type: 'string' }, out: { type: 'string' }, lenient: { type: 'boolean' },
  } });
  need(values, ['config', 'pred', 'out'], 'grade');
  apart({ '--out': values.out }, { '--config': values.config, '--pred': values.pred });
  const { loadGradingConfig, readForms } = require('../src/grading.js');
  const { renderGradingPage } = require('../src/report/grading-page.js');
  const config = loadGradingConfig(values.config);
  const { forms, fingerprint, problems } = readForms({ config, predPath: values.pred, mode: MODE(values) });
  for (const i of problems.filter(x => x.level !== 'stop')) say(i.level + ' [' + i.trap + '] ' + i.where + ': ' + i.message);
  writeFile(values.out, renderGradingPage(forms, config, { fingerprint, forms_file: require('node:path').basename(values.pred) }));
  say(forms.length + ' form(s), ' + forms.length * config.fields.length + ' field(s) to grade. Open the page in a browser; it saves a grades file for: wfeval score --grades <file>');
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
  // Past this a count is not held exactly, and 1 of Infinity would print as a result (trap P27).
  if (!Number.isSafeInteger(tested)) throw new Error('rate: ' + positionals[1].slice(0, 30) + (positionals[1].length > 30 ? '...' : '') + ' records is too large to count exactly');
  const { rate } = require('../src/metrics/stats.js');
  const { targetCheck } = require('../src/metrics/target.js');
  const { renderRate } = require('../src/report/terminal.js');
  const opts = targetOptions(values);
  const x = { kind: 'rate', rate: rate(wrong, tested), target: opts.target === undefined ? null : targetCheck(wrong, tested, opts.target, { chance: opts.chance }) };
  report(renderRate, x);
  if (values.json) writeJson(values.json, x);
}

// estimate: a judge's answer key for every record, checked by a person on a sample (traps K1-K13).
function estimate(args) {
  const { values } = parseArgs({ args, options: {
    config: { type: 'string' }, pred: { type: 'string' }, 'judge-key': { type: 'string' }, key: { type: 'string' },
    lenient: { type: 'boolean' }, json: { type: 'string' }, target: { type: 'string' }, 'fail-if-not-shown': { type: 'boolean' }, picks: { type: 'string' },
    pick: { type: 'string' }, seed: { type: 'string' },
  } });
  const outputs = { '--json': values.json };
  apart(outputs, { '--config': values.config, '--pred': values.pred, '--judge-key': values['judge-key'], '--key': values.key, '--picks': values.picks });
  const { estimateRun, pickRun } = require('../src/estimate.js');
  const { renderEstimate, renderPick } = require('../src/report/estimate.js');
  // --pick <n>: before checking, which records to check (traps K10-K13). Checked before any file is read.
  if (values.pick !== undefined) {
    const extra = ['key', 'target', 'picks', 'fail-if-not-shown'].filter(k => values[k] !== undefined);
    if (extra.length) throw new Error('[K12] --pick chooses the records to check, before there is a person\'s key: it does not take ' + extra.map(k => '--' + k).join(' '));
    if (!/^\d+$/.test(values.pick) || Number(values.pick) < 1) throw new Error('[K10] --pick must be a whole number of 1 or more (the checks to make), got ' + JSON.stringify(values.pick));
    if (values.seed !== undefined && (!/^\d+$/.test(values.seed) || Number(values.seed) > 4294967295)) throw new Error('[K12] --seed must be a whole number from 0 to 4294967295, got ' + JSON.stringify(values.seed));
    need(values, ['config', 'pred', 'judge-key'], 'estimate --pick');
    const k = pickRun({ config: configFor(values.config, outputs), predPath: values.pred, judgeKeyPath: values['judge-key'], n: Number(values.pick),
      seed: values.seed === undefined ? 1 : Number(values.seed), mode: MODE(values), configPath: values.config });
    report(renderPick, k, values.json || null);
    if (values.json) writeJson(values.json, k);
    return 0;
  }
  if (values.seed !== undefined) throw new Error('[K12] --seed goes with --pick <n>: it chooses which records to check');
  need(values, ['config', 'pred', 'judge-key'], 'estimate');
  if (!values.key) {
    throw new Error('estimate needs --key <file>: the person\'s answer key for the records they checked. ' +
      'To choose which records to check first, run estimate with --pick <n> instead of --key');
  }
  if (values['fail-if-not-shown'] && values.target === undefined) throw new Error('--fail-if-not-shown goes with --target <percent>: it fails when the range is not wholly under the target');
  const target = values.target === undefined ? null : targetPercent(values);
  let e;
  try {
    e = estimateRun({ config: configFor(values.config, outputs), predPath: values.pred, judgeKeyPath: values['judge-key'], personKeyPath: values.key, mode: MODE(values), target, picksPath: values.picks || null });
  } catch (stop) {
    // Nothing out because every model call failed: with a gate, the gate's answer (trap P2).
    if (!stop.nothing_evaluated || !values['fail-if-not-shown']) throw stop;
    say('fail-if-not-shown: nothing was evaluated: ' + stop.nothing_evaluated);
    return 3;
  }
  report(renderEstimate, e);
  if (values.json) writeJson(values.json, e);
  if (values['fail-if-not-shown'] && e.nothing_evaluated) {
    say('fail-if-not-shown: nothing was evaluated: ' + e.nothing_evaluated.why);
    return 3;
  }
  if (values['fail-if-not-shown'] && !e.target.shown) {
    say('fail-if-not-shown: the likely range reaches ' + e.target.high_pct + '%, not wholly under ' + e.target.target_pct + '%');
    return 3;
  }
  return 0;
}

// monitor: live samples over time (src/monitor.js). Options checked before any file is read.
function monitor(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    config: { type: 'string' }, counts: { type: 'string' }, target: { type: 'string' }, acceptable: { type: 'string' },
    alarming: { type: 'string' }, 'false-alarm-every': { type: 'string' }, since: { type: 'string' },
    'fail-on-alarm': { type: 'boolean' }, lenient: { type: 'boolean' }, json: { type: 'string' }, 'period-size': { type: 'string' }, keys: { type: 'string' },
    watch: { type: 'string' }, 'segment-by': { type: 'string' }, segments: { type: 'string' },
  } });
  const outputs = { '--json': values.json };
  const keyFiles = values.keys ? positionals.map(f => require('node:path').join(values.keys, require('node:path').basename(f))) : [];
  apart(outputs, { '--config': values.config, '--counts': values.counts, 'a period file': positionals, 'a key file': keyFiles });
  const percent = flag => {
    if (values[flag] === undefined) return null;
    const v = decimal(values[flag]);
    if (!(v > 0 && v < 100)) throw new Error('--' + flag + ' must be a percentage above 0 and below 100, got ' + JSON.stringify(values[flag]));
    return v;
  };
  const every = values['false-alarm-every'] === undefined ? 2000 : decimal(values['false-alarm-every']);
  if (!(Number.isInteger(every) && every > 1)) throw new Error('--false-alarm-every must be a whole number of records, got ' + JSON.stringify(values['false-alarm-every']));
  // Checked as text, so the message shows what was typed ("abc"), not what Number() made of it.
  const size = values['period-size'];
  if (size !== undefined && !/^\d+$/.test(size)) throw new Error('--period-size must be a whole number of records, 1 or more, got ' + JSON.stringify(size));
  const opts = { target: percent('target'), acceptable: percent('acceptable'), alarming: percent('alarming'), falseAlarmEvery: every, since: values.since === undefined ? null : values.since, lenient: Boolean(values.lenient),
    periodSize: size === undefined ? null : Number(size) };
  // --watch and --segment-by: the series watched, and each segment's own alarm and bound.
  if (values.watch !== undefined) opts.watch = values.watch;
  if (values['segment-by'] !== undefined) opts.segmentBy = values['segment-by'];
  if (values.segments !== undefined) opts.segments = values.segments.split(',');
  if (values.counts && values.config) throw new Error('--counts holds counts scored elsewhere: it takes no --config');
  const { monitorRun } = require('../src/monitor.js');
  const { renderMonitor } = require('../src/report/monitor.js');
  const m = monitorRun({ config: values.config ? configFor(values.config, outputs) : null, runPaths: positionals, countsPath: values.counts || null, keysDir: values.keys || null, ...opts });
  if (values.config) m.inputs.config = values.config;
  report(renderMonitor, m);
  if (values.json) writeJson(values.json, m);
  // No check in any period the alarm counts: an alarm that read nothing has not passed (trap P2).
  if (values['fail-on-alarm'] && m.nothing_evaluated) { say('fail-on-alarm: nothing was evaluated: ' + m.nothing_evaluated.why); return 3; }
  // A segment's alarm stops the job too: a rise confined to one segment can hide in the whole.
  const segmentAlarms = m.segments ? m.segments.rows.filter(r => r.detector.status === 'alarm') : [];
  if (values['fail-on-alarm'] && (m.detector.status === 'alarm' || segmentAlarms.length)) {
    if (m.detector.status === 'alarm') say('fail-on-alarm: ALARM since ' + m.detector.alarm_since + ' (the rise likely started in ' + m.detector.rise_started + ')');
    for (const r of segmentAlarms) say('fail-on-alarm: ALARM in segment ' + r.segment + ' since ' + r.detector.alarm_since + ' (the rise likely started in ' + r.detector.rise_started + ')');
    return 3;
  }
  return 0;
}

// agree: Krippendorff's alpha among two or more graders' answer keys or grades files.
function agree(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    config: { type: 'string' }, keys: { type: 'boolean' }, grades: { type: 'boolean' }, names: { type: 'string' },
    output: { type: 'string', multiple: true }, lenient: { type: 'boolean' }, json: { type: 'string' },
    resamples: { type: 'string' }, seed: { type: 'string' }, 'write-key': { type: 'string' },
  } });
  if (Boolean(values.keys) === Boolean(values.grades)) throw new Error('agree needs exactly one of --keys <file> <file> ... or --grades <file> <file> ...');
  const outputs = { '--write-key': values['write-key'], '--json': values.json };
  apart(outputs, { '--config': values.config, [values.keys ? 'a key' : 'a grades file']: positionals });
  const whole = (k, min, max) => {
    if (values[k] === undefined) return undefined;
    const n = Number(values[k]);
    // Number('') is 0: an empty --seed= must not pass as seed 0.
    if (!/^[0-9]+$/.test(values[k]) || n < min || n > max) throw new Error('--' + k + ' must be a whole number from ' + min + ' to ' + max);
    return n;
  };
  const opts = { names: values.names ? values.names.split(',') : null, mode: MODE(values) };
  const resamples = whole('resamples', 100, 100000);
  const seed = whole('seed', 0, 4294967295);
  if (resamples !== undefined) opts.resamples = resamples;
  if (seed !== undefined) opts.seed = seed;
  const { agreeKeys, agreeGrades } = require('../src/agree.js');
  const { renderAgree } = require('../src/report/agree.js');
  let a;
  if (values.keys) {
    need(values, ['config'], 'agree --keys');
    // A key with only some outputs is one the full config refuses (D2, F4) and score stops on.
    if (values['write-key'] && values.output) throw new Error('--write-key writes a whole key, every output the config reads; it does not go with --output');
    const config = configFor(values.config, outputs);
    a = agreeKeys({ config, keyPaths: positionals, outputs: values.output || null, majority: Boolean(values['write-key']), ...opts });
    if (values['write-key']) {
      const { majorityKeyText } = require('../src/agree.js');
      const text = majorityKeyText(config, a.majority, values['write-key']);
      writeFile(values['write-key'], text);
      say(a.majority.written.length + ' record(s) in the majority key; ' + a.majority.left_out.length + ' record(s) left out, for a person to settle:');
      for (const x of a.majority.left_out) say('  ' + x.id + ': ' + x.why);
      if (a.majority.fields_left_out.length) {
        say('! ' + a.majority.fields_left_out.length + ' field(s) written without a value, the graders split on them (per-trap and per-group tables will put these records in "(none)"):');
        for (const x of a.majority.fields_left_out) say('  ' + x.id + ' ' + x.field + ': ' + x.values.map(v => JSON.stringify(v === undefined ? null : v)).join(' / '));
      }
      if (a.majority.left_out.length) {
        say(a.majority.left_out.length + ' records were left out: settle them and add them to the key, or score only the other records; score stops on a record with no answer (trap B4)');
      }
      const { majority, ...rest } = a;
      a = rest;
    }
  } else {
    const extra = ['config', 'output', 'write-key'].filter(k => values[k]);
    if (extra.length) throw new Error('agree --grades reads everything from the grades files; it does not take ' + extra.map(k => '--' + k).join(' '));
    a = agreeGrades({ gradePaths: positionals, ...opts });
  }
  report(renderAgree, a);
  if (values.json) writeJson(values.json, a);
  return 0;
}

// suspects: the answer-key entries most likely wrong, ranked for a person (traps N1-N19).
function suspects(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    config: { type: 'string' }, key: { type: 'string' }, rulings: { type: 'string' }, top: { type: 'string' },
    'write-rulings': { type: 'string' }, lenient: { type: 'boolean' }, json: { type: 'string' },
    'show-held-out': { type: 'boolean' },
  } });
  // N1, N9: checked before any file is read, so nothing is scored for a command that cannot finish.
  if (values.top !== undefined && (!/^\d+$/.test(values.top) || Number(values.top) < 1)) {
    throw new Error('[N1] --top must be a whole number of 1 or more (the suspects to list), got ' + JSON.stringify(values.top));
  }
  const top = values.top === undefined ? 20 : Number(values.top);
  const out = values['write-rulings'];
  if (out !== undefined) {
    const path = require('node:path');
    const folder = path.dirname(path.resolve(out));
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
      throw new Error('[N9] --write-rulings: the folder ' + folder + ' does not exist; name a file in a folder that does');
    }
    if (fs.existsSync(out)) throw new Error('[N9] --write-rulings writes a new file, and ' + out + ' already exists: it may hold a person\'s rulings. Name a new file');
    if (values.json && path.resolve(values.json) === path.resolve(out)) {
      throw new Error('[N9] --write-rulings and --json name the same file, ' + out + ': the rulings would replace the results. Name two files');
    }
  }
  const outputs = { '--write-rulings': out, '--json': values.json };
  apart(outputs, { '--config': values.config, '--key': values.key, '--rulings': values.rulings, 'a run': positionals });
  need(values, ['config', 'key'], 'suspects');
  const config = configFor(values.config, outputs);
  // config.split (traps O21-O24): the held-out records are left out, as suspects and as evidence;
  // --show-held-out lists them, a look recorded in split.log. A rulings file's stop counts them.
  const splitLook = splitOptions(values, config);
  const rulings = splitRulingsOf(values, config);
  const { suspectsRun, rulingsText } = require('../src/suspects.js');
  const { renderSuspects } = require('../src/report/suspects.js');
  // What a look lists (its identity, trap O8): --top's count, or every suspect when --json is written.
  const s = suspectsRun({ config, keyPath: values.key, predPaths: positionals, mode: MODE(values), rulings, ...splitLook,
    lookOptions: { listed: values.json ? 'all' : top } });
  report(renderSuspects, s, top);
  if (values.json) writeJson(values.json, s);
  if (out !== undefined) {
    const w = rulingsText(s, rulings, top);
    if (!w) {
      say('nothing written to ' + out + ': ' + (s.suspects.length ? 'every listed suspect already has a ruling' : 'there is no suspect to rule on'));
    } else {
      // 'wx': never over a file, even one that appeared after the check above.
      fs.writeFileSync(out, w.text, { flag: 'wx' });
      say('wrote ' + out);
      const others = !w.carried ? '' : w.replaced ? ', with the other ' + w.carried + ' ruling(s) of ' + rulings.file + ' as written'
        : ', after the ' + w.carried + ' ruling(s) of ' + rulings.file;
      // With a split (trap O24): the rulings on held-out records are copied as written (left out, they
      // would change the key score uses for the held-out half), counted here, never named.
      const r = s.split && s.split.rulings ? s.split.rulings.held_out : null;
      const heldOut = r ? Object.values(r).reduce((a, b) => a + b, 0) : 0;
      const copied = heldOut ? ' (' + heldOut + ' of them on held-out records, copied as written)' : '';
      say(w.fresh + ' listed suspect(s) written as pending' + (w.replaced ? ' (' + w.replaced + ' in place of rulings set aside)' : '') + others + copied +
        '. Fill in "by" and "on" for each and change "pending" to the ruling (the report lists the choices); a "proposed" left behind, or a ' +
        'keep\'s "with", is then dropped, with a note. Pass the file with --rulings: a ruling still pending reads as it is, and a decided one ' +
        'without "by" and "on" stops in strict mode (trap I13).');
    }
  }
  return 0;
}

const COMMANDS = { check, score, variance, compare, whatif, grade, rate: rateCmd, estimate, monitor, agree, suspects };

// What the language says at the edge of its limits, in words about this run (trap P35). What is
// listed here has a limit of its own, so a person is told what to change, never to read a stack.
function plainWords(e) {
  if (e instanceof RangeError && /string length/i.test(e.message)) return 'this run\'s results are too large to write out as one piece of text (over 512 MB): leave out --json or --html, or score fewer records at once';
  if (e instanceof RangeError && /call stack/i.test(e.message)) return 'a file nests too deeply, or a list is too long, for this command to read: check the input files';
  if (e instanceof RangeError && /allocation|array length/i.test(e.message)) return 'this run needs more memory than can be set aside: score fewer records at once';
  return e.message;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help') { console.log(USAGE); return 0; }
  if (!Object.hasOwn(COMMANDS, cmd)) { say('unknown or unbuilt command: ' + cmd);
    console.error('\n' + USAGE);
    return 2; }
  try {
    return COMMANDS[cmd](rest) || 0;
  } catch (e) {
    // An option the command does not have, or one given without its value, is a bad command
    // (exit 2), not a problem in the files. Node's own advice about '--' only confuses here.
    if (typeof e.code === 'string' && e.code.startsWith('ERR_PARSE_ARGS')) {
      say('bad command: ' + e.message.split('. To specify')[0] + ' (wfeval --help lists every command\'s options)');
      return 2;
    }
    console.error('error: ' + require('../src/text.js').escapeControls(plainWords(e), true));
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));

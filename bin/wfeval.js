#!/usr/bin/env node
// CLI entry. Parses arguments, dispatches to a subcommand, sets the exit code.
// No metric logic lives here - this file only connects the terminal to src/.
const fs = require('node:fs');
const { parseArgs } = require('node:util');
const { loadConfig, addGroupBy, addClusterBy, SEVERITIES } = require('../src/config.js');
const { loadRun } = require('../src/load.js');
const { loadRulings } = require('../src/rulings.js');
const { loadMix } = require('../src/mix.js');
const { scoreRun, varianceRun, compareRun, scoreGradesRun } = require('../src/score.js');
const { gateNames, worseOutcomes } = require('../src/metrics/runs.js');
const { renderTerminal, renderVariance, renderCompare, renderWhatif, renderGrades } = require('../src/report/terminal.js');
const { resultsJson } = require('../src/report/json.js');

const USAGE = `usage: wfeval <command> [options]

commands:
  check     --config <file> [--pred <file> --key <file>] [--lenient]
            validate a config, and optionally read a predictions file and answer key

  score     --config <file> --pred <file> --key <file> [--lenient] [--rulings <file>]
            [--json <file>] [--html <file>] [--quiet] [--fail-on <severity>]
            [--target <percent> [--chance 0.8|0.9|0.95]] [--group-by <field> ...]
            [--cluster-by <field>] [--mix <file>]
            score one run. --fail-on critical|high|medium|low exits with code 3 when a
            silent error or safeguard failure at or above that severity is found (for CI).
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
            --rulings reads a person's rulings on them (add, reject, pending): adds join the
            key for scoring (the key file is never changed), rejected gaps are no longer
            listed, and with pending rulings the silent error rate is also given as if they
            were all added

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
            several runs of identical code: mean and spread of every metric, the worst
            run's silent error rate (the one to quote), how many different records were a
            silent error in at least one run, the records that behave differently from run
            to run, and the possible key gaps, each with its ruling when --rulings is given

  compare   --config <file> --key <file> --before <file> --after <file>
            [--noise <run> --noise <run> ...] [--after-key <file>] [--rulings <file>]
            [--lenient] [--json <file>] [--fail-if-worse <outcomes>]
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
            [--false-alarm-every <records>] [--period-size <records>] [--since <period>] [--fail-on-alarm]
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

exit codes: 0 done · 1 a problem in the files or an option's value (listed) · 2 bad command
            (an unknown command or option, or an option given without its value) · 3 --fail-on,
            --fail-if-worse, --fail-on-alarm or --fail-if-not-shown triggered`;

const MODE = values => (values.lenient ? 'lenient' : 'strict');
function need(values, names, cmd) {
  const missing = names.filter(n => !values[n]);
  if (missing.length) throw new Error(cmd + ' needs ' + missing.map(n => '--' + n + ' <file>').join(' '));
}
// --target 5 and --chance 0.9, checked before any file is read.
function targetPercent(values) {
  const target = Number(values.target);
  if (!(target > 0 && target < 100)) throw new Error('--target must be a percentage above 0 and below 100, got ' + JSON.stringify(values.target));
  return target;
}
function targetOptions(values) {
  if (values.target === undefined) {
    if (values.chance !== undefined) throw new Error('--chance goes with --target <percent>');
    return {};
  }
  const target = targetPercent(values);
  const chance = values.chance === undefined ? 0.8 : Number(values.chance);
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
  const confidence = values.confidence === undefined ? 0.95 : Number(values.confidence);
  if (![0.9, 0.95, 0.99].includes(confidence)) throw new Error('--confidence must be 0.9, 0.95 or 0.99');
  return { target, confidence };
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
    // Collected as a list only to refuse a second one: the last would otherwise win unseen.
    'cluster-by': { type: 'string', multiple: true },
    mix: { type: 'string' },
  } });
  const failOn = values['fail-on'];
  if (failOn !== undefined && !SEVERITIES.includes(failOn)) throw new Error('--fail-on must be one of: ' + SEVERITIES.join(', '));
  if (values.grades || values['second-reviewer']) return scoreGrades(values, failOn);
  need(values, ['config', 'pred', 'key'], 'score');
  const clusterBy = values['cluster-by'] || [];
  if (clusterBy.length > 1) throw new Error('--cluster-by takes one field: a record is in one cluster, got ' + clusterBy.map(c => JSON.stringify(c)).join(', '));

  let config = loadConfig(values.config);
  if (values['group-by']) config = addGroupBy(config, values['group-by']);
  if (clusterBy.length) config = addClusterBy(config, clusterBy[0]);
  // --mix <file>: read and checked before the run is scored, against the groups --group-by added (trap G18).
  const mix = values.mix ? loadMix(values.mix, config) : null;
  const results = scoreRun({ config, predPath: values.pred, keyPath: values.key, mode: MODE(values), rulings: rulingsOf(values, config), mix, ...targetOptions(values) });
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
  const extra = ['config', 'pred', 'key', 'html', 'group-by', 'cluster-by', 'rulings', 'mix'].filter(k => values[k]);
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
  if (c.clusters) console.log('  clusters    ' + c.clusters.from + ' field "' + c.clusters.field + '" (the silent error rate\'s range also counts clusters)');
  const t = c.thresholds;
  if (!t) {
    console.log('  thresholds  not set');
  } else {
    const gates = Object.entries(t.auto_publish).map(([f, v]) => f + ' >= ' + (typeof v === 'string' ? 'each record\'s own "' + v + '"' : v)).join(', ') || 'none';
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
    // Repeatable, and the lists add up: a second flag never silently replaces the first.
    'fail-if-worse': { type: 'string', multiple: true },
  } });
  const gates = values['fail-if-worse'] ? gateNames(values['fail-if-worse']) : null;
  need(values, ['config', 'key', 'before', 'after'], 'compare');
  const config = loadConfig(values.config);
  const c = compareRun({
    config, keyPath: values.key, afterKeyPath: values['after-key'] || null, beforePath: values.before, afterPath: values.after,
    noisePaths: values.noise || [], mode: MODE(values), rulings: rulingsOf(values, config),
  });
  // Read before the report is printed, so a named outcome this compare does not measure stops
  // as an input problem instead of following a report that looks like a pass (trap I19).
  const worse = gates ? worseOutcomes(c.paired, gates) : [];
  process.stdout.write(renderCompare(c));
  if (values.json) writeFile(values.json, JSON.stringify(resultsJson(c), null, 2) + '\n');
  if (worse.length) {
    console.error('fail-if-worse ' + gates.join(',') + ': ' + worse.map(o => o.flag + ' (fixed ' + o.fixed + ', broke ' + o.broke + ')').join(', '));
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
  } });
  need(values, ['config', 'pred', 'key'], 'whatif');
  const holdIf = values['hold-if'] || [];
  if (holdIf.length && (values.gate || values.floor)) throw new Error('--hold-if goes with --policies or alone, not with --gate or --floor');
  const policyMode = Boolean(values.policies) || holdIf.length > 0;
  if ([values.gate, values.floor, policyMode].filter(Boolean).length !== 1) throw new Error('whatif needs exactly one of --gate, --floor or --policies (or --hold-if)');
  const sweepOnly = ['output', 'from', 'to', 'step'].filter(k => values[k] !== undefined);
  if (policyMode && sweepOnly.length) throw new Error(sweepOnly.map(k => '--' + k).join(' ') + ' go(es) with --gate or --floor: a policy names its own thresholds');
  const certify = certifyOptions(values);
  let config = loadConfig(values.config);
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
  const { paired, problems: loaded } = scoreRun({ config, predPath: values.pred, keyPath: values.key, mode: MODE(values) });
  if (policyMode) {
    const { checkPolicyData } = require('../src/policy.js');
    const { policySweep } = require('../src/metrics/policy.js');
    // One file passed as both, by name or by content: its key-side fields are the key's (E17).
    const sameFile = require('node:path').resolve(values.pred) === require('node:path').resolve(values.key) ||
      fs.readFileSync(values.pred).equals(fs.readFileSync(values.key));
    checkPolicyData(policies, paired, config, p, { sameFile });
    p.throwIfStopped();
    const w = { ...policySweep(paired, config, policies, certify), problems: [...loaded, ...p.items] };
    process.stdout.write(renderWhatif(w));
    if (values.json) writeFile(values.json, JSON.stringify(resultsJson({ inputs: { predictions: values.pred, key: values.key, ...(values.policies ? { policies: values.policies } : {}) }, ...w }), null, 2) + '\n');
    return;
  }
  const opts = {};
  for (const k of ['from', 'to', 'step']) {
    if (values[k] === undefined) continue;
    opts[k] = Number(values[k]);
    if (!Number.isFinite(opts[k])) throw new Error('--' + k + ' must be a number');
  }
  const { gateSweep, floorSweep } = require('../src/metrics/whatif.js');
  const w = values.gate ? gateSweep(paired, config, { ...opts, ...certify, outputs: values.output ? [values.output] : null }) : floorSweep(paired, config, opts);
  process.stdout.write(renderWhatif({ ...w, problems: loaded }));
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

// estimate: a judge's answer key for every record, checked by a person on a sample (traps K1-K13).
function estimate(args) {
  const { values } = parseArgs({ args, options: {
    config: { type: 'string' }, pred: { type: 'string' }, 'judge-key': { type: 'string' }, key: { type: 'string' },
    lenient: { type: 'boolean' }, json: { type: 'string' }, target: { type: 'string' }, 'fail-if-not-shown': { type: 'boolean' }, picks: { type: 'string' },
    pick: { type: 'string' }, seed: { type: 'string' },
  } });
  const { estimateRun, pickRun } = require('../src/estimate.js');
  const { renderEstimate, renderPick } = require('../src/report/estimate.js');
  // --pick <n>: before checking, which records to check (traps K10-K13). Checked before any file is read.
  if (values.pick !== undefined) {
    const extra = ['key', 'target', 'picks', 'fail-if-not-shown'].filter(k => values[k] !== undefined);
    if (extra.length) throw new Error('[K12] --pick chooses the records to check, before there is a person\'s key: it does not take ' + extra.map(k => '--' + k).join(' '));
    if (!/^\d+$/.test(values.pick) || Number(values.pick) < 1) throw new Error('[K10] --pick must be a whole number of 1 or more (the checks to make), got ' + JSON.stringify(values.pick));
    if (values.seed !== undefined && (!/^\d+$/.test(values.seed) || Number(values.seed) > 4294967295)) throw new Error('[K12] --seed must be a whole number from 0 to 4294967295, got ' + JSON.stringify(values.seed));
    need(values, ['config', 'pred', 'judge-key'], 'estimate --pick');
    const k = pickRun({ config: loadConfig(values.config), predPath: values.pred, judgeKeyPath: values['judge-key'], n: Number(values.pick),
      seed: values.seed === undefined ? 1 : Number(values.seed), mode: MODE(values), configPath: values.config });
    process.stdout.write(renderPick(k, values.json || null));
    if (values.json) writeFile(values.json, JSON.stringify(resultsJson(k), null, 2) + '\n');
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
  const e = estimateRun({ config: loadConfig(values.config), predPath: values.pred, judgeKeyPath: values['judge-key'], personKeyPath: values.key, mode: MODE(values), target, picksPath: values.picks || null });
  process.stdout.write(renderEstimate(e));
  if (values.json) writeFile(values.json, JSON.stringify(resultsJson(e), null, 2) + '\n');
  if (values['fail-if-not-shown'] && !e.target.shown) {
    console.error('fail-if-not-shown: the likely range reaches ' + e.target.high_pct + '%, not wholly under ' + e.target.target_pct + '%');
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
  } });
  const percent = flag => {
    if (values[flag] === undefined) return null;
    const v = Number(values[flag]);
    if (!(v > 0 && v < 100)) throw new Error('--' + flag + ' must be a percentage above 0 and below 100, got ' + JSON.stringify(values[flag]));
    return v;
  };
  const every = values['false-alarm-every'] === undefined ? 2000 : Number(values['false-alarm-every']);
  if (!(Number.isInteger(every) && every > 1)) throw new Error('--false-alarm-every must be a whole number of records, got ' + JSON.stringify(values['false-alarm-every']));
  // Checked as text, so the message shows what was typed ("abc"), not what Number() made of it.
  const size = values['period-size'];
  if (size !== undefined && !/^\d+$/.test(size)) throw new Error('--period-size must be a whole number of records, 1 or more, got ' + JSON.stringify(size));
  const opts = { target: percent('target'), acceptable: percent('acceptable'), alarming: percent('alarming'), falseAlarmEvery: every, since: values.since === undefined ? null : values.since, lenient: Boolean(values.lenient),
    periodSize: size === undefined ? null : Number(size) };
  if (values.counts && values.config) throw new Error('--counts holds counts scored elsewhere: it takes no --config');
  const { monitorRun } = require('../src/monitor.js');
  const { renderMonitor } = require('../src/report/monitor.js');
  const m = monitorRun({ config: values.config ? loadConfig(values.config) : null, runPaths: positionals, countsPath: values.counts || null, keysDir: values.keys || null, ...opts });
  if (values.config) m.inputs.config = values.config;
  process.stdout.write(renderMonitor(m));
  if (values.json) writeFile(values.json, JSON.stringify(resultsJson(m), null, 2) + '\n');
  if (values['fail-on-alarm'] && m.detector.status === 'alarm') {
    console.error('fail-on-alarm: ALARM since ' + m.detector.alarm_since + ' (the rise likely started in ' + m.detector.rise_started + ')');
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
    const config = loadConfig(values.config);
    a = agreeKeys({ config, keyPaths: positionals, outputs: values.output || null, majority: Boolean(values['write-key']), ...opts });
    if (values['write-key']) {
      const { majorityKeyText } = require('../src/agree.js');
      const text = majorityKeyText(config, a.majority, values['write-key']);
      writeFile(values['write-key'], text);
      console.error(a.majority.written.length + ' record(s) in the majority key; ' + a.majority.left_out.length + ' record(s) left out, for a person to settle:' +
        a.majority.left_out.map(x => '\n  ' + x.id + ': ' + x.why).join(''));
      if (a.majority.fields_left_out.length) {
        console.error('! ' + a.majority.fields_left_out.length + ' field(s) written without a value, the graders split on them (per-trap and per-group tables will put these records in "(none)"):' +
          a.majority.fields_left_out.map(x => '\n  ' + x.id + ' ' + x.field + ': ' + x.values.map(v => JSON.stringify(v === undefined ? null : v)).join(' / ')).join(''));
      }
      if (a.majority.left_out.length) {
        console.error(a.majority.left_out.length + ' records were left out: settle them and add them to the key, or score only the other records; score stops on a record with no answer (trap B4)');
      }
      const { majority, ...rest } = a;
      a = rest;
    }
  } else {
    const extra = ['config', 'output', 'write-key'].filter(k => values[k]);
    if (extra.length) throw new Error('agree --grades reads everything from the grades files; it does not take ' + extra.map(k => '--' + k).join(' '));
    a = agreeGrades({ gradePaths: positionals, ...opts });
  }
  process.stdout.write(renderAgree(a));
  if (values.json) writeFile(values.json, JSON.stringify(resultsJson(a), null, 2) + '\n');
  return 0;
}

const COMMANDS = { check, score, variance, compare, whatif, grade, rate: rateCmd, estimate, monitor, agree };

function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help') { console.log(USAGE); return 0; }
  if (!COMMANDS[cmd]) { console.error('unknown or unbuilt command: ' + cmd + '\n\n' + USAGE); return 2; }
  try {
    return COMMANDS[cmd](rest) || 0;
  } catch (e) {
    // An option the command does not have, or one given without its value, is a bad command
    // (exit 2), not a problem in the files. Node's own advice about '--' only confuses here.
    if (typeof e.code === 'string' && e.code.startsWith('ERR_PARSE_ARGS')) {
      console.error('bad command: ' + e.message.split('. To specify')[0] + ' (wfeval --help lists every command\'s options)');
      return 2;
    }
    console.error('error: ' + e.message);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));

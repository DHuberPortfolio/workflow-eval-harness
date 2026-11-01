// Terminal text for `wfeval estimate` (src/estimate.js): the silent error rate from a judge's
// answer key checked by a person. Wording from format.js and docs/READING_A_REPORT.md.

const { pct, count, range, num, table } = require('./format.js');

const f1 = x => x.toFixed(1) + '%';
const records = n => n + ' record' + (n === 1 ? '' : 's');
const yesNo = b => (b ? 'silent error' : 'fine');

// What the estimate rests on: said every time, since neither can be checked from the files.
const ASSUMES = 'It assumes the person picked the records they checked at random (from all the records out, or within each judge verdict group) ' +
  'and checked them without seeing the judge\'s verdict.';

function headline(e) {
  const est = e.estimate;
  if (est.pct === null) {
    const g = e.unchecked_groups.map(x => 'the records the judge ' + (x === 'flagged' ? 'flags' : 'passes')).join(' and ');
    return 'No estimate: none of ' + g + ' was checked, so their rate could be anything from 0% to 100%.\n' +
      '  What can be said: the silent error rate is between ' + f1(est.low_pct) + ' and ' + f1(est.high_pct) + ' (95%), counting them at 0% for the low end and 100% for the high.';
  }
  const n = e.checked.flagged.n + e.checked.passed.n;
  const m = est.worth_records === null ? null : Math.round(est.worth_records);
  const worth = m === null ? '' : '\n  That is worth about ' + m + ' records checked by a person alone: a person\'s own range would be this narrow from about ' + m +
    ' (the person checked ' + n + ').';
  return f1(est.pct) + ' of the ' + e.out + ' records that went out without review are estimated to be silent errors.\n' +
    '  The true rate on records like these is likely between ' + f1(est.low_pct) + ' and ' + f1(est.high_pct) + ' (95% range).' + worth;
}

// What the judge's key covers: every record, or the records out without review (all it needs).
const judgeCovers = e => (e.judge_records >= e.records ? 'every record'
  : e.judge_records === e.out ? e.out + ' records: the ones that went out without review'
  : e.judge_records + ' records, among them every one of the ' + e.out + ' that went out without review');

function renderEstimate(e) {
  const c = e.checked;
  const parts = [];
  parts.push('ESTIMATE  ' + e.inputs.predictions + '\n  judge\'s answer key: ' + e.inputs.judge_key + ' (' + judgeCovers(e) + ')\n  person\'s answer key: ' + e.inputs.person_key +
    ' (' + records(c.flagged.n + c.passed.n) + ' checked among the records out)\n\n' +
    e.records + ' records · ' + e.out + ' went out without review · ' + e.inputs.mode + ' mode');
  parts.push('SILENT ERROR RATE, JUDGE CHECKED BY A PERSON\n  ' + headline(e) + '\n  ' + ASSUMES);

  const po = e.person_only;
  const rows = [
    ['', 'rate', 'count', 'likely range', 'what it is'],
    ['Judge alone', pct(e.judge.rate), count(e.judge.rate), range(e.judge.rate), 'the rate if the judge were always right'],
    po.looks_random
      ? ['Person alone', pct(po.rate), count(po.rate), range(po.rate), 'the person\'s checks on their own: a fair rate only if the checks were picked at random from all the records out, not by the judge\'s verdict as --pick does']
      : ['Person alone', 'n/a', count(po.rate), '', po.why_not === 'picked_by_verdict'
        ? 'not a fair rate: the picks file says they were picked by the judge\'s verdict, not at random from all the records out'
        : 'not a fair rate: the checks hold ' + f1(po.flagged_share_pct) + ' judge flags, the run ' + f1(po.run_flagged_share_pct)],
  ];
  parts.push('FOR CONTRAST\n' + table(rows, [1, 2, 3]));

  const W = { flagged: e.judge.flagged, passed: e.out - e.judge.flagged };
  const g = name => [name === 'flagged' ? 'The judge flags' : 'The judge passes', String(W[name]), String(c[name].n), String(c[name].errors),
    c[name].n ? f1(100 * c[name].errors / c[name].n) : 'not checked'];
  const n = c.flagged.n + c.passed.n;
  const bunchedWarned = e.problems.some(x => x.trap === 'K7');
  parts.push('BY THE JUDGE\'S VERDICT\n' + table([['', 'records out', 'checked', 'silent errors found', 'rate in the checks'], g('flagged'), g('passed')], [1, 2, 3, 4]) + '\n  ' +
    (e.split === 'pick' && bunchedWarned ? 'The checks are split the way estimate --pick splits ' + n + ', but within a verdict group they may not have been picked at random (the K7 warning below).'
      : e.split === 'pick' ? 'The checks are split the way estimate --pick splits ' + n + ' checks, the recommended way.'
      : 'The checks are not split the way estimate --pick would split ' + n + ': fine if they were picked at random, from all the records out or within each verdict group.'));

  const q = e.judge_quality;
  parts.push('THE JUDGE, ON THE CHECKED RECORDS\n' +
    '  Of the ' + q.person_errors + ' silent error' + (q.person_errors === 1 ? '' : 's') + ' the person found, the judge caught ' + q.judge_caught + '.\n' +
    '  Of the ' + q.judge_flags_checked + ' judge flag' + (q.judge_flags_checked === 1 ? '' : 's') + ' the person checked, the person confirmed ' + q.person_confirmed + '.\n' +
    '  Agreement beyond chance (Cohen\'s kappa): ' + (q.judge_flags_checked === 0 || q.judge_flags_checked === n
      ? 'not informative: the judge gave every checked record the same verdict, so there is nothing to compare'
      : q.kappa === null ? 'not measurable (both gave every checked record the same verdict)' : num(q.kappa)) + '.\n' +
    '  A wrong judge does not bias the estimate (the person\'s checks set each group\'s rate); it widens the range.');

  if (e.disagreements.length) {
    const lines = e.disagreements.map(d => [d.id, yesNo(d.judge) + (d.judge_types.length ? ' (' + d.judge_types.join(', ') + ')' : ''),
      yesNo(d.person) + (d.person_types.length ? ' (' + d.person_types.join(', ') + ')' : '')]);
    parts.push('WHERE THE JUDGE AND THE PERSON DISAGREE  (' + e.disagreements.length + '; useful for fixing the judge)\n' + table([['id', 'judge', 'person'], ...lines]));
  }
  if (e.picks && e.picks.exact) parts.push('PICKS  Checked exactly the ' + e.picks.n + ' records picked in ' + e.picks.file + (e.picks.seed === null ? '' : ' (seed ' + e.picks.seed + ')') + '.');
  if (c.not_out.length) parts.push('LEFT OUT  ' + records(c.not_out.length) + ' checked but not out without review: ' + c.not_out.join(' '));

  if (e.target) {
    const t = e.target;
    const lines = ['TARGET  under ' + t.target_pct + '%'];
    if (t.shown) lines.push('  Shown: the whole likely range is under ' + t.target_pct + '% (its high end is ' + f1(t.high_pct) + ').');
    else if (e.estimate.pct === null) lines.push('  Not shown, and no estimate to plan from: check some records in every verdict group first.');
    else if (t.at_or_above) lines.push('  Not shown: the estimate itself is at or above ' + t.target_pct + '%. More checks cannot show it is under; the rate has to come down first.');
    else if (t.more) {
      lines.push('  Not shown yet: the high end is ' + f1(t.high_pct) + '.', '  About ' + t.more.total + ' more checks would show it if each group\'s rate stayed where it is: ' +
        t.more.flagged + ' more of the records the judge flags and ' + t.more.passed + ' more of the ones it passes (the split needing the fewest).',
      '  A break-even guide, not a plan: a fresh sample that size lands under the target only about half the time.');
    } else if (t.why === 'all_records_checked' && n === e.out) {
      lines.push('  Not shown, and every record out without review was checked: the range is for records like these (the rate a fresh record would have), ' +
        'so only more records out can narrow it.');
    } else if (t.why === 'all_records_checked') {
      lines.push('  Not shown, and even checking every record out would not show it at these rates: ' + e.out + ' records out are too few to pin the rate down that far. ' +
        'More records out are needed.');
    } else lines.push('  Not shown, and the search for how many more checks would show it stopped past 200,000 more: far more records would have to be checked.');
    parts.push(lines.join('\n'));
  }
  const notes = e.problems.filter(i => i.level !== 'stop');
  if (notes.length) parts.push('WARNINGS AND CLEAN-UPS\n' + notes.map(i => '  ' + i.level + ' [' + i.trap + '] ' + i.where + ': ' + i.message).join('\n'));
  return parts.join('\n\n') + '\n';
}

// estimate --pick: the records a person should check, before anyone checks.
// picksFile: the file --json saves the pick to, if any, for the next step's --picks.
function renderPick(k, picksFile = null) {
  const a = k.allocation;
  const parts = ['PICK  ' + records(k.n) + ' to check, of the ' + k.out + ' that went out without review  (' + k.inputs.predictions + ', seed ' + k.seed + ')',
    'Check these records without looking at the judge\'s verdict, and write your own answer key for them alone:\n  ' + k.picks.join(' '),
    'How they were chosen: ' + a.flagged + ' of the ' + k.flagged + ' records the judge flags and ' + a.passed + ' of the ' + (k.out - k.flagged) + ' it passes, at random within each.\n' +
    '  That split gives the narrowest range when errors are rare (docs/METRICS.md, "Which records to check"). The same seed picks the same records.\n' +
    '  Then: wfeval estimate --config ' + (k.inputs.config || '<config>') + ' --pred ' + k.inputs.predictions + ' --judge-key ' + k.inputs.judge_key + ' --key <your answer key>' + (picksFile ? ' --picks ' + picksFile : '')];
  const notes = k.problems.filter(i => i.level !== 'stop');
  if (notes.length) parts.push('WARNINGS AND CLEAN-UPS\n' + notes.map(i => '  ' + i.level + ' [' + i.trap + '] ' + i.where + ': ' + i.message).join('\n'));
  return parts.join('\n\n') + '\n';
}

module.exports = { renderEstimate, renderPick };

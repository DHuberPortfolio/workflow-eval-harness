// The terminal report for wfeval monitor: one row per period, then the two answers in plain words
// (has the silent error rate gone up? is it shown under the target?), then what the alarm is
// tuned to. Renders the object monitorRun returns; --json writes that same object.
// With --watch silent-omissions the same report speaks of the records blocked or suppressed and the
// share of them wrongly left out (SERIES); with segments, a table of them follows the whole's
// report, and the whole's numbers say what the segments changed.

const { pct, range, nothingLine, thousands, sized } = require('./format.js');
const { SERIES } = require('../metrics/monitor.js');

// A percentage to the decimals it was stored with, at least one: an upper bound of 4.98% keeps
// both, and --target 0.05 prints as 0.05%, not 0.1% (L16).
const pv = x => x.toFixed(Math.max(1, (String(x).split('.')[1] || '').length)) + '%';
const p1 = x => pv(Number(x));
const pad = (s, w) => String(s).padEnd(w);
const lpad = (s, w) => String(s).padStart(w);
// The series watched, in words: the default's are the report's words as they always were.
const wordsOf = m => SERIES[m.watch || 'silent-errors'];
const omissions = m => m.watch === 'silent-omissions';
// The two count columns' widths: 6 and 8 for "out" and "silent", wider for longer headings.
const widths = w => [Math.max(6, w.column.length + 2), Math.max(8, w.hitColumn.length + 2)];
const toAlarm = c => (c ? (c.level_pct > 999 ? '>999%' : c.level_pct.toFixed(0) + '%') : '');
// The segments' alarms share the budget (a sentence's worth of what changed for the whole).
const sharing = m => Boolean(m.segments && m.segments.without_segments);
const PROVISIONAL = 'Provisional: a segment that first appears later can take this back: name the segments with --segments, chosen before the first period counted, to make it final.';
// A "shown" mark that a later segment can take back (the family not named in advance).
const shownMark = r => (r.shown ? (r.provisional ? '  shown*' : '  shown') : '');
const PROVISIONAL_KEY = '  * provisional: a segment that first appears later can take it back (see SEGMENTS)';

function table(m) {
  const w = wordsOf(m), [c1, c2] = widths(w);
  const head = '  ' + pad('period', 14) + lpad(w.column, c1) + lpad(w.hitColumn, c2) + '  ' + pad('rate', 9) + pad('likely range', 14) + lpad('to alarm', 9) + '  ' + pad('status', 12) + lpad('upper bound', 12);
  const rows = m.periods.map(r => {
    const status = !r.counted ? 'before --since' : r.alarm ? 'ALARM' : 'in control';
    // (before --since: the alarm restarted after it; the bound still counts it)
    const shown = shownMark(r);
    return '  ' + pad(r.period, 14) + lpad(r.rate.d, c1) + lpad(r.rate.n, c2) + '  ' + pad(r.rate.d === 0 ? w.none : pct(r.rate), 9) + pad(range(r.rate), 14) +
      lpad(toAlarm(r.cusum), 9) + '  ' + pad(status, 12) + lpad(r.upper_pct === null ? '' : pv(r.upper_pct), 12) + shown;
  });
  return [head, ...rows, ...(m.periods.some(r => r.provisional) ? [PROVISIONAL_KEY] : [])].join('\n');
}

function detectorSection(m) {
  const s = m.settings, d = m.detector, w = wordsOf(m);
  const lines = [];
  if (d.status === 'alarm') {
    lines.push('HAS IT GONE UP?  ALARM since ' + d.alarm_since + ': the ' + w.rate + ' has likely risen above the acceptable ' + p1(s.acceptable_pct) + '.');
    lines.push('The rise likely started in ' + d.rise_started + ' (the period after the CUSUM last stood at 0). Find what changed then, fix it, and restart the alarm with --since <the first period after the fix>. The bound below keeps counting every period: a restart picked after an alarm is picked by the numbers.');
  } else {
    lines.push('HAS IT GONE UP?  No alarm: no sign yet that the ' + w.rate + ' has risen above the acceptable ' + p1(s.acceptable_pct) + '. The CUSUM stands at ' + d.level_pct.toFixed(0) + '% of its alarm level.');
  }
  const alone = sharing(m) ? m.segments.without_segments : null;
  lines.push('How: the CUSUM adds up, period by period, how much likelier each period\'s count is at ' + p1(s.alarming_pct) + ' than at ' + p1(s.acceptable_pct) +
    ', never going below 0, and alarms when the total reaches its alarm level (Page 1954). The "to alarm" column is that total as a share of the alarm level. ' +
    'One period\'s rate alone is noisy; the total weighs every period by its records. ' +
    'Alarm level ' + s.alarm_at + (s.alarm_at === 1 ? ' step' : ' steps') + (alone ? ' (' + alone.alarm_at + ' without --segment-by)' : '') + ', for periods of ' + s.period_size + ' records (' + (s.period_size_pinned ? '--period-size' : 'the median so far') + '); ' +
    'each row\'s status used the level for the periods up to it, so a status once printed does not change as periods are added.');
  if (alone && alone.alarm_since !== null && d.status !== 'alarm') {
    lines.push('Without segments, the whole\'s alarm (set for ' + thousands(s.false_alarm_every) + ') would have gone off in ' + alone.alarm_since + '. With segments it shares the budget and is set for ' +
      thousands(s.alarm_set_for) + ', so it has not: read the segments below, or run without --segment-by to watch the whole on its own budget.');
  }
  if (!s.acceptable_given) {
    lines.push(omissions(m)
      ? '--acceptable was not given: the acceptable rate is half the target. Set it to the share the workflow normally leaves out wrongly, measured before launch: ' +
        'monitor --watch silent-omissions on the golden-set run file, as a single period (score\'s silent omission rate counts a different base), or the first weeks checked. ' +
        'The alarm watches for a rise from it, and dates the rise by it.'
      : '--acceptable was not given: the acceptable rate is half the target. Set it to the rate the workflow normally runs at, measured before launch ' +
        '(score on a golden set, or the first weeks checked): the alarm watches for a rise from it, and dates the rise by it.');
  }
  return lines.join('\n  ');
}

function boundSection(m) {
  const b = m.bound, w = wordsOf(m);
  if (!b) return null;
  const under = p1(b.target_pct);
  const from = b.records + ' ' + w.base + ', ' + b.silent + ' ' + (b.silent === 1 ? w.hit : w.hits);
  const lines = [];
  if (b.shown) {
    lines.push('SHOWN UNDER ' + under + '  since ' + b.shown_since + ': the true ' + w.rate + ' is under ' + under + ' (upper bound ' + pv(b.upper_pct) + ', from ' + from + '), valid however often you look.' +
      (b.provisional ? ' ' + PROVISIONAL : ''));
  } else {
    lines.push('NOT SHOWN UNDER ' + under + (b.last_shown ? ' now' : ' yet') + ': upper bound ' + (b.upper_pct === null ? 'not measured' : pv(b.upper_pct)) + ', from ' + from + '.' +
      (b.last_shown ? ' It was shown in ' + b.last_shown + '; the ' + w.hits + ' since have taken the evidence back below the bar.' : ''));
  }
  lines.push('How: the upper bound is a confidence sequence (Robbins 1970): it is valid however often you look, so checking it every period and acting the first time it says "under ' + under +
    '" is safe. The chance it ever shows "under ' + under + '" when the true rate is ' + under + ' or more is at most 5%. ' +
    'The likely range of one period, or of all periods added up, is not: looked at every period, it shows "under" by luck far more often (docs/METRICS.md).');
  if (m.segments) {
    lines.push('With segments, the whole is checked together with them, so it needs more evidence before it is called shown: a bar of ' + b.bar.toFixed(1) + ' here, against 20 alone. ' +
      'That keeps one 5% for every "shown" in this report (see SEGMENTS). The bar is 20 plus the segments\' average shortfall below 20, so between 20 and 40.');
  }
  lines.push('The price of looking any time: with no ' + w.hit + ' at all, ' + sized(b.perfect_run.anytime, w.base) + ' show it' + (m.segments ? ' at that bar' : '') + ', against ' +
    thousands(b.perfect_run.fixed) + ' for one test of a size fixed in advance (' + w.fixedTest + ').');
  if (m.detector.status === 'alarm') {
    lines.push('With an alarm raised, read this bound as the periods together, not as the rate now: the alarm says the rate has likely risen since ' + m.detector.rise_started + '.');
  }
  return lines.join('\n  ');
}

function designSection(m) {
  const s = m.settings, g = m.design, w = wordsOf(m);
  const alone = sharing(m) ? m.segments.without_segments : null;
  // With segments the whole's alarm is set for twice the records asked: it shares the budget.
  const asked = alone
    ? 'at least the ' + thousands(s.alarm_set_for) + ' the whole\'s alarm is set for, for periods of ' + g.period_size + ' records: with segments, the whole and the segments share the ' +
      thousands(s.false_alarm_every) + ' asked for with --false-alarm-every'
    : 'at least the ' + thousands(s.false_alarm_every) + ' asked for with --false-alarm-every, for periods of ' + g.period_size + ' records';
  const stepsUp = omissions(m) ? 'the ' + s.scores.up + ' steps up for a ' + w.hit : 'a ' + w.hit + '\'s ' + s.scores.up + ' steps up';
  return 'TUNED TO  a rise to ' + p1(s.alarming_pct) + ' would be flagged after about ' + thousands(g.detect_records) + ' records on average' +
    (alone ? ' (' + thousands(alone.detect_records) + ' without segments)' : '') + ', counted from the rise with the CUSUM at 0 (about ' + g.detect_periods.toFixed(1) +
    ' periods of ' + g.period_size + '); about one false alarm per ' + thousands(g.false_alarm_records) + ' records checked when the rate is ' +
    p1(s.acceptable_pct) + ' (' + asked + ').\n  ' +
    'The CUSUM adds up evidence at any rate above ' + p1(g.break_even_pct) + ' (where ' + stepsUp + ' balance the right records\' ' + s.scores.down +
    ' steps down), so a rate under the alarming one is flagged too, only later' +
    (g.under_target ? ': at ' + p1(g.under_target.rate_pct) + ', just under the target, an alarm comes after about ' + thousands(g.under_target.records) + ' records' : '') + '.\n  ' +
    'All from a Markov chain of the CUSUM (Brook & Evans 1972) for periods of ' + g.period_size + ' records (' + (s.period_size_pinned ? '--period-size' : 'the median') + '). ' +
    'Fewer false alarms mean slower flags. A bigger rise is flagged sooner; a smaller one, later.';
}

// Each segment: one row (its records, its rate, where its alarm stands, its bound), then the two
// answers for the segments, and how the alarms and the bounds count them together.
function segmentSection(m) {
  const g = m.segments, w = wordsOf(m), s = m.settings, [c1, c2] = widths(w);
  const source = g.from === 'counts file' ? 'counts file column "' + g.by + '"' : (g.from === 'key' ? 'answer key' : 'predictions') + ' field "' + g.by + '"';
  const family = g.declared ? g.declared.length + ' named with --segments, and (other) and (none): ' + g.members + ' in all' : g.members + ' segment(s)';
  const head = 'SEGMENTS  by ' + g.by + ' (' + source + ') · ' +
    (g.rows.length ? family + ', each with its own alarm and bound, beside the whole\'s above' : 'no segment has ' + w.base + ' checked');
  const bounds = g.rows.some(r => r.bound);
  // Without a target there is no bound: no column for it, and no spaces left at the line ends.
  const cols = ('  ' + pad('segment', 14) + lpad(w.column, c1) + lpad(w.hitColumn, c2) + '  ' + pad('rate', 9) + pad('likely range', 14) + lpad('to alarm', 9) + '  ' + pad('status', 12) + (bounds ? 'upper bound' : '')).trimEnd();
  const rows = g.rows.map(r => {
    const b = r.bound;
    const last = r.periods[r.periods.length - 1];
    const bound = !b ? '' : b.too_few ? 'too few: ' + thousands(b.too_few.needed) + ' needed' : pv(b.upper_pct) + shownMark(last);
    return ('  ' + pad(r.segment, 14) + lpad(r.records, c1) + lpad(r.silent, c2) + '  ' + pad(pct(r.rate), 9) + pad(range(r.rate), 14) +
      lpad(toAlarm(r.detector), 9) + '  ' + pad(r.detector.status === 'alarm' ? 'ALARM' : 'in control', 12) + bound).trimEnd();
  });
  const lines = [];
  if (g.rows.length) {
    const alarms = g.rows.filter(r => r.detector.status === 'alarm');
    lines.push(alarms.length
      ? 'HAS ANY SEGMENT GONE UP?  ALARM in ' + alarms.map(r => r.segment + ' since ' + r.detector.alarm_since + ' (the rise likely started in ' + r.detector.rise_started + ')').join('; ') + '.'
      : 'HAS ANY SEGMENT GONE UP?  No alarm in any segment.');
    lines.push(sharing(m)
      ? 'How: each segment has its own CUSUM, set as the whole\'s is, for the median size of its own periods. The alarms share --false-alarm-every: set per records checked, the segments together ' +
        'false-alarm about as often as the whole alone, so the whole and each segment are each set for one false alarm per ' + thousands(g.false_alarm_every_each) + ' of their records checked, and the report ' +
        '(the whole and every segment) gives about one false alarm per ' + thousands(s.false_alarm_every) + ' records checked in all. --fail-on-alarm counts every one.'
      : 'One segment with records, and no record in two: it is the whole, so the alarms keep the ' + thousands(s.false_alarm_every) + ' asked for with --false-alarm-every. --fail-on-alarm counts it.');
  }
  if (bounds) {
    const under = p1(m.bound.target_pct);
    const shown = g.rows.filter(r => r.bound.shown);
    lines.push((shown.length
      ? 'SHOWN UNDER ' + under + ' in ' + shown.map(r => r.segment + ' (since ' + r.bound.shown_since + ')').join(', ') + '.'
      : 'NO SEGMENT SHOWN UNDER ' + under + (g.rows.some(r => r.bound.last_shown) ? ' now.' : ' yet.')) + (g.provisional && shown.length ? ' ' + PROVISIONAL : ''));
    // A segment shown before and not now is said, as the whole's is.
    const gone = g.rows.filter(r => !r.bound.shown && r.bound.last_shown);
    if (gone.length) {
      lines.push('Shown before, not now: ' + gone.map(r => r.segment + ' (last in ' + r.bound.last_shown + ')').join(', ') + '. The ' + w.hits + ' since have taken the evidence back below the bar.');
    }
    lines.push('Because the whole and ' + (g.members === 1 ? 'the segment are' : g.members + ' segments are') + ' checked at once, each needs more evidence (a higher bar) before it is called shown; ' +
      'that keeps the chance of any wrong "shown" in this report at 5%, however often you look. ' +
      'The exact rule: closed testing on a weighted average of their evidence, the whole weighted 1/2 and the segments sharing 1/2 (Vovk & Wang 2021). ' +
      'A segment\'s bar is 20, plus each other segment\'s shortfall below 20, plus ' + g.members + ' times the whole\'s; its upper bound is the rate that bar rules out.' +
      (g.provisional ? ' The family is the segments in these periods; a segment that first appears later joins it and changes the bars.' : ' The family is the segments named in advance: what is printed stays.'));
    lines.push('Each segment\'s upper bound holds for that segment on its own; only "shown" is counted across segments, so the lowest of several upper bounds is not a result: it was not checked against the others.');
    const few = g.rows.filter(r => r.bound.too_few);
    if (few.length) {
      lines.push('Too few records to show anything yet (the ' + w.base + ' checked, of those its bar needs with no ' + w.hit + ' at all): ' +
        few.map(r => r.segment + ' ' + thousands(r.records) + ' of ' + thousands(r.bound.too_few.needed)).join(', ') + '. Their rates and ranges above are all there is.');
    }
  }
  if (g.other_values && Object.keys(g.other_values).length) {
    const vals = Object.entries(g.other_values);
    lines.push('(other) holds the values not named in --segments: ' + vals.slice(0, 12).map(([v, n]) => v + ' (' + n + ')').join(', ') + (vals.length > 12 ? ', ...' : '') + '.');
  }
  if (g.empty.length) lines.push(g.empty.join(', ') + ': no ' + w.base + ' were checked, in any period.');
  if (g.records_in_several) {
    const total = m.periods.reduce((t, r) => t + r.rate.d, 0);
    lines.push(g.records_in_several + ' record(s) carry several segments and count in each, so the segments add up to more than the ' + total + ' records.' +
      (g.overlap ? ' So that the alarms still keep the budget, each segment\'s alarm is set for ' + thousands(g.overlap.every_segment) + ' records rather than ' + thousands(g.false_alarm_every_each) +
        ' (' + thousands(g.overlap.memberships) + ' memberships for ' + thousands(g.overlap.records) + ' records), and the report in all keeps about one false alarm per ' + thousands(s.false_alarm_every) + ' records checked.' : ''));
  }
  return [head, ...(g.rows.length ? [cols, ...rows] : [])].join('\n') + (lines.length ? '\n\n  ' + lines.join('\n  ') : '');
}

function renderMonitor(m) {
  const s = m.settings, w = wordsOf(m);
  const source = m.inputs.counts ? m.inputs.counts : m.inputs.runs.length + ' period file(s)';
  const head = 'MONITOR  ' + m.periods.length + ' period(s) from ' + source + ' · ' + m.inputs.mode + ' mode' + (s.since ? ' · alarm restarted at ' + s.since + ' (--since)' : '') + '\n' +
    '  acceptable ' + p1(s.acceptable_pct) + ' · alarming ' + p1(s.alarming_pct) + (s.target_pct === null ? '' : ' · target ' + p1(s.target_pct)) +
    ' · rate: ' + w.header;
  const parts = [m.nothing_evaluated ? nothingLine(m.nothing_evaluated.why) : null, head, table(m), detectorSection(m), boundSection(m), designSection(m), m.segments ? segmentSection(m) : null].filter(Boolean);
  const notes = m.problems.filter(i => i.level !== 'stop');
  if (notes.length) parts.push('NOTES (' + notes.length + ')\n' + notes.map(i => '  [' + i.trap + '] ' + i.where + ': ' + i.message).join('\n'));
  return parts.join('\n\n') + '\n';
}

module.exports = { renderMonitor };

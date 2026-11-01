// The terminal report for wfeval monitor: one row per period, then the two answers in plain words
// (has the silent error rate gone up? is it shown under the target?), then what the alarm is
// tuned to. Renders the object monitorRun returns; --json writes that same object.

const { pct, range } = require('./format.js');

const thousands = n => (n === Infinity ? 'more than a million' : Math.round(n).toLocaleString('en-US'));
// A percentage to the decimals it was stored with, at least one: an upper bound of 4.98% keeps
// both, and --target 0.05 prints as 0.05%, not 0.1% (L16).
const pv = x => x.toFixed(Math.max(1, (String(x).split('.')[1] || '').length)) + '%';
const p1 = x => pv(Number(x));
const pad = (s, w) => String(s).padEnd(w);
const lpad = (s, w) => String(s).padStart(w);

function table(m) {
  const head = '  ' + pad('period', 14) + lpad('out', 6) + lpad('silent', 8) + '  ' + pad('rate', 9) + pad('likely range', 14) + lpad('to alarm', 9) + '  ' + pad('status', 12) + lpad('upper bound', 12);
  const rows = m.periods.map(r => {
    const status = !r.counted ? 'before --since' : r.alarm ? 'ALARM' : 'in control';
    // (before --since: the alarm restarted after it; the bound still counts it)
    const shown = r.shown ? '  shown' : '';
    return '  ' + pad(r.period, 14) + lpad(r.rate.d, 6) + lpad(r.rate.n, 8) + '  ' + pad(r.rate.d === 0 ? 'none out' : pct(r.rate), 9) + pad(range(r.rate), 14) +
      lpad(r.cusum ? (r.cusum.level_pct > 999 ? '>999%' : r.cusum.level_pct.toFixed(0) + '%') : '', 9) + '  ' + pad(status, 12) + lpad(r.upper_pct === null ? '' : pv(r.upper_pct), 12) + shown;
  });
  return [head, ...rows].join('\n');
}

function detectorSection(m) {
  const s = m.settings, d = m.detector;
  const lines = [];
  if (d.status === 'alarm') {
    lines.push('HAS IT GONE UP?  ALARM since ' + d.alarm_since + ': the silent error rate has likely risen above the acceptable ' + p1(s.acceptable_pct) + '.');
    lines.push('The rise likely started in ' + d.rise_started + ' (the period after the CUSUM last stood at 0). Find what changed then, fix it, and restart the alarm with --since <the first period after the fix>. The bound below keeps counting every period: a restart picked after an alarm is picked by the numbers.');
  } else {
    lines.push('HAS IT GONE UP?  No alarm: no sign yet that the silent error rate has risen above the acceptable ' + p1(s.acceptable_pct) + '. The CUSUM stands at ' + d.level_pct.toFixed(0) + '% of its alarm level.');
  }
  lines.push('How: the CUSUM adds up, period by period, how much likelier each period\'s count is at ' + p1(s.alarming_pct) + ' than at ' + p1(s.acceptable_pct) +
    ', never going below 0, and alarms when the total reaches its alarm level (Page 1954). The "to alarm" column is that total as a share of the alarm level. ' +
    'One period\'s rate alone is noisy; the total weighs every period by its records. ' +
    'Alarm level ' + s.alarm_at + ' steps, for periods of ' + s.period_size + ' records (' + (s.period_size_pinned ? '--period-size' : 'the median so far') + '); ' +
    'each row\'s status used the level for the periods up to it, so a status once printed does not change as periods are added.');
  if (!s.acceptable_given) {
    lines.push('--acceptable was not given: the acceptable rate is half the target. Set it to the rate the workflow normally runs at, measured before launch ' +
      '(score on a golden set, or the first weeks checked): the alarm watches for a rise from it, and dates the rise by it.');
  }
  return lines.join('\n  ');
}

function boundSection(m) {
  const b = m.bound;
  if (!b) return null;
  const under = p1(b.target_pct);
  const from = b.records + ' records out without review, ' + b.silent + ' silent error' + (b.silent === 1 ? '' : 's');
  const lines = [];
  if (b.shown) {
    lines.push('SHOWN UNDER ' + under + '  since ' + b.shown_since + ': the true silent error rate is under ' + under + ' (upper bound ' + pv(b.upper_pct) + ', from ' + from + '), valid however often you look.');
  } else {
    lines.push('NOT SHOWN UNDER ' + under + (b.last_shown ? ' now' : ' yet') + ': upper bound ' + (b.upper_pct === null ? 'not measured' : pv(b.upper_pct)) + ', from ' + from + '.' +
      (b.last_shown ? ' It was shown in ' + b.last_shown + '; the silent errors since have taken the evidence back below the bar.' : ''));
  }
  lines.push('How: the upper bound is a confidence sequence (Robbins 1970): it is valid however often you look, so checking it every period and acting the first time it says "under ' + under +
    '" is safe. The chance it ever shows "under ' + under + '" when the true rate is ' + under + ' or more is at most 5%. ' +
    'The likely range of one period, or of all periods added up, is not: looked at every period, it shows "under" by luck far more often (docs/METRICS.md).');
  lines.push('The price of looking any time: with no silent error at all, ' + thousands(b.perfect_run.anytime) + ' records out without review show it, against ' +
    thousands(b.perfect_run.fixed) + ' for one test of a size fixed in advance (score --target).');
  if (m.detector.status === 'alarm') {
    lines.push('With an alarm raised, read this bound as the periods together, not as the rate now: the alarm says the rate has likely risen since ' + m.detector.rise_started + '.');
  }
  return lines.join('\n  ');
}

function designSection(m) {
  const s = m.settings, g = m.design;
  return 'TUNED TO  a rise to ' + p1(s.alarming_pct) + ' would be flagged after about ' + thousands(g.detect_records) + ' records on average, counted from the rise with the CUSUM at 0 (about ' + g.detect_periods.toFixed(1) +
    ' periods of ' + g.period_size + '); about one false alarm per ' + thousands(g.false_alarm_records) + ' records checked when the rate is ' +
    p1(s.acceptable_pct) + ' (at least the ' + thousands(s.false_alarm_every) + ' asked for with --false-alarm-every, for periods of ' + g.period_size + ' records).\n  ' +
    'The CUSUM adds up evidence at any rate above ' + p1(g.break_even_pct) + ' (where a silent error\'s ' + s.scores.up + ' steps up balance the right records\' ' + s.scores.down +
    ' steps down), so a rate under the alarming one is flagged too, only later' +
    (g.under_target ? ': at ' + p1(g.under_target.rate_pct) + ', just under the target, an alarm comes after about ' + thousands(g.under_target.records) + ' records' : '') + '.\n  ' +
    'All from a Markov chain of the CUSUM (Brook & Evans 1972) for periods of ' + g.period_size + ' records (' + (s.period_size_pinned ? '--period-size' : 'the median') + '). ' +
    'Fewer false alarms mean slower flags. A bigger rise is flagged sooner; a smaller one, later.';
}

function renderMonitor(m) {
  const s = m.settings;
  const source = m.inputs.counts ? m.inputs.counts : m.inputs.runs.length + ' period file(s)';
  const head = 'MONITOR  ' + m.periods.length + ' period(s) from ' + source + ' · ' + m.inputs.mode + ' mode' + (s.since ? ' · alarm restarted at ' + s.since + ' (--since)' : '') + '\n' +
    '  acceptable ' + p1(s.acceptable_pct) + ' · alarming ' + p1(s.alarming_pct) + (s.target_pct === null ? '' : ' · target ' + p1(s.target_pct)) +
    ' · rate: silent errors of the records out without review checked';
  const parts = [head, table(m), detectorSection(m), boundSection(m), designSection(m)].filter(Boolean);
  const notes = m.problems.filter(i => i.level !== 'stop');
  if (notes.length) parts.push('NOTES (' + notes.length + ')\n' + notes.map(i => '  [' + i.trap + '] ' + i.where + ': ' + i.message).join('\n'));
  return parts.join('\n\n') + '\n';
}

module.exports = { renderMonitor };

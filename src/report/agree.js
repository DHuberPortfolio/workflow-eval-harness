// The terminal report for wfeval agree: how far the graders agree, output by output.
// Wording follows docs/READING_A_REPORT.md ("Agreement among graders").
const { num, list } = require('./format.js');

const READING = {
  reliable: 'reliable: 0.800 or above',
  tentative: 'tentative conclusions only: 0.667 to 0.800',
  unreliable: 'do not rely on it: below 0.667',
  not_measurable: 'not measurable: every grader gave the same value, so chance alone agrees perfectly',
};
const METRIC = {
  nominal: 'compared as names: the same or not',
  ordinal: 'compared on the level order: a miss across levels that many values use counts more',
  jaccard: 'compared as sets: the share of values one listed and the other did not (Jaccard)',
};
// Why a range is missing (Krippendorff's bootstrap note: resampling does not apply; trap M15).
const NO_RANGE = {
  no_disagreement: 'every record compared got the same value from every grader. Resampling them can only give 1 to 1, which would claim certainty from these few records; more records labelled by two or more graders are what would show it',
  one_odd_value: 'every value but one is the same, so resampling either keeps the odd value or has nothing to measure. Settle the record below and label more records with the rare value',
  no_spread: 'every record compared looks alike, so every resample gives the same alpha, and a range of zero width would claim certainty these records cannot give. Label more, and more varied, records',
  one_record: 'only one record was compared, so resampling can only repeat it. Label more records by two or more graders',
};
const show = v => (Array.isArray(v) ? (v.length ? v.join(', ') : '(none)') : String(v));
const chance = x => (x === null ? 'n/a' : Math.round(x * 100) + '%');
// The band is read from alpha alone. Hayes & Krippendorff (2007) judge it by the chance alpha is
// below the bar, so when the likely range reaches below the band's own bar the band is not
// shown, only suggested: "reliable" beside a range down to 0.436 would claim more than it knows.
const BAR = { reliable: 0.8, tentative: 0.667 };
function readingOf(o) {
  const bar = BAR[o.reading];
  if (bar === undefined || o.range.low === null || o.range.low >= bar) return READING[o.reading];
  return READING[o.reading] + ' (not shown: the likely range reaches below ' + num(bar) + ')';
}

function renderOutput(o, graders) {
  const lines = [o.name.toUpperCase() + '  (' + o.type + ', ' + METRIC[o.metric] + ')'];
  const r = o.range;
  lines.push('  alpha        ' + (o.alpha === null ? 'not measurable' : num(o.alpha)) + (r.low === null ? '' : '   likely range ' + num(r.low) + ' to ' + num(r.high)) + '   ' + readingOf(o));
  if (r.why && r.why !== 'not_measurable') lines.push('  no likely range: ' + NO_RANGE[r.why]);
  if (r.low !== null) lines.push('  chance alpha is below 0.800: ' + chance(r.below['0.800']) + ' · below 0.667: ' + chance(r.below['0.667']) +
    (r.method === 'krippendorff' ? '   (' + r.resamples + ' resamples of the pairs (Krippendorff\'s method), the disagreement chance gives kept fixed)'
      : '   (' + r.resamples + ' resamples of the records' + (r.unmeasurable ? ', ' + r.unmeasurable + ' not measurable' : '') + ')'));
  if (o.masi_alpha !== undefined) lines.push('  MASI alpha   ' + num(o.masi_alpha) + '   (the same sets with the MASI distance, for comparison)');
  lines.push('  compared     ' + o.units + ' record(s), ' + Number(o.values.toFixed(3)) + ' values that can be paired' +
    (o.graded_by_one.length ? '; ' + o.graded_by_one.length + ' record(s) labelled by one grader only, left out: ' + list(o.graded_by_one) : ''));
  // D_o / D_e reads the same for every metric (an ordinal's raw disagreements are squared rank
  // distances, meaningless alone); the raw values stay in --json (observed, expected).
  if (o.observed !== null && o.expected) lines.push('  disagreement  ' + (100 * o.observed / o.expected).toFixed(1) + '% of what chance alone would give (alpha is 1 minus this)   raw agreement ' + o.raw_agreement.pct.toFixed(1) + '% of pairs');
  if (o.prevalence_warning) {
    lines.push('  ! one value, ' + show(o.dominant.value) + ', is ' + o.dominant.pct.toFixed(1) + '% of the values. Alpha can be low despite high raw agreement: ' +
      o.raw_agreement.pct.toFixed(1) + '% of pairs agree, but chance alone would agree ' + o.chance_agreement.pct.toFixed(1) + '% of the time with values this lopsided, and alpha is ' + num(o.alpha) + '. The rare value is what to check.');
  }
  if (o.range_too_narrow) {
    lines.push('  ! only ' + o.rare_values + ' value(s) are not the most common one (' + show(o.dominant.value) + '), so the likely range is probably too narrow: ' +
      'in simulation, ranges built on fewer than 15 such values missed the real alpha far more often than 5% of the time (docs/METRICS.md). Label more records.');
  }
  if (graders.length > 2) {
    lines.push('  each pair    ' + o.pairs.map(x => x.graders.join('-') + ' ' + (x.alpha === null ? 'not measurable' : num(x.alpha)) + ' (' + x.units + ')').join(' · '));
  }
  if (o.without) {
    lines.push('  leave one out ' + o.without.map(w => 'without ' + w.grader + ': ' + (w.alpha === null ? 'not measurable' : num(w.alpha))).join(' · '));
    if (o.odd_one) {
      const w = o.without.find(x => x.grader === o.odd_one);
      lines.push('                leaving out ' + o.odd_one + ' raises alpha most (' + num(o.alpha) + ' to ' + num(w.alpha) + '): ' + o.odd_one + ' labels most differently from the others. That shows who differs, not who is wrong: check the guidelines with them');
    }
  }
  if (o.disagreements.length === 0) lines.push('  to settle    none: every record compared got the same value');
  else {
    lines.push('  to settle    ' + o.disagreements.length + ' record(s) the graders labelled differently:');
    for (const d of o.disagreements.slice(0, 20)) lines.push('    ' + d.id.padEnd(10) + ' ' + Object.entries(d.values).map(([g, v]) => g + ': ' + show(v)).join(' · '));
    if (o.disagreements.length > 20) lines.push('    +' + (o.disagreements.length - 20) + ' more (all of them in --json)');
  }
  return lines.join('\n');
}

function renderAgree(a) {
  const parts = ['AGREEMENT AMONG GRADERS  Krippendorff\'s alpha · ' + a.inputs.mode + ' mode · ' + (a.source === 'keys' ? 'answer keys' : 'free-text grades')];
  parts.push('graders  ' + a.graders.map(g => g.name + ' (' + g.records + (a.source === 'keys' ? ' records' : ' grades') + ')').join(' · '));
  parts.push('1 is perfect agreement, 0 is what chance alone gives. 0.800 and up: reliable; 0.667 to 0.800: tentative conclusions only; below 0.667: do not rely on it. ' +
    (a.source === 'keys' ? 'A low alpha means the answer key itself is uncertain, and every rate measured against it inherits that.' : 'A low alpha means the grades themselves are uncertain, and every rate counted from them inherits that.'));
  for (const o of a.outputs) parts.push(renderOutput(o, a.graders));
  for (const level of ['warn', 'fix']) {
    const found = a.problems.filter(i => i.level === level);
    if (found.length) parts.push((level === 'warn' ? 'WARNINGS' : 'CLEANED UP') + '\n' + found.map(i => '  [' + i.trap + '] ' + i.where + ': ' + i.message).join('\n'));
  }
  return parts.join('\n\n') + '\n';
}

module.exports = { renderAgree };

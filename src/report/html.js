// The score report as one self-contained HTML file: no dependencies, no network, opens
// in any browser. Everything shown comes from the same results object as the terminal
// report. Every value that came from an input file is HTML-escaped: a record id is data,
// and data must never be able to run as code in the report.

const { WRONG_WHEN } = require('./terminal.js');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = r => (!r || r.pct === null ? 'n/a' : r.pct.toFixed(1) + '%');
const cnt = r => (!r ? '' : r.n + ' of ' + r.d);
const rng = r => (!r || r.low_pct === null ? '' : r.low_pct.toFixed(1) + '–' + r.high_pct.toFixed(1) + '%');
const num = (x, d = 3) => (x === null || x === undefined ? 'n/a' : x.toFixed(d));
const ids = list => (list.length ? list.map(esc).join(', ') : '<span class="muted">none</span>');

const SEVERITY_CLASS = { critical: 'critical', high: 'serious', medium: 'warning', low: 'low' };
const severity = s => '<span class="sev ' + SEVERITY_CLASS[s] + '"><span class="sev-dot" aria-hidden="true"></span>' + esc(s) + '</span>';
// An error type such as SP-SHOULD-REVIEW, kept on one line rather than broken at its hyphens.
const typeTag = t => '<span class="type">' + esc(t) + '</span>';

function table(head, rows, numeric = []) {
  const th = head.map((h, i) => '<th' + (numeric.includes(i) ? ' class="num"' : '') + '>' + h + '</th>').join('');
  const tr = rows.map(r => '<tr>' + r.map((c, i) => '<td' + (numeric.includes(i) ? ' class="num"' : '') + '>' + c + '</td>').join('') + '</tr>').join('');
  return '<div class="table-wrap"><table><thead><tr>' + th + '</tr></thead><tbody>' + tr + '</tbody></table></div>';
}

function differences(d) {
  const labels = { wrong: 'applied, not in key', missing_rejected: 'proposed, not applied', missing: 'never proposed', invalid: 'not an allowed value', near_miss: 'near miss' };
  const out = [];
  for (const [bucket, label] of Object.entries(labels)) {
    for (const [output, values] of Object.entries(d[bucket] || {})) out.push(esc(output) + ' ' + label + ': <code>' + values.map(esc).join(', ') + '</code>');
  }
  return out.join('<br>');
}

function tiles(r) {
  const tile = (label, rate, note) => '<div class="tile"><div class="tile-label">' + label + '</div><div class="tile-value">' + pct(rate) +
    '</div><div class="tile-note">' + cnt(rate) + (rng(rate) ? ' · range ' + rng(rate) : '') + (note ? '<br>' + note : '') + '</div></div>';
  const out = [tile('Straight-through', r.straight_through, 'went through with no human')];
  if (r.silent_omissions) out.push(tile('Silent omissions', r.silent_omissions.rate, 'blocked or suppressed, but should be seen'));
  out.push(tile('Review-queue precision', r.review_queue.precision, 'reviews a human actually needed'));
  if (r.block) out.push(tile('Block precision', r.block.precision, 'blocks the key agrees with'));
  out.push('<div class="tile"><div class="tile-label">Safeguard failures</div><div class="tile-value">' + r.safeguard_failures.records +
    '</div><div class="tile-note">went through past a gate or floor</div></div>');
  return '<div class="tiles">' + out.join('') + '</div>';
}

// Calibration chart: stated confidence (x) against how often those claims were right (y).
// On the diagonal, "0.85" means 85%. Each dot is one bucket; its thin line is the 95% range.
function calibrationChart(c) {
  const buckets = c.overall.buckets;
  if (buckets.length === 0) return '';
  const W = 520, H = 340, L = 52, R = 20, T = 16, B = 44;
  const w = W - L - R, h = H - T - B;
  const x0 = Math.min(0.5, Math.floor(Math.min(...buckets.map(b => b.from)) * 10) / 10);
  const x = v => L + ((v - x0) / (1 - x0)) * w;
  const y = v => T + (1 - v) * h;
  const parts = [];
  for (let v = 0; v <= 1.0001; v += 0.2) {
    parts.push('<line class="grid" x1="' + L + '" x2="' + (L + w) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>');
    parts.push('<text class="tick" x="' + (L - 8) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + Math.round(v * 100) + '%</text>');
  }
  for (let v = x0; v <= 1.0001; v += 0.1) {
    parts.push('<text class="tick" x="' + x(v).toFixed(1) + '" y="' + (T + h + 18) + '" text-anchor="middle">' + v.toFixed(1) + '</text>');
  }
  parts.push('<line class="axis" x1="' + L + '" x2="' + (L + w) + '" y1="' + (T + h) + '" y2="' + (T + h) + '"/>');
  // The diagonal is explained in the caption, not labeled in the plot: the top right,
  // where it ends, is where confident claims cluster, and a label there collides with them.
  parts.push('<line class="diagonal" x1="' + x(x0).toFixed(1) + '" y1="' + y(x0).toFixed(1) + '" x2="' + x(1).toFixed(1) + '" y2="' + y(1).toFixed(1) + '"/>');
  parts.push('<text class="axis-title" x="' + (L + w / 2) + '" y="' + (H - 6) + '" text-anchor="middle">stated confidence</text>');
  parts.push('<text class="axis-title" transform="translate(14 ' + (T + h / 2) + ') rotate(-90)" text-anchor="middle">actually right</text>');
  buckets.forEach((b, i) => {
    const cx = x((b.from + b.to) / 2).toFixed(1);
    const acc = b.correct / b.n;
    parts.push('<line class="range" x1="' + cx + '" x2="' + cx + '" y1="' + y(b.accuracy.high_pct / 100).toFixed(1) + '" y2="' + y(b.accuracy.low_pct / 100).toFixed(1) + '"/>');
    parts.push('<circle class="dot" cx="' + cx + '" cy="' + y(acc).toFixed(1) + '" r="5"/>');
    parts.push('<circle class="hit" data-i="' + i + '" tabindex="0" cx="' + cx + '" cy="' + y(acc).toFixed(1) + '" r="12" aria-label="stated ' +
      esc(b.from === b.to ? num(b.from, 2) : num(b.from, 2) + ' to ' + num(b.to, 2)) + ', ' + b.correct + ' of ' + b.n + ' right"/>');
  });
  // The tooltip reads the buckets from this JSON. "<" is escaped so no value can close the script tag.
  const data = JSON.stringify(buckets.map(b => ({
    stated: b.from === b.to ? num(b.from, 2) : num(b.from, 2) + '–' + num(b.to, 2),
    right: b.correct + ' of ' + b.n, accuracy: pct(b.accuracy), range: rng(b.accuracy),
  }))).replace(/</g, '\\u003c');
  return '<div class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Calibration: stated confidence against how often claims were right">' +
    parts.join('') + '</svg><div class="tooltip" role="status" hidden></div><script type="application/json" class="chart-data">' + data + '</script></div>';
}

const TOOLTIP_JS = `
document.querySelectorAll('.chart').forEach(chart => {
  const data = JSON.parse(chart.querySelector('.chart-data').textContent);
  const tip = chart.querySelector('.tooltip');
  const show = (el, evt) => {
    const d = data[Number(el.getAttribute('data-i'))];
    tip.replaceChildren();
    const v = document.createElement('strong'); v.textContent = d.accuracy + ' right (' + d.right + ')';
    const s = document.createElement('div'); s.textContent = 'stated ' + d.stated + ' · 95% range ' + d.range;
    tip.append(v, s);
    const box = chart.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    tip.hidden = false;
    const left = Math.min(Math.max(r.left - box.left + r.width / 2 - tip.offsetWidth / 2, 0), box.width - tip.offsetWidth);
    tip.style.left = left + 'px';
    tip.style.top = Math.max(r.top - box.top - tip.offsetHeight - 8, 0) + 'px';
  };
  chart.querySelectorAll('.hit').forEach(el => {
    el.addEventListener('pointerenter', e => show(el, e));
    el.addEventListener('focus', e => show(el, e));
    el.addEventListener('pointerleave', () => { tip.hidden = true; });
    el.addEventListener('blur', () => { tip.hidden = true; });
  });
});`;

const CSS = `
:root {
  color-scheme: light;
  --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --axis: #c3c2b7; --border: rgba(11,11,11,0.10); --series: #2a78d6;
  --critical: #d03b3b; --serious: #ec835a; --warning: #fab219; --low: #898781;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --page: #0d0d0d; --surface: #1a1a19; --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10); --series: #3987e5;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0d0d0d; --surface: #1a1a19; --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
  --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10); --series: #3987e5;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 40px 0 12px; }
h3 { font-size: 15px; margin: 20px 0 8px; }
p, .meta { color: var(--ink-2); margin: 0 0 12px; }
.muted { color: var(--muted); }
code { font: 13px ui-monospace, "Cascadia Mono", Consolas, monospace; overflow-wrap: anywhere; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
.hero { display: flex; flex-wrap: wrap; gap: 8px 32px; align-items: baseline; }
.hero-label { font-weight: 600; width: 100%; }
.hero-value { font-size: 56px; font-weight: 600; line-height: 1; }
.hero-note { color: var(--ink-2); }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 12px; }
.tile { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
.tile-label { color: var(--ink-2); font-size: 13px; }
.tile-value { font-size: 26px; font-weight: 600; }
.tile-note { color: var(--muted); font-size: 12px; }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--grid); vertical-align: top; }
th { color: var(--ink-2); font-weight: 600; white-space: nowrap; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sev { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.type { white-space: nowrap; }
.sev-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--low); }
.sev.critical .sev-dot { background: var(--critical); }
.sev.serious .sev-dot { background: var(--serious); }
.sev.warning .sev-dot { background: var(--warning); }
.chart { position: relative; max-width: 560px; }
.chart svg { width: 100%; height: auto; display: block; }
.grid { stroke: var(--grid); stroke-width: 1; }
.axis { stroke: var(--axis); stroke-width: 1; }
.diagonal { stroke: var(--axis); stroke-width: 1; }
.tick { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.axis-title { fill: var(--ink-2); font-size: 12px; }
.range { stroke: var(--series); stroke-width: 2; stroke-linecap: round; opacity: 0.35; }
.dot { fill: var(--series); stroke: var(--surface); stroke-width: 2; }
.hit { fill: transparent; cursor: pointer; }
.hit:focus { outline: none; stroke: var(--ink); stroke-width: 1; }
.tooltip { position: absolute; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 13px; pointer-events: none; box-shadow: 0 4px 16px rgba(0,0,0,0.12); max-width: 260px; }
.tooltip div { color: var(--ink-2); }
.notes li { color: var(--ink-2); }
@media (max-width: 560px) { .hero-value { font-size: 44px; } }
`;

function renderHtml(results, generatedAt = new Date().toISOString()) {
  const r = results.routing;
  const q = results.quality;
  const s = [];

  s.push('<h1>Workflow evaluation</h1>');
  s.push('<p class="meta">' + esc(results.inputs.predictions) + ' scored against ' + esc(results.inputs.key) + ' · ' + r.total + ' records · ' +
    esc(results.inputs.mode) + ' mode · generated ' + esc(generatedAt) + '<br>A record needed a human if ' + esc(WRONG_WHEN[results.inputs.wrong_when]) + '.</p>');

  // Headline
  const se = r.silent_errors;
  s.push('<section class="card hero"><div class="hero-label">Silent error rate</div><div class="hero-value">' + pct(se.rate) + '</div>' +
    '<div class="hero-note">' + cnt(se.rate) + ' records that went through with no human needed one' +
    (rng(se.rate) ? '<br>95% range ' + rng(se.rate) + (se.one_record_moves_pct !== null ? ' · one record moves this by ' + se.one_record_moves_pct.toFixed(1) + ' points' : '') : '') +
    '</div></section>');
  s.push(tiles(r));

  // Silent errors
  s.push('<h2>Silent errors</h2>');
  if (se.records.length === 0) s.push('<p>None of the records that went through needed a human.</p>');
  else {
    s.push(table(['Record', 'Severity', 'Types', 'Went', 'Should', 'What differed', 'Trap'], se.records.map(x => [
      '<code>' + esc(x.id) + '</code>', severity(x.severity), x.types.map(typeTag).join('<br>'), esc(x.route), esc(x.gold_route ?? ''),
      differences(x.differences) || '<span class="muted">values match</span>', x.traps.map(esc).join(', '),
    ])));
  }
  if (r.silent_omissions) {
    s.push('<h3>Silent omissions</h3>');
    s.push(r.silent_omissions.records.length === 0 ? '<p>None.</p>' : table(['Record', 'Severity', 'Type', 'Went', 'Should', 'Trap'], r.silent_omissions.records.map(x => [
      '<code>' + esc(x.id) + '</code>', severity(x.severity), x.types.map(typeTag).join('<br>'), esc(x.route), esc(x.gold_route), x.traps.map(esc).join(', '),
    ])));
  }
  s.push('<h3>Safeguard failures</h3>');
  s.push(r.safeguard_failures.records === 0 ? '<p>None.</p>'
    : '<p>Went through although a safeguard should have held them. Not counted in the silent error rate, but critical: each is a workflow bug to find, even when the content is right. ' +
      'Find the branch that routed these records and why it skipped the check. If the key agrees with the record, the fix is a model that clears the threshold, not a lower threshold.</p>' +
      table(['Record', 'Severity', 'Type'], r.safeguard_failures.detail.map(d => ['<code>' + esc(d.id) + '</code>', severity('critical'), d.types.map(typeTag).join(', ')])));
  s.push('<p>Wasted reviews: ' + ids(r.review_queue.wasted) + (r.block ? ' · Wrongly blocked: ' + ids(r.block.wrongly_blocked) : '') + '</p>');

  // Quality
  s.push('<h2>Output quality</h2>');
  const left = [...q.left_out.model_failed.map(i => esc(i) + ' (model failed)'), ...q.left_out.suppressed_duplicates.map(i => esc(i) + ' (suppressed duplicate)')];
  s.push('<p>' + q.population + ' records' + (left.length ? '; left out: ' + left.join(', ') : '') + '. Only applied values count as predicted.</p>');
  const sets = Object.entries(q.outputs).filter(([, o]) => o.type === 'set');
  if (sets.length) {
    const rows = sets.map(([n, o]) => [esc(n), pct(o.precision), pct(o.recall), num(o.f1), pct(o.exact_match), o.tp + ' / ' + o.fp + ' / ' + o.fn]);
    if (q.overall && sets.length > 1) rows.push(['<strong>overall</strong>', pct(q.overall.precision), pct(q.overall.recall), num(q.overall.f1), '', q.overall.tp + ' / ' + q.overall.fp + ' / ' + q.overall.fn]);
    s.push(table(['Output', 'Precision', 'Recall', 'F1', 'Exact match', 'TP / FP / FN'], rows, [1, 2, 3, 4, 5]));
  }
  for (const [n, o] of Object.entries(q.outputs).filter(([, x]) => x.type !== 'set')) {
    const labels = Object.keys(o.per_label);
    s.push('<h3>' + esc(n) + ': accuracy ' + pct(o.accuracy) + ' (' + cnt(o.accuracy) + ')</h3>');
    if (o.type === 'ordinal') {
      const lean = o.mean_signed === null || o.mean_signed === 0 ? 'no lean' : o.mean_signed > 0 ? 'leans higher than the key' : 'leans lower than the key';
      s.push('<p>Within one step: ' + pct(o.within_one) + ' · average distance ' + num(o.mean_distance, 2) + ' steps · closeness ' + num(o.closeness) +
        ' (1 is always exact) · ' + lean + ' (' + o.predicted_higher + ' higher, ' + o.predicted_lower + ' lower)' +
        (Object.keys(o.miss_distances).length ? ' · misses by distance: ' + Object.entries(o.miss_distances).map(([d, c]) => d + ': ' + c).join(', ') : '') + '</p>');
    }
    s.push(table(['Key says', ...labels.map(l => 'predicted ' + esc(l)), 'Precision', 'Recall', 'F1'], labels.map(k => [
      esc(k), ...labels.map(p => String(o.confusion[k][p])), pct(o.per_label[k].precision), pct(o.per_label[k].recall), num(o.per_label[k].f1),
    ]), labels.map((_, i) => i + 1).concat([labels.length + 1, labels.length + 2, labels.length + 3])));
  }

  // Traps
  if (results.traps) {
    s.push('<h2>Per trap</h2>');
    s.push(table(['Trap', 'Records', 'Routed right', 'Silent errors', 'Omissions', 'Wasted reviews'], results.traps.groups.map(g => [
      esc(g.trap), String(g.records.length), g.routed_correctly.d ? cnt(g.routed_correctly) : 'n/a', ids(g.silent_errors), ids(g.silent_omissions), ids(g.wasted_reviews),
    ]), [1, 2]));
    if (results.traps.coverage.below.length) s.push('<p>Below min_per_trap (' + results.traps.coverage.min_per_trap + '): ' + results.traps.coverage.below.map(b => esc(b.trap) + ' (' + b.records + ')').join(', ') + '</p>');
  }

  // Calibration
  const c = results.calibration;
  s.push('<h2>Calibration</h2>');
  if (c.overall.n === 0) s.push('<p>No values with a confidence.</p>');
  else {
    s.push('<p>Does a stated confidence mean what it says? ' + c.overall.n + ' claims, ' + (c.buckets === 'distinct' ? 'one group per stated value' : 'groups of ' + esc(c.buckets.replace('width ', ''))) +
      '. Average gap ' + num(c.overall.ece) + ' (0 is perfectly calibrated). The grey diagonal is where stated equals actual; ' +
      'a dot above it was right more often than stated, below it less often. Each thin line is that dot\'s 95% range.' +
      (c.overall.n < 100 ? ' With ' + c.overall.n + ' claims, read the ranges, not the dots.' : '') + '</p>');
    s.push('<section class="card">' + calibrationChart(c) + '</section>');
    s.push(table(['Stated', 'Claims', 'Right', 'Accuracy', 'Gap', '95% range'], c.overall.buckets.map(b => [
      b.from === b.to ? num(b.from, 2) : num(b.from, 2) + '–' + num(b.to, 2), String(b.n), String(b.correct), pct(b.accuracy), (b.gap > 0 ? '+' : '') + b.gap.toFixed(2), rng(b.accuracy),
    ]), [0, 1, 2, 3, 4, 5]));
    if (c.thresholds.length) {
      s.push('<ul class="notes">' + c.thresholds.map(t => '<li>' + (t.name === 'auto_publish' ? 'Gate on ' + esc(t.output) : esc(t.name)) + ' at ' + t.threshold +
        ': claims at or above it were right ' + pct(t.at_or_above) + ' of the time (' + cnt(t.at_or_above) + ')' +
        (t.below && t.below.d ? '; below it, ' + pct(t.below) + ' (' + cnt(t.below) + ')' : '') + '.</li>').join('') + '</ul>');
    }
  }

  // Every record
  s.push('<h2>Every record</h2>');
  s.push(table(['Record', 'Went', 'Should', 'Needed a human', 'Outcome', 'Trap'], results.records.map(x => {
    const outcome = x.silent ? severity(x.silent.severity) + ' silent error' : x.omission ? severity(x.omission.severity) + ' silent omission'
      : x.safeguards.length ? 'safeguard failure' : x.wasted_review ? 'wasted review' : '<span class="muted">ok</span>';
    return ['<code>' + esc(x.id) + '</code>', esc(x.route), esc(x.gold_route ?? ''), x.needs_human ? 'yes' : 'no', outcome, x.traps.map(esc).join(', ')];
  })));

  if (r.not_measured.length) s.push('<h2>Not measured</h2><ul class="notes">' + r.not_measured.map(n => '<li>' + esc(n.what) + ': ' + esc(n.why) + '</li>').join('') + '</ul>');
  const notes = results.problems.filter(i => i.level !== 'stop');
  if (notes.length) s.push('<h2>Warnings and clean-ups</h2><ul class="notes">' + notes.map(i => '<li>' + esc(i.level) + ' [' + esc(i.trap) + '] ' + esc(i.where) + ': ' + esc(i.message) + '</li>').join('') + '</ul>');

  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Workflow evaluation</title><style>' + CSS + '</style></head><body><main>' + s.join('\n') + '</main><script>' + TOOLTIP_JS + '</script></body></html>\n';
}

module.exports = { renderHtml, esc };

// Small text-formatting helpers shared by the terminal reports.

const pct = r => (r === null || r === undefined || r.pct === null ? 'n/a' : r.pct.toFixed(1) + '%');
const count = r => (r === null || r === undefined ? '' : r.n + ' of ' + r.d);
const range = r => (r === null || r === undefined || r.low_pct === null ? '' : r.low_pct.toFixed(1) + '-' + r.high_pct.toFixed(1) + '%');
const num = (x, d = 3) => (x === null || x === undefined ? 'n/a' : x.toFixed(d));
const signed = (x, d = 2) => (x === null ? 'n/a' : (x > 0 ? '+' : '') + x.toFixed(d));
const list = (ids, max = 12) => (ids.length === 0 ? '-' : ids.slice(0, max).join(' ') + (ids.length > max ? ' +' + (ids.length - max) + ' more' : ''));

// Rows of cells -> aligned lines. `right` lists the columns aligned right (numbers).
function table(rows, right = [], indent = '  ') {
  const widths = [];
  for (const row of rows) row.forEach((c, i) => { widths[i] = Math.max(widths[i] || 0, String(c).length); });
  return rows.map(row => indent + row.map((c, i) => {
    const s = String(c);
    if (i === row.length - 1 && !right.includes(i)) return s;
    return right.includes(i) ? s.padStart(widths[i]) : s.padEnd(widths[i]);
  }).join('   ')).join('\n');
}

module.exports = { pct, count, range, num, signed, list, table };

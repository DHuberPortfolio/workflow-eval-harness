// Jaccard or MASI for set outputs in wfeval agree? Two checks, over every pair (and triple) of
// subsets of five values:
//   1. How each distance relates to what scoring counts. The harness scores a set value by value
//      (a value one key lists and the other does not changes one true positive, false positive or
//      false negative), so the disagreement that matters is the number of values in one key and
//      not the other, out of the values either lists. Does the distance depend on that alone?
//   2. The triangle inequality, d(A,C) <= d(A,B) + d(B,C): a distance that breaks it can rank
//      "A and C" as further apart than the two steps through B.
//   node scripts/agree-set-distance.js
const { jaccardDistance, masiDistance } = require('../src/metrics/agreement.js');

const VALUES = ['a', 'b', 'c', 'd', 'e'];
const subsets = [];
for (let m = 0; m < 1 << VALUES.length; m++) subsets.push(VALUES.filter((_, i) => m & (1 << i)));

for (const [name, d] of [['Jaccard', jaccardDistance], ['MASI', masiDistance]]) {
  // 1: for each (values that differ, values either lists), the distinct distances seen.
  const by = new Map();
  for (const A of subsets) for (const B of subsets) {
    const union = new Set([...A, ...B]).size;
    if (union === 0) continue;
    const differ = union - A.filter(x => B.includes(x)).length;
    const k = differ + '/' + union;
    if (!by.has(k)) by.set(k, new Set());
    by.get(k).add(d(A, B).toFixed(6));
  }
  const spread = [...by.entries()].filter(([, s]) => s.size > 1);
  // 2: the triangle inequality.
  let broken = 0, triples = 0, example = null;
  for (const A of subsets) for (const B of subsets) for (const C of subsets) {
    triples++;
    if (d(A, C) > d(A, B) + d(B, C) + 1e-12) { broken++; if (!example) example = [A, B, C]; }
  }
  console.log(name + ': ' + (spread.length === 0 ? 'depends only on (values that differ) / (values either lists)'
    : 'gives different distances for the same values-that-differ out of the same union in ' + spread.length + ' of ' + by.size + ' cases, e.g. ' + spread[0][0] + ' -> ' + [...spread[0][1]].join(' or ')));
  console.log('  triangle inequality broken in ' + broken + ' of ' + triples + ' triples' + (example ? ', e.g. ' + example.map(s => '{' + s.join(',') + '}').join(' ') : ''));
}

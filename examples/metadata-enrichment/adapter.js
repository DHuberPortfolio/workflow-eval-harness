// Translates the metadata enrichment workflow's Layer 3 output into the harness's shape.
//
// The harness never learns about this workflow; this file does. Each Layer 3 record
// becomes one combined record: the workflow's values under "output", the answer key
// under "expected" (see test/fixtures/shapes/combined.json for the shape).
//
// What it translates:
//   applied.subjects / industries / geographies / entities -> output.<FACET> values,
//     with confidence and inherited_from kept
//   guard.rejections -> the same facet's values, marked applied: false
//   truth_codes -> expected.<FACET> (already closed under taxonomy ancestors, like applied)
//   decision_reason -> decision_branch, so a what-if knows which records the gate decided
//   llm_status -> scored

const FACETS = { SUBJECT: 'subjects', INDUSTRY: 'industries', GEOGRAPHY: 'geographies', COMPANY: 'entities' };

// Layer 3's routing ladder, identified by the start of each decision_reason. The reasons
// are prose written for people; if one is reworded, this stops loudly rather than
// misfiling records. (Suggested workflow change: emit decision_branch directly.)
const BRANCHES = [
  ['model-failed', /^Enrichment layer unavailable/],
  ['duplicate', /^Near-duplicate of/],
  ['hard-rejection', /^Guard rejected/],
  ['empty-required', /^Required facet\(s\) returned no code/],
  ['completeness', /^Record looks under-tagged/],
  ['salience', /^Record looks over-tagged/],
  ['gate', /^Lead tag confidence below the per-facet auto-publish threshold/],
  ['auto', /^All tags in vocabulary/],
];

function branchOf(r) {
  const hit = BRANCHES.find(([, re]) => re.test(r.decision_reason));
  if (!hit) throw new Error(r.article_id + ': unrecognised decision_reason "' + r.decision_reason.slice(0, 60) + '"');
  return hit[0];
}

function adaptRecord(r) {
  const output = {};
  for (const [facet, key] of Object.entries(FACETS)) {
    const applied = (r.applied[key] || []).map(t => {
      const v = { value: facet === 'COMPANY' ? t.entity_id : t.code, confidence: t.confidence };
      if (t.inherited_from) v.inherited_from = t.inherited_from;
      return v;
    });
    const appliedCodes = new Set(applied.map(v => v.value));
    // A code can be rejected as the model's own proposal and still be applied, because a
    // narrower applied code carries it in as a broader term (GEO-US at 0.40 rejected, but
    // added as GEO-US-TX's parent). The applied copy is what reached the index; listing
    // both would be the same value twice (trap D6).
    const rejected = new Map();
    for (const x of r.guard.rejections) {
      if (x.facet !== facet || appliedCodes.has(x.code) || rejected.has(x.code)) continue;
      rejected.set(x.code, { value: x.code, confidence: typeof x.confidence === 'number' ? x.confidence : null, applied: false });
    }
    output[facet] = [...applied, ...rejected.values()];
  }
  return {
    id: r.article_id,
    decision: r.decision,
    decision_branch: branchOf(r),
    scored: r.llm_status === 'ok',
    output,
    expected: r.truth_codes,
  };
}

const adapt = layer3 => layer3.map(adaptRecord);

module.exports = { adapt, branchOf, BRANCHES };

// Translates the compliance reviewer's per-document output into the harness's shape.
//
// Input (runs/*.json): one row per document, trimmed from the workflow's "Merge and Route"
// node: decision, the client's gating threshold, the deterministic layer's hits
// [code, severity], the LLM layer's findings [code, confidence], and the answer key
// (expected_violations, expected_flag, detectable_by).
//
// Output: one combined record per document (see test/fixtures/shapes/combined.json):
//   output.violations - what the workflow found:
//     deterministic blocking/review hits    applied, no confidence (rules, not guesses)
//     deterministic advisory hits           not applied (a note, not a finding)
//     LLM findings at or above threshold    applied, with confidence
//     LLM findings below threshold          not applied, with confidence (the "notes")
//   expected.verdict    - VIOLATION or CLEAN, the answer key's correct route
//   expected.violations - the answer key's codes
//   expected.trap       - detectable_by: which layer should catch it (deterministic / llm / both / none)
// A code found by both layers is kept once: the deterministic hit, which decided the route.

function mergeViolations(row) {
  const byCode = new Map();
  for (const [code, severity] of row.det) {
    byCode.set(code, { value: code, confidence: null, applied: severity !== 'advisory' });
  }
  for (const [code, confidence] of row.llm) {
    const applied = confidence >= row.threshold;
    const prev = byCode.get(code);
    if (prev && prev.confidence === null && prev.applied) continue;   // the rule already decided it
    if (prev && (prev.applied || (prev.confidence ?? -1) >= confidence) && !applied) continue;
    byCode.set(code, { value: code, confidence, applied: applied || Boolean(prev && prev.applied) });
  }
  return [...byCode.values()];
}

function adaptRecord(row) {
  return {
    id: row.id,
    decision: row.decision,
    scored: row.llm_status === 'ok',
    output: { violations: mergeViolations(row) },
    expected: {
      verdict: row.expected_flag ? 'VIOLATION' : 'CLEAN',
      violations: row.expected_violations,
      trap: row.detectable_by,
    },
  };
}

const adapt = rows => rows.map(adaptRecord);

module.exports = { adapt, mergeViolations };

// node examples/compliance-reviewer/adapter.js runs/exec-50.json > exec-50.harness.json
if (require.main === module) {
  const fs = require('fs');
  const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  process.stdout.write('[\n' + adapt(rows).map(r => '  ' + JSON.stringify(r)).join(',\n') + '\n]\n');
}

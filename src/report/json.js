// The machine-readable results file: the same results object the reports render,
// plus what produced it. score's paired input records are left out (they are the inputs); compare's
// paired table, an object of counts, is a result, and stays (trap P40).
const pkg = require('../../package.json');

function resultsJson(results, generatedAt = new Date().toISOString()) {
  const { paired, ...rest } = results;
  return { tool: pkg.name, version: pkg.version, generated_at: generatedAt, ...rest, ...(paired && !Array.isArray(paired) ? { paired } : {}) };
}

module.exports = { resultsJson };

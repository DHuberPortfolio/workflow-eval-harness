// The machine-readable results file: the same results object the reports render,
// plus what produced it. The paired input records are left out (they are the inputs).
const pkg = require('../../package.json');

function resultsJson(results, generatedAt = new Date().toISOString()) {
  const { paired, ...rest } = results;
  return { tool: pkg.name, version: pkg.version, generated_at: generatedAt, ...rest };
}

module.exports = { resultsJson };

// SHA-256, the one hash the harness uses. node:crypto takes longer to load than all of the tool's
// own code, and most commands never hash anything, so it is loaded by the first call.

const fs = require('fs');

const sha256 = data => require('node:crypto').createHash('sha256').update(data);

// What a file holds, to tell whether two files are the same run or the same key.
const fingerprint = file => sha256(fs.readFileSync(file)).digest('hex');

module.exports = { sha256, fingerprint };

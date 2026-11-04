// Text at the two edges of the tool: reading a file, and writing to a terminal.

const fs = require('fs');

// A stop for the way a file was saved. A reader says it in its own words, with the file's name
// beside it: e.code tells it from a file that could not be read at all.
const ENCODING = 'WFEVAL_ENCODING';
const encodingStop = (trap, message) => Object.assign(new Error(message), { code: ENCODING, trap });
const RESAVE = 'Save it as UTF-8 and run again';

// Every input file is read here (traps P16, P17). Read as UTF-8, a byte that is not UTF-8 becomes
// U+FFFD without a word, so two different values can come out the same text and score as a match
// (Excel's plain "CSV" is Windows-1252). The check costs nothing on a clean file: only a file holding
// U+FFFD is looked at again, and only then are its bytes compared with the text. A file with a real
// U+FFFD in it comes back as it was written, and is valid.
function readText(file) {
  const text = fs.readFileSync(file, 'utf8');
  // UTF-16 without its mark reads as valid UTF-8 with a NUL beside each letter.
  if (text.slice(0, 1024).includes('\0')) throw encodingStop('P17', 'saved as UTF-16. ' + RESAVE + ' (PowerShell 5.1\'s > writes UTF-16; Out-File -Encoding utf8 does not)');
  if (!text.includes('�')) return text;
  const bytes = fs.readFileSync(file);
  if ((bytes[0] === 0xFF && bytes[1] === 0xFE) || (bytes[0] === 0xFE && bytes[1] === 0xFF)) {
    throw encodingStop('P17', 'saved as UTF-16. ' + RESAVE + ' (PowerShell 5.1\'s > writes UTF-16; Out-File -Encoding utf8 does not)');
  }
  if (Buffer.from(text, 'utf8').equals(bytes)) return text;
  const line = text.slice(0, text.indexOf('�')).split('\n').length;
  throw encodingStop('P16', 'not valid UTF-8 (first at line ' + line + '). ' + RESAVE + ' (in Excel: "CSV UTF-8"): read as it is, two different values could come out as the same text');
}

// Control characters: everything below space but tab and line feed, DEL, and the C1 block (U+009B
// opens an escape sequence in some terminals).
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u2028\u2029]/;
const CONTROL_ALL = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u2028\u2029]/g;
const CONTROL_OR_LF = /[\x00-\x08\x0a-\x1f\x7f-\x9f\u2028\u2029]/;
const CONTROL_OR_LF_ALL = /[\x00-\x08\x0a-\x1f\x7f-\x9f\u2028\u2029]/g;
const visible = c => (c === '\n' ? '\\n' : c === '\r' ? '\\r' : c > '\xff' ? '\\u' + c.charCodeAt(0).toString(16) : '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'));

// Model text must not drive a terminal: an escape sequence can clear the screen or rewrite a line,
// and a line break in an id can forge a line of the report (trap P12). keepLines: true for text whose
// line breaks are the report's own; false for one value, or one line.
function escapeControls(text, keepLines) {
  if (keepLines) return CONTROL.test(text) ? text.replace(CONTROL_ALL, visible) : text;
  return CONTROL_OR_LF.test(text) ? text.replace(CONTROL_OR_LF_ALL, visible) : text;
}

// Field names repeat on every record, and a fair share of a large run's strings are field names:
// each is tested once.
const cleanKeys = new Set();
function keyAsShown(k) {
  if (cleanKeys.has(k)) return k;
  const shown = escapeControls(k, false);
  if (shown === k) cleanKeys.add(k);
  return shown;
}
// Results nest a handful of levels: past this, a walk is in a loop, and stops.
const DEEPEST = 64;

// A reader that went away: a pipe's other end closed. The report just ends (trap P24). Which code it
// arrives with depends on the system and the moment: EPIPE, a stream already destroyed, or EOF.
const closedReader = e => e.code === 'EPIPE' || e.code === 'ERR_STREAM_DESTROYED' || e.code === 'EOF';

function walk(value, depth) {
  if (typeof value === 'string') return CONTROL_OR_LF.test(value) ? value.replace(CONTROL_OR_LF_ALL, visible) : value;
  if (value === null || typeof value !== 'object' || depth > DEEPEST || ArrayBuffer.isView(value)) return value;
  if (Array.isArray(value)) {
    let out = value;
    for (let i = 0; i < value.length; i++) {
      const x = walk(value[i], depth + 1);
      if (x === value[i]) continue;
      if (out === value) out = value.slice();
      out[i] = x;
    }
    return out;
  }
  if (value instanceof Map || value instanceof Set) {
    const isMap = value instanceof Map;
    const old = [...value];
    const entries = old.map(e => (isMap ? [walk(e[0], depth + 1), walk(e[1], depth + 1)] : walk(e, depth + 1)));
    const changed = entries.some((e, i) => (isMap ? e[0] !== old[i][0] || e[1] !== old[i][1] : e !== old[i]));
    return !changed ? value : isMap ? new Map(entries) : new Set(entries);
  }
  let changes = null;
  let renamed = false;
  for (const k of Object.keys(value)) {
    const x = walk(value[k], depth + 1);
    const key = keyAsShown(k);
    if (key !== k) renamed = true;
    if (x !== value[k] || key !== k) (changes || (changes = [])).push([k, key, x]);
  }
  if (!changes) return value;
  // What is not enumerable stays with the copy: the results keep some values off the JSON that way.
  const out = Object.create(Object.getPrototypeOf(value), Object.getOwnPropertyDescriptors(value));
  for (const [k, key, x] of changes) {
    if (renamed) delete out[k];
    Object.defineProperty(out, key, { value: x, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

// A results object with every string made safe for a terminal, line breaks included: what a report
// is rendered from, so no renderer has to think about it (bin/wfeval.js report()). Nothing is copied
// unless something in it changes, so a report on ordinary text is rendered from the very same object,
// and the object given is never changed: runs share their key records, and JSON keeps the raw text.
// results.paired is the run's whole input, which a report reads only for a record's key by its id:
// it is walked only when the rest held something to escape, so an id still finds its record.
function forTerminal(results) {
  if (results === null || typeof results !== 'object' || !Array.isArray(results.paired)) return walk(results, 0);
  const { paired, ...rest } = results;
  const out = walk(rest, 0);
  return out === rest ? results : { ...out, paired: walk(paired, 0) };
}

module.exports = { readText, ENCODING, escapeControls, forTerminal, closedReader };

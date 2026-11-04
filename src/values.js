// Small tests of a value read from a file, and the words a problem uses for one. One copy, so
// every reader agrees on what an object, a name or a label is.

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = v => typeof v === 'string' && v.length > 0;
// A name has something to read in it. Only a separator may be all spaces: a space is a real one.
const isName = v => isText(v) && v.trim().length > 0;
// A field name or a dotted path. Never through __proto__: no file means it, and a path is written as
// well as read (agree --write-key), where it would reach every object in the process (trap P15).
const isPath = v => isName(v) && v.split('.').every(part => part.length > 0 && part !== '__proto__');
// The names every JavaScript object already has. Refused as the name of an output or a group
// (trap P13), where they would be looked up in plain objects; as data they are ordinary text.
const RESERVED = new Set(Object.getOwnPropertyNames(Object.prototype));
const isReserved = name => RESERVED.has(name);
// A field a config names, as its own: "constructor" is not a declared output.
const own = (obj, key) => (Object.hasOwn(obj, key) ? obj[key] : undefined);
const isProb = v => typeof v === 'number' && v >= 0 && v <= 1;
// What a group label, a cluster or a policy's equals may be: text, a number or true/false, each
// read as trimmed text.
const isLabel = x => typeof x === 'string' || typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x));
const describe = v => (v === null ? 'null' : v === undefined ? 'nothing' : Array.isArray(v) ? 'a list'
  : typeof v === 'string' ? 'the text ' + JSON.stringify(v) : typeof v);

// The largest and smallest of a list of any length: Math.max(...list) passes every value as an
// argument, and a long list overflows the stack (trap P35).
function maxOf(list) {
  let m = -Infinity;
  for (const x of list) if (x > m) m = x;
  return m;
}
function minOf(list) {
  let m = Infinity;
  for (const x of list) if (x < m) m = x;
  return m;
}
// Adds a list of any length to another, for the same reason.
function addAll(list, more) {
  for (const x of more) list.push(x);
  return list;
}

// A whole count with commas. Past what a number holds exactly it is no count of anything (a target of
// 1e-300% asks for one): words, never "Infinity" or a figure with an exponent (trap P42).
const countable = n => Number.isSafeInteger(Math.round(n));
const thousands = n => (countable(n) ? String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : 'more than any sample could hold');

// Text in one fixed order, whatever the machine's locale says, so a report reads the same everywhere
// (trap P38). The collator is made once, by the first comparison that needs it.
let collator = null;
function compareText(a, b) {
  if (collator === null) collator = new Intl.Collator('en');
  return collator.compare(a, b);
}

module.exports = { isObj, isText, isName, isPath, isProb, isLabel, describe, isReserved, own, maxOf, minOf, addAll, countable, thousands, compareText };

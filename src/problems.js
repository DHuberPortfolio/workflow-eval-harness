// Collects every problem found in the input, so they can all be reported at once.
//
// Each problem has a level:
//   stop - scoring must not go ahead
//   warn - scoring goes ahead, the report shows it
//   fix  - the tool cleaned something up; the report says what
// and names the trap it belongs to (see test/TRAPS.md), where it was found, and what is wrong.
//
// mode decides what "strict" problems become: stop in strict mode (golden sets, where
// anything odd is a bug to fix), warn in lenient mode (samples of real production output).

// Record ids are marked where a problem's place or message is written (markId), so a report that
// must not name some records (a held-out half: split.js maskProblems, trap O6) can take exactly
// those out, by where each was written, never by searching the text: "12" in "12 records" is never
// taken for record 12. The marks never reach a report: a problem is kept without them, with where
// its ids were in a property no report or JSON file reads (marks).

const { escapeControls } = require('./text.js');

const OPEN = '';
const MID = '';
const CLOSE = '';
// An id may hold the mark characters themselves (they are private-use characters, and data is data:
// trap P21). Inside a mark they are written as ESCAPE and a digit, so a mark can be read back exactly.
const ESCAPE = '\uE003';
const MARK_CHARS = /[\uE000-\uE003]/g;
const sealed = s => s.replace(MARK_CHARS, c => ESCAPE + (c.charCodeAt(0) - 0xE000));
const opened = s => (s.includes(ESCAPE) ? s.replace(/\uE003([0-3])/g, (_, d) => String.fromCharCode(0xE000 + Number(d))) : s);
// A record's id as written into a problem. shown: the text written, when not the id itself (an id
// before its spaces are trimmed, or in another case).
const markId = (id, shown) => OPEN + sealed(String(shown === undefined ? id : shown)) + (shown === undefined ? '' : MID + sealed(String(id))) + CLOSE;

// The text without marks, and each marked id's place in it: [{ id, start, end }]. Only a close with
// an open before it is a mark: a value written into a message can hold either character alone, and it
// stays as written. Each pass moves past a close, so this always ends.
function unmark(text) {
  if (typeof text !== 'string' || !text.includes(OPEN)) return { text, ids: [] };
  let out = '';
  const ids = [];
  let i = 0;
  for (let b = text.indexOf(CLOSE); b !== -1; b = text.indexOf(CLOSE, i)) {
    const a = text.lastIndexOf(OPEN, b);
    if (a < i) { out += text.slice(i, b + 1); i = b + 1; continue; }
    out += text.slice(i, a);
    const [written, id] = text.slice(a + 1, b).split(MID);
    const shown = opened(written);
    ids.push({ id: id === undefined ? shown : opened(id), start: out.length, end: out.length + shown.length });
    out += shown;
    i = b + 1;
  }
  return { text: out + text.slice(i), ids };
}

// The stops, as the error that stops scoring says them.
function stopsText(stops) {
  const lines = stops.map(i => (i.strict ? '* ' : '') + '[' + i.trap + '] ' + escapeControls(i.where, false) + ': ' + escapeControls(i.message, false));
  const hint = stops.some(i => i.strict) ? '\n(* strict mode only: --lenient would report these as warnings)' : '';
  return stops.length + ' problem(s) stop scoring (details in test/TRAPS.md):\n  - ' + lines.join('\n  - ') + hint;
}

// A problem with its record ids' places (marks: { where, message }), kept out of reports and JSON.
function withMarks(item, where, message) {
  if (where.length || message.length) Object.defineProperty(item, 'marks', { value: { where, message } });
  return item;
}

function problems(mode = 'strict') {
  if (mode !== 'strict' && mode !== 'lenient') throw new Error('mode must be "strict" or "lenient", got ' + mode);
  const items = [];
  const add = (level, strict) => (trap, where, message) => {
    const w = unmark(where);
    const m = unmark(message);
    const item = { level, trap, where: w.text, message: m.text };
    if (strict) item.strict = true;   // remembered so the error can say --lenient would allow it
    items.push(withMarks(item, w.ids, m.ids));
  };

  return {
    mode,
    items,
    stop: add('stop', false),
    warn: add('warn', false),
    fix: add('fix', false),
    strict: add(mode === 'strict' ? 'stop' : 'warn', true),

    // Throws one error listing every stop, or does nothing if there are none. The error keeps the
    // problems it was made from (items, not shown), so a report can say it again without some ids.
    throwIfStopped() {
      const stops = items.filter(i => i.level === 'stop');
      if (stops.length === 0) return;
      const e = new Error(stopsText(stops));
      Object.defineProperty(e, 'items', { value: items.slice() });
      throw e;
    },
  };
}

// Adds to a list of problems the ones it does not hold yet, each once.
function addNew(list, items) {
  const key = i => i.trap + i.where + i.message;
  const seen = new Set(list.map(key));
  for (const i of items) {
    if (!seen.has(key(i))) { seen.add(key(i)); list.push(i); }
  }
}

module.exports = { problems, addNew, markId, unmark, stopsText, withMarks, MARKS: { OPEN, MID, CLOSE } };

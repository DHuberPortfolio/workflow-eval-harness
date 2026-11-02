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

const OPEN = '';
const MID = '';
const CLOSE = '';
// A record's id as written into a problem. shown: the text written, when not the id itself (an id
// before its spaces are trimmed, or in another case).
const markId = (id, shown) => OPEN + String(shown === undefined ? id : shown) + (shown === undefined ? '' : MID + String(id)) + CLOSE;

// The text without marks, and each marked id's place in it: [{ id, start, end }].
function unmark(text) {
  if (typeof text !== 'string' || !text.includes(OPEN)) return { text, ids: [] };
  let out = '';
  const ids = [];
  let i = 0;
  for (let a = text.indexOf(OPEN); a !== -1; a = text.indexOf(OPEN, i)) {
    const b = text.indexOf(CLOSE, a);
    out += text.slice(i, a);
    const [shown, id] = text.slice(a + 1, b).split(MID);
    ids.push({ id: id === undefined ? shown : id, start: out.length, end: out.length + shown.length });
    out += shown;
    i = b + 1;
  }
  return { text: out + text.slice(i), ids };
}

// The stops, as the error that stops scoring says them.
function stopsText(stops) {
  const lines = stops.map(i => (i.strict ? '* ' : '') + '[' + i.trap + '] ' + i.where + ': ' + i.message);
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

module.exports = { problems, markId, unmark, stopsText, withMarks, MARKS: { OPEN, MID, CLOSE } };

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

function problems(mode = 'strict') {
  if (mode !== 'strict' && mode !== 'lenient') throw new Error('mode must be "strict" or "lenient", got ' + mode);
  const items = [];
  const add = (level, strict) => (trap, where, message) => {
    const item = { level, trap, where, message };
    if (strict) item.strict = true;   // remembered so the error can say --lenient would allow it
    items.push(item);
  };

  return {
    mode,
    items,
    stop: add('stop', false),
    warn: add('warn', false),
    fix: add('fix', false),
    strict: add(mode === 'strict' ? 'stop' : 'warn', true),

    // Throws one error listing every stop, or does nothing if there are none.
    throwIfStopped() {
      const stops = items.filter(i => i.level === 'stop');
      if (stops.length === 0) return;
      const lines = stops.map(i => (i.strict ? '* ' : '') + '[' + i.trap + '] ' + i.where + ': ' + i.message);
      const hint = stops.some(i => i.strict) ? '\n(* strict mode only: --lenient would report these as warnings)' : '';
      throw new Error(stops.length + ' problem(s) stop scoring (details in test/TRAPS.md):\n  - ' + lines.join('\n  - ') + hint);
    },
  };
}

module.exports = { problems };

// wfeval suspects as plain text for the terminal (100 columns): the answer-key entries the runs
// disagree with, the likeliest key errors first, each with why it is listed, in the numbers the
// ranking used (metrics/suspects.js).

const { table, rulingsWords, rulingStatus, thousands, plural } = require('./format.js');
const { howSplit, setAsideText, heldOutRulingsCount, localDate } = require('./split.js');

const WIDTH = 100;
// Words wrapped to the report's width, every line indented.
function wrap(text, indent) {
  const lines = [];
  let line = indent;
  for (const word of text.split(' ')) {
    if (line.length + word.length + 1 > WIDTH && line.trim() !== '') { lines.push(line.replace(/ +$/, '')); line = indent; }
    line += word + ' ';
  }
  if (line.trim() !== '') lines.push(line.replace(/ +$/, ''));
  return lines.join('\n');
}

const range = c => (c === null ? null : c.min === c.max ? c.min.toFixed(2) : c.min.toFixed(2) + '-' + c.max.toFixed(2));

// "4 of 4 say it, 3 applied (0.75-0.85)" or, for one run, "says it, not applied (0.85)". A value
// stated with no confidence (a rule's output) says so.
function runsWords(s) {
  const d = s.said;
  const conf = d.said === 0 ? '' : ' (' + (range(d.confidence) || 'no confidence') + ')';
  if (s.kind === 'label') return (d.runs === 1 ? 'says ' + d.label : d.said + ' of ' + d.runs + ' say ' + d.label) + conf;
  if (d.runs === 1) return d.said === 0 ? 'does not say it' : 'says it' + (d.applied ? '' : ', not applied') + conf;
  if (d.said === 0) return 'none of ' + d.runs + ' says it';
  return d.said + ' of ' + d.runs + ' say it' + (d.applied < d.said ? ', ' + d.applied + ' applied' : '') + conf;
}

const keyWords = s => (s.kind === 'key_lacks' ? 'lacks ' : s.kind === 'key_lists' ? 'lists ' : 'says ') + s.value;

// How strongly the workflow states something, in a bin: "says X at 0.90 or more" for one run, "the
// runs give X an average of 0.90 or more" for several.
const level = bin => (bin.startsWith('below') ? bin : 'at ' + bin);
const average = bin => 'an average ' + (bin.startsWith('below') ? bin : 'of ' + bin);

const pct = x => Math.round(x * 100) + '%';
// Two decimals, rounded as written: 0.475 is 0.48 (toFixed reads the binary 0.47499... as 0.47).
const two = x => (Math.round(Number((x * 100).toPrecision(12))) / 100).toFixed(2);

// A curve value is an estimate, not a count: the counts it was read from come first, then what the
// tool reads them as. Half a record each way pulls a level with few records toward even (6 of 6 reads
// as about 93%), and between two levels the curve is read in a straight line: both are said, so the
// figure is never taken for an observed rate. "Few": fewer than 20 records in the counts read.
const FEW = 20;
function reading(from, value) {
  if (from.length === 0) return null;
  const few = from.reduce((n, x) => n + x.of, 0) < FEW ? 'with so few records, ' : '';
  return from.map(x => thousands(x.agree) + ' of ' + thousands(x.of) + ' ' + x.where).join(' and ') + '; ' +
    (from.length > 1 ? few + 'reading between them, the tool puts it at about ' : few + 'the tool reads that as about ') + pct(value) + '.';
}
// With no other record to read from, the curve is even (metrics/suspects.js curveOf).
const EVEN = 'the tool takes it as an even chance, 50%.';

// With several runs, the number a suspect is ranked on: the runs' average confidence, 0 for a run
// that does not say it. With one run it is that run's confidence, already in the run column.
function averageWords(s) {
  const d = s.said;
  if (d.runs < 2) return '';
  const avg = 'Average ' + two(s.average_confidence) + ' over ' + d.runs + ' runs';
  const missing = d.runs - d.said;
  if (missing === 0) return avg + '. ';
  if (d.said === 0) return avg + ': no run says it. ';
  const [one, many] = s.kind === 'label' ? ['gives another label', 'give another label'] : ['does not say it', 'do not say it'];
  return avg + ', counting 0 for ' + (missing === 1 ? 'the run that ' + one : 'the ' + missing + ' runs that ' + many) + '. ';
}

// Why a suspect is listed, in the numbers its weight came from.
function why(s, runs) {
  const e = s.evidence;
  const one = runs === 1;
  const says = what => (one ? 'this workflow says ' + what + ' ' + level(e.bin) : 'the runs give ' + what + ' ' + average(e.bin));
  const cap = t => t[0].toUpperCase() + t.slice(1);
  let text;
  if (e.kind === 'key_lacks') {
    const read = reading(e.curve_from, e.curve);
    const curve = ' For ' + s.output + ' values ' + (one ? 'said' : 'given') + ' at about that level, ';
    text = e.of === 0
      ? cap(says(s.value)) + ' on no other record.' + (read ? curve + 'the answer key listed ' + read : ' No other ' + s.output + ' value to read from: ' + EVEN)
      : 'On other records where ' + says(s.value) + ', the answer key lists it ' + thousands(e.listed) + ' of ' + thousands(e.of) + ' times.' +
        (read ? curve + 'it listed ' + read : '');
  } else if (e.kind === 'key_lists') {
    // "leaves it out on 0 of the 3", never "never says it 0 of 3 times".
    const how = e.bin === 'never' ? (one ? 'this workflow leaves ' : 'the runs leave ') + (e.listed === 0 ? 'it' : s.value) + ' out'
      : (one ? 'this workflow says ' : 'the runs give ') + (e.listed === 0 ? 'it ' : s.value + ' ') + (one ? level(e.bin) : average(e.bin));
    text = e.listed === 0
      ? 'No other record\'s answer key lists ' + s.value + '; ' + how + ' on ' + thousands(e.when_lacking) + ' of the ' + thousands(e.lacking) + ' records whose key lacks it.'
      : cap(how) + ' on ' + thousands(e.when_listed) + ' of the ' + thousands(e.listed) + ' other records whose answer key lists it, and on ' +
        thousands(e.when_lacking) + ' of the ' + thousands(e.lacking) + ' whose key lacks it.';
  } else {
    const read = reading(e.curve_from, e.curve);
    text = read
      ? 'Where ' + (one ? 'this workflow gives' : 'the runs give') + ' a ' + s.output + ' label ' + (one ? 'at about this level' : 'about this average') +
        ' on other records, the answer key agreed on ' + read
      : 'No other record has a ' + s.output + ' label to compare with the answer key: ' + EVEN;
  }
  // The run column says "no confidence"; the line says how it was counted (N18).
  const none = s.said.said > 0 && s.said.confidence === null ? 'Stated with no confidence, which counts as 1. ' : '';
  const rule = s.kind === 'label' ? 'replace (with ' + s.with + ') or keep' : s.verbs.join(' or ');
  const who = [s.by, s.on].filter(Boolean).join(', ');
  const status = s.ruling === 'pending' ? '[' + rulingStatus(s) + '] '
    : s.ruling === 'set aside' ? '[ruled ' + s.set_aside.ruling + (who ? ' (' + who + ')' : '') + ', set aside: ' + s.set_aside.why + '] ' : '';
  return status + none + averageWords(s) + text + ' Rule: ' + rule + '.';
}

// ---------- with a split in the config (traps O21-O24) ----------

// A paragraph whose first line starts with a heading and whose later lines are indented two spaces.
const headed = text => wrap(text, '  ').replace(/^ {2}/, '');

// The look --show-held-out made (split-log.js commitLook), in words.
function lookWords(lk) {
  if (!lk.counted) {
    return lk.reason === 'no_log' ? 'Looks at the held-out half are not counted without split.log, so this listing is not recorded: add "log": "split-log.json" to split in the config to count it.'
      : 'This listing was not recorded in split.log.';
  }
  const at = lk.repeat
    ? 'Look ' + lk.look + ' at this held-out half again (' + lk.log + '): the same command, files, config and mode as on ' + localDate(lk.repeat.date) + ', so it is not counted again.'
    : lk.new_log ? 'The first look at this held-out half: no log file was found at ' + lk.log + ', so a new one was started.'
      : 'Look ' + lk.look + ' at this held-out half (counted in ' + lk.log + ').';
  // The log records the held-out records listed (the held-out suspects shown), and only those (trap O13).
  return at + (lk.ids_shown ? ' The log records the held-out records it listed: from now on a claim on them can spend nothing.'
    : ' No held-out record is among the suspects shown, so the log records no listing; it is a look all the same.');
}

// What the list leaves out (O21): said once, with how many and how to include them; or, with
// --show-held-out, that both halves are in it, and the look that recorded it (O23).
function splitSection(s) {
  const held = s.held_out.records;
  const lines = [];
  if (s.held_out.left_out) {
    lines.push('SPLIT  The tuning half: ' + thousands(s.tuning.records) + ' of ' + thousands(s.tuning.records + held + s.set_aside) + ' records.');
    lines.push(wrap((held === 1 ? 'The other record is' : 'The other ' + thousands(held) + ' records are') + ' held out from tuning (' + howSplit(s) +
      '): left out here, both as suspects and from the evidence each suspect is ranked on. --show-held-out includes ' + (held === 1 ? 'it' : 'them') + '.', '  '));
  } else if (held === 0) {
    lines.push(headed('SPLIT  No record fell in the held-out half (' + howSplit(s) + '): every record is listed and read as evidence, as without a split.'));
  } else {
    lines.push(headed('SPLIT  Both halves, with --show-held-out: the ' + plural(held, 'held-out record', 'held-out records') + ' (' + howSplit(s) + ') ' +
      (held === 1 ? 'is' : 'are') + ' listed and read as evidence with the tuning half\'s ' + thousands(s.tuning.records) + '.'));
  }
  if (s.set_aside) lines.push(wrap(setAsideText(s.set_aside), '  '));
  const counted = heldOutRulingsCount(s.rulings && s.rulings.held_out);
  if (counted) lines.push(wrap('Rulings on held-out records: ' + counted + ' (counted, not listed).', '  '));
  if (s.look) lines.push(wrap(lookWords(s.look), '  '));
  return lines.join('\n');
}

function renderSuspects(r, top = 20) {
  const parts = [];
  const n = r.runs;
  parts.push('SUSPECTS  answer-key entries the run' + (n === 1 ? '' : 's') + ' disagree' + (n === 1 ? 's' : '') + ' with, the likeliest key errors first\n' +
    '  ' + (n === 1 ? '1 run' : n + ' runs') + ' against ' + r.inputs.key + ' · ' + r.inputs.mode + ' mode\n' +
    r.inputs.runs.map((f, i) => '  run ' + (i + 1) + '  ' + f).join('\n'));
  if (r.split) parts.push(splitSection(r.split));
  // With held-out records left out, what the list says is about the tuning half only.
  const half = r.split && r.split.held_out.left_out ? ' in the tuning half' : '';
  if (r.rulings) {
    const [first, ...rest] = rulingsWords(r.rulings);
    parts.push([headed('RULINGS  ' + first), ...rest.map(l => wrap(l, '  '))].join('\n'));
  }
  const c = r.counts;
  const lines = [];
  if (c.total === 0) {
    const none = 'No suspect' + (r.rulings && r.rulings.not_listed ? ' left to rule on' : '') + ': the run' + (n === 1 ? ' agrees' : 's agree') + ' with every entry of the answer key' + half +
      (r.rulings && r.rulings.not_listed ? ' that has no ruling yet' : '') + '.';
    lines.push(headed(none));
  } else {
    const kinds = [[c.key_lacks, 'value', 'values', 'the answer key may be missing'], [c.key_lists, 'value', 'values', 'it may list wrongly'],
      [c.label, 'label', 'labels', 'it may have wrong']].filter(([k]) => k > 0).map(([k, one, many, what]) => k + ' ' + (k === 1 ? one : many) + ' ' + what);
    lines.push(wrap(c.total + ' suspect' + (c.total === 1 ? '' : 's') + ': ' + kinds.join(', ') + '. Each is a mistake by the workflow or by the answer key: ' +
      'a reviewer reads the record and rules.', '  '));
    const shown = r.suspects.slice(0, top);
    const rows = [['#', 'record', 'output', 'the answer key', 'the run' + (n === 1 ? '' : 's')]];
    // Two spaces between columns, not three: long values and confidence ranges fit in 100.
    const body = table([...rows, ...shown.map(s => [String(s.rank), s.id, s.output, keyWords(s), runsWords(s)])], [0], '  ', '  ').split('\n');
    lines.push('', body[0]);
    shown.forEach((s, i) => { lines.push(body[i + 1]); lines.push(wrap(why(s, n), '       ')); });
    if (r.suspects.length > shown.length) lines.push('  +' + (r.suspects.length - shown.length) + ' more (all in --json; --top ' + r.suspects.length + ' lists them all here)');
  }
  // N8: said once, as a count (never ids: with a split, only the records shown are counted).
  if (r.key_leaves_out) {
    const k = r.key_leaves_out;
    lines.push(wrap(plural(k, 'record', 'records') + ' the answer key blocks or suppresses as ' + (k === 1 ? 'a duplicate is' : 'duplicates are') +
      ' left out, as suspects and as evidence: whatever ' + (k === 1 ? 'its values, it changes' : 'their values, they change') +
      ' no routing rate (only output quality counts ' + (k === 1 ? 'it' : 'them') + ').', '  '));
  }
  if (r.rulings && r.rulings.not_listed) {
    lines.push(wrap(r.rulings.not_listed + ' more ' + (r.rulings.not_listed === 1 ? 'was' : 'were') + ' ruled in ' + r.rulings.file +
      ' (add, reject, remove, keep or replace): not listed again.', '  '));
  }
  parts.push(lines.join('\n'));
  if (c.total) {
    parts.push(wrap('How they are ranked: by how surprising the run' + (n === 1 ? '\'s answer' : 's\' answers') + ' would be if the answer key entry were right, ' +
      'measured on the answer key\'s other records' + half + '; every entry is taken to be as likely as any other to be wrong.' +
      (n === 1 ? '' : ' A value\'s confidence is averaged over the runs, 0 where a run does not say it, so runs that agree count for more.') + ' A suspect is not proof, and a key ' +
      'error the runs agree with cannot be listed at all. Record each ruling in a rulings file and pass it with --rulings (docs/CONFIG.md): ' +
      '--write-rulings <new file> writes the listed suspects as pending rulings to fill in.', '  '));
  }
  const notes = r.problems.filter(i => i.level !== 'stop');
  // Wrapped like the rest, each note's later lines indented under its first.
  if (notes.length) parts.push('WARNINGS AND CLEAN-UPS\n' + notes.map(i => wrap(i.level + ' [' + i.trap + '] ' + i.where + ': ' + i.message, '    ').replace(/^ {4}/, '  ')).join('\n'));
  return parts.join('\n\n') + '\n';
}

module.exports = { renderSuspects };

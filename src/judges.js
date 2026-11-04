// wfeval judges: the questions a rulings file leaves open, put to AI judges, and their answers
// turned back into rulings (section Q of test/TRAPS.md). The harness calls no model: it writes the
// questions and reads the answers, and whatever ran the judges is outside it.
//
// Two rules make a panel worth more than one reader:
//   - A judge sees the case and nothing of who proposed what, nor the ranking: being told what the
//     runs say, or how likely the harness thinks an error is, is how a reader comes to agree with it.
//     What the key lists for the record beside the value asked about is shown, as `listed`: whether
//     a value repeats one already there cannot be judged without it. A label's question shows
//     nothing of the key, since the key's label is the answer in doubt.
//   - Only a unanimous panel decides. A split, or a judge who gave no answer, leaves the ruling
//     pending, and the report's bracket shows what it could do to the rate.
const { pendingKind } = require('./rulings.js');
const { isObj, describe } = require('./values.js');
const { slotValues } = require('./metrics/slots.js');

const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// A label has one answer per record, and its question must not show what the key says.
const askedKey = (id, output, value, isLabel) => JSON.stringify(isLabel ? [id, output] : [id, output, value]);
const keyOf = x => askedKey(x.id, x.output, x.value, x.label);

function casesFrom(rulings, config, key) {
  const byId = new Map(key.map(k => [k.id, k]));
  // Every value the key lists for this output on this record but the one asked about.
  const listedBeside = x => {
    const k = byId.get(x.id);
    const slots = k && Array.isArray(k.outputs[x.output]) ? k.outputs[x.output] : [];
    return slots.flatMap(slotValues).filter(v => v !== x.value).sort(order);
  };
  const open = rulings.list.filter(x => x.ruling === 'pending');
  if (open.length === 0) throw new Error('[Q1] ' + rulings.file + ' has no pending ruling: there is nothing to ask');
  return open
    .map(x => (x.label
      ? { id: x.id, output: x.output, asks: 'label', labels: config.outputs[x.output].labels.map(String) }
      : { id: x.id, output: x.output, asks: 'belongs', value: x.value, listed: listedBeside(x) }))
    .sort((a, b) => order(a.id, b.id) || order(a.output, b.output) || order(a.value || '', b.value || ''));
}

// One judge's file, checked against the questions: an answer to nothing, or one that says nothing,
// could change a key, so each stops the run rather than being passed over.
function readAnswers({ file, data }, open) {
  if (!isObj(data) || typeof data.judge !== 'string' || data.judge.trim() === '') throw new Error('[Q2] ' + file + ' needs "judge": a name for this judge');
  if (!Array.isArray(data.answers)) throw new Error('[Q2] ' + file + ' needs "answers": a list, got ' + describe(data.answers));
  const answers = new Map();
  for (const a of data.answers) {
    if (!isObj(a)) throw new Error('[Q3] ' + file + ': an answer must be an object, got ' + describe(a));
    const id = String(a.id);
    const isLabel = a.label !== undefined;
    const key = askedKey(id, a.output, a.value, isLabel);
    const x = open.get(key);
    if (!x) throw new Error('[Q3] ' + file + ' answers a question nobody asked: ' + id + ' ' + a.output + (isLabel ? '' : ' ' + a.value));
    if (answers.has(key)) throw new Error('[Q3] ' + file + ' answers ' + id + ' ' + a.output + ' twice');
    if (x.label) {
      if (!x.labels.includes(a.label)) throw new Error('[Q3] ' + file + ': ' + id + ' ' + a.output + ' is answered ' + describe(a.label) + ', which is not one of its labels');
    } else if (typeof a.belongs !== 'boolean') {
      throw new Error('[Q3] ' + file + ': ' + id + ' ' + a.output + ' needs "belongs": true or false, got ' + describe(a.belongs));
    }
    answers.set(key, a);
  }
  return { judge: data.judge.trim(), answers };
}

// What a unanimous panel rules, or null. What a value "belonging" means depends on what was asked:
// a value the key lacks is added, one it lists is kept.
function outcome(x, said) {
  if (x.label) {
    const labels = new Set(said.map(a => a.label));
    if (labels.size !== 1) return null;
    const [l] = labels;
    return l === x.value ? { ruling: 'keep' } : { ruling: 'replace', with: l };
  }
  const yes = said.filter(a => a.belongs).length;
  if (yes !== 0 && yes !== said.length) return null;
  const belongs = yes === said.length;
  if (pendingKind(x) === 'remove') return { ruling: belongs ? 'keep' : 'remove' };
  return { ruling: belongs ? 'add' : 'reject' };
}

function splitNote(x, said) {
  if (x.label) {
    const n = new Map();
    for (const a of said) n.set(a.label, (n.get(a.label) || 0) + 1);
    return 'AI judges split: ' + [...n].sort((a, b) => b[1] - a[1] || order(a[0], b[0])).map(([l, k]) => k + ' ' + l).join(', ');
  }
  const yes = said.filter(a => a.belongs).length;
  return 'AI judges split: ' + yes + ' yes, ' + (said.length - yes) + ' no';
}
const joined = (note, more) => (note ? note + ' | ' + more : more);

// files: [{ file, data }], one per judge. Rulings already decided are carried over word for word:
// a panel answers what was open, and overrules nobody.
function mergeAnswers(rulings, config, files, { on }) {
  if (files.length < 2) throw new Error('[Q2] a panel needs at least 2 judges, got ' + files.length);
  const open = new Map(rulings.list.filter(x => x.ruling === 'pending').map(x => [keyOf(x), { ...x, labels: x.label ? config.outputs[x.output].labels.map(String) : null }]));
  if (open.size === 0) throw new Error('[Q1] ' + rulings.file + ' has no pending ruling: there is nothing to decide');
  const panel = files.map(f => readAnswers(f, open));
  const seen = new Set();
  for (const p of panel) {
    if (seen.has(p.judge)) throw new Error('[Q2] judge ' + p.judge + ' is listed twice: a panel is separate readers');
    seen.add(p.judge);
  }
  const n = panel.length;
  const counts = { judges: n, cases: open.size, decided: 0, split: 0, unanswered: 0 };
  const byIndex = new Map(rulings.list.map(x => [x.index, x]));
  const out = rulings.entries.map((raw, i) => {
    const x = byIndex.get(i);
    if (!x || x.ruling !== 'pending') return raw;
    const key = keyOf(x);
    const said = panel.map(p => p.answers.get(key)).filter(Boolean);
    if (said.length < n) {
      counts.unanswered++;
      return { ...raw, note: joined(raw.note, said.length + ' of ' + n + ' AI judges answered') };
    }
    const made = outcome(open.get(key), said);
    if (!made) {
      counts.split++;
      return { ...raw, note: joined(raw.note, splitNote(x, said)) };
    }
    counts.decided++;
    const why = said.map(a => a.why).find(w => typeof w === 'string' && w.trim() !== '');
    return { id: x.id, output: x.output, value: x.value, ...made, by: n + ' AI judges', on, reviewer_kind: 'judge', ...(why ? { note: why.trim() } : {}) };
  });
  return { rulings: out, counts, text: '{ "rulings": [\n' + out.map(r => '  ' + JSON.stringify(r)).join(',\n') + '\n] }\n' };
}

module.exports = { casesFrom, mergeAnswers };

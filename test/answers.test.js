// Free answers (trap F15): a number within a tolerance, and text compared once it is tidied. A question-answering agent's
// answers are not labels from a fixed list: compared as exact text, 27.615 against 27.61 and ('Alan Payne',) against
// Alan Payne both read as wrong, and an agent that answered 18 of 20 right reads as one that answers 2 in 3 wrong.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateConfig } = require('../src/config.js');
const { scoreRun } = require('../src/score.js');
const { renderTerminal } = require('../src/report/terminal.js');
const { renderHtml } = require('../src/report/html.js');

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-answers-'));
function json(name, content, d) {
  const p = path.join(d, name);
  fs.writeFileSync(p, JSON.stringify(content));
  return p;
}
const routing = { field: 'route', map: { send: 'auto', hold: 'review' } };
const configOf = output => {
  const r = validateConfig({ id_field: 'id', outputs: { answer: output }, routing });
  assert.deepEqual(r.errors, []);
  return r.config;
};
function run(output, pairs) {
  const d = folder();
  const pred = pairs.map(([given], i) => ({ id: 'Q' + (i + 1), route: 'send', answer: given }));
  const key = pairs.map(([, right], i) => ({ id: 'Q' + (i + 1), answer: right }));
  return scoreRun({ config: configOf(output), predPath: json('p.json', pred, d), keyPath: json('k.json', key, d) });
}
const wrongIds = r => r.routing.silent_errors.records.map(x => x.id);

test('F15: a number is right within its tolerance, however it was written', () => {
  const r = run({ type: 'number', tolerance: 0.005 }, [
    [27.615, 27.61],            // within 0.005
    ['27.610', '27.61'],        // the same number written two ways
    ['(27.6149,)', 27.61],      // a database row as the agent printed it
    [27.62, 27.61],             // 0.01 off: wrong
    ['about 27', 27.61],        // not a number: a wrong answer, not a broken file
  ]);
  const a = r.quality.outputs.answer;
  assert.equal(a.type, 'number');
  assert.deepEqual([a.accuracy.n, a.accuracy.d], [3, 5]);
  assert.equal(a.tolerance, 0.005);
  assert.equal(a.within_tolerance, 2);
  assert.deepEqual(wrongIds(r), ['Q4', 'Q5']);
});

test('F15: with no tolerance a number must be the same number, not the same text', () => {
  const a = run({ type: 'number' }, [[27.615, 27.61], ['1e3', 1000], ['1000.0', '1000']]).quality.outputs.answer;
  assert.deepEqual([a.accuracy.n, a.accuracy.d], [2, 3]);
});

test('F15: text is compared once case, spaces and the quotes, brackets and commas around it are tidied away', () => {
  const r = run({ type: 'text' }, [
    ["('Alan Payne',)", 'Alan Payne'],
    ['  alan   PAYNE ', 'Alan Payne'],
    ['"Paris"', 'paris'],
    ['Alan Paine', 'Alan Payne'],
  ]);
  const a = r.quality.outputs.answer;
  assert.equal(a.type, 'text');
  assert.deepEqual([a.accuracy.n, a.accuracy.d], [3, 4]);
  assert.deepEqual(wrongIds(r), ['Q4']);
});

test('F15: an answer key that is not a number stops the run', () => {
  assert.throws(() => run({ type: 'number', tolerance: 0.5 }, [[1, 'one']]), /answer is "one", which is not a number/);
});

test('F15: settings that cannot apply to free answers are refused when the config is read', () => {
  const errors = output => validateConfig({ id_field: 'id', outputs: { answer: output }, routing }).errors.join(' ');
  assert.match(errors({ type: 'label', labels: ['a', 'b'], tolerance: 0.1 }), /tolerance only applies to type "number" or "text"/);
  assert.match(errors({ type: 'number', tolerance: -1 }), /tolerance must be a number of 0 or more/);
  assert.match(errors({ type: 'number', labels: ['a', 'b'] }), /labels only applies to type "label" or "ordinal"/);
  assert.match(errors({ type: 'text', decline: { values: ['none'] } }), /decline/);
  assert.equal(errors({ type: 'number', tolerance: 0 }), '');
  assert.equal(errors({ type: 'text' }), '');
});

test('F15: terminal and page show the accuracy, and no table of every distinct answer', () => {
  const r = run({ type: 'number', tolerance: 0.005 }, [[27.615, 27.61], [3, 4]]);
  const t = renderTerminal(r);
  assert.match(t, /answer \(number\): accuracy 50\.0%/);
  assert.match(t, /within 0\.005 of the answer key/);
  assert.doesNotMatch(t, /as 27\.61/);
  const h = renderHtml(r);
  assert.match(h, /answer: accuracy 50\.0%/);
  assert.doesNotMatch(h, /predicted 27\.61/);
});

test('F15: several runs and the suspects check read free answers, and a ruling on one is refused, not guessed', () => {
  const d = folder();
  const config = configOf({ type: 'number', tolerance: 0.005 });
  const key = json('k.json', [{ id: 'Q1', answer: 27.61 }, { id: 'Q2', answer: 4 }], d);
  const one = json('a.json', [{ id: 'Q1', route: 'send', answer: 27.615 }, { id: 'Q2', route: 'send', answer: 3 }], d);
  const two = json('b.json', [{ id: 'Q1', route: 'send', answer: '27.61' }, { id: 'Q2', route: 'send', answer: 3 }], d);
  const { varianceRun } = require('../src/score.js');
  const v = varianceRun({ config, keyPath: key, predPaths: [one, two] });
  assert.deepEqual(v.metrics.find(m => m.name === 'answer accuracy').values, [50, 50]);
  const s = require('../src/suspects.js').suspectsRun({ config, keyPath: key, predPaths: [one, two] });
  assert.ok(s);
  const rulings = json('r.json', { rulings: [{ id: 'Q2', output: 'answer', value: '3', ruling: 'keep' }] }, d);
  assert.throws(() => require('../src/rulings.js').loadRulings(rulings, config), /free number answer: rulings do not cover number or text outputs yet/);
});

test('F15: a text answer that is a number is compared as a number, so one column can hold names and figures', () => {
  // A question-answering agent answers some questions with a name and some with a figure: one text output with a tolerance reads both.
  const r = run({ type: 'text', tolerance: 0.005 }, [
    ["('Alan Payne',)", 'Alan Payne'],
    ['27.615', '27.61'],
    ['(27.610,)', '27.61'],
    ['27.62', '27.61'],
    ['Alan Paine', 'Alan Payne'],
  ]);
  const a = r.quality.outputs.answer;
  assert.deepEqual([a.accuracy.n, a.accuracy.d], [3, 5]);
  assert.deepEqual(wrongIds(r), ['Q4', 'Q5']);
  assert.equal(a.tolerance, 0.005);
  assert.equal(a.within_tolerance, 1);
});

test('F15: an empty or bracket-only answer is never right, and a big number gets no extra slack', () => {
  const n = run({ type: 'number', tolerance: 0.005 }, [['()', 0], ['2500000002', 2500000000], ['1000000000900', 1000000000000], ['27.615', 27.61], ['27.616', 27.61], ['1234567890123456788', '1234567890123456789']]);
  assert.deepEqual(wrongIds(n), ['Q1', 'Q2', 'Q3', 'Q5', 'Q6'], '"()" is no answer, 2 off is not within 0.005, 27.616 is just over, and two long numbers differ');
  const t = run({ type: 'text', tolerance: 0.005 }, [['()', '0'], ['[ ]', '0']]);
  assert.deepEqual(wrongIds(t), ['Q1', 'Q2']);
});

test('F15: text compares as numbers only when both are plain numbers a number can hold exactly', () => {
  const r = run({ type: 'text' }, [
    ['1234567890123456788', '1234567890123456789'],   // two long ids: different
    ['2134', '02134'],                                 // a code with a leading zero: different
    ['27.610', '27.61'],                               // plain numbers: the same
    ['0.50', '0.5'],                                   // "0.x" is plain: the same
    ['007', '7'],                                      // a leading zero is a code, not a number
  ]);
  assert.deepEqual(wrongIds(r), ['Q1', 'Q2', 'Q5']);
});

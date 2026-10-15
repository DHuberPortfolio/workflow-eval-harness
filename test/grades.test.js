// Free-text outputs graded by a person: the grades file and its scores,
// checked against test/fixtures/freetext/EXPECTED.md. Trap tests are named after their entry
// in test/TRAPS.md (section J).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateGradingConfig, loadGradingConfig, readForms, readGrades, fingerprint } = require('../src/grading.js');
const { problems } = require('../src/problems.js');
const { scoreGradesRun } = require('../src/score.js');
const { cohensKappa } = require('../src/metrics/stats.js');
const { renderGrades } = require('../src/report/terminal.js');

const dir = path.join(__dirname, 'fixtures', 'freetext');
const A = path.join(dir, 'grades-a.json');
const B = path.join(dir, 'grades-b.json');
const CONFIG = loadGradingConfig(path.join(dir, 'grading.json'));
const FORMS = readForms({ config: CONFIG, predPath: path.join(dir, 'forms.json') });
const R = scoreGradesRun({ gradesPath: A, secondPath: B });
const nd = r => [r.n, r.d, r.pct, r.low_pct, r.high_pct];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-grading-'));
const write = (name, data) => { const f = path.join(tmp, name); fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data)); return f; };
const gradesA = () => JSON.parse(fs.readFileSync(A, 'utf8'));
function readFlagged(data, mode = 'strict') {
  const p = problems(mode);
  const g = readGrades(write('g.json', data), p);
  return { g, flagged: p.items.map(i => i.level + ':' + i.trap), items: p.items };
}

// ---------- The scores ----------

test('grades: invented, missing and faithful rates over every field', () => {
  assert.equal(R.overall.graded, 15);
  assert.deepEqual(nd(R.overall.invented), [3, 15, 20, 7, 45.2]);
  assert.deepEqual(nd(R.overall.missing), [2, 15, 13.3, 3.7, 37.9]);
  assert.deepEqual(nd(R.overall.faithful), [10, 15, 66.7, 41.7, 84.8]);
  assert.deepEqual(R.severity, { invented: 'high', missing: 'medium' });
});

test('grades: per field and per section (a section pools its fields)', () => {
  const f = Object.fromEntries(R.fields.map(x => [x.name, [x.invented.n, x.missing.n, x.graded]]));
  assert.deepEqual(f, { type: [0, 0, 3], reason: [2, 0, 3], enjoyed: [1, 0, 3], independence: [0, 1, 3], manage_now: [0, 1, 3] });
  assert.deepEqual(nd(R.fields[1].invented), [2, 3, 66.7, 20.8, 93.9]);
  assert.deepEqual(nd(R.fields[0].invented), [0, 3, 0, 0, 56.2]);
  const s = R.sections.find(x => x.section === 'Unique strengths');
  assert.deepEqual(s.fields, ['enjoyed', 'independence', 'manage_now']);
  assert.deepEqual(nd(s.invented), [1, 9, 11.1, 2, 43.5]);
  assert.deepEqual(nd(s.missing), [2, 9, 22.2, 6.3, 54.7]);
  assert.deepEqual(R.sections.map(x => x.section), ['Is this a', 'Reason for contacting', 'Unique strengths']);
});

test('grades: forms with an invented field, and the kinds', () => {
  assert.deepEqual(nd(R.forms.with_invented), [2, 3, 66.7, 20.8, 93.9]);
  assert.deepEqual(R.forms.per_form.map(f => [f.form, f.invented, f.missing]), [['V1', 1, 1], ['V2', 2, 0], ['V3', 0, 1]]);
  assert.deepEqual(R.invented.map(x => x.form + ' ' + x.field), ['V1 reason', 'V2 reason', 'V2 enjoyed']);
  assert.deepEqual(R.kinds, { counts: { 'figure altered': 1, 'contradiction smoothed over': 1, 'inferred a diagnosis, risk or eligibility': 0, 'also leaves something out': 1 }, none_given: 1 });
});

test('grades: two reviewers, observed agreement and Cohen\'s kappa', () => {
  const a = R.agreement;
  assert.equal(a.compared, 15);
  assert.deepEqual(nd(a.observed), [13, 15, 86.7, 62.1, 96.3]);
  assert.equal(a.kappa, 0.735);            // 83/113
  assert.equal(a.invented_kappa, 0.762);   // 16/21
  assert.deepEqual(nd(a.invented_observed), [14, 15, 93.3, 70.2, 98.8]);
  assert.deepEqual(a.confusion, { faithful: { faithful: 9, invented: 0, missing: 1 }, invented: { faithful: 1, invented: 2, missing: 0 }, missing: { faithful: 0, invented: 0, missing: 2 } });
  assert.deepEqual(a.disagreements.map(d => [d.form, d.field, d.first, d.second]), [['V2', 'enjoyed', 'invented', 'faithful'], ['V3', 'reason', 'faithful', 'missing']]);
});

test('J9: kappa is "not measurable" when both used one grade only, never 1 or 0', () => {
  const m = { faithful: { faithful: 5, invented: 0, missing: 0 }, invented: { faithful: 0, invented: 0, missing: 0 }, missing: { faithful: 0, invented: 0, missing: 0 } };
  assert.equal(cohensKappa(m, ['faithful', 'invented', 'missing']), null);
  assert.equal(cohensKappa({ a: { a: 0, b: 0 }, b: { a: 0, b: 0 } }, ['a', 'b']), null);
  assert.equal(cohensKappa({ a: { a: 2, b: 0 }, b: { a: 0, b: 2 } }, ['a', 'b']), 1);
});

test('grades: the terminal report shows the headline, the invented fields and the disagreements', () => {
  const text = renderGrades(R);
  assert.match(text, /Invented\s+20\.0%\s+3 of 15\s+7\.0-45\.2%/);
  assert.match(text, /Forms with an invented field\s+66\.7%\s+2 of 3/);
  assert.match(text, /V1\s+reason\s+\[figure altered\]/);
  assert.match(text, /Cohen's kappa\s+0\.735/);
  assert.match(text, /V2\s+enjoyed\s+invented \/ faithful/);
});

test('score --grades: --fail-on high trips on an invented field; extra inputs are refused', () => {
  const run = args => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'wfeval.js'), ...args], { encoding: 'utf8' });
  const high = run(['score', '--grades', A, '--quiet', '--fail-on', 'high']);
  assert.equal(high.status, 3);
  assert.match(high.stderr, /V1 reason \(high\), V2 reason \(high\), V2 enjoyed \(high\)/);
  assert.equal(run(['score', '--grades', A, '--quiet', '--fail-on', 'critical']).status, 0);
  assert.match(run(['score', '--grades', A, '--quiet', '--fail-on', 'medium']).stderr, /V3 independence \(medium\)/);
  assert.equal(run(['score', '--grades', A, '--pred', A]).status, 1);
});

// ---------- The grades file (J1-J8, J10) ----------

test('J1: anything but a grades file stops', () => {
  assert.deepEqual(readFlagged('not json').flagged, ['stop:J1']);
  assert.deepEqual(readFlagged({ format: 'other' }).flagged, ['stop:J1']);
  assert.deepEqual(readFlagged({ ...gradesA(), grades: 'x' }).flagged, ['stop:J1']);
});

test('J2: a grade is read like a label: spaces trimmed, case never guessed', () => {
  const spaced = gradesA(); spaced.grades[0].grade = ' faithful ';
  assert.deepEqual(readFlagged(spaced).flagged, ['fix:J2']);
  const cased = gradesA(); cased.grades[0].grade = 'Faithful';
  const r = readFlagged(cased);
  assert.deepEqual(r.flagged, ['stop:J2']);
  assert.match(r.items[0].message, /did you mean "faithful"/);
  const other = gradesA(); other.grades[0].grade = 'unsure';
  assert.deepEqual(readFlagged(other).flagged, ['stop:J2']);
});

test('J3: a grade for a form or field the file does not list stops', () => {
  const f = gradesA(); f.grades[0].form = 'V9';
  assert.deepEqual(readFlagged(f).flagged, ['stop:J3']);
  const g = gradesA(); g.grades[0].field = 'nope';
  assert.deepEqual(readFlagged(g).flagged, ['stop:J3']);
});

test('J4: the same field graded twice stops', () => {
  const g = gradesA(); g.grades.push({ ...g.grades[0], grade: 'missing' });
  assert.deepEqual(readFlagged(g).flagged, ['stop:J4']);
});

test('J5: an ungraded field stops in strict mode; with --lenient it is left out of every rate', () => {
  const g = gradesA(); g.grades = g.grades.filter(x => !(x.form === 'V3' && x.field === 'independence'));
  assert.deepEqual(readFlagged(g).flagged, ['stop:J5']);
  const lenient = scoreGradesRun({ gradesPath: write('part.json', g), mode: 'lenient' });
  assert.deepEqual([lenient.overall.graded, lenient.overall.missing.n], [14, 1]);
  assert.deepEqual(lenient.ungraded, [{ form: 'V3', field: 'independence' }]);
  // V3 is no longer fully graded, so it is out of the forms rate rather than assumed clean.
  assert.deepEqual([lenient.forms.with_invented.n, lenient.forms.with_invented.d], [2, 2]);
  assert.deepEqual(lenient.forms.partly_graded, ['V3']);
  assert.throws(() => scoreGradesRun({ gradesPath: write('part.json', g) }), /\[J5\]/);
});

test('J6: kinds must be listed, and describe an invented field only', () => {
  const unknown = gradesA(); unknown.grades[1].kinds = ['made up'];
  assert.deepEqual(readFlagged(unknown).flagged, ['stop:J6']);
  const onFaithful = gradesA(); onFaithful.grades[0].kinds = ['figure altered'];
  assert.deepEqual(readFlagged(onFaithful).flagged, ['stop:J6']);
  assert.deepEqual(readFlagged(onFaithful, 'lenient').flagged, ['warn:J6']);
});

test('J7: a second reviewer who graded different text stops', () => {
  const other = JSON.parse(fs.readFileSync(B, 'utf8')); other.fingerprint = 'sha256:0000';
  assert.throws(() => scoreGradesRun({ gradesPath: A, secondPath: write('b.json', other) }), /\[J7\].*fingerprints differ/);
  const fewer = JSON.parse(fs.readFileSync(B, 'utf8')); fewer.forms = ['V1', 'V2']; fewer.grades = fewer.grades.filter(x => x.form !== 'V3');
  assert.throws(() => scoreGradesRun({ gradesPath: A, secondPath: write('b.json', fewer) }), /\[J7\].*different forms or fields/);
});

test('J8: the same grades file as both reviewers is a warning', () => {
  const r = scoreGradesRun({ gradesPath: A, secondPath: write('copy.json', fs.readFileSync(A, 'utf8')) });
  assert.deepEqual(r.problems.map(i => i.level + ':' + i.trap), ['warn:J8']);
  assert.equal(r.agreement.kappa, 1);
});

// ---------- Reading the forms (J13) ----------

test('the forms: three forms, five fields each, and the fingerprint the fixture grades carry', () => {
  assert.equal(FORMS.forms.length, 3);
  assert.deepEqual(FORMS.forms[0].fields.map(f => f.name), ['type', 'reason', 'enjoyed', 'independence', 'manage_now']);
  assert.equal(FORMS.fingerprint, gradesA().fingerprint);
  // Any change to the text graded changes the fingerprint.
  const changed = JSON.parse(JSON.stringify(FORMS.forms)); changed[1].fields[2].text += '.';
  assert.notEqual(fingerprint(changed), FORMS.fingerprint);
});

test('J13: an empty field is still graded; a field that is not text stops; a missing source is strict', () => {
  const forms = [
    { id: 'X1', transcript: 'said things', form: { type: 'Review', reason: null } },
    { id: 'X2', transcript: '', form: { type: 'Review', reason: { text: 'nested' } } },
  ];
  const cfg = validateGradingConfig({ source_field: 'transcript', fields: { type: { field: 'form.type' }, reason: { field: 'form.reason' } } }).config;
  assert.throws(() => readForms({ config: cfg, predPath: write('forms.json', forms) }), e => /\[J13\].*X2 form\.reason: must be text, got object/.test(e.message) && /\[J13\].*X2: has no source text/.test(e.message));
  const ok = readForms({ config: cfg, predPath: write('forms.json', forms.slice(0, 1)) });
  assert.deepEqual(ok.forms[0].fields, [{ name: 'type', text: 'Review' }, { name: 'reason', text: '' }]);
  assert.throws(() => readForms({ config: cfg, predPath: write('forms.json', [forms[0], forms[0]]) }), /\[B2\]/);
});

test('the grading config: misspelled keys and bad kinds are errors; defaults are filled in', () => {
  const { config, errors } = validateGradingConfig({ fields: { a: {} } });
  assert.deepEqual(errors, []);
  assert.deepEqual(config.fields, [{ name: 'a', field: 'a', section: null, label: 'a' }]);
  assert.deepEqual(config.kinds, ['figure altered', 'contradiction smoothed over', 'also leaves something out']);
  assert.match(validateGradingConfig({ fields: { a: {} }, sorce_field: 'x' }).errors[0], /unknown key "sorce_field"/);
  assert.match(validateGradingConfig({ fields: { a: { secton: 'x' } } }).errors[0], /unknown key "fields\.a\.secton"/);
  assert.match(validateGradingConfig({ fields: {} }).errors[0], /at least one entry/);
  assert.match(validateGradingConfig({ fields: { a: {} }, kinds: ['x', 'x'] }).errors[0], /distinct/);
});

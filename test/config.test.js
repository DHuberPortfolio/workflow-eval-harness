const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateConfig, loadConfig } = require('../src/config.js');

const TINY = path.join(__dirname, 'fixtures', 'tiny', 'config.json');

// Smallest config that should pass. Each test below breaks one thing.
const minimal = () => ({
  outputs: { SUBJECT: { type: 'set' } },
  routing: { map: { AUTO_PUBLISH: 'auto', EDITOR_REVIEW: 'review' } },
});

test('tiny fixture config loads', () => {
  const c = loadConfig(TINY);
  assert.deepEqual(Object.keys(c.outputs), ['SUBJECT', 'GEOGRAPHY']);
  assert.equal(c.routing.gold_field, 'expected_route');
  assert.equal(c.wrong_when, 'either');   // a gold route exists and no wrong_when is set
  assert.equal(c.trap_field, 'trap');
  assert.deepEqual(c.thresholds, { floor: 0.6, provisional_below: 0.75, auto_publish: { SUBJECT: 0.85 }, gate_uses: 'lead' });
});

test('minimal config gets every default filled in', () => {
  const { config, errors } = validateConfig(minimal());
  assert.deepEqual(errors, []);
  assert.equal(config.id_field, 'id');
  assert.equal(config.routing.field, 'route');
  assert.deepEqual(config.outputs.SUBJECT, {
    type: 'set', field: 'SUBJECT', key_field: 'SUBJECT', labels: null, near_miss_steps: null, value_key: 'value', confidence_key: 'confidence',
    rejected_field: null, confidence_field: null,
  });
  const noInput = { format: null, records_at: null, unwrap: null, delimiter: null, list_separator: '|', confidence_separator: '@' };
  assert.deepEqual(config.input, { predictions: noInput, key: noInput });
  assert.equal(config.wrong_when, 'any_mismatch'); // no gold field, so fall back
  assert.equal(config.thresholds, null);
  assert.equal(config.trap_field, null);
});

test('trap_field must be a field name if given', () => {
  const raw = minimal();
  raw.trap_field = '';
  assert.match(validateConfig(raw).errors[0], /trap_field must be/);
});

test('gate defaults to the lead value, not the weakest (the run-1 bug)', () => {
  const raw = minimal();
  raw.thresholds = { auto_publish: { SUBJECT: 0.85 } };
  assert.equal(validateConfig(raw).config.thresholds.gate_uses, 'lead');
});

test('label output needs its labels listed', () => {
  const raw = minimal();
  raw.outputs.verdict = { type: 'label' };
  assert.match(validateConfig(raw).errors.join('\n'), /outputs\.verdict\.labels/);
  raw.outputs.verdict.labels = ['pass', 'elevate', 'fail'];
  assert.deepEqual(validateConfig(raw).errors, []);
});

test('misspelled top-level key is an error, not silently ignored', () => {
  const raw = minimal();
  raw.wrong_whne = 'gold_route';
  assert.match(validateConfig(raw).errors[0], /unknown key "wrong_whne"/);
});

test('routing must have an auto route and only known classes', () => {
  const raw = minimal();
  raw.routing.map = { EDITOR_REVIEW: 'review', DENY: 'reject' };
  const errs = validateConfig(raw).errors.join('\n');
  assert.match(errs, /DENY is "reject"/);
  assert.match(errs, /no decision mapped to "auto"/);
});

test('gold_route requires a gold field', () => {
  const raw = minimal();
  raw.wrong_when = 'gold_route';
  assert.match(validateConfig(raw).errors[0], /routing\.gold_field is not set/);
});

test('thresholds must be 0-1 and in a sensible order', () => {
  const raw = minimal();
  raw.thresholds = { floor: 0.6, provisional_below: 0.5 };
  assert.match(validateConfig(raw).errors[0], /provisional_below \(0\.5\) is below/);
  raw.thresholds = { floor: 0.6, auto_publish: { SUBJECT: 0.55 } };
  assert.match(validateConfig(raw).errors[0], /auto_publish\.SUBJECT \(0\.55\) is below/);
  raw.thresholds = { auto_publish: { SUBJECT: 85 } };
  assert.match(validateConfig(raw).errors[0], /must be a number from 0 to 1/);
});

test('auto_publish can only gate declared outputs', () => {
  const raw = minimal();
  raw.thresholds = { auto_publish: { INDUSTRY: 0.85 } };
  assert.match(validateConfig(raw).errors[0], /INDUSTRY is not a declared output/);
});

test('misspelled threshold key is an error', () => {
  const raw = minimal();
  raw.thresholds = { flor: 0.6 };
  assert.match(validateConfig(raw).errors[0], /unknown key "thresholds\.flor"/);
});

test('fields can be dotted paths, but not with empty parts', () => {
  const raw = minimal();
  raw.id_field = 'meta.id';
  raw.outputs.SUBJECT.field = 'output.subject';
  raw.outputs.SUBJECT.key_field = 'expected.subject';
  assert.deepEqual(validateConfig(raw).errors, []);
  raw.outputs.SUBJECT.field = 'output..subject';
  assert.match(validateConfig(raw).errors[0], /outputs\.SUBJECT\.field must be a field name, or a dotted path/);
});

test('input settings are checked, including misspellings', () => {
  const raw = minimal();
  raw.input = { predictions: { unwrap: 'json', records_at: 'data.results', format: 'jsonl' } };
  assert.deepEqual(validateConfig(raw).errors, []);
  raw.input = { predictions: { unwarp: 'json' }, keys: {} };
  const errs = validateConfig(raw).errors.join('\n');
  assert.match(errs, /unknown key "input\.predictions\.unwarp"/);
  assert.match(errs, /unknown key "input\.keys"/);
  raw.input = { predictions: { format: 'xml' } };
  assert.match(validateConfig(raw).errors[0], /format must be one of: json, jsonl, csv/);
});

test('CSV separators must be valid and different from each other', () => {
  const raw = minimal();
  raw.input = { predictions: { format: 'csv', delimiter: ';', list_separator: '/', confidence_separator: '~' } };
  assert.deepEqual(validateConfig(raw).errors, []);
  raw.input = { predictions: { list_separator: '@' } };
  assert.match(validateConfig(raw).errors[0], /list_separator and confidence_separator are both "@"/);
  raw.input = { predictions: { delimiter: '|' } };
  assert.match(validateConfig(raw).errors[0], /delimiter "\|" is also used as a separator inside cells/);
  raw.input = { predictions: { delimiter: ':' } };
  assert.match(validateConfig(raw).errors[0], /delimiter must be one of/);
});

test('rejected_field is for sets, confidence_field is for labels', () => {
  const raw = minimal();
  raw.outputs.SUBJECT.rejected_field = 'SUBJECT_rejected';
  raw.outputs.verdict = { type: 'label', labels: ['pass', 'fail'], confidence_field: 'confidence' };
  assert.deepEqual(validateConfig(raw).errors, []);
  raw.outputs.SUBJECT.confidence_field = 'x';
  raw.outputs.verdict.rejected_field = 'y';
  const errs = validateConfig(raw).errors.join('\n');
  assert.match(errs, /SUBJECT\.confidence_field only applies to type "label"/);
  assert.match(errs, /verdict\.rejected_field only applies to type "set"/);
});

test('misspelled output setting is an error', () => {
  const raw = minimal();
  raw.outputs.SUBJECT.feild = 'x';
  assert.match(validateConfig(raw).errors[0], /unknown key "outputs\.SUBJECT\.feild"/);
});

test('wrong_when accepts either, gold_route and any_mismatch; the first two need a gold route', () => {
  const raw = minimal();
  raw.wrong_when = 'either';
  assert.match(validateConfig(raw).errors[0], /wrong_when is "either" but routing\.gold_field is not set/);
  raw.routing.gold_field = 'expected';
  for (const w of ['either', 'gold_route', 'any_mismatch']) { raw.wrong_when = w; assert.deepEqual(validateConfig(raw).errors, []); }
  raw.wrong_when = 'sometimes';
  assert.match(validateConfig(raw).errors[0], /wrong_when must be one of/);
});

test('severity overrides a type\'s default level; unknown types and levels are errors', () => {
  const raw = minimal();
  raw.severity = { 'SP-DUPLICATE': 'medium' };
  const { config } = validateConfig(raw);
  assert.equal(config.severity['SP-DUPLICATE'], 'medium');
  assert.equal(config.severity['SP-WRONG'], 'high');   // untouched default
  raw.severity = { 'SP-TYPO': 'low', 'SP-WRONG': 'severe' };
  const errs = validateConfig(raw).errors.join('\n');
  assert.match(errs, /SP-TYPO is not a known error type/);
  assert.match(errs, /SP-WRONG must be one of: critical, high, medium, low/);
});

test('min_per_trap needs a trap field and a whole number', () => {
  const raw = minimal();
  raw.min_per_trap = 3;
  assert.match(validateConfig(raw).errors[0], /trap_field is not/);
  raw.trap_field = 'trap';
  assert.deepEqual(validateConfig(raw).errors, []);
  raw.min_per_trap = 2.5;
  assert.match(validateConfig(raw).errors[0], /whole number/);
});

test('allowed_values: a list, or a file read relative to the config', () => {
  const raw = minimal();
  raw.allowed_values = { SUBJECT: ['A', 'B'] };
  assert.deepEqual(validateConfig(raw).config.allowed_values, { SUBJECT: ['A', 'B'] });
  raw.allowed_values = { SUBJECT: { file: 'vocab.json', field: 'code' } };
  assert.deepEqual(validateConfig(raw).config.allowed_values, { SUBJECT: { file: 'vocab.json', field: 'code' } });
  raw.allowed_values = { GEO: ['A'], SUBJECT: 'vocab.json' };
  const errs = validateConfig(raw).errors.join('\n');
  assert.match(errs, /allowed_values\.GEO is not a declared output/);
  assert.match(errs, /allowed_values\.SUBJECT must be a list/);
});

test('calibration buckets and whatif settings are checked', () => {
  const raw = minimal();
  raw.calibration = { buckets: 0.1 };
  raw.whatif = { movable_field: 'decision_branch', movable_values: [6, 7] };
  assert.deepEqual(validateConfig(raw).errors, []);
  raw.calibration = { buckets: 2 };
  raw.whatif = { movable_field: 'decision_branch' };
  const errs = validateConfig(raw).errors.join('\n');
  assert.match(errs, /calibration must be/);
  assert.match(errs, /whatif must be/);
});

test('every problem is reported at once', () => {
  const { config, errors } = validateConfig({ outputs: {}, routing: 'x', typo: 1 });
  assert.equal(config, null);
  assert.equal(errors.length, 3);
});

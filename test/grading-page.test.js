// The grading page: one self-contained file a person grades free-text fields in. Most of what the
// page does in a browser (keyboard, loading, layout) needs a browser, which this suite does not
// have (no dependencies); these tests check what can be checked from the file itself (J12), and
// run its script against a stand-in to check what it saves.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { validateGradingConfig, loadGradingConfig, readForms, readGrades } = require('../src/grading.js');
const { problems } = require('../src/problems.js');
const { renderGradingPage } = require('../src/report/grading-page.js');

const dir = path.join(__dirname, 'fixtures', 'freetext');
const CONFIG = loadGradingConfig(path.join(dir, 'grading.json'));
const FORMS = readForms({ config: CONFIG, predPath: path.join(dir, 'forms.json') });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-page-'));

const page = renderGradingPage(FORMS.forms, CONFIG, { fingerprint: FORMS.fingerprint, forms_file: 'forms.json' });

test('the page is one file that cannot reach the network', () => {
  assert.doesNotMatch(page, /<script[^>]+src=/);
  assert.doesNotMatch(page, /<link[^>]+href=/);
  assert.doesNotMatch(page, /https?:\/\//);
  assert.doesNotMatch(page, /fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/);
  assert.match(page, /<meta http-equiv="Content-Security-Policy" content="default-src 'none';/);
});

test('the page has a radio group per field, labelled, with kinds and a note', () => {
  assert.equal((page.match(/<fieldset class="field"/g) || []).length, 15);
  assert.equal((page.match(/type="radio"/g) || []).length, 45);
  assert.equal((page.match(/<textarea id="note-/g) || []).length, 15);
  assert.match(page, /<legend><span class="section">Reason for contacting · <\/span>Your reason for contacting People&#39;s Services\?<\/legend>/);
  assert.match(page, /value="2"> inferred a diagnosis, risk or eligibility<\/label>/);
  const data = JSON.parse(page.match(/<script type="application\/json" id="grading-data">([^]*?)<\/script>/)[1]);
  assert.deepEqual([data.format, data.fingerprint, data.forms], ['wfeval-grades/1', FORMS.fingerprint, ['V1', 'V2', 'V3']]);
});

test('J12: hostile input in ids, sources, field texts and the config is escaped and cannot run', () => {
  const evil = '</script><script>alert(1)</script><img src=x onerror=alert(2)>"\'&';
  const forms = [{ id: evil, source: evil + '\n<!--', fields: [{ name: 'a', text: evil }] }];
  const cfg = validateGradingConfig({ title: evil, source_field: 's', fields: { [evil]: { section: evil, label: evil } }, kinds: [evil] }).config;
  const out = renderGradingPage(forms, cfg, { fingerprint: 'sha256:' + evil, forms_file: evil });
  assert.doesNotMatch(out, /<img src=x/);
  assert.doesNotMatch(out, /<script>alert/);
  assert.doesNotMatch(out, /<!--/);
  // Only the page's own two scripts: the data block and the code.
  assert.equal((out.match(/<script/g) || []).length, 2);
  assert.match(out, /&lt;\/script&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;&lt;img src=x onerror=alert\(2\)&gt;&quot;&#39;&amp;/);
  const data = out.match(/<script type="application\/json" id="grading-data">([^]*?)<\/script>/)[1];
  assert.doesNotMatch(data, /</);
  assert.equal(JSON.parse(data).forms[0], evil);   // the data still reads back exactly
});

// The page's own script, run against a stand-in for the few parts of a page it touches. Clicks and
// layout still need a browser, but the grades file it saves feeds every free-text figure.
function openPage() {
  const part = re => page.match(re)[1];
  const fields = [...page.matchAll(/<fieldset class="field" data-form="(\d+)" data-field="(\d+)"/g)].map(([, form, field]) => ({
    dataset: { form, field }, on: {}, grade: null, box: { hidden: true }, note: { value: '' },
    kinds: CONFIG.kinds.map((_, i) => ({ value: String(i), checked: false })),
    addEventListener(type, fn) { this.on[type] = fn; }, classList: { toggle() {} },
    querySelector(sel) { return sel === '.kinds' ? this.box : sel === 'textarea' ? this.note : this.grade === null ? null : { value: this.grade }; },
    querySelectorAll() { return this.kinds.filter(k => k.checked); },
  }));
  const element = () => ({ on: {}, value: '', textContent: '', addEventListener(type, fn) { this.on[type] = fn; } });
  const byId = { 'grading-data': { textContent: part(/id="grading-data">([^]*?)<\/script>/) } };
  const windowOn = {};
  let saved = null;
  vm.runInNewContext(part(/<\/script><script>([^]*?)<\/script><\/body>/), {
    document: {
      getElementById: id => (byId[id] = byId[id] || element()), querySelectorAll: () => fields, addEventListener() {},
      createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} }, documentElement: {},
    },
    window: { addEventListener: (type, fn) => { windowOn[type] = fn; } },
    Blob: class { constructor(parts) { saved = parts.join(''); } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, setTimeout() {},
  });
  const leaving = () => { let warned = false; windowOn.beforeunload({ preventDefault() { warned = true; } }); return warned; };
  return { fields, leaving, save: () => { byId.save.on.click(); return saved; } };
}

test('the page saves kinds on an invented grade only, and warns on leaving only with something unsaved', () => {
  const { fields, leaving, save } = openPage();
  assert.equal(leaving(), false);
  fields[0].grade = 'invented';
  fields[0].kinds[1].checked = true;
  fields[0].note.value = ' a figure ';
  fields[0].on.change();
  fields[1].grade = 'faithful';
  fields[1].kinds[0].checked = true;   // ticked under another grade, then the grade changed
  fields[1].on.change();
  assert.equal(leaving(), true);
  const text = save();
  assert.equal(leaving(), false);
  const file = path.join(tmp, 'saved-grades.json');
  fs.writeFileSync(file, text);
  const out = JSON.parse(text);
  assert.deepEqual(out.grades, [
    { form: 'V1', field: FORMS.forms[0].fields[0].name, grade: 'invented', kinds: [CONFIG.kinds[1]], note: 'a figure' },
    { form: 'V1', field: FORMS.forms[0].fields[1].name, grade: 'faithful' },
  ]);
  // What it saved reads back as a grades file.
  assert.deepEqual(readGrades(file, problems('lenient')).grades.size, 2);
});

test('grade: the command writes the page', () => {
  const out = path.join(tmp, 'page.html');
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'wfeval.js'), 'grade', '--config', path.join(dir, 'grading.json'), '--pred', path.join(dir, 'forms.json'), '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(out, 'utf8'), page);
});

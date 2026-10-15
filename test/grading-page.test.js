// The grading page: one self-contained file a person grades free-text fields in. What the
// page does in a browser (keyboard, saving, loading) needs a browser, which this suite does
// not have (no dependencies); these tests check what can be checked from the file itself (J12).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateGradingConfig, loadGradingConfig, readForms } = require('../src/grading.js');
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

test('grade: the command writes the page', () => {
  const out = path.join(tmp, 'page.html');
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'wfeval.js'), 'grade', '--config', path.join(dir, 'grading.json'), '--pred', path.join(dir, 'forms.json'), '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(out, 'utf8'), page);
});

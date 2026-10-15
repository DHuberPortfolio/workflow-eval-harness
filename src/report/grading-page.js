// The grading page: one self-contained HTML file in which a person grades each free-text
// field of a workflow's output against its source, and saves the grades as a JSON file.
//
// - No network, ever: no CDN, no fonts, no fetch. A Content-Security-Policy in the page itself
//   forbids loading anything, so even a value that slipped through escaping could not call
//   out. It works opened straight from disk (file://).
// - Every value from an input file (ids, source texts, field texts, the config's names and
//   labels) is HTML-escaped where it is shown, and the data the script reads sits in a JSON
//   block in which "<" is escaped, so no value can close the script tag (trap J12).
// - The script builds every grade from form controls and never writes input values into the
//   page as HTML.
// - Keyboard: native radio groups and fields in reading order; F, I and M grade the field
//   that has focus; N jumps to the next ungraded field.
// - Saving is a browser download of the grades file. Nothing is kept in browser storage: two
//   reviewers on one computer must not see each other's grades, or their agreement means
//   nothing. "Load saved grades" resumes from a file this page saved.
// - Light and dark themes follow the system, with a button to choose; the colours and type
//   are the score report's (html.js).

const { esc, CSS } = require('./html.js');
const { GRADES_FORMAT } = require('../grading.js');

const GRADE_TEXT = {
  faithful: ['Faithful', 'supported by the source, and nothing it should hold is left out'],
  invented: ['Invented', 'says something the source does not support'],
  missing: ['Missing', 'leaves out something the source says, and invents nothing'],
};
const KEYS = { faithful: 'F', invented: 'I', missing: 'M' };

// For the JSON block: "<" escaped, so "</script>" and "<!--" inside a value are harmless.
const jsonForScript = v => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const PAGE_CSS = `
.toolbar { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; padding: 10px 0; background: var(--page); border-bottom: 1px solid var(--grid); }
.toolbar label { color: var(--ink-2); font-size: 14px; }
.toolbar .progress { font-variant-numeric: tabular-nums; color: var(--ink-2); }
.toolbar .spacer { flex: 1; }
input[type=text], textarea { font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--axis); border-radius: 8px; padding: 6px 8px; }
textarea { width: 100%; min-height: 2.6em; resize: vertical; }
button, .filebutton { font: inherit; font-size: 14px; color: var(--ink); background: var(--surface); border: 1px solid var(--axis); border-radius: 8px; padding: 6px 12px; cursor: pointer; }
button.primary { background: var(--series); border-color: var(--series); color: #fff; }
:focus-visible { outline: 2px solid var(--series); outline-offset: 2px; }
.filebutton input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.filebutton:focus-within { outline: 2px solid var(--series); outline-offset: 2px; }
.status { min-height: 1.5em; color: var(--ink-2); font-size: 14px; }
.how dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 8px 0 0; }
.how dt { font-weight: 600; }
.how dd { margin: 0; color: var(--ink-2); }
.formnav { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 14px; }
.formnav a { color: var(--series); }
.form { margin-top: 32px; }
.cols { display: grid; grid-template-columns: 1fr; gap: 16px; }
#reviewer { width: 11em; }
@media (min-width: 900px) {
  .toolbar { position: sticky; top: 0; z-index: 2; }
  .cols { grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); align-items: start; }
  .source { position: sticky; top: 72px; max-height: calc(100vh - 88px); overflow: auto; }
}
.text { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font: 14px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
.source .text { color: var(--ink); }
.empty { color: var(--muted); font-style: italic; }
fieldset.field { border: 1px solid var(--border); border-radius: 12px; background: var(--surface); padding: 14px 16px 16px; margin: 0 0 12px; min-width: 0; }
fieldset.field legend { float: left; width: 100%; font-weight: 600; padding: 0; margin: 0 0 6px; }
fieldset.field legend + * { clear: both; }
fieldset.field legend .section { color: var(--muted); font-weight: 400; }
fieldset.field.graded { border-color: var(--axis); }
.value { background: var(--page); border-radius: 8px; padding: 10px 12px; margin: 6px 0 12px; }
.choices { display: flex; flex-wrap: wrap; gap: 8px; border: 0; padding: 0; margin: 0 0 8px; }
.choice { display: inline-flex; gap: 6px; align-items: baseline; border: 1px solid var(--grid); border-radius: 8px; padding: 6px 10px; cursor: pointer; }
.choice:has(input:checked) { border-color: var(--series); }
.choice .hint { color: var(--muted); font-size: 13px; }
.choice kbd { font: 12px ui-monospace, Consolas, monospace; color: var(--muted); border: 1px solid var(--grid); border-radius: 4px; padding: 0 4px; }
.kinds { margin: 4px 0 10px; display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 14px; color: var(--ink-2); }
.kinds[hidden] { display: none; }
.note-label { display: block; font-size: 13px; color: var(--ink-2); margin-bottom: 4px; }
`;

const PAGE_JS = `
(function () {
  const data = JSON.parse(document.getElementById('grading-data').textContent);
  const fieldsets = Array.from(document.querySelectorAll('fieldset.field'));
  const progress = document.getElementById('progress');
  const status = document.getElementById('status');
  const reviewer = document.getElementById('reviewer');
  let dirty = false;

  const say = text => { status.textContent = text; };
  const gradeOf = fs => { const c = fs.querySelector('input[type=radio]:checked'); return c ? c.value : null; };

  function refresh(fs) {
    const g = gradeOf(fs);
    fs.classList.toggle('graded', g !== null);
    const kinds = fs.querySelector('.kinds');
    if (kinds) kinds.hidden = g !== 'invented';
  }
  function update() {
    const done = fieldsets.filter(fs => gradeOf(fs) !== null).length;
    progress.textContent = done + ' of ' + fieldsets.length + ' fields graded';
  }

  fieldsets.forEach(fs => {
    fs.addEventListener('change', () => { dirty = true; refresh(fs); update(); });
    fs.addEventListener('input', () => { dirty = true; });
  });

  // F, I and M grade the field that has focus; N goes to the next ungraded field. Never while typing.
  const keyGrade = { f: 'faithful', i: 'invented', m: 'missing' };
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type === 'text'))) return;
    const k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); nextUngraded(); return; }
    const fs = t && t.closest ? t.closest('fieldset.field') : null;
    if (!fs || !keyGrade[k]) return;
    const radio = fs.querySelector('input[type=radio][value="' + keyGrade[k] + '"]');
    e.preventDefault();
    radio.checked = true;
    radio.focus();
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  });

  function nextUngraded() {
    const active = document.activeElement && document.activeElement.closest ? document.activeElement.closest('fieldset.field') : null;
    const start = active ? fieldsets.indexOf(active) + 1 : 0;
    const order = fieldsets.slice(start).concat(fieldsets.slice(0, start));
    const next = order.find(fs => gradeOf(fs) === null);
    if (!next) { say('Every field is graded.'); return; }
    next.scrollIntoView({ block: 'center' });
    next.querySelector('input[type=radio]').focus();
  }
  document.getElementById('next').addEventListener('click', nextUngraded);

  function collect() {
    const grades = [];
    fieldsets.forEach(fs => {
      const g = gradeOf(fs);
      if (g === null) return;
      const form = data.forms[Number(fs.dataset.form)];
      const field = data.fields[Number(fs.dataset.field)];
      const entry = { form: form, field: field.name, grade: g };
      if (g === 'invented') {
        const kinds = Array.from(fs.querySelectorAll('.kinds input:checked')).map(c => data.kinds[Number(c.value)]);
        if (kinds.length) entry.kinds = kinds;
      }
      const note = fs.querySelector('textarea').value.trim();
      if (note) entry.note = note;
      grades.push(entry);
    });
    return {
      format: data.format, title: data.title, fingerprint: data.fingerprint, forms_file: data.forms_file,
      reviewer: reviewer.value.trim(), saved_at: new Date().toISOString(),
      fields: data.fields.map(f => ({ name: f.name, section: f.section })), kinds: data.kinds, forms: data.forms, grades: grades,
    };
  }

  document.getElementById('save').addEventListener('click', () => {
    const out = collect();
    const blob = new Blob([JSON.stringify(out, null, 2) + '\\n'], { type: 'application/json' });
    const a = document.createElement('a');
    const who = out.reviewer.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    a.href = URL.createObjectURL(blob);
    a.download = 'grades' + (who ? '-' + who : '') + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    dirty = false;
    const missing = fieldsets.length - out.grades.length;
    say('Saved ' + out.grades.length + ' grade(s) as ' + a.download + (missing ? '. ' + missing + ' field(s) are not graded yet.' : '.') +
      ' Score it with: wfeval score --grades ' + a.download);
  });

  // Resume from a grades file this page saved: same forms only (the fingerprint must match).
  document.getElementById('load').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let saved;
      try { saved = JSON.parse(reader.result); } catch (err) { say('Not loaded: ' + file.name + ' is not valid JSON.'); return; }
      if (!saved || saved.format !== data.format) { say('Not loaded: ' + file.name + ' is not a grades file.'); return; }
      if (saved.fingerprint !== data.fingerprint) { say('Not loaded: ' + file.name + ' grades different forms (or forms whose text has changed).'); return; }
      let applied = 0;
      (saved.grades || []).forEach(g => {
        const fi = data.forms.indexOf(String(g.form));
        const ki = data.fields.findIndex(f => f.name === g.field);
        const fs = fieldsets.find(x => Number(x.dataset.form) === fi && Number(x.dataset.field) === ki);
        const radio = fs && fs.querySelector('input[type=radio][value="' + (g.grade === 'faithful' || g.grade === 'invented' || g.grade === 'missing' ? g.grade : 'none') + '"]');
        if (!radio) return;
        radio.checked = true;
        fs.querySelectorAll('.kinds input').forEach(c => { c.checked = Array.isArray(g.kinds) && g.kinds.includes(data.kinds[Number(c.value)]); });
        fs.querySelector('textarea').value = typeof g.note === 'string' ? g.note : '';
        refresh(fs);
        applied++;
      });
      if (typeof saved.reviewer === 'string') reviewer.value = saved.reviewer;
      update();
      dirty = false;
      say('Loaded ' + applied + ' grade(s) from ' + file.name + '.');
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // Theme: the system's by default; the button cycles system, light, dark.
  const themeButton = document.getElementById('theme');
  const themes = ['system', 'light', 'dark'];
  themeButton.addEventListener('click', () => {
    const now = document.documentElement.getAttribute('data-theme') || 'system';
    const next = themes[(themes.indexOf(now) + 1) % themes.length];
    if (next === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', next);
    themeButton.textContent = 'Theme: ' + next;
  });

  fieldsets.forEach(refresh);
  update();
})();`;

// forms: readForms().forms; config: the grading config; meta: { fingerprint, forms_file }.
function renderGradingPage(forms, config, meta) {
  const title = config.title || 'Free-text outputs';
  const nForms = forms.length;
  const s = [];
  s.push('<h1>Grade free-text fields</h1>');
  s.push('<p class="meta">' + esc(title) + ' · ' + nForms + ' form' + (nForms === 1 ? '' : 's') + ' · ' + config.fields.length + ' field' + (config.fields.length === 1 ? '' : 's') +
    ' each · from ' + esc(meta.forms_file) + ' · <span title="' + esc(meta.fingerprint) + '">fingerprint ' + esc(meta.fingerprint.replace(/^sha256:/, '').slice(0, 12)) + '</span></p>');

  s.push('<section class="card how" aria-labelledby="how"><h2 id="how" style="margin-top:0">How to grade</h2>' +
    '<p>Read each field against ' + (config.source_field ? 'the source beside it' : 'its source (no source text was given to this page: keep your own copy open)') +
    ', and give it one grade. Judge only against the source: not what is likely, not what the form usually says. ' +
    'Grade on your own; agreement between two reviewers only means something if neither saw the other\'s grades.</p><dl>' +
    Object.entries(GRADE_TEXT).map(([, [name, hint]]) => '<dt>' + name + '</dt><dd>' + esc(hint) + '</dd>').join('') +
    '</dl><p style="margin-top:12px">A field that both invents and leaves something out is <strong>Invented</strong>: tick "also leaves something out" if it is offered, or say so in the note. ' +
    'When Invented is chosen, tick how it was invented, if any of the kinds fits.</p>' +
    '<p>Keyboard: Tab moves between fields, arrow keys between grades. <kbd>F</kbd> <kbd>I</kbd> <kbd>M</kbd> grade the field you are on; <kbd>N</kbd> goes to the next ungraded field. ' +
    'Save often: the grades are saved only as the file you download. Load it again to carry on.</p></section>');

  s.push('<div class="toolbar"><label>Reviewer <input type="text" id="reviewer" autocomplete="name" placeholder="your name"></label>' +
    '<span class="progress" id="progress" aria-live="polite"></span><span class="spacer"></span>' +
    '<button type="button" id="next">Next ungraded</button>' +
    '<label class="filebutton">Load saved grades<input type="file" id="load" accept=".json,application/json"></label>' +
    '<button type="button" id="theme">Theme: system</button>' +
    '<button type="button" class="primary" id="save">Save grades</button></div>');
  s.push('<p class="status" id="status" role="status"></p>');
  if (nForms > 1) s.push('<nav class="formnav" aria-label="Forms">' + forms.map((f, i) => '<a href="#form-' + i + '">' + esc(f.id) + '</a>').join('') + '</nav>');

  forms.forEach((f, i) => {
    const source = config.source_field
      ? '<div class="source card"><h3 style="margin-top:0">Source</h3>' + (f.source ? '<pre class="text">' + esc(f.source) + '</pre>' : '<p class="empty">No source text.</p>') + '</div>'
      : '';
    const fields = config.fields.map((def, j) => {
      const text = f.fields[j].text;
      const name = 'g-' + i + '-' + j;
      const choices = Object.entries(GRADE_TEXT).map(([value, [label, hint]]) =>
        '<label class="choice"><input type="radio" name="' + name + '" value="' + value + '"> ' + label + ' <kbd aria-hidden="true">' + KEYS[value] + '</kbd><span class="hint">' + esc(hint) + '</span></label>').join('');
      const kinds = config.kinds.length ? '<div class="kinds" hidden><span>How was it invented?</span>' + config.kinds.map((k, n) =>
        '<label><input type="checkbox" value="' + n + '"> ' + esc(k) + '</label>').join('') + '</div>' : '';
      return '<fieldset class="field" data-form="' + i + '" data-field="' + j + '"><legend>' + (def.section ? '<span class="section">' + esc(def.section) + ' · </span>' : '') + esc(def.label) + '</legend>' +
        (text === '' ? '<p class="value empty">(empty)</p>' : '<pre class="text value">' + esc(text) + '</pre>') +
        '<div class="choices">' + choices + '</div>' + kinds +
        '<label class="note-label" for="note-' + i + '-' + j + '">Note (optional): what is invented or missing</label><textarea id="note-' + i + '-' + j + '" rows="2"></textarea></fieldset>';
    }).join('');
    s.push('<section class="form" id="form-' + i + '" aria-labelledby="form-h-' + i + '"><h2 id="form-h-' + i + '">Form <code>' + esc(f.id) + '</code> <span class="muted" style="font-weight:400">' + (i + 1) + ' of ' + nForms + '</span></h2>' +
      '<div class="cols">' + source + '<div class="fields">' + fields + '</div></div></section>');
  });

  const data = {
    format: GRADES_FORMAT, title: config.title, fingerprint: meta.fingerprint, forms_file: meta.forms_file,
    forms: forms.map(f => f.id), fields: config.fields.map(f => ({ name: f.name, section: f.section })), kinds: config.kinds,
  };
  const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="' + csp + '">' +
    '<title>Grade: ' + esc(title) + '</title><style>' + CSS + PAGE_CSS + '</style></head><body><main>' + s.join('\n') + '</main>' +
    '<script type="application/json" id="grading-data">' + jsonForScript(data) + '</script><script>' + PAGE_JS + '</script></body></html>\n';
}

module.exports = { renderGradingPage, jsonForScript };

// The HTML report: self-contained, escaped, and showing the same numbers as the results.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfig } = require('../src/config.js');
const { scoreRun } = require('../src/score.js');
const { renderHtml, esc } = require('../src/report/html.js');

const dir = path.join(__dirname, 'fixtures', 'tiny');
const results = scoreRun({ config: loadConfig(path.join(dir, 'config.json')), predPath: path.join(dir, 'predictions.json'), keyPath: path.join(dir, 'key.json') });
const html = renderHtml(results, '2026-01-01T00:00:00Z');

test('the report is one file: no external scripts, styles, fonts or images', () => {
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.doesNotMatch(html, /<link[^>]+href=/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('the headline and the silent error record are in the report', () => {
  assert.match(html, /<div class="hero-value">50\.0%<\/div>/);
  assert.match(html, /1 of 2 records that went through/);
  assert.match(html, /<code>R2<\/code>/);
  assert.match(html, /SUBJ-ANTI/);
});

test('the calibration chart has one dot per bucket and a data table for the tooltip', () => {
  assert.equal((html.match(/class="dot"/g) || []).length, 9);
  assert.equal((html.match(/class="hit"/g) || []).length, 9);
  assert.match(html, /<script type="application\/json" class="chart-data">/);
});

test('values from input files are escaped: a record id cannot run as code in the report', () => {
  const evil = JSON.parse(JSON.stringify(results));
  evil.records[0].id = '<img src=x onerror=alert(1)>';
  evil.routing.silent_errors.records[0].id = '</script><script>alert(1)</script>';
  const out = renderHtml(evil, 'now');
  assert.doesNotMatch(out, /<img src=x/);
  assert.doesNotMatch(out, /<\/script><script>alert/);
  assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(esc('a"b\'c&d'), 'a&quot;b&#39;c&amp;d');
});

test('the chart data cannot close its own script tag', () => {
  const tricky = JSON.parse(JSON.stringify(results));
  tricky.calibration.overall.buckets[0].accuracy.pct = null;   // exercise the n/a path too
  const out = renderHtml(tricky, 'now');
  const data = out.match(/class="chart-data">([^]*?)<\/script>/)[1];
  assert.doesNotMatch(data, /</);
});

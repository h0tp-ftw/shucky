'use strict';

// Unified shucky test runner — runs every suite in its own process, counts the PASS/FAIL lines,
// and prints one aggregated summary. Full output is shown only for suites that fail.
//   node test/run-all.js

const { execFileSync } = require('child_process');
const path = require('path');

const SUITES = [
  'run.js',           // scanner / rule engine (fixtures)
  'run-rules.js',     // every deterministic rule in isolation + prose/fence logic
  'run-install.js',   // source parsing, SSRF, discovery, placement, lockfiles, install gate
  'run-manager.js',   // registry, remove, update, find, install --list, per-command help
  'run-archive.js',   // .tar.gz / .zip extraction guards
  'run-coverage.js'   // edge cases across modules + full CLI lifecycle integration
];

let grandPass = 0, grandFail = 0, anyFail = false;
const rows = [];

for (const suite of SUITES) {
  let out = '', code = 0;
  try {
    out = execFileSync('node', [path.join(__dirname, suite)], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
    code = e.status || 1;
  }
  const p = (out.match(/^PASS /gm) || []).length;
  const f = (out.match(/^FAIL /gm) || []).length;
  grandPass += p; grandFail += f;
  if (f || code) anyFail = true;
  rows.push({ suite: suite, pass: p, fail: f, code: code });
  if (f || code) {
    console.log('\n===== ' + suite + '  (FAILED) =====');
    process.stdout.write(out);
  }
}

console.log('\n──────────── shucky test summary ────────────');
for (const r of rows) {
  const mark = (r.fail || r.code) ? '✗' : '✓';
  let line = '  ' + mark + '  ' + r.suite.replace(/\.js$/, '').padEnd(14) + String(r.pass).padStart(3) + ' passed';
  if (r.fail) line += '  ·  ' + r.fail + ' FAILED';
  if (r.code && !r.fail) line += '  ·  exited ' + r.code;
  console.log(line);
}
console.log('  ' + '─'.repeat(42));
console.log('  ' + (anyFail ? '✗ FAIL' : '✓ PASS') + '   ' + grandPass + ' checks across ' + rows.length + ' suites' + (grandFail ? '  ·  ' + grandFail + ' FAILED' : ''));

process.exit(anyFail ? 1 : 0);

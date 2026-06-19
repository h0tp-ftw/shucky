'use strict';

// Shared zero-dependency test helpers for the shucky suites.
// Each check prints "PASS  <name>" / "FAIL  <name>" (run-all.js counts these across all suites).

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

let passed = 0, failed = 0;

function check(name, cond) {
  if (cond) { passed++; console.log('PASS  ' + name); }
  else { failed++; console.log('FAIL  ' + name); }
  return !!cond;
}
function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  return check(ok ? name : name + '  (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')', ok);
}
function throws(name, fn) { let t = false; try { fn(); } catch (e) { t = true; } return check(name, t); }
async function throwsAsync(name, fn) { let t = false; try { await fn(); } catch (e) { t = true; } return check(name, t); }

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'shucky-t-')); }
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
function B(s) { return Buffer.from(s); }

// Run fn with console silenced (returns fn's value; async-aware).
async function quiet(fn) {
  const l = console.log, e = console.error;
  console.log = function () {}; console.error = function () {};
  try { return await fn(); } finally { console.log = l; console.error = e; }
}
// Run fn capturing console.log into a string (console.error silenced); returns the captured text.
async function capture(fn) {
  const l = console.log, e = console.error;
  let out = '';
  console.log = function () { out += Array.prototype.join.call(arguments, ' ') + '\n'; };
  console.error = function () {};
  try { await fn(); } finally { console.log = l; console.error = e; }
  return out;
}
// Run fn with process.cwd() temporarily set to dir.
async function withCwd(dir, fn) {
  const prev = process.cwd();
  try { process.chdir(dir); return await fn(); } finally { try { process.chdir(prev); } catch (e) { /* gone */ } }
}

function finish(label) {
  const total = passed + failed;
  console.log('\n' + (failed === 0 ? 'ALL ' + label + ' PASSED (' + total + ')' : (failed + ' ' + label + ' FAILED')));
  process.exit(failed ? 1 : 0);
}

// ---- archive fixture builders (no system tar/zip) ----
function makeTar(entries) {
  const blocks = [];
  for (const e of entries) {
    const h = Buffer.alloc(512);
    h.write(e.name, 0, 'utf8');
    const size = e.data ? e.data.length : 0;
    h.write(size.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
    h.write(String(e.type || '0'), 156, 'ascii');
    h.write('ustar\0', 257, 'ascii'); h.write('00', 263, 'ascii');
    blocks.push(h);
    if (size) { const padded = Buffer.alloc(Math.ceil(size / 512) * 512); e.data.copy(padded); blocks.push(padded); }
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
function makeTarGz(entries) { return zlib.gzipSync(makeTar(entries)); }
function makeZip(entries) {
  const locals = [], centrals = []; let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'); const data = e.data;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(Buffer.concat([lh, name, data]));
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE((e.mode || 0) >>> 0, 38); ch.writeUInt32LE(off, 42);
    centrals.push(Buffer.concat([ch, name]));
    off += locals[locals.length - 1].length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

module.exports = {
  check, eq, throws, throwsAsync, tmp, rmrf, B, quiet, capture, withCwd, finish,
  makeTar, makeTarGz, makeZip
};

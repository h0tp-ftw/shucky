'use strict';

// Zero-dependency tests for archive sources: node test/run-archive.js
// Builds .tar.gz and .zip in-process (no system tar/zip), then asserts the extractor's guards.

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const archive = require('../lib/archive');
const { discoverSkills } = require('../lib/discover');
const cli = require('../lib/cli');
const lock = require('../lib/lock');

let failures = 0;
function check(name, cond) { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) failures++; }
function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
function B(s) { return Buffer.from(s); }

// Minimal ustar tar (reader ignores checksum). entry: { name, data?, type? '0'|'5'|'2' }
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
  blocks.push(Buffer.alloc(1024)); // two zero blocks = end
  return Buffer.concat(blocks);
}
function makeTarGz(entries) { return zlib.gzipSync(makeTar(entries)); }

// Minimal STORED zip (method 0). entry: { name, data, mode? (external attrs) }
function makeZip(entries) {
  const locals = [], centrals = []; let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'); const data = e.data;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const local = Buffer.concat([lh, name, data]);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE((e.mode || 0) >>> 0, 38); ch.writeUInt32LE(off, 42);
    centrals.push(Buffer.concat([ch, name]));
    locals.push(local); off += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
const SYMLINK_MODE = (0xA000 | 0x1FF) << 16;
const SKILL = B('---\nname: arch-skill\ndescription: from an archive\n---\nbody\n');

// ---- tar.gz ---------------------------------------------------------------
(function () {
  let d = tmp('shucky-tar-');
  const r = archive.extractArchive(makeTarGz([{ name: 'SKILL.md', data: SKILL }, { name: 'sub/x.txt', data: B('hi') }]), d);
  check('tar.gz extracts files', r.format === 'tar.gz' && fs.existsSync(path.join(d, 'SKILL.md')) && fs.existsSync(path.join(d, 'sub/x.txt')));
  rmrf(d);

  d = tmp('shucky-tar-');
  archive.extractArchive(makeTarGz([{ name: 'SKILL.md', data: SKILL }, { name: 'leak', data: B('/etc/passwd'), type: '2' }]), d);
  check('tar.gz drops symlink entry', fs.existsSync(path.join(d, 'SKILL.md')) && !fs.existsSync(path.join(d, 'leak')));
  rmrf(d);

  d = tmp('shucky-tar-');
  archive.extractArchive(makeTarGz([{ name: 'SKILL.md', data: SKILL }, { name: '../escape.txt', data: B('SLIP') }]), d);
  check('tar.gz blocks tar-slip (../)', !fs.existsSync(path.join(path.dirname(d), 'escape.txt')) && fs.existsSync(path.join(d, 'SKILL.md')));
  rmrf(d);
})();

// ---- zip ------------------------------------------------------------------
(function () {
  let d = tmp('shucky-zip-');
  const r = archive.extractArchive(makeZip([{ name: 'SKILL.md', data: SKILL }, { name: 'sub/x.txt', data: B('hi') }]), d);
  check('zip extracts files', r.format === 'zip' && fs.existsSync(path.join(d, 'SKILL.md')) && fs.existsSync(path.join(d, 'sub/x.txt')));
  rmrf(d);

  d = tmp('shucky-zip-');
  archive.extractArchive(makeZip([
    { name: 'SKILL.md', data: SKILL },
    { name: '../escape.txt', data: B('SLIP') },
    { name: 'badlink', data: B('/etc/passwd'), mode: SYMLINK_MODE }
  ]), d);
  check('zip blocks zip-slip + drops symlink', fs.existsSync(path.join(d, 'SKILL.md')) && !fs.existsSync(path.join(path.dirname(d), 'escape.txt')) && !fs.existsSync(path.join(d, 'badlink')));
  rmrf(d);
})();

// ---- caps + format errors -------------------------------------------------
(function () {
  let threw = false;
  try { archive.extractArchive(makeTarGz([{ name: 'a', data: B('1') }, { name: 'b', data: B('2') }]), tmp('shucky-cap-'), { limits: { maxEntries: 1 } }); }
  catch (e) { threw = true; }
  check('archive entry-count cap trips', threw);

  threw = false;
  try { archive.extractArchive(makeTarGz([{ name: 'big', data: Buffer.alloc(2048) }]), tmp('shucky-cap-'), { limits: { maxEntrySize: 1024 } }); }
  catch (e) { threw = true; }
  check('archive per-entry size cap trips', threw);

  threw = false;
  try { archive.extractArchive(B('not an archive at all'), tmp('shucky-cap-')); }
  catch (e) { threw = true; }
  check('unrecognized format throws', threw);
})();

// ---- discover + install integration --------------------------------------
(function () {
  const d = tmp('shucky-disc-');
  archive.extractArchive(makeTarGz([{ name: 'SKILL.md', data: SKILL }]), d);
  const skills = discoverSkills(d);
  check('discover finds skill in extracted archive', skills.length === 1 && skills[0].name === 'arch-skill');
  rmrf(d);
})();

async function installFromArchive() {
  const origLog = console.log, origErr = console.error;
  const proj = tmp('shucky-ai-');
  const tarPath = path.join(proj, 'skill.tar.gz');
  fs.writeFileSync(tarPath, makeTarGz([{ name: 'SKILL.md', data: SKILL }]));
  const prev = process.cwd();
  console.log = function () {}; console.error = function () {};
  let code;
  try { process.chdir(proj); code = await cli.cmdInstall(cli.parseArgs(['install', tarPath, '--agent', 'universal'])); }
  finally { console.log = origLog; console.error = origErr; try { process.chdir(prev); } catch (e) {} }
  check('install from .tar.gz passes the gate + installs', code === 0 && !!lock.getSkill('project', 'arch-skill', proj) && fs.existsSync(path.join(proj, '.agents/skills/arch-skill/SKILL.md')));
  rmrf(proj);
}

installFromArchive().then(function () {
  console.log('\n' + (failures === 0 ? 'ALL ARCHIVE TESTS PASSED' : (failures + ' ARCHIVE TEST(S) FAILED')));
  process.exit(failures ? 1 : 0);
}).catch(function (e) { console.error('test harness error: ' + (e && e.stack || e)); process.exit(1); });

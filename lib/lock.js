'use strict';

// shucky install lockfiles — what got installed, from where, at which commit, and what the
// scan said about it. Two files (mirrors vercel-labs/skills' split, MIT-inspired):
//   global   ~/.shucky/installed-skills.json   (timestamps; for `list`/`update`)
//   project  ./shucky-skills.json              (committed, sorted, timestamp-free → clean diffs)
//
// Recording the verdict + commit SHA is what lets a future `update` re-fetch, RE-SCAN, and warn
// if a once-clean skill now blocks.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function globalDir() {
  const st = process.env.XDG_STATE_HOME;
  if (st && path.isAbsolute(st)) return path.join(st, 'shucky');
  return path.join(os.homedir(), '.shucky');
}

function getLockPath(scope, cwd) {
  if (scope === 'global') return path.join(globalDir(), 'installed-skills.json');
  return path.join(cwd || process.cwd(), 'shucky-skills.json');
}

function readLock(scope, cwd) {
  try {
    const raw = JSON.parse(fs.readFileSync(getLockPath(scope, cwd), 'utf8'));
    if (raw && raw.skills && typeof raw.skills === 'object') return { version: raw.version || 1, skills: raw.skills };
  } catch (e) { /* missing/invalid → fresh */ }
  return { version: 1, skills: {} };
}

function writeLock(scope, cwd, data) {
  const p = getLockPath(scope, cwd);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const names = Object.keys(data.skills);
  if (scope !== 'global') names.sort(); // deterministic order for committed project lock
  const out = { version: 1, skills: {} };
  for (const n of names) out.skills[n] = data.skills[n];
  fs.writeFileSync(p, JSON.stringify(out, null, 2) + '\n');
  return p;
}

// entry: { source, sourceType, sourceUrl, ref, skillPath, hash, verdict, rawVerdict,
//          overriddenByApproval, agents }
function addSkill(scope, name, entry, cwd) {
  const data = readLock(scope, cwd);
  const e = Object.assign({}, entry);
  if (scope === 'global') {
    const now = new Date().toISOString();
    const prior = data.skills[name];
    e.installedAt = (prior && prior.installedAt) || now;
    e.updatedAt = now;
    if (!e.scannedAt) e.scannedAt = now;
  } else {
    delete e.installedAt; delete e.updatedAt; delete e.scannedAt; // committed lock stays timestamp-free
  }
  data.skills[name] = e;
  return writeLock(scope, cwd, data);
}

function removeSkill(scope, name, cwd) {
  const data = readLock(scope, cwd);
  if (!data.skills[name]) return false;
  delete data.skills[name];
  writeLock(scope, cwd, data);
  return true;
}

function getSkill(scope, name, cwd) {
  return readLock(scope, cwd).skills[name] || null;
}

function listSkills(scope, cwd) {
  const skills = readLock(scope, cwd).skills;
  return Object.keys(skills).sort().map(function (name) {
    return Object.assign({ name: name }, skills[name]);
  });
}

// Stable sha256 over a folder's relative paths + contents (skips .git/node_modules + symlinks).
// On-disk hash → zero-network, provider-agnostic; used to detect silent content drift.
function computeFolderHash(dir) {
  const files = [];
  (function walk(d, rel) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const full = path.join(d, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      let st;
      try { st = fs.lstatSync(full); } catch (er) { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(full, r);
      else if (st.isFile()) files.push([r, full]);
    }
  })(dir, '');
  files.sort(function (a, b) { return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0); });
  const h = crypto.createHash('sha256');
  for (const pair of files) {
    h.update(pair[0]); h.update('\0');
    try { h.update(fs.readFileSync(pair[1])); } catch (e) { /* ignore */ }
    h.update('\0');
  }
  return 'sha256:' + h.digest('hex');
}

module.exports = {
  getLockPath: getLockPath,
  readLock: readLock,
  addSkill: addSkill,
  removeSkill: removeSkill,
  getSkill: getSkill,
  listSkills: listSkills,
  computeFolderHash: computeFolderHash
};

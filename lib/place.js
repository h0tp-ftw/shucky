'use strict';

// shucky placement — install a VETTED skill directory into the user's agent environments.
// Ported from vercel-labs/skills `src/installer.ts` (MIT). See NOTICE.
//
// One security divergence from upstream: copyTree() DROPS symlinks instead of dereferencing
// them. scanTarget() skips symlinks when it scans, so dereferencing on copy would smuggle
// UNSCANNED content (the link target) into the install — a scan bypass. We refuse to copy any
// symlink out of the fetched tree.
//
// placeSkill(skillDir, name, agentList, { scope, copy, cwd, forceCreate })
//   -> { name, scope, mode, canonicalPath, results: [{ agent, success, path, mode, skipped?, symlinkFailed?, universal?, error? }] }

const fs = require('fs');
const path = require('path');
const { agents, isUniversalAgent, getCanonicalSkillsDir, getAgentBaseDir } = require('./agents');

const EXCLUDE_FILES = new Set(['metadata.json']);
const EXCLUDE_DIRS = new Set(['.git', '__pycache__', '__pypackages__', 'node_modules']);

// kebab-case, path-traversal-safe install name.
function sanitizeName(name) {
  const s = String(name).toLowerCase().replace(/[^a-z0-9._]+/g, '-').replace(/^[.\-]+|[.\-]+$/g, '');
  return s.substring(0, 255) || 'unnamed-skill';
}

function isPathSafe(base, target) {
  const nb = path.normalize(path.resolve(base));
  const nt = path.normalize(path.resolve(target));
  return nt === nb || nt.indexOf(nb + path.sep) === 0;
}
function pathsOverlap(a, b) { return isPathSafe(a, b) || isPathSafe(b, a); }

function cleanAndCreateDirectory(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* mkdir will surface real errors */ }
  fs.mkdirSync(p, { recursive: true });
}

function resolveSymlinkTarget(linkPath, linkTarget) {
  return path.resolve(path.dirname(linkPath), linkTarget);
}

// Resolve a path's PARENT through symlinks, keeping the final component. Handles e.g.
// ~/.claude/skills being a symlink to ~/.agents/skills, so we don't compute broken links.
function resolveParentSymlinks(p) {
  const resolved = path.resolve(p);
  const dir = path.dirname(resolved);
  const base = path.basename(resolved);
  try { return path.join(fs.realpathSync(dir), base); } catch (e) { return resolved; }
}

// Copy a tree, DROPPING symlinks and excluded files/dirs. Returns count of skipped symlinks.
function copyTree(src, dest, skipped) {
  skipped = skipped || { links: 0 };
  fs.mkdirSync(dest, { recursive: true });
  let entries;
  try { entries = fs.readdirSync(src, { withFileTypes: true }); } catch (e) { return skipped; }
  for (const entry of entries) {
    const name = entry.name;
    const srcPath = path.join(src, name);
    const destPath = path.join(dest, name);
    let st;
    try { st = fs.lstatSync(srcPath); } catch (e) { continue; }
    if (st.isSymbolicLink()) { skipped.links++; continue; } // SECURITY: never copy symlinks out
    if (st.isDirectory()) {
      if (EXCLUDE_DIRS.has(name)) continue;
      copyTree(srcPath, destPath, skipped);
    } else if (st.isFile()) {
      if (EXCLUDE_FILES.has(name)) continue;
      fs.copyFileSync(srcPath, destPath);
    }
    // ignore fifo/socket/device entries
  }
  return skipped;
}

// Create a symlink (junction on win32), reconciling existing links/dirs. Returns true on success.
function createSymlink(target, linkPath) {
  try {
    const resolvedTarget = path.resolve(target);
    const resolvedLink = path.resolve(linkPath);

    let realTarget, realLink;
    try { realTarget = fs.realpathSync(resolvedTarget); } catch (e) { realTarget = resolvedTarget; }
    try { realLink = fs.realpathSync(resolvedLink); } catch (e) { realLink = resolvedLink; }
    if (realTarget === realLink) return true;
    if (resolveParentSymlinks(target) === resolveParentSymlinks(linkPath)) return true;

    try {
      const st = fs.lstatSync(linkPath);
      if (st.isSymbolicLink()) {
        const existing = fs.readlinkSync(linkPath);
        if (resolveSymlinkTarget(linkPath, existing) === resolvedTarget) return true;
        fs.rmSync(linkPath, { force: true });
      } else {
        fs.rmSync(linkPath, { recursive: true, force: true });
      }
    } catch (err) {
      if (err && err.code === 'ELOOP') { try { fs.rmSync(linkPath, { force: true }); } catch (e) { /* fall through */ } }
      // ENOENT etc. → proceed to create
    }

    const linkDir = path.dirname(linkPath);
    fs.mkdirSync(linkDir, { recursive: true });
    const realLinkDir = resolveParentSymlinks(linkDir);
    const isWin = process.platform === 'win32';
    const symlinkType = isWin ? 'junction' : undefined;
    const symlinkTarget = isWin ? resolvedTarget : path.relative(realLinkDir, target);
    fs.symlinkSync(symlinkTarget, linkPath, symlinkType);
    return true;
  } catch (e) { return false; }
}

// ---- per-agent placement --------------------------------------------------

function guardAgent(agentType, isGlobal) {
  const agent = agents[agentType];
  if (!agent) return { agent: agentType, success: false, error: 'unknown agent: ' + agentType };
  if (isGlobal && agent.globalSkillsDir === undefined) {
    return { agent: agentType, success: false, error: agent.displayName + ' does not support global install' };
  }
  return null;
}

function placeCopy(skillDir, skillName, agentType, isGlobal, cwd) {
  const bad = guardAgent(agentType, isGlobal);
  if (bad) return bad;
  const agentBase = getAgentBaseDir(agentType, isGlobal ? 'global' : 'project', cwd);
  const agentDir = path.join(agentBase, skillName);
  if (!isPathSafe(agentBase, agentDir)) return { agent: agentType, success: false, error: 'path traversal in skill name' };
  if (pathsOverlap(skillDir, agentDir)) return { agent: agentType, success: true, path: agentDir, mode: 'copy', skipped: true };
  cleanAndCreateDirectory(agentDir);
  copyTree(skillDir, agentDir);
  return { agent: agentType, success: true, path: agentDir, mode: 'copy' };
}

function placeSymlink(skillDir, skillName, agentType, isGlobal, cwd, canonicalDir, forceCreate) {
  const bad = guardAgent(agentType, isGlobal);
  if (bad) return bad;
  const scope = isGlobal ? 'global' : 'project';

  // Universal agents read straight from the canonical dir — already written, no symlink needed.
  if (isUniversalAgent(agentType)) {
    return { agent: agentType, success: true, path: canonicalDir, mode: 'symlink', universal: true };
  }

  const agentBase = getAgentBaseDir(agentType, scope, cwd);
  const agentDir = path.join(agentBase, skillName);
  if (!isPathSafe(agentBase, agentDir)) return { agent: agentType, success: false, error: 'path traversal in skill name' };

  // Project installs: don't materialise an agent dir (e.g. .windsurf/) for an agent that isn't
  // used here — unless the user explicitly asked for it. The skill is already in .agents/skills.
  if (!isGlobal && !forceCreate) {
    const agentRootDir = path.join(cwd, agents[agentType].skillsDir.split('/')[0]);
    if (!fs.existsSync(agentRootDir)) {
      return { agent: agentType, success: true, path: canonicalDir, mode: 'symlink', skipped: true };
    }
  }

  if (pathsOverlap(skillDir, agentDir)) return { agent: agentType, success: true, path: agentDir, mode: 'symlink', skipped: true };

  if (createSymlink(canonicalDir, agentDir)) {
    return { agent: agentType, success: true, path: agentDir, mode: 'symlink' };
  }
  // Symlink unsupported (e.g. Windows w/o privilege) → copy fallback.
  cleanAndCreateDirectory(agentDir);
  copyTree(skillDir, agentDir);
  return { agent: agentType, success: true, path: agentDir, mode: 'symlink', symlinkFailed: true };
}

// ---- public --------------------------------------------------------------

function placeSkill(skillDir, name, agentList, opts) {
  opts = opts || {};
  const scope = opts.scope === 'global' ? 'global' : 'project';
  const isGlobal = scope === 'global';
  const copy = !!opts.copy;
  const cwd = opts.cwd || process.cwd();
  const forceCreate = !!opts.forceCreate;
  const skillName = sanitizeName(name);
  agentList = agentList || [];
  const results = [];

  if (copy) {
    for (const agentType of agentList) results.push(placeCopy(skillDir, skillName, agentType, isGlobal, cwd));
    return { name: skillName, scope: scope, mode: 'copy', canonicalPath: null, results: results };
  }

  const canonicalBase = getCanonicalSkillsDir(scope, cwd);
  const canonicalDir = path.join(canonicalBase, skillName);
  if (!isPathSafe(canonicalBase, canonicalDir)) throw new Error('invalid skill name (path traversal): ' + name);

  // Write the canonical copy ONCE (unless the source already is the canonical dir).
  if (!pathsOverlap(skillDir, canonicalDir)) {
    cleanAndCreateDirectory(canonicalDir);
    copyTree(skillDir, canonicalDir);
  }
  for (const agentType of agentList) {
    results.push(placeSymlink(skillDir, skillName, agentType, isGlobal, cwd, canonicalDir, forceCreate));
  }
  return { name: skillName, scope: scope, mode: 'symlink', canonicalPath: canonicalDir, results: results };
}

module.exports = {
  placeSkill,
  sanitizeName,
  isPathSafe,
  pathsOverlap,
  copyTree,
  createSymlink,
  cleanAndCreateDirectory
};

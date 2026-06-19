'use strict';

// shucky skill discovery — find the SKILL.md packages inside a fetched directory.
// Plugin-manifest handling ported from vercel-labs/skills `src/plugin-manifest.ts` (MIT). See NOTICE.
//
// discoverSkills(rootDir, { subpath?, skillFilter? }) -> [{ name, dir, skillMdPath, description, frontmatterName }]
//
// Frontmatter is read with a STRING-ONLY line reader (no `yaml` dep, no anchors/aliases) so a
// hostile SKILL.md can't trigger a YAML-bomb or type-coercion during discovery. The full file is
// still handed to scanTarget(). Symlinks are never traversed out of the tree.

const fs = require('fs');
const path = require('path');

const MAX_DEPTH = 8;

// Strip ANSI/OSC/control sequences (CWE-150) from any string we might echo to a terminal.
function stripControl(s) {
  return String(s)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC
    .replace(/\x1b[@-_][0-?]*[ -/]*[@-~]/g, '')        // CSI / other ESC
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');         // raw control chars
}

// Filesystem-safe install name derived from a (possibly hostile) frontmatter name or dir basename.
function safeName(raw) {
  let s = stripControl(raw).trim();
  s = s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '').replace(/-+/g, '-').replace(/[.-]+$/, '');
  return s.slice(0, 100);
}

// Minimal, injection-safe frontmatter reader: only name/description/license out of the leading --- block.
function parseFrontmatter(text) {
  const out = {};
  const m = String(text).match(/^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    if (key !== 'name' && key !== 'description' && key !== 'license') continue;
    let val = kv[2].trim();
    if (val.length >= 2 && ((val[0] === '"' && val[val.length - 1] === '"') || (val[0] === "'" && val[val.length - 1] === "'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function isSubpathSafe(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

function walkForSkills(root, out, depth) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch (e) { return; }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === '.github') continue;
    const full = path.join(root, e.name);
    let st;
    try { st = fs.lstatSync(full); } catch (er) { continue; }
    if (st.isSymbolicLink()) continue; // never follow symlinks out of the fetched tree
    if (st.isDirectory()) walkForSkills(full, out, depth + 1);
    else if (st.isFile() && /^skill\.md$/i.test(e.name)) out.push(full);
  }
}

// Extra skill directories declared by Claude-Code plugin manifests (validated within rootDir).
function getPluginSkillPaths(rootDir) {
  const dirs = [];
  const add = function (rel) {
    if (typeof rel !== 'string' || rel.indexOf('./') !== 0) return; // must be repo-relative
    const abs = path.resolve(rootDir, rel);
    if (isSubpathSafe(rootDir, abs)) dirs.push(abs);
  };
  const readJson = function (p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
  };
  const plugin = readJson(path.join(rootDir, '.claude-plugin', 'plugin.json'));
  if (plugin && Array.isArray(plugin.skills)) plugin.skills.forEach(add);
  const market = readJson(path.join(rootDir, '.claude-plugin', 'marketplace.json'));
  if (market && Array.isArray(market.plugins)) {
    for (const pl of market.plugins) {
      if (pl && Array.isArray(pl.skills)) pl.skills.forEach(add);
    }
  }
  return dirs;
}

function discoverSkills(rootDir, opts) {
  opts = opts || {};
  let base = rootDir;
  if (opts.subpath) {
    const target = path.resolve(rootDir, opts.subpath);
    if (!isSubpathSafe(rootDir, target)) throw new Error('subpath escapes source: ' + opts.subpath);
    base = target;
  }

  const mdPaths = [];
  walkForSkills(base, mdPaths, 0);
  for (const pd of getPluginSkillPaths(rootDir)) {
    if (fs.existsSync(pd)) walkForSkills(pd, mdPaths, 0);
  }

  // Shallowest first → deterministic dedupe by install name.
  mdPaths.sort(function (a, b) { return a.split(path.sep).length - b.split(path.sep).length || a.localeCompare(b); });

  const byName = new Map();
  for (const mdPath of mdPaths) {
    const dir = path.dirname(mdPath);
    let text = '';
    try { text = fs.readFileSync(mdPath, 'utf8'); } catch (e) { continue; }
    const fm = parseFrontmatter(text);
    const name = safeName(fm.name || path.basename(dir));
    if (!name) continue;
    if (!byName.has(name)) {
      byName.set(name, {
        name: name,
        dir: dir,
        skillMdPath: mdPath,
        description: stripControl(fm.description || '').slice(0, 300),
        frontmatterName: fm.name || null
      });
    }
  }

  let skills = Array.from(byName.values());
  if (opts.skillFilter) {
    const f = String(opts.skillFilter).toLowerCase();
    skills = skills.filter(function (s) {
      return s.name.toLowerCase() === f ||
        path.basename(s.dir).toLowerCase() === f ||
        (s.frontmatterName || '').toLowerCase() === f;
    });
  }
  return skills;
}

module.exports = { discoverSkills, parseFrontmatter, safeName, stripControl, isSubpathSafe };

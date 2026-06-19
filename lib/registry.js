'use strict';

// shucky sources registry — the repos / registries / curated lists a user trusts and searches.
// Register a source once, then `find` across them and `install --list <name>` a curated bundle.
// Two files: global ~/.shucky/sources.json + project ./shucky-sources.json (committed).
//
//   source entry = { name, type: 'repo' | 'registry' | 'list', spec, trust? }
//     repo      a git source you install/find within (spec: owner/repo or URL)
//     registry  a search endpoint (well-known host or skills.sh-style) — for `find`
//     list      a manifest enumerating skills, installable as a set (spec: URL or local .json)
//   trust: 'trusted' feeds config.trustedSources (low/medium relax; high/critical still blocks)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { safeGet } = require('./fetch');
const { parseSource, getOwnerRepo } = require('./sources');

function globalDir() {
  const cfg = process.env.XDG_CONFIG_HOME;
  if (cfg && path.isAbsolute(cfg)) return path.join(cfg, 'shucky');
  return path.join(os.homedir(), '.shucky');
}
function sourcesPath(scope, cwd) {
  return scope === 'global' ? path.join(globalDir(), 'sources.json') : path.join(cwd || process.cwd(), 'shucky-sources.json');
}

function read(scope, cwd) {
  try {
    const r = JSON.parse(fs.readFileSync(sourcesPath(scope, cwd), 'utf8'));
    if (Array.isArray(r.sources)) return { version: r.version || 1, sources: r.sources };
  } catch (e) { /* fresh */ }
  return { version: 1, sources: [] };
}

function write(scope, cwd, data) {
  const p = sourcesPath(scope, cwd);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const sources = data.sources.slice().sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
  fs.writeFileSync(p, JSON.stringify({ version: 1, sources: sources }, null, 2) + '\n');
  return p;
}

function inferType(spec) {
  if (/\.json(\?.*)?$/i.test(spec)) return 'list'; // a .json manifest (local or remote) is a list
  const parsed = parseSource(spec);
  if (parsed.type === 'well-known') return 'registry';
  return 'repo';
}

function deriveName(spec) {
  const parsed = parseSource(spec);
  const or = getOwnerRepo(parsed);
  if (or) return or.replace(/\//g, '-');
  try { return new URL(spec).hostname; } catch (e) { /* fall through */ }
  return String(spec).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'source';
}

function addSource(scope, spec, opts, cwd) {
  opts = opts || {};
  const data = read(scope, cwd);
  const type = opts.type || inferType(spec);
  const name = opts.name || deriveName(spec);
  data.sources = data.sources.filter(function (s) { return s.name !== name; });
  const entry = { name: name, type: type, spec: spec };
  if (opts.trust) entry.trust = opts.trust;
  data.sources.push(entry);
  return { path: write(scope, cwd, data), entry: entry };
}

function removeSource(scope, name, cwd) {
  const data = read(scope, cwd);
  const before = data.sources.length;
  data.sources = data.sources.filter(function (s) { return s.name !== name; });
  if (data.sources.length === before) return false;
  write(scope, cwd, data);
  return true;
}

function listSources(cwd) {
  const out = [];
  for (const scope of ['project', 'global']) {
    for (const s of read(scope, cwd).sources) out.push(Object.assign({ scope: scope }, s));
  }
  return out;
}

function getSource(name, cwd) {
  return listSources(cwd).find(function (s) { return s.name === name; }) || null;
}

// Resolve a `list` source (by registered name OR a direct manifest spec) → install source strings.
// Manifest may be `["owner/repo@skill", …]` or `{ "skills": [{ "source": "...", "skill": "..." }] }`.
async function resolveList(nameOrSpec, cwd) {
  let spec = nameOrSpec;
  const registered = getSource(nameOrSpec, cwd);
  if (registered) {
    if (registered.type !== 'list') throw new Error('source "' + nameOrSpec + '" is type ' + registered.type + ', not a list');
    spec = registered.spec;
  }
  let text;
  if (/^https?:\/\//.test(spec)) {
    const buf = await safeGet(spec, { accept: 'application/json' });
    text = buf.toString('utf8');
  } else {
    text = fs.readFileSync(path.resolve(cwd || process.cwd(), spec), 'utf8');
  }
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('list manifest is not valid JSON: ' + spec); }
  const arr = Array.isArray(data) ? data : (Array.isArray(data.skills) ? data.skills : []);
  return arr.map(function (item) {
    if (typeof item === 'string') return item;
    if (item && item.source) return item.source + (item.skill ? '@' + item.skill : '');
    return null;
  }).filter(Boolean);
}

// Owner/host prefixes for sources the user marked `trusted` → merged into config.trustedSources.
function trustedOwners(cwd) {
  const out = [];
  for (const s of listSources(cwd)) {
    if (s.trust !== 'trusted') continue;
    const or = getOwnerRepo(parseSource(s.spec));
    if (or) out.push(or.split('/')[0]);
    else { try { out.push(new URL(s.spec).hostname); } catch (e) { /* skip */ } }
  }
  return out;
}

module.exports = {
  sourcesPath: sourcesPath,
  read: read,
  addSource: addSource,
  removeSource: removeSource,
  listSources: listSources,
  getSource: getSource,
  resolveList: resolveList,
  trustedOwners: trustedOwners,
  inferType: inferType,
  deriveName: deriveName
};

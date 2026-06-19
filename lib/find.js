'use strict';

// shucky find — discover skills across the public registry (skills.sh) and the user's registered
// sources/lists, every hit annotated with source-trust. Selecting one just hands off to
// `shucky install <source>` — which re-fetches and SCANS before anything lands. find never installs.

const { safeGet } = require('./fetch');
const { loadConfig } = require('./config');
const registry = require('./registry');

const SKILLS_SH_SEARCH = 'https://skills.sh/api/search?q=';

async function searchSkillsSh(query, opts) {
  try {
    const buf = await safeGet(SKILLS_SH_SEARCH + encodeURIComponent(query || ''), { accept: 'application/json', timeout: (opts && opts.timeout) || 12000 });
    const data = JSON.parse(buf.toString('utf8'));
    const skills = Array.isArray(data.skills) ? data.skills : [];
    return skills.map(function (s) {
      const source = s.source || (s.id ? String(s.id).split('/').slice(0, 2).join('/') : null);
      const skill = s.skillId || s.name;
      return {
        name: s.name || skill, source: source, skill: skill, installs: s.installs || 0,
        registry: 'skills.sh', install: source ? source + (skill && skill !== source ? '@' + skill : '') : (s.id || '')
      };
    }).filter(function (r) { return r.install; });
  } catch (e) { return { error: 'skills.sh: ' + e.message }; }
}

async function searchListSource(src, query, opts) {
  try {
    const members = await registry.resolveList(src.spec, opts && opts.cwd);
    const q = (query || '').toLowerCase();
    return members.filter(function (m) { return !q || m.toLowerCase().indexOf(q) !== -1; }).map(function (m) {
      const parts = m.split('@');
      return { name: m, source: parts[0], skill: parts[1] || null, installs: 0, registry: src.name, install: m, trust: src.trust };
    });
  } catch (e) { return { error: 'list ' + src.name + ': ' + e.message }; }
}

async function searchWellKnown(src, query, opts) {
  try {
    const origin = new URL(src.spec).origin;
    const buf = await safeGet(origin + '/.well-known/agent-skills/index.json', { accept: 'application/json', timeout: (opts && opts.timeout) || 12000 });
    const data = JSON.parse(buf.toString('utf8'));
    const skills = Array.isArray(data.skills) ? data.skills : [];
    const q = (query || '').toLowerCase();
    return skills.filter(function (s) {
      return s && s.name && (!q || (s.name + ' ' + (s.description || '')).toLowerCase().indexOf(q) !== -1);
    }).map(function (s) {
      return { name: s.name, source: src.spec, skill: s.name, installs: 0, registry: src.name, install: src.spec, trust: src.trust };
    });
  } catch (e) { return { error: 'registry ' + src.name + ': ' + e.message }; }
}

// GitHub search — code search for SKILL.md when a token is present (precise), else unauthenticated
// repo search (works for everyone, lower rate limit). Opt-in: --github flag or GITHUB_TOKEN.
async function searchGitHub(query, opts) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = token ? { authorization: 'Bearer ' + token } : {};
  const timeout = (opts && opts.timeout) || 12000;
  try {
    if (token) {
      const q = encodeURIComponent((query || '') + ' filename:SKILL.md');
      const buf = await safeGet('https://api.github.com/search/code?q=' + q + '&per_page=20', { accept: 'application/vnd.github+json', headers: headers, timeout: timeout });
      const data = JSON.parse(buf.toString('utf8'));
      return (data.items || []).map(function (it) {
        const repo = it.repository ? it.repository.full_name : null;
        const dir = it.path ? it.path.replace(/\/?SKILL\.md$/i, '') : '';
        const src = repo ? (dir ? repo + '/' + dir : repo) : null;
        return { name: dir ? dir.split('/').pop() : repo, source: repo, skill: null, installs: 0, registry: 'github', install: src };
      }).filter(function (r) { return r.install; });
    }
    const q = encodeURIComponent((query || 'skill') + ' skill in:name,description,readme');
    const buf = await safeGet('https://api.github.com/search/repositories?q=' + q + '&per_page=15&sort=stars', { accept: 'application/vnd.github+json', headers: headers, timeout: timeout });
    const data = JSON.parse(buf.toString('utf8'));
    // Unauthenticated repo search is broad — keep only repos that actually look skill-related.
    return (data.items || []).filter(function (r) {
      const hay = (r.full_name + ' ' + (r.description || '')).toLowerCase();
      return hay.indexOf('skill') !== -1 || hay.indexOf('agent') !== -1;
    }).map(function (r) {
      return { name: r.full_name, source: r.full_name, skill: null, installs: r.stargazers_count || 0, stars: true, registry: 'github', install: r.full_name };
    });
  } catch (e) { return { error: 'github: ' + e.message }; }
}

async function findSkills(query, opts) {
  opts = opts || {};
  const cwd = opts.cwd;
  const results = [];
  const searched = [];
  const errors = [];

  if (!opts.localOnly) {
    searched.push('skills.sh');
    const r = await searchSkillsSh(query, opts);
    if (Array.isArray(r)) results.push.apply(results, r);
    else if (r && r.error) errors.push(r.error);
  }

  const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!opts.localOnly && (opts.github || ghToken)) {
    searched.push('github');
    const r = await searchGitHub(query, opts);
    if (Array.isArray(r)) {
      results.push.apply(results, r);
      if (!ghToken) errors.push('github: showing repo matches — set GITHUB_TOKEN for precise SKILL.md code search');
    } else if (r && r.error) errors.push(r.error);
  }

  for (const src of registry.listSources(cwd)) {
    if (src.type === 'list') {
      searched.push(src.name);
      const r = await searchListSource(src, query, opts);
      if (Array.isArray(r)) results.push.apply(results, r); else if (r && r.error) errors.push(r.error);
    } else if (src.type === 'registry') {
      searched.push(src.name);
      const r = await searchWellKnown(src, query, opts);
      if (Array.isArray(r)) results.push.apply(results, r); else if (r && r.error) errors.push(r.error);
    }
  }

  // Annotate trust from the built-in trustedSources + any registered `trusted` owners.
  const trusted = new Set();
  (loadConfig(null, {}).trustedSources || []).concat(registry.trustedOwners(cwd)).forEach(function (t) { trusted.add(String(t).toLowerCase()); });
  for (const r of results) {
    if (r.trust) continue;
    const owner = r.source ? String(r.source).toLowerCase().split('/')[0] : '';
    if (owner && (trusted.has(owner) || trusted.has(String(r.source).toLowerCase()))) r.trust = 'trusted';
  }

  results.sort(function (a, b) { return (b.installs || 0) - (a.installs || 0) || String(a.name).localeCompare(String(b.name)); });
  return { results: results, searched: searched, errors: errors };
}

async function cmdFind(args) {
  const query = args._.slice(1).join(' ').trim();
  const cwd = process.cwd();
  let out;
  try { out = await findSkills(query, { cwd: cwd, localOnly: args.flags.local, github: args.flags.github }); }
  catch (e) { console.error('find: ' + e.message); return 3; }

  if (args.flags.json) { console.log(JSON.stringify(Object.assign({ query: query }, out), null, 2)); return 0; }

  for (const e of out.errors) console.error('  (note) ' + e);
  if (!out.results.length) {
    console.log('no skills found' + (query ? ' for "' + query + '"' : '') + '. searched: ' + (out.searched.join(', ') || 'nothing'));
    return 0;
  }
  const limit = Number(args.flags.limit) || 25;
  console.log('found ' + out.results.length + ' skill(s)' + (query ? ' for "' + query + '"' : '') + ' — searched ' + out.searched.join(', ') + ':\n');
  for (const r of out.results.slice(0, limit)) {
    const trust = r.trust === 'trusted' ? '  ✓trusted' : '';
    const metric = r.installs ? (r.stars ? '  (' + r.installs + ' ⭐)' : '  (' + r.installs + ' installs)') : '';
    console.log('  ' + r.name + '   ← ' + r.registry + trust + metric);
    console.log('      shucky install ' + r.install);
  }
  if (out.results.length > limit) console.log('\n  … ' + (out.results.length - limit) + ' more (use --limit <n> or --json)');
  console.log('\nEvery install is scanned before it lands.');
  return 0;
}

module.exports = { findSkills, cmdFind, searchSkillsSh };

'use strict';

// shucky source resolver — parse a source string into a structured target.
// Portions ported from vercel-labs/skills `src/source-parser.ts` (MIT). See NOTICE.
// Pure string → struct: NO I/O, NO network. Trivially unit-testable.
//
// ParsedSource = { type, url, subpath?, ref?, skillFilter?, localPath? }
//   type ∈ local | github | gitlab | git | well-known | rawfile | gist
// shucky widens the reference set with `rawfile` (a direct SKILL.md / .md URL,
// incl. github /blob/ and gitlab /-/raw/) and `gist`, so "from anywhere" is literally true.

const { isAbsolute, resolve } = require('path');

// Common shorthand → canonical source.
const SOURCE_ALIASES = {
  'coinbase/agentWallet': 'coinbase/agentic-wallet-skills'
};

function parseOwnerRepo(ownerRepo) {
  const m = String(ownerRepo).match(/^([^/]+)\/([^/]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

// Reject any subpath with a ".." segment (path-traversal guard, parse-time).
function sanitizeSubpath(subpath) {
  const normalized = String(subpath).replace(/\\/g, '/');
  for (const seg of normalized.split('/')) {
    if (seg === '..') {
      throw new Error('Unsafe subpath: "' + subpath + '" contains path-traversal ".." segments.');
    }
  }
  return subpath;
}

function isLocalPath(input) {
  return (
    isAbsolute(input) ||
    input.startsWith('./') ||
    input.startsWith('../') ||
    input === '.' ||
    input === '..' ||
    /^[a-zA-Z]:[/\\]/.test(input) // Windows C:\ , D:/ , …
  );
}

// .tar.gz / .tgz / .zip → archive (tested on the path portion, ignoring #frag / ?query).
function archiveFormat(spec) {
  const p = String(spec).split('#')[0].split('?')[0];
  if (/\.zip$/i.test(p)) return 'zip';
  if (/\.(tar\.gz|tgz)$/i.test(p)) return 'tar.gz';
  return null;
}

function decodeFragmentValue(value) {
  try { return decodeURIComponent(value); }
  catch (e) { return value; }
}

// Only treat a trailing #fragment as a git ref for git-shaped sources (so a
// generic well-known URL keeps its fragment).
function looksLikeGitSource(input) {
  if (input.startsWith('github:') || input.startsWith('gitlab:') || input.startsWith('git@')) return true;
  if (/^ssh:\/\/.+\.git(?:$|[/?])/i.test(input)) return true;
  if (input.startsWith('http://') || input.startsWith('https://')) {
    try {
      const u = new URL(input);
      const p = u.pathname;
      if (u.hostname === 'github.com') return /^\/[^/]+\/[^/]+(?:\.git)?(?:\/tree\/[^/]+(?:\/.*)?)?\/?$/.test(p);
      if (u.hostname === 'gitlab.com') return /^\/.+?\/[^/]+(?:\.git)?(?:\/-\/tree\/[^/]+(?:\/.*)?)?\/?$/.test(p);
    } catch (e) { /* fall through */ }
  }
  if (/^https?:\/\/.+\.git(?:$|[/?])/i.test(input)) return true;
  return (
    !input.includes(':') &&
    !input.startsWith('.') &&
    !input.startsWith('/') &&
    /^([^/]+)\/([^/]+)(?:\/(.+)|@(.+))?$/.test(input)
  );
}

function parseFragmentRef(input) {
  const hashIndex = input.indexOf('#');
  if (hashIndex < 0) return { inputWithoutFragment: input };
  const inputWithoutFragment = input.slice(0, hashIndex);
  const fragment = input.slice(hashIndex + 1);
  if (!fragment || !looksLikeGitSource(inputWithoutFragment)) return { inputWithoutFragment: input };
  const atIndex = fragment.indexOf('@');
  if (atIndex === -1) return { inputWithoutFragment: inputWithoutFragment, ref: decodeFragmentValue(fragment) };
  const ref = fragment.slice(0, atIndex);
  const skillFilter = fragment.slice(atIndex + 1);
  return {
    inputWithoutFragment: inputWithoutFragment,
    ref: ref ? decodeFragmentValue(ref) : undefined,
    skillFilter: skillFilter ? decodeFragmentValue(skillFilter) : undefined
  };
}

function appendFragmentRef(input, ref, skillFilter) {
  if (!ref) return input;
  return input + '#' + ref + (skillFilter ? '@' + skillFilter : '');
}

// Any HTTP(S) URL that is not a known git host and not a .git repo → well-known discovery.
function isWellKnownUrl(input) {
  if (!input.startsWith('http://') && !input.startsWith('https://')) return false;
  try {
    const u = new URL(input);
    const excluded = [
      'github.com', 'gitlab.com',
      'raw.githubusercontent.com', 'gist.github.com', 'gist.githubusercontent.com'
    ];
    if (excluded.indexOf(u.hostname.toLowerCase()) !== -1) return false;
    if (input.endsWith('.git')) return false;
    return true;
  } catch (e) { return false; }
}

// shucky extension: classify direct-file and gist http(s) sources BEFORE the loose
// github/gitlab regexes (which would otherwise mis-match e.g. gist.github.com).
function classifyHttpUrl(input, fragmentRef) {
  let u;
  try { u = new URL(input); } catch (e) { return null; }
  const host = u.hostname.toLowerCase();
  const path = u.pathname;

  if (host === 'gist.github.com') {
    const parts = path.split('/').filter(Boolean);
    const id = (parts.length >= 2 ? parts[1] : parts[0]) || '';
    const cleanId = id.replace(/\.git$/, '');
    if (cleanId) {
      const out = { type: 'gist', url: 'https://gist.github.com/' + cleanId + '.git' };
      if (fragmentRef) out.ref = fragmentRef;
      return out;
    }
  }

  if (host === 'raw.githubusercontent.com' || host === 'gist.githubusercontent.com') {
    return { type: 'rawfile', url: input };
  }

  if (host === 'github.com') {
    // /blob/<ref>/<path> or /raw/<ref>/<path> → fetch the raw file directly.
    const m = path.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+)$/);
    if (m) {
      const owner = m[1], repo = m[2].replace(/\.git$/, ''), ref = m[3], p = m[4];
      return { type: 'rawfile', url: 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/' + ref + '/' + p };
    }
    return null; // repo / tree URLs handled by the git logic below
  }

  if (host === 'gitlab.com') {
    if (path.indexOf('/-/raw/') !== -1) return { type: 'rawfile', url: input }; // gitlab raw is directly fetchable
    return null;
  }

  // Any other host whose path points straight at a markdown / SKILL file → rawfile.
  if (/\/SKILL\.md$/i.test(path) || /\.md$/i.test(path)) {
    return { type: 'rawfile', url: input };
  }
  return null;
}

function parseSource(input) {
  input = String(input == null ? '' : input).trim();
  if (!input) throw new Error('empty source');

  // Local path: absolute, relative, or current dir.
  if (isLocalPath(input)) {
    const resolved = resolve(input);
    const lfmt = archiveFormat(input);
    if (lfmt) return { type: 'archive', url: resolved, localPath: resolved, archiveFormat: lfmt };
    return { type: 'local', url: resolved, localPath: resolved };
  }

  const fr = parseFragmentRef(input);
  let body = fr.inputWithoutFragment;
  const fragmentRef = fr.ref;
  const fragmentSkillFilter = fr.skillFilter;

  if (SOURCE_ALIASES[body]) body = SOURCE_ALIASES[body];

  // Prefix shorthands.
  const ghPrefix = body.match(/^github:(.+)$/);
  if (ghPrefix) return parseSource(appendFragmentRef(ghPrefix[1], fragmentRef, fragmentSkillFilter));
  const glPrefix = body.match(/^gitlab:(.+)$/);
  if (glPrefix) return parseSource(appendFragmentRef('https://gitlab.com/' + glPrefix[1], fragmentRef, fragmentSkillFilter));
  const gistPrefix = body.match(/^gist:(.+)$/);
  if (gistPrefix) {
    const out = { type: 'gist', url: 'https://gist.github.com/' + gistPrefix[1].replace(/\.git$/, '') + '.git' };
    if (fragmentRef) out.ref = fragmentRef;
    return out;
  }

  // shucky: archive + direct-file + gist classification before the loose git regexes.
  if (body.startsWith('http://') || body.startsWith('https://')) {
    const afmt = archiveFormat(body);
    if (afmt) return { type: 'archive', url: body, archiveFormat: afmt };
    const c = classifyHttpUrl(body, fragmentRef);
    if (c) return c;
  }

  // GitHub URL with path: …/github.com/owner/repo/tree/<ref>/<subpath>
  let m = body.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/);
  if (m) {
    return {
      type: 'github',
      url: 'https://github.com/' + m[1] + '/' + m[2] + '.git',
      ref: m[3] || fragmentRef,
      subpath: sanitizeSubpath(m[4])
    };
  }
  // GitHub URL, branch only: …/github.com/owner/repo/tree/<ref>
  m = body.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)$/);
  if (m) {
    return { type: 'github', url: 'https://github.com/' + m[1] + '/' + m[2] + '.git', ref: m[3] || fragmentRef };
  }
  // GitHub URL: …/github.com/owner/repo
  m = body.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (m) {
    const out = { type: 'github', url: 'https://github.com/' + m[1] + '/' + m[2].replace(/\.git$/, '') + '.git' };
    if (fragmentRef) out.ref = fragmentRef;
    return out;
  }

  // GitLab URL with path (any instance): proto://host/<repoPath>/-/tree/<ref>/<subpath>
  m = body.match(/^(https?):\/\/([^/]+)\/(.+?)\/-\/tree\/([^/]+)\/(.+)/);
  if (m && m[2] !== 'github.com' && m[3]) {
    return {
      type: 'gitlab',
      url: m[1] + '://' + m[2] + '/' + m[3].replace(/\.git$/, '') + '.git',
      ref: m[4] || fragmentRef,
      subpath: sanitizeSubpath(m[5])
    };
  }
  // GitLab URL, branch only: proto://host/<repoPath>/-/tree/<ref>
  m = body.match(/^(https?):\/\/([^/]+)\/(.+?)\/-\/tree\/([^/]+)$/);
  if (m && m[2] !== 'github.com' && m[3]) {
    return { type: 'gitlab', url: m[1] + '://' + m[2] + '/' + m[3].replace(/\.git$/, '') + '.git', ref: m[4] || fragmentRef };
  }
  // gitlab.com URL (official host only): gitlab.com/owner/repo or group/subgroup/repo
  m = body.match(/gitlab\.com\/(.+?)(?:\.git)?\/?$/);
  if (m && m[1].indexOf('/') !== -1) {
    const out = { type: 'gitlab', url: 'https://gitlab.com/' + m[1] + '.git' };
    if (fragmentRef) out.ref = fragmentRef;
    return out;
  }

  // owner/repo@skill-name
  m = body.match(/^([^/]+)\/([^/@]+)@(.+)$/);
  if (m && body.indexOf(':') === -1 && !body.startsWith('.') && !body.startsWith('/')) {
    const out = { type: 'github', url: 'https://github.com/' + m[1] + '/' + m[2] + '.git', skillFilter: fragmentSkillFilter || m[3] };
    if (fragmentRef) out.ref = fragmentRef;
    return out;
  }
  // owner/repo  or  owner/repo/sub/path
  m = body.match(/^([^/]+)\/([^/]+)(?:\/(.+?))?\/?$/);
  if (m && body.indexOf(':') === -1 && !body.startsWith('.') && !body.startsWith('/')) {
    const out = { type: 'github', url: 'https://github.com/' + m[1] + '/' + m[2] + '.git' };
    if (fragmentRef) out.ref = fragmentRef;
    if (m[3]) out.subpath = sanitizeSubpath(m[3]);
    if (fragmentSkillFilter) out.skillFilter = fragmentSkillFilter;
    return out;
  }

  // Arbitrary HTTP(S) host (not git) → well-known discovery.
  if (isWellKnownUrl(body)) {
    return { type: 'well-known', url: body };
  }

  // Fallback: a direct git URL (git@…, ssh://…, https://….git).
  const out = { type: 'git', url: body };
  if (fragmentRef) out.ref = fragmentRef;
  return out;
}

// Normalised owner/repo (lowercased input form) for trust-matching + lock provenance.
// Returns null for local/rawfile/well-known (no owner/repo identity).
function getOwnerRepo(parsed) {
  if (!parsed || parsed.type === 'local') return null;
  const url = parsed.url || '';

  const ssh = url.match(/^git@[^:]+:(.+)$/);
  if (ssh) {
    const p = ssh[1].replace(/\.git$/, '');
    return p.indexOf('/') !== -1 ? p : null;
  }
  if (url.startsWith('ssh://')) {
    try {
      const u = new URL(url);
      const p = u.pathname.slice(1).replace(/\.git$/, '');
      return p.indexOf('/') !== -1 ? p : null;
    } catch (e) { return null; }
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) return null;
  try {
    const u = new URL(url);
    // rawfile / well-known have no stable owner/repo identity for trust.
    if (parsed.type === 'rawfile' || parsed.type === 'well-known' || parsed.type === 'archive') return null;
    const p = u.pathname.slice(1).replace(/\.git$/, '');
    return p.indexOf('/') !== -1 ? p : null;
  } catch (e) { return null; }
}

module.exports = {
  parseSource,
  getOwnerRepo,
  parseOwnerRepo,
  sanitizeSubpath,
  isLocalPath,
  isWellKnownUrl
};

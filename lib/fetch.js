'use strict';

// shucky universal fetcher — normalise ANY source into a local directory we can scan.
// Every fetched skill ends up as plain files on disk, which scanTarget() already eats.
// Zero npm deps: `git` (system binary) for git-type sources, Node `https`/`http` for the rest.
//
// fetchSource(parsed, opts) -> { dir, ref, provenance, cleanup }
//   dir        absolute path to the fetched skill root (temp dir, or the local path in place)
//   ref        resolved commit SHA (git) / content hash (rawfile) / null — feeds the scan gate
//   provenance { type, url, input } for the lockfile + messaging
//   cleanup()  removes the temp dir (no-op for local sources); ALWAYS call it in a finally

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { assertSafeHttpsUrl } = require('./safeurl');

const DEFAULT_MAX_BYTES = Number(process.env.SHUCKY_MAX_FETCH_BYTES) || 25 * 1024 * 1024;
const DEFAULT_HTTP_TIMEOUT = Number(process.env.SHUCKY_HTTP_TIMEOUT) || 20000;
const DEFAULT_GIT_TIMEOUT = Number(process.env.SHUCKY_GIT_TIMEOUT) || 120000;
const MAX_REDIRECTS = 5;

// ---- temp dir lifecycle --------------------------------------------------

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shucky-'));
}

// Only ever remove a dir we created under os.tmpdir() with our prefix.
function removeTempRoot(tempRoot) {
  if (!tempRoot) return;
  try {
    const base = path.basename(tempRoot);
    if (base.indexOf('shucky-') !== 0) return;
    if (tempRoot.indexOf(os.tmpdir()) !== 0) return;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch (e) { /* best effort */ }
}

// ---- git ------------------------------------------------------------------

function validateRef(ref) {
  if (ref == null || ref === '') return;
  if (ref[0] === '-' || !/^[\w./-]+$/.test(ref)) {
    throw new Error('unsafe git ref: ' + JSON.stringify(ref));
  }
}

function gitEnv() {
  return Object.assign({}, process.env, {
    GIT_TERMINAL_PROMPT: '0',     // never prompt for credentials → fail fast
    GIT_LFS_SKIP_SMUDGE: '1',     // don't pull LFS blobs
    GCM_INTERACTIVE: 'never',
    GIT_ASKPASS: 'echo'
  });
}

function runGit(args, opts) {
  return execFileSync('git', args, Object.assign({
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: DEFAULT_GIT_TIMEOUT,
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'utf8',
    env: gitEnv()
  }, opts || {}));
}

// Clone url@ref into repoDir (shallow). Falls back to full clone + checkout when ref is a
// commit SHA (which `--branch` can't take). Returns the resolved HEAD SHA.
function gitCloneInto(url, ref, repoDir) {
  validateRef(ref);
  try {
    const args = ['clone', '--depth', '1', '--no-tags', '--single-branch'];
    if (ref) args.push('--branch', ref);
    args.push('--', url, repoDir);
    runGit(args);
  } catch (e) {
    if (!ref) throw new Error('git clone failed: ' + gitErr(e));
    // ref might be a commit SHA → clone the default branch, then check it out.
    try { fs.rmSync(repoDir, { recursive: true, force: true }); } catch (e2) { /* ignore */ }
    runGit(['clone', '--no-tags', '--', url, repoDir]);
    runGit(['-C', repoDir, 'checkout', ref]);
  }
  return runGit(['-C', repoDir, 'rev-parse', 'HEAD']).trim();
}

function gitErr(e) {
  const s = (e && (e.stderr || e.message) || '').toString().trim();
  if (/Authentication failed|could not read Username|terminal prompts disabled/i.test(s)) {
    return 'authentication required (private repo?) — shucky does not prompt for git credentials';
  }
  return s.split('\n').slice(-3).join(' ') || 'unknown error';
}

// ---- http(s) --------------------------------------------------------------

// GET a URL, re-validating SSRF safety on EVERY redirect hop, with size + time caps.
async function safeGet(url, opts) {
  opts = opts || {};
  const maxBytes = opts.maxBytes || DEFAULT_MAX_BYTES;
  let current = url;
  for (let hop = 0; ; hop++) {
    if (hop > MAX_REDIRECTS) throw new Error('too many redirects fetching ' + url);
    const u = await assertSafeHttpsUrl(current, { resolver: opts.resolver, allowHttp: opts.allowHttp });
    const lib = u.protocol === 'http:' ? http : https;

    const resp = await new Promise(function (res, rej) {
      const req = lib.get(u, {
        timeout: opts.timeout || DEFAULT_HTTP_TIMEOUT,
        headers: Object.assign({ 'user-agent': 'shucky', 'accept': opts.accept || '*/*' }, opts.headers || {})
      }, res);
      req.on('timeout', function () { req.destroy(new Error('request timed out')); });
      req.on('error', rej);
    });

    const status = resp.statusCode;
    if (status >= 300 && status < 400 && resp.headers.location) {
      resp.resume(); // drain
      current = new URL(resp.headers.location, u).toString();
      continue;
    }
    if (status !== 200) { resp.resume(); throw new Error('HTTP ' + status + ' fetching ' + current); }

    const cl = Number(resp.headers['content-length'] || 0);
    if (cl && cl > maxBytes) { resp.destroy(); throw new Error('response too large (' + cl + ' bytes)'); }

    return await new Promise(function (res, rej) {
      const chunks = [];
      let total = 0;
      resp.on('data', function (d) {
        total += d.length;
        if (total > maxBytes) { resp.destroy(); rej(new Error('response exceeded ' + maxBytes + ' bytes')); return; }
        chunks.push(d);
      });
      resp.on('end', function () { res(Buffer.concat(chunks)); });
      resp.on('error', rej);
    });
  }
}

function shortHash(buf) {
  return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

// ---- per-type fetchers ----------------------------------------------------

function fetchLocal(parsed) {
  const p = parsed.localPath || parsed.url;
  let stat;
  try { stat = fs.statSync(p); }
  catch (e) { throw new Error('local source not found: ' + p); }
  const dir = stat.isDirectory() ? p : path.dirname(p);
  return { dir: dir, ref: null, provenance: { type: 'local', url: p, input: p }, cleanup: function () {} };
}

function fetchGit(parsed, opts) {
  if (/^https?:\/\//.test(parsed.url)) {
    // Validate the clone host (SSRF) before handing it to git.
    return assertSafeHttpsUrl(parsed.url, { resolver: opts && opts.resolver })
      .then(function () { return doGitClone(parsed); });
  }
  // git@ / ssh:// — no http host to validate; trust the explicit URL.
  return Promise.resolve(doGitClone(parsed));
}

function doGitClone(parsed) {
  const tempRoot = makeTempRoot();
  const repoDir = path.join(tempRoot, 'repo');
  try {
    const sha = gitCloneInto(parsed.url, parsed.ref, repoDir);
    return {
      dir: repoDir,
      ref: sha,
      provenance: { type: parsed.type, url: parsed.url, input: parsed.url },
      cleanup: function () { removeTempRoot(tempRoot); }
    };
  } catch (e) {
    removeTempRoot(tempRoot);
    throw e;
  }
}

async function fetchRawfile(parsed, opts) {
  const tempRoot = makeTempRoot();
  const skillDir = path.join(tempRoot, 'skill');
  try {
    fs.mkdirSync(skillDir, { recursive: true });
    const buf = await safeGet(parsed.url, { resolver: opts && opts.resolver, accept: 'text/markdown,text/plain,*/*' });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), buf);
    return {
      dir: skillDir,
      ref: shortHash(buf),
      provenance: { type: 'rawfile', url: parsed.url, input: parsed.url },
      cleanup: function () { removeTempRoot(tempRoot); }
    };
  } catch (e) {
    removeTempRoot(tempRoot);
    throw e;
  }
}

// Minimal RFC-8615 well-known discovery: probe the index, materialise each `skill-md`
// skill as <name>/SKILL.md. Archive-type entries are skipped (Phase 3).
async function fetchWellKnown(parsed, opts) {
  const origin = new URL(parsed.url).origin;
  const indexPaths = ['/.well-known/agent-skills/index.json', '/.well-known/skills/index.json'];
  let index = null, indexBase = null;
  for (const ip of indexPaths) {
    try {
      const buf = await safeGet(origin + ip, { resolver: opts && opts.resolver, accept: 'application/json' });
      index = JSON.parse(buf.toString('utf8'));
      indexBase = ip;
      break;
    } catch (e) { /* try next */ }
  }
  if (!index || !Array.isArray(index.skills)) {
    throw new Error('no .well-known skills index at ' + origin);
  }

  const tempRoot = makeTempRoot();
  try {
    let count = 0;
    for (const sk of index.skills) {
      if (!sk || !sk.name) continue;
      const name = String(sk.name).replace(/[^A-Za-z0-9._-]/g, '-');
      let md = null;
      if (sk.url) {
        if (sk.type && sk.type !== 'skill-md') continue; // archives → Phase 3
        md = await safeGet(new URL(sk.url, origin).toString(), { resolver: opts && opts.resolver });
      } else if (Array.isArray(sk.files)) {
        const base = origin + path.posix.dirname(indexBase) + '/' + name + '/';
        const target = sk.files.find(function (f) { return /SKILL\.md$/i.test(f); }) || sk.files[0];
        if (target) md = await safeGet(new URL(target, base).toString(), { resolver: opts && opts.resolver });
      }
      if (!md) continue;
      const d = path.join(tempRoot, name);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'SKILL.md'), md);
      count++;
    }
    if (!count) throw new Error('well-known index listed no installable skill-md skills');
    return {
      dir: tempRoot,
      ref: null,
      provenance: { type: 'well-known', url: parsed.url, input: parsed.url },
      cleanup: function () { removeTempRoot(tempRoot); }
    };
  } catch (e) {
    removeTempRoot(tempRoot);
    throw e;
  }
}

// Fetch a .tar.gz / .zip (remote URL or local file) and extract it into a temp dir, with all the
// zip-slip / zip-bomb / symlink guards in lib/archive.js. Untrusted → always fully scanned.
async function fetchArchive(parsed, opts) {
  const tempRoot = makeTempRoot();
  const extractDir = path.join(tempRoot, 'extract');
  try {
    let buf;
    if (parsed.localPath) buf = fs.readFileSync(parsed.localPath);
    else buf = await safeGet(parsed.url, { resolver: opts && opts.resolver, maxBytes: DEFAULT_MAX_BYTES });
    require('./archive').extractArchive(buf, extractDir, { format: parsed.archiveFormat });
    return {
      dir: extractDir,
      ref: shortHash(buf),
      provenance: { type: 'archive', url: parsed.url, input: parsed.url },
      cleanup: function () { removeTempRoot(tempRoot); }
    };
  } catch (e) {
    removeTempRoot(tempRoot);
    throw e;
  }
}

// ---- dispatcher -----------------------------------------------------------

function fetchSource(parsed, opts) {
  opts = opts || {};
  switch (parsed.type) {
    case 'local':
      return Promise.resolve(fetchLocal(parsed));
    case 'github':
    case 'gitlab':
    case 'gist':
    case 'git':
      return fetchGit(parsed, opts);
    case 'rawfile':
      return fetchRawfile(parsed, opts);
    case 'well-known':
      return fetchWellKnown(parsed, opts);
    case 'archive':
      return fetchArchive(parsed, opts);
    default:
      return Promise.reject(new Error('unsupported source type: ' + parsed.type));
  }
}

module.exports = { fetchSource, safeGet, removeTempRoot, validateRef, makeTempRoot };

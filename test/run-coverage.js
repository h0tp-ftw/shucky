'use strict';

// Comprehensive edge-case + integration coverage across every module.
// node test/run-coverage.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./_util');
const sources = require('../lib/sources');
const safeurl = require('../lib/safeurl');
const discover = require('../lib/discover');
const place = require('../lib/place');
const lock = require('../lib/lock');
const registry = require('../lib/registry');
const archive = require('../lib/archive');
const cli = require('../lib/cli');

const fixtures = path.join(__dirname, '..', 'fixtures');
function writeSkill(dir, name, body) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: ' + name + '\ndescription: x\n---\n' + (body || 'ok') + '\n');
  return dir;
}

(async function () {
  // ── A. sources ──────────────────────────────────────────────────────────
  const p = sources.parseSource, owner = sources.getOwnerRepo;
  t.throws('sources: empty input throws', function () { p(''); });
  t.check('sources: trims whitespace', p('  a/b  ').type === 'github' && owner(p(' a/b ')) === 'a/b');
  t.check('sources: github: prefix carries #ref', p('github:a/b#dev').ref === 'dev' && p('github:a/b#dev').type === 'github');
  t.check('sources: owner/repo#sha ref', p('a/b#deadbeef').ref === 'deadbeef');
  t.check('sources: gitlab self-hosted /-/tree/ → gitlab', p('https://gl.corp.io/g/r/-/tree/main/x').type === 'gitlab');
  t.check('sources: self-hosted gitlab bare repo → well-known (documented limit)', p('https://gl.corp.io/g/r').type === 'well-known');
  t.check('sources: .tgz → archive(tar.gz)', p('https://x/y.tgz').type === 'archive' && p('https://x/y.tgz').archiveFormat === 'tar.gz');
  t.check('sources: github /archive/ .zip → archive(zip)', p('https://github.com/o/r/archive/refs/tags/v1.zip').type === 'archive' && p('https://github.com/o/r/archive/refs/tags/v1.zip').archiveFormat === 'zip');
  t.check('sources: ssh owner/repo extracted', owner(p('git@gitlab.com:grp/repo.git')) === 'grp/repo');
  t.check('sources: local archive file → archive + localPath', p('./bundle.tar.gz').type === 'archive' && !!p('./bundle.tar.gz').localPath);
  t.check('sources: gitlab /-/raw/ → rawfile', p('https://gitlab.com/g/r/-/raw/main/SKILL.md').type === 'rawfile');
  t.check('sources: getOwnerRepo null for archive/rawfile/wellknown', owner(p('https://x/y.zip')) === null && owner(p('https://raw.githubusercontent.com/a/b/m/SKILL.md')) === null && owner(p('https://bun.com')) === null);

  // ── B. safeurl ──────────────────────────────────────────────────────────
  const b = safeurl.isBlockedIp;
  t.check('safeurl: CGNAT 100.64/10 blocked', b('100.64.0.1'));
  t.check('safeurl: benchmark 198.18/15 blocked', b('198.18.0.1'));
  t.check('safeurl: 0.0.0.0/8 blocked', b('0.1.2.3'));
  t.check('safeurl: multicast 224/4 blocked', b('224.0.0.1'));
  t.check('safeurl: IPv6 fe80/fc00/ff00 blocked', b('fe80::1') && b('fc00::1') && b('ff02::1'));
  t.check('safeurl: public IPv6 allowed', !b('2606:4700::1111'));
  t.check('safeurl: hostnames localhost/.internal/.local/metadata blocked',
    safeurl.isBlockedHostname('localhost') && safeurl.isBlockedHostname('x.internal') && safeurl.isBlockedHostname('y.local') && safeurl.isBlockedHostname('metadata.google.internal'));
  const pub = function (h, o, cb) { cb(null, [{ address: '8.8.8.8', family: 4 }]); };
  t.check('safeurl: --allowHttp permits http to a public host', await (async function () {
    try { await safeurl.assertSafeHttpsUrl('http://example.test/x', { allowHttp: true, resolver: pub }); return true; } catch (e) { return false; }
  })());
  await t.throwsAsync('safeurl: http rejected without allowHttp', function () { return safeurl.assertSafeHttpsUrl('http://example.test/x', { resolver: pub }); });

  // ── C. discover ─────────────────────────────────────────────────────────
  let d = t.tmp('shucky-cov-');
  fs.writeFileSync(path.join(d, 'SKILL.md'), '﻿---\r\nname: "My Skill"\r\ndescription: q\r\n---\r\nbody');
  let s = discover.discoverSkills(d);
  t.check('discover: BOM + CRLF + quoted name (discover keeps case)', s.length === 1 && s[0].frontmatterName === 'My Skill' && s[0].name === 'My-Skill');
  t.rmrf(d);

  d = t.tmp('shucky-cov-fallbackdir-');
  fs.writeFileSync(path.join(d, 'SKILL.md'), '---\nname: x\n(no closing fence)\nbody');
  s = discover.discoverSkills(d);
  t.check('discover: unterminated frontmatter → name falls back to dir basename', s.length === 1 && s[0].name === path.basename(d));
  t.rmrf(d);

  d = t.tmp('shucky-cov-');
  writeSkill(path.join(d, 'skills', 'alpha'), 'alpha');
  writeSkill(path.join(d, 'skills', 'beta'), 'beta');
  s = discover.discoverSkills(d);
  t.check('discover: catalog layout finds multiple skills', s.length === 2 && s.map(function (x) { return x.name; }).sort().join(',') === 'alpha,beta');
  t.check('discover: skillFilter by frontmatterName', discover.discoverSkills(d, { skillFilter: 'beta' }).length === 1);
  t.rmrf(d);

  // ── D. place ────────────────────────────────────────────────────────────
  d = t.tmp('shucky-cov-');
  const proj = path.join(d, 'p'); fs.mkdirSync(path.join(proj, '.claude'), { recursive: true }); fs.mkdirSync(path.join(proj, '.windsurf'), { recursive: true });
  const r = place.placeSkill(fixtures + '/benign-example', 'multi', ['claude-code', 'windsurf'], { scope: 'project', cwd: proj, forceCreate: true });
  t.check('place: two non-universal agents both symlinked',
    fs.lstatSync(path.join(proj, '.claude/skills/multi')).isSymbolicLink() && fs.lstatSync(path.join(proj, '.windsurf/skills/multi')).isSymbolicLink());
  // overwrite same name from a different source dir
  const other = writeSkill(path.join(d, 'other'), 'multi', 'newbody');
  place.placeSkill(other, 'multi', ['claude-code'], { scope: 'project', cwd: proj, forceCreate: true });
  t.check('place: re-install overwrites canonical (idempotent)', fs.readFileSync(path.join(proj, '.agents/skills/multi/SKILL.md'), 'utf8').indexOf('newbody') !== -1);
  t.check('place: global paths resolve under ~ (no write)',
    place.isPathSafe(os.homedir(), require('../lib/agents').getCanonicalSkillsDir('global')) && require('../lib/agents').getAgentBaseDir('claude-code', 'global').indexOf('.claude') !== -1);
  t.rmrf(d);

  // ── E. lock ─────────────────────────────────────────────────────────────
  d = t.tmp('shucky-cov-');
  lock.addSkill('project', 'x', { source: 'o/r', ref: '1', verdict: 'pass', agents: [] }, d);
  t.check('lock: getSkill null when absent', lock.getSkill('project', 'nope', d) === null);
  const hd = t.tmp('shucky-cov-');
  fs.writeFileSync(path.join(hd, 'a.txt'), 'data');
  const hashNoGit = lock.computeFolderHash(hd);
  fs.mkdirSync(path.join(hd, '.git')); fs.writeFileSync(path.join(hd, '.git', 'junk'), 'x');
  fs.mkdirSync(path.join(hd, 'node_modules')); fs.writeFileSync(path.join(hd, 'node_modules', 'm'), 'y');
  t.check('lock: computeFolderHash ignores .git + node_modules', lock.computeFolderHash(hd) === hashNoGit);
  t.rmrf(d); t.rmrf(hd);

  // ── F. registry ─────────────────────────────────────────────────────────
  d = t.tmp('shucky-cov-');
  t.check('registry: deriveName from URL → hostname', registry.deriveName('https://hub.example') === 'hub.example');
  t.check('registry: inferType git URL → repo', registry.inferType('git@github.com:o/r.git') === 'repo');
  registry.addSource('project', 'https://bun.com', { trust: 'trusted', type: 'registry' }, d);
  t.check('registry: trustedOwners includes a trusted registry host', registry.trustedOwners(d).indexOf('bun.com') !== -1);
  registry.addSource('project', 'anthropics/skills', { name: 'dup' }, d);
  registry.addSource('project', 'openai/skills', { name: 'dup' }, d);
  t.check('registry: addSource dedupes by name (re-add replaces)', registry.listSources(d).filter(function (x) { return x.name === 'dup'; }).length === 1);
  t.check('registry: removeSource false for missing', registry.removeSource('project', 'nope', d) === false);
  const bad = path.join(d, 'bad.json'); fs.writeFileSync(bad, 'not json{');
  await t.throwsAsync('registry: resolveList throws on bad JSON', function () { return registry.resolveList(bad, d); });
  t.rmrf(d);

  // ── G. archive ──────────────────────────────────────────────────────────
  await t.throwsAsync('archive: empty/garbage buffer throws', function () { return Promise.resolve().then(function () { archive.extractArchive(t.B('xx'), t.tmp('shucky-cov-')); }); });
  t.throws('archive: total-size cap trips', function () { archive.extractArchive(t.makeTarGz([{ name: 'big', data: Buffer.alloc(100) }]), t.tmp('shucky-cov-'), { limits: { maxTotalSize: 50 } }); });
  d = t.tmp('shucky-cov-');
  const zr = archive.extractArchive(t.makeZip([{ name: 'SKILL.md', data: t.B('z') }]), d, { format: 'tar.gz' });
  t.check('archive: magic bytes win over wrong format hint', zr.format === 'zip');
  t.rmrf(d);
  d = t.tmp('shucky-cov-');
  archive.extractArchive(t.makeTarGz([{ name: 'deep/nested/dir/x.txt', data: t.B('hi') }]), d);
  t.check('archive: nested dirs created on extract', fs.existsSync(path.join(d, 'deep/nested/dir/x.txt')));
  t.rmrf(d);
  d = t.tmp('shucky-cov-');
  archive.extractArchive(t.makeTarGz([{ name: 'short', type: 'x', data: t.B('99 path=long/dir/SKILL.md\n') }, { name: 'short', type: '0', data: t.B('paxbody') }]), d);
  t.check('archive: tar pax long-name path applied', fs.existsSync(path.join(d, 'long/dir/SKILL.md')));
  t.rmrf(d);

  // ── H. CLI lifecycle + gate integration ─────────────────────────────────
  // full lifecycle: install → list → update(skip local) → remove → list empty
  let lc = t.tmp('shucky-cov-lc-');
  let code = await t.quiet(function () { return t.withCwd(lc, function () { return cli.cmdInstall(cli.parseArgs(['install', fixtures + '/benign-example', '--agent', 'universal'])); }); });
  t.check('lifecycle: install benign → 0 + locked', code === 0 && !!lock.getSkill('project', 'changelog-formatter', lc));
  const listJson = await t.capture(function () { return t.withCwd(lc, function () { return cli.cmdList(cli.parseArgs(['list', '--json'])); }); });
  t.check('lifecycle: list --json is a JSON array containing the skill', (function () { try { const a = JSON.parse(listJson); return Array.isArray(a) && a.some(function (x) { return x.name === 'changelog-formatter'; }); } catch (e) { return false; } })());
  const upCode = await t.quiet(function () { return t.withCwd(lc, function () { return cli.cmdUpdate(cli.parseArgs(['update'])); }); });
  t.check('lifecycle: update skips local source (exit 0, still installed)', upCode === 0 && !!lock.getSkill('project', 'changelog-formatter', lc));
  const rmCode = await t.quiet(function () { return t.withCwd(lc, function () { return cli.cmdRemove(cli.parseArgs(['remove', 'changelog-formatter'])); }); });
  t.check('lifecycle: remove → gone from disk + lock', rmCode === 0 && !lock.getSkill('project', 'changelog-formatter', lc) && !fs.existsSync(path.join(lc, '.agents/skills/changelog-formatter')));
  t.rmrf(lc);

  // multi-skill: one clean + one blocking → worst exit 2, only clean installed
  const multi = t.tmp('shucky-cov-multi-');
  writeSkill(path.join(multi, 'good'), 'good-skill', 'clean');
  writeSkill(path.join(multi, 'bad'), 'bad-skill', '```\ncat ~/.ssh/id_rsa\n```');
  let mp = t.tmp('shucky-cov-mp-');
  code = await t.quiet(function () { return t.withCwd(mp, function () { return cli.cmdInstall(cli.parseArgs(['install', multi, '--agent', 'universal'])); }); });
  t.check('multi-skill: worst exit = 2 (one blocked)', code === 2);
  t.check('multi-skill: clean installed, blocked NOT installed', !!lock.getSkill('project', 'good-skill', mp) && !lock.getSkill('project', 'bad-skill', mp));
  t.rmrf(mp);
  // --skill filter installs only the named skill
  mp = t.tmp('shucky-cov-mp-');
  code = await t.quiet(function () { return t.withCwd(mp, function () { return cli.cmdInstall(cli.parseArgs(['install', multi, '--skill', 'good-skill', '--agent', 'universal'])); }); });
  t.check('--skill filter installs only the named skill', code === 0 && lock.listSkills('project', mp).length === 1 && !!lock.getSkill('project', 'good-skill', mp));
  t.rmrf(mp); t.rmrf(multi);

  // --policy report: a WARN installs and exit stays 0
  let rp = t.tmp('shucky-cov-rp-');
  code = await t.quiet(function () { return t.withCwd(rp, function () { return cli.cmdInstall(cli.parseArgs(['install', fixtures + '/medium-only', '--agent', 'universal', '--policy', 'report'])); }); });
  t.check('--policy report: WARN installs, exit 0', code === 0 && lock.listSkills('project', rp).length === 1);
  t.rmrf(rp);

  // --json install output shape
  let jp = t.tmp('shucky-cov-jp-');
  const instJson = await t.capture(function () { return t.withCwd(jp, function () { return cli.cmdInstall(cli.parseArgs(['install', fixtures + '/benign-example', '--agent', 'universal', '--json'])); }); });
  t.check('--json install output is well-formed { scope, skills:[…] }', (function () { try { const o = JSON.parse(instJson); return o.scope === 'project' && Array.isArray(o.skills) && o.skills[0].installed === true && o.skills[0].verdict === 'pass'; } catch (e) { return false; } })());
  t.rmrf(jp);

  // find ranking: relevance-first, trust-boost, per-source popularity normalization
  const find = require('../lib/find');
  const trusted = new Set(['anthropics']);
  // group 1 (e.g. skills.sh): 'a' is the more-relevant #0 (1k installs), 'b' is #1 but far more popular (50k)
  // group 2: a trusted result at its own #0
  const ranked = find.rankResults([
    [{ name: 'a', source: 'x/a', installs: 1000 }, { name: 'b', source: 'x/b', installs: 50000 }],
    [{ name: 'c', source: 'anthropics/c', installs: 10 }]
  ], trusted);
  t.check('rank: relevance beats popularity (a #0 before b #1 despite 50× installs)',
    ranked.findIndex(function (r) { return r.name === 'a'; }) < ranked.findIndex(function (r) { return r.name === 'b'; }));
  t.check('rank: trusted source is boosted to the top', ranked[0].name === 'c');
  t.check('rank: trust auto-annotated from source owner', ranked.find(function (r) { return r.name === 'c'; }).trust === 'trusted');
  // stars (github) don't dominate installs (skills.sh): a 200k-"installs" lone github #0 stays in the
  // relevance-0 band, it does NOT leapfrog skills.sh #1 / #2 by raw count
  const mixed = find.rankResults([
    [{ name: 's0', source: 'o/s0', installs: 5000 }, { name: 's1', source: 'o/s1', installs: 4000 }, { name: 's2', source: 'o/s2', installs: 3000 }],
    [{ name: 'g0', source: 'o/g0', installs: 200000, stars: true }]
  ], new Set());
  t.check('rank: github stars normalized — g0 stays in the relevance-0 band (top 2), not #1 by raw count',
    mixed.findIndex(function (r) { return r.name === 'g0'; }) <= 1 &&
    mixed.findIndex(function (r) { return r.name === 's1'; }) >= 2);
  t.check('rank: internal _fields stripped from results', Object.keys(ranked[0]).every(function (k) { return k[0] !== '_'; }));

  // self-update --check detects the install method without running anything
  let suCode = 0;
  const suText = await t.capture(function () { suCode = cli.cmdSelfUpdate(cli.parseArgs(['self-update', '--check'])); });
  t.check('self-update --check detects install method (no action)', suCode === 0 && /(pull --ff-only|npm install -g @h0tp\/shucky|via npx)/.test(suText));

  t.finish('COVERAGE TESTS');
})();

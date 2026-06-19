'use strict';

// Zero-dependency tests for the Phase-2 manager: registry, remove, update, find, install --list.
// No real network — find is exercised with localOnly + a local list manifest.

const fs = require('fs');
const os = require('os');
const path = require('path');
const registry = require('../lib/registry');
const place = require('../lib/place');
const lock = require('../lib/lock');
const find = require('../lib/find');
const cli = require('../lib/cli');

const fixtures = path.join(__dirname, '..', 'fixtures');
let failures = 0;
function check(name, cond) { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) failures++; }
function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* ignore */ } }

function quiet(fn) {
  const l = console.log, e = console.error;
  console.log = function () {}; console.error = function () {};
  try { return fn(); } finally { console.log = l; console.error = e; }
}
async function quietAsync(fn) {
  const l = console.log, e = console.error;
  console.log = function () {}; console.error = function () {};
  try { return await fn(); } finally { console.log = l; console.error = e; }
}

// ---- registry (sync) -----------------------------------------------------
(function () {
  const t = tmp('shucky-reg-');
  check('inferType owner/repo → repo', registry.inferType('a/b') === 'repo');
  check('inferType .json → list (local + remote)', registry.inferType('https://x/y.json') === 'list' && registry.inferType('/abs/list.json') === 'list');
  check('inferType https host → registry', registry.inferType('https://bun.com') === 'registry');
  registry.addSource('project', 'anthropics/skills', { trust: 'trusted' }, t);
  registry.addSource('project', 'https://hub.example', { name: 'hub' }, t);
  const ls = registry.listSources(t);
  check('addSource + listSources', ls.length === 2);
  check('deriveName owner/repo → owner-repo', ls.find(function (s) { return s.spec === 'anthropics/skills'; }).name === 'anthropics-skills');
  check('trust recorded', ls.find(function (s) { return s.name === 'anthropics-skills'; }).trust === 'trusted');
  check('registry type inferred', ls.find(function (s) { return s.name === 'hub'; }).type === 'registry');
  check('trustedOwners includes anthropics', registry.trustedOwners(t).indexOf('anthropics') !== -1);
  check('getSource', registry.getSource('hub', t).name === 'hub');
  check('removeSource', registry.removeSource('project', 'hub', t) && registry.listSources(t).length === 1);
  rmrf(t);
})();

// ---- unplace / remove (sync) ---------------------------------------------
(function () {
  const t = tmp('shucky-rm-');
  const proj = path.join(t, 'p'); fs.mkdirSync(proj, { recursive: true });
  place.placeSkill(path.join(fixtures, 'benign-example'), 'My Skill', ['claude-code', 'cursor'], { scope: 'project', cwd: proj, forceCreate: true });
  const canon = path.join(proj, '.agents/skills/my-skill');
  const cl = path.join(proj, '.claude/skills/my-skill');
  check('pre-remove: canonical + agent present', fs.existsSync(canon) && fs.existsSync(cl));
  const res = place.unplaceSkill('My Skill', ['claude-code', 'cursor'], { scope: 'project', cwd: proj });
  check('unplaceSkill removes canonical + agent dirs', !fs.existsSync(canon) && !fs.existsSync(cl) && res.removed.length >= 2);
  rmrf(t);
})();

// ---- per-command help (sync) ---------------------------------------------
(function () {
  const cmds = ['install', 'scan', 'find', 'list', 'remove', 'update', 'source', 'approve'];
  let allHaveHelp = true;
  for (const c of cmds) {
    const h = cli.helpFor(c);
    if (h === cli.HELP || h.indexOf('Usage:') === -1) allHaveHelp = false;
  }
  check('every command has its own --help (Usage + not the global blob)', allHaveHelp);
  check('help aliases resolve (i/add, search, ls, rm, upgrade)',
    cli.helpFor('i') === cli.helpFor('install') &&
    cli.helpFor('add') === cli.helpFor('install') &&
    cli.helpFor('search') === cli.helpFor('find') &&
    cli.helpFor('ls') === cli.helpFor('list') &&
    cli.helpFor('rm') === cli.helpFor('remove') &&
    cli.helpFor('upgrade') === cli.helpFor('update'));
  check('unknown/empty command → global help', cli.helpFor('bogus') === cli.HELP && cli.helpFor(undefined) === cli.HELP);
  check('source help documents add/list/remove subcommands',
    /\badd\b/.test(cli.helpFor('source')) && /\bremove\b/.test(cli.helpFor('source')) && /\blist\b/.test(cli.helpFor('source')));
})();

// ---- async: resolveList, find, install --list, update, source cmd --------
async function asyncSuite() {
  // resolveList — both manifest shapes (local files)
  const t = tmp('shucky-rl-');
  const m1 = path.join(t, 'm1.json'); fs.writeFileSync(m1, JSON.stringify(['a/b@one', 'c/d']));
  const m2 = path.join(t, 'm2.json'); fs.writeFileSync(m2, JSON.stringify({ skills: [{ source: 'e/f', skill: 'two' }, { source: 'g/h' }] }));
  check('resolveList array form', (await registry.resolveList(m1, t)).join(',') === 'a/b@one,c/d');
  check('resolveList object form', (await registry.resolveList(m2, t)).join(',') === 'e/f@two,g/h');
  rmrf(t);

  // find — localOnly over a registered list source (no network)
  const ft = tmp('shucky-find-');
  const man = path.join(ft, 'list.json'); fs.writeFileSync(man, JSON.stringify(['anthropics/skills@pdf', 'foo/bar@baz']));
  registry.addSource('project', man, { name: 'mylist', type: 'list' }, ft);
  const out = await find.findSkills('pdf', { cwd: ft, localOnly: true });
  check('find localOnly skips skills.sh, searches registered', out.searched.indexOf('skills.sh') === -1 && out.searched.indexOf('mylist') !== -1);
  check('find filters list by query', out.results.length === 1 && out.results[0].install === 'anthropics/skills@pdf');
  check('find annotates trusted owner', out.results[0].trust === 'trusted');
  rmrf(ft);

  // install --list — installs each local member, each scanned
  const li = tmp('shucky-li-');
  fs.writeFileSync(path.join(li, 'bundle.json'), JSON.stringify([path.join(fixtures, 'benign-example')]));
  const liCode = await quietAsync(function () {
    const prev = process.cwd();
    return Promise.resolve().then(function () { process.chdir(li); return cli.cmdInstall(cli.parseArgs(['install', '--list', path.join(li, 'bundle.json'), '--agent', 'universal'])); })
      .then(function (c) { try { process.chdir(prev); } catch (e) {} return c; });
  });
  check('install --list installs members (scanned)', liCode === 0 && lock.listSkills('project', li).length === 1 && !!lock.getSkill('project', 'changelog-formatter', li));
  rmrf(li);

  // update — local-source skill is reported not-auto-updatable, exit 0, left intact
  const up = tmp('shucky-up-');
  lock.addSkill('project', 'localskill', { source: null, sourceType: 'local', ref: null, verdict: 'pass', agents: [] }, up);
  const upCode = await quietAsync(function () {
    const prev = process.cwd();
    return Promise.resolve().then(function () { process.chdir(up); return cli.cmdUpdate(cli.parseArgs(['update'])); })
      .then(function (c) { try { process.chdir(prev); } catch (e) {} return c; });
  });
  check('update skips local source (exit 0, intact)', upCode === 0 && !!lock.getSkill('project', 'localskill', up));
  rmrf(up);

  // source command (cli) — add + remove return 0 and mutate the sources file
  const sc = tmp('shucky-sc-');
  const codes = quiet(function () {
    const prev = process.cwd();
    process.chdir(sc);
    const add = cli.cmdSource(cli.parseArgs(['source', 'add', 'anthropics/skills', '--trust', 'trusted']));
    const present = registry.listSources(sc).length === 1;
    const rm = cli.cmdSource(cli.parseArgs(['source', 'remove', 'anthropics-skills']));
    try { process.chdir(prev); } catch (e) {}
    return { add: add, present: present, rm: rm, gone: registry.listSources(sc).length === 0 };
  });
  check('cmdSource add/remove work', codes.add === 0 && codes.present && codes.rm === 0 && codes.gone);
  rmrf(sc);
}

asyncSuite().then(function () {
  console.log('\n' + (failures === 0 ? 'ALL MANAGER TESTS PASSED' : (failures + ' MANAGER TEST(S) FAILED')));
  process.exit(failures ? 1 : 0);
}).catch(function (e) {
  console.error('test harness error: ' + (e && e.stack || e));
  process.exit(1);
});

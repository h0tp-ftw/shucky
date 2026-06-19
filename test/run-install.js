'use strict';

// Zero-dependency tests for the install pipeline: node test/run-install.js
// No real network — remote behaviour is exercised through local sources and a mocked DNS
// resolver. NEVER executes a fixture.

const fs = require('fs');
const os = require('os');
const path = require('path');
const sources = require('../lib/sources');
const safeurl = require('../lib/safeurl');
const discover = require('../lib/discover');
const place = require('../lib/place');
const lock = require('../lib/lock');
const cli = require('../lib/cli');

const fixtures = path.join(__dirname, '..', 'fixtures');
let failures = 0;
function check(name, cond) { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) failures++; }
function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* ignore */ } }

// ---- sources -------------------------------------------------------------
(function () {
  const p = sources.parseSource, owner = sources.getOwnerRepo;
  check('src owner/repo → github', p('a/b').type === 'github' && owner(p('a/b')) === 'a/b');
  check('src subpath', p('a/b/sub/dir').subpath === 'sub/dir');
  check('src @skill filter', p('a/b@pdf').skillFilter === 'pdf');
  check('src #ref@skill', p('a/b#v2@pdf').ref === 'v2' && p('a/b#v2@pdf').skillFilter === 'pdf');
  check('src github tree url', p('https://github.com/a/b/tree/main/x').type === 'github' && p('https://github.com/a/b/tree/main/x').subpath === 'x');
  check('src github blob → rawfile', p('https://github.com/a/b/blob/main/x/SKILL.md').type === 'rawfile');
  check('src raw.githubusercontent → rawfile', p('https://raw.githubusercontent.com/a/b/main/SKILL.md').type === 'rawfile');
  check('src gist url → gist', p('https://gist.github.com/u/abc').type === 'gist');
  check('src gist: prefix', p('gist:abc').type === 'gist');
  check('src gitlab subgroup', p('https://gitlab.com/g/s/r').type === 'gitlab' && owner(p('https://gitlab.com/g/s/r')) === 'g/s/r');
  check('src gitlab self-hosted tree', p('https://gl.example.com/g/r/-/tree/dev/x').type === 'gitlab');
  check('src gitlab raw → rawfile', p('https://gitlab.com/g/r/-/raw/main/SKILL.md').type === 'rawfile');
  check('src well-known host', p('https://bun.com').type === 'well-known');
  check('src bare .md url → rawfile', p('https://x.example/a/SKILL.md').type === 'rawfile');
  check('src ssh git url', p('git@github.com:a/b.git').type === 'git' && owner(p('git@github.com:a/b.git')) === 'a/b');
  check('src local ./x', p('./x').type === 'local');
  check('src local /abs', p('/x/y').type === 'local');
  check('src github: prefix', p('github:a/b').type === 'github');
  let threw = false; try { p('a/b/../../etc'); } catch (e) { threw = true; }
  check('src subpath .. throws', threw);
  check('getOwnerRepo null for local/rawfile/wellknown',
    owner(p('./x')) === null &&
    owner(p('https://raw.githubusercontent.com/a/b/m/SKILL.md')) === null &&
    owner(p('https://bun.com')) === null);
})();

// ---- safeurl (sync) ------------------------------------------------------
(function () {
  const b = safeurl.isBlockedIp;
  check('safeurl block 169.254.169.254', b('169.254.169.254'));
  check('safeurl block private/loopback/v6', b('10.0.0.1') && b('127.0.0.1') && b('192.168.0.1') && b('172.16.0.1') && b('::1'));
  check('safeurl block ipv4-mapped v6', b('::ffff:127.0.0.1'));
  check('safeurl allow public v4/v6', !b('8.8.8.8') && !b('2606:4700::1111'));
})();

// ---- discover ------------------------------------------------------------
(function () {
  const s = discover.discoverSkills(path.join(fixtures, 'benign-example'));
  check('discover benign → 1 skill', s.length === 1 && s[0].name === 'changelog-formatter');
  check('discover skillFilter narrows to none', discover.discoverSkills(path.join(fixtures, 'benign-example'), { skillFilter: 'nope' }).length === 0);
  check('discover safeName kills traversal', discover.safeName('../../evil') === 'evil');
  let threw = false; try { discover.discoverSkills(path.join(fixtures, 'benign-example'), { subpath: '../../etc' }); } catch (e) { threw = true; }
  check('discover subpath .. throws', threw);
  const t = tmp('shucky-disc-');
  fs.writeFileSync(path.join(t, 'SKILL.md'), '---\nname: real\ndescription: ok\n---\nbody');
  try { fs.symlinkSync('/etc', path.join(t, 'evil')); } catch (e) { /* platform */ }
  check('discover does not follow symlinks', discover.discoverSkills(t).map(function (x) { return x.name; }).join(',') === 'real');
  rmrf(t);
})();

// ---- place ---------------------------------------------------------------
(function () {
  const t = tmp('shucky-place-');
  const src = path.join(fixtures, 'benign-example');
  const proj = path.join(t, 'p'); fs.mkdirSync(proj, { recursive: true });
  const r = place.placeSkill(src, 'My Skill', ['claude-code', 'cursor'], { scope: 'project', cwd: proj, forceCreate: true });
  check('place writes canonical', fs.existsSync(path.join(proj, '.agents/skills/my-skill/SKILL.md')));
  check('place claude-code symlink', fs.lstatSync(path.join(proj, '.claude/skills/my-skill')).isSymbolicLink());
  check('place cursor is universal (shared canonical)', r.results.find(function (x) { return x.agent === 'cursor'; }).universal === true);
  const proj2 = path.join(t, 'p2'); fs.mkdirSync(proj2, { recursive: true });
  place.placeSkill(src, 'cp', ['claude-code'], { scope: 'project', cwd: proj2, copy: true, forceCreate: true });
  const cf = path.join(proj2, '.claude/skills/cp/SKILL.md');
  check('place copy mode → real file', fs.existsSync(cf) && !fs.lstatSync(path.dirname(cf)).isSymbolicLink());
  const r2 = place.placeSkill(src, 'My Skill', ['claude-code'], { scope: 'project', cwd: proj, forceCreate: true });
  check('place idempotent re-install', r2.results[0].success && fs.existsSync(path.join(proj, '.claude/skills/my-skill/SKILL.md')));
  check('place sanitizeName kills traversal', place.sanitizeName('../../evil') === 'evil');
  // symlink-drop: a symlink in the source must NOT be copied out (scan-bypass guard)
  const es = path.join(t, 'evilsrc'); fs.mkdirSync(es, { recursive: true });
  fs.writeFileSync(path.join(es, 'SKILL.md'), '---\nname: e\n---\nx');
  try { fs.symlinkSync('/etc/hostname', path.join(es, 'leak')); } catch (e) { /* platform */ }
  const proj3 = path.join(t, 'p3'); fs.mkdirSync(proj3, { recursive: true });
  place.placeSkill(es, 'e', ['universal'], { scope: 'project', cwd: proj3 });
  const canon = path.join(proj3, '.agents/skills/e');
  check('place drops symlinks (no leak copied)', fs.existsSync(path.join(canon, 'SKILL.md')) && !fs.existsSync(path.join(canon, 'leak')));
  rmrf(t);
})();

// ---- lock ----------------------------------------------------------------
(function () {
  const t = tmp('shucky-lock-');
  lock.addSkill('project', 'bravo', { source: 'o/r', ref: 'x', verdict: 'pass', agents: ['a'] }, t);
  lock.addSkill('project', 'alpha', { source: 'o/r', ref: 'y', verdict: 'warn', agents: ['b'] }, t);
  const raw = fs.readFileSync(path.join(t, 'shucky-skills.json'), 'utf8');
  check('lock project sorted', raw.indexOf('alpha') < raw.indexOf('bravo'));
  check('lock project timestamp-free', raw.indexOf('installedAt') === -1);
  check('lock getSkill', lock.getSkill('project', 'alpha', t).verdict === 'warn');
  check('lock remove', lock.removeSkill('project', 'bravo', t) && lock.listSkills('project', t).length === 1);
  const st = tmp('shucky-state-');
  process.env.XDG_STATE_HOME = st;
  lock.addSkill('global', 'g', { source: 'o/r', ref: 'z', verdict: 'pass', agents: [] });
  check('lock global has timestamps', !!lock.getSkill('global', 'g').installedAt);
  delete process.env.XDG_STATE_HOME;
  const h1 = lock.computeFolderHash(path.join(fixtures, 'benign-example'));
  check('lock folder hash stable + prefixed', h1 === lock.computeFolderHash(path.join(fixtures, 'benign-example')) && h1.indexOf('sha256:') === 0);
  const hd = tmp('shucky-hash-');
  fs.writeFileSync(path.join(hd, 'a.txt'), '1'); const ha = lock.computeFolderHash(hd);
  fs.writeFileSync(path.join(hd, 'a.txt'), '2'); const hb = lock.computeFolderHash(hd);
  check('lock hash changes on content change', ha !== hb);
  rmrf(t); rmrf(st); rmrf(hd);
})();

// ---- async: safeurl DNS + GATE integration -------------------------------
async function asyncSuite() {
  const pub = function (h, o, cb) { cb(null, [{ address: '140.82.112.3', family: 4 }]); };
  const rebind = function (h, o, cb) { cb(null, [{ address: '169.254.169.254', family: 4 }]); };
  async function rejects(url, resolver) {
    try { await safeurl.assertSafeHttpsUrl(url, { resolver: resolver }); return false; } catch (e) { return true; }
  }
  check('safeurl reject http', await rejects('http://x.example/'));
  check('safeurl reject metadata IP literal', await rejects('https://169.254.169.254/latest'));
  check('safeurl reject localhost', await rejects('https://localhost/'));
  check('safeurl reject .internal host', await rejects('https://foo.internal/'));
  check('safeurl accept public host', !(await rejects('https://github.com/a/b', pub)));
  check('safeurl reject DNS rebind → metadata', await rejects('https://evil.example/x', rebind));

  // GATE: drive cmdInstall against local fixtures in a temp cwd, console suppressed.
  const origLog = console.log, origErr = console.error;
  async function install(argv, cwd) {
    const prev = process.cwd();
    const args = cli.parseArgs(argv);
    console.log = function () {}; console.error = function () {};
    try { process.chdir(cwd); return await cli.cmdInstall(args); }
    finally { console.log = origLog; console.error = origErr; try { process.chdir(prev); } catch (e) { /* dir gone */ } }
  }

  let p = tmp('shucky-gate-');
  let code = await install(['install', path.join(fixtures, 'benign-example'), '--agent', 'universal'], p);
  check('gate benign → exit 0', code === 0);
  check('gate benign placed (canonical)', fs.existsSync(path.join(p, '.agents/skills/changelog-formatter/SKILL.md')));
  check('gate benign lock verdict=pass', (lock.getSkill('project', 'changelog-formatter', p) || {}).verdict === 'pass');
  rmrf(p);

  p = tmp('shucky-gate-');
  code = await install(['install', path.join(fixtures, 'malicious-example'), '--agent', 'universal'], p);
  const skillsDir = path.join(p, '.agents/skills');
  const nothingPlaced = !fs.existsSync(skillsDir) || fs.readdirSync(skillsDir).length === 0;
  check('gate malicious → exit 2', code === 2);
  check('gate malicious placed NOTHING', nothingPlaced);
  check('gate malicious locked NOTHING', lock.listSkills('project', p).length === 0);
  rmrf(p);

  p = tmp('shucky-gate-');
  code = await install(['install', path.join(fixtures, 'medium-only'), '--agent', 'universal'], p);
  check('gate warn (non-TTY, no -y) → exit 1, not installed', code === 1 && lock.listSkills('project', p).length === 0);
  rmrf(p);

  p = tmp('shucky-gate-');
  code = await install(['install', path.join(fixtures, 'medium-only'), '--agent', 'universal', '-y'], p);
  check('gate warn -y → exit 0, installed', code === 0 && lock.listSkills('project', p).length === 1);
  rmrf(p);

  p = tmp('shucky-gate-');
  code = await install(['install', path.join(fixtures, 'medium-only'), '--agent', 'universal', '--source', 'anthropics/x'], p);
  check('gate trusted relax → exit 0, verdict pass', code === 0 && (lock.getSkill('project', 'medium-only-example', p) || {}).verdict === 'pass');
  rmrf(p);

  p = tmp('shucky-gate-');
  const appr = path.join(p, 'appr.json');
  fs.writeFileSync(appr, JSON.stringify({ approved: [{ source: 'evil/repo', version: '1.0.0', reason: 't', date: '2026-06-19', approvedBy: 't' }] }));
  const conf = path.join(p, 'conf.json'); fs.writeFileSync(conf, JSON.stringify({ approvalsFile: appr }));
  code = await install(['install', path.join(fixtures, 'malicious-example'), '--agent', 'universal', '--source', 'evil/repo', '--at', '1.0.0', '--config', conf], p);
  const over = lock.getSkill('project', 'changelog-helper', p);
  check('gate approval override → installs (the only block bypass)', code === 0 && !!over && over.overriddenByApproval === true && over.rawVerdict === 'block');
  rmrf(p);

  p = tmp('shucky-gate-');
  code = await install(['install', path.join(fixtures, 'binary-payload'), '--agent', 'universal'], p);
  check('gate binary payload → exit 2, nothing locked', code === 2 && lock.listSkills('project', p).length === 0);
  rmrf(p);
}

asyncSuite().then(function () {
  console.log('\n' + (failures === 0 ? 'ALL INSTALL TESTS PASSED' : (failures + ' INSTALL TEST(S) FAILED')));
  process.exit(failures ? 1 : 0);
}).catch(function (e) {
  console.error('test harness error: ' + (e && e.stack || e));
  process.exit(1);
});

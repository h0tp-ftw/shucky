'use strict';

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');
const { scanTarget } = require('./scan');
const { addApproval } = require('./approvals');
const report = require('./report');
const { parseSource, getOwnerRepo } = require('./sources');
const { fetchSource } = require('./fetch');
const { discoverSkills } = require('./discover');
const agentsLib = require('./agents');
const { placeSkill } = require('./place');
const lock = require('./lock');

const HELP = [
  'shucky — find, vet, and install agent skills. It shucks every skill before it lands.',
  '',
  'Usage:',
  '  shucky install <source> [options]      fetch → scan → install (alias: add, i)',
  '  shucky scan <path|source> [options]    vet a skill (local path or remote source)',
  '  shucky list [--global] [--json]        list skills shucky installed (alias: ls)',
  '  shucky approve <owner/repo> --at <version|commit> --reason <text> [--by <name>]',
  '',
  'Sources (install/scan accept any of):',
  '  owner/repo[/sub][@skill][#ref]   github   ·   a local ./path or /abs/path',
  '  https://github.com/… (repo, /tree/…, or /blob/…/SKILL.md)   ·   gitlab (incl. self-hosted)',
  '  a git URL (git@…, ssh://…, …​.git)   ·   gist:<id>   ·   a raw SKILL.md URL   ·   a .well-known host',
  '',
  'Install options:',
  '  -g, --global            install for all your agents user-wide (default: this project)',
  '  --scope <project|global>',
  '  -a, --agent <name>      target a specific agent (repeatable; default: auto-detected)',
  '  --all                   target every supported agent',
  '  --skill <name>          only install this skill from a multi-skill source (repeatable)',
  '  --dir <path>            treat <path> as a local source (same as passing it positionally)',
  '  --copy                  copy files instead of symlinking',
  '  -y, --yes               assume yes (installs WARN skills; NEVER installs a BLOCK)',
  '',
  'Scan/shared options:',
  '  --source <owner/repo>   provenance, for trusted-source relaxation',
  '  --at <version|commit>   the version being scanned (enables approval matching)',
  '  --policy <block|warn|report>',
  '  --config <file>         path to a config.json (defaults to packaged config)',
  '  --json                  machine-readable output',
  '  --quiet                 print only the verdict line',
  '',
  'General:  -h, --help   ·   -v, --version',
  '',
  'Exit codes: 0 ok/pass · 1 warn (skipped) · 2 block (refused) · 3 error',
  'A BLOCK is overridable ONLY via `shucky approve` (no --force). shucky never executes a skill.'
].join('\n');

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json' || a === '-j') args.flags.json = true;
    else if (a === '--quiet' || a === '-q') args.flags.quiet = true;
    else if (a === '--config') args.flags.config = argv[++i];
    else if (a === '--policy') args.flags.policy = argv[++i];
    else if (a === '--source') args.flags.source = argv[++i];
    else if (a === '--at') args.flags.at = argv[++i];
    else if (a === '--reason') args.flags.reason = argv[++i];
    else if (a === '--by') args.flags.by = argv[++i];
    else if (a === '-g' || a === '--global') args.flags.global = true;
    else if (a === '--scope') args.flags.scope = argv[++i];
    else if (a === '-a' || a === '--agent') { (args.flags.agent = args.flags.agent || []).push(argv[++i]); }
    else if (a === '--skill') { (args.flags.skill = args.flags.skill || []).push(argv[++i]); }
    else if (a === '--all') args.flags.all = true;
    else if (a === '--dir') args.flags.dir = argv[++i];
    else if (a === '--copy') args.flags.copy = true;
    else if (a === '-y' || a === '--yes') args.flags.yes = true;
    else if (a === '--list') args.flags.list = argv[++i];
    else if (a === '-h' || a === '--help') args.flags.help = true;
    else if (a === '-v' || a === '--version') args.flags.version = true;
    else args._.push(a);
  }
  return args;
}

function dropUndef(o) {
  const r = {};
  for (const k in o) if (o[k] !== undefined && o[k] !== null) r[k] = o[k];
  return r;
}

function scanOverrides(args) {
  const o = {};
  if (args.flags.policy) o.policy = args.flags.policy;
  if (args.flags.source) o.source = args.flags.source;
  if (args.flags.at) o.version = args.flags.at;
  return o;
}

// ---- scan (now accepts remote sources too) -------------------------------

async function cmdScan(args) {
  const target = args._[1];
  if (!target) { console.error('scan: missing <path|source>'); return 3; }

  let parsed;
  try { parsed = parseSource(target); }
  catch (e) { console.error('scan: ' + e.message); return 3; }

  // Local path → scan in place (original behavior).
  if (parsed.type === 'local') {
    const config = loadConfig(args.flags.config, scanOverrides(args));
    let result;
    try { result = scanTarget(path.resolve(target), config); }
    catch (err) { console.error('scan error: ' + err.message); return 3; }
    return emitScan(result, config, args);
  }

  // Remote source → fetch into a temp dir, scan, clean up.
  let fetched;
  try { fetched = await fetchSource(parsed, {}); }
  catch (e) { console.error('scan: fetch failed — ' + e.message); return 3; }
  try {
    const overrides = dropUndef(Object.assign({ source: getOwnerRepo(parsed), version: fetched.ref }, scanOverrides(args)));
    const config = loadConfig(args.flags.config, overrides);
    const result = scanTarget(fetched.dir, config);
    result.target = getOwnerRepo(parsed) || parsed.url;
    return emitScan(result, config, args);
  } catch (err) {
    console.error('scan error: ' + err.message);
    return 3;
  } finally {
    if (fetched && fetched.cleanup) fetched.cleanup();
  }
}

function emitScan(result, config, args) {
  if (args.flags.json) console.log(report.json(result));
  else if (args.flags.quiet) console.log('shucky: ' + result.verdict.toUpperCase() + ' (' + result.findings.length + ' findings)');
  else console.log(report.human(result));
  if (config.policy === 'report') return 0;
  return result.verdict === 'block' ? 2 : (result.verdict === 'warn' ? 1 : 0);
}

// ---- install -------------------------------------------------------------

function promptYesNo(question) {
  try {
    process.stdout.write(question + ' [y/N] ');
    const buf = Buffer.alloc(256);
    const n = fs.readSync(0, buf, 0, 256, null);
    const ans = buf.toString('utf8', 0, n).trim().toLowerCase();
    return ans === 'y' || ans === 'yes';
  } catch (e) { return false; }
}

// proceed | skip | abort — reuses the scan verdict (which already folds in approvals + relax).
function gateDecision(result, flags, config) {
  const v = result.verdict;
  if (v === 'block') return 'abort';        // only `shucky approve` can lift this
  if (v === 'pass') return 'proceed';
  // warn:
  if (config && config.policy === 'report') return 'proceed';
  if (flags.yes) return 'proceed';
  if (process.stdin.isTTY && promptYesNo('  install this WARN skill anyway?')) return 'proceed';
  return 'skip';
}

function resolveAgentList(flags) {
  if (flags.all) return Object.keys(agentsLib.agents).filter(function (t) { return t !== 'universal'; });
  if (flags.agent && flags.agent.length) return flags.agent;
  const detected = agentsLib.detectInstalledAgents();
  return detected.length ? detected : ['universal'];
}

async function cmdInstall(args) {
  const input = args.flags.dir || args._[1];
  if (!input) { console.error('install: missing <source>'); return 3; }

  let parsed;
  try { parsed = parseSource(input); }
  catch (e) { console.error('install: ' + e.message); return 3; }

  const scope = (args.flags.global || args.flags.scope === 'global') ? 'global' : 'project';
  const agentList = resolveAgentList(args);
  const forceCreate = !!(args.flags.agent && args.flags.agent.length) || !!args.flags.all;
  // --source lets the user assert provenance (trust relax) for sources without an intrinsic
  // owner/repo (local, rawfile, well-known). Otherwise we derive it from the source itself.
  const ownerRepo = args.flags.source || getOwnerRepo(parsed);
  const cwd = process.cwd();

  let fetched;
  try { fetched = await fetchSource(parsed, {}); }
  catch (e) { console.error('install: fetch failed — ' + e.message); return 3; }
  // --at lets the user pin a version for approval-matching when the source has no resolved SHA.
  const effectiveVersion = args.flags.at || fetched.ref || null;

  let worst = 0;
  const summary = [];
  const jsonOut = [];
  try {
    let skills;
    try { skills = discoverSkills(fetched.dir, { subpath: parsed.subpath, skillFilter: parsed.skillFilter }); }
    catch (e) { console.error('install: ' + e.message); return 3; }

    if (args.flags.skill && args.flags.skill.length) {
      const want = new Set(args.flags.skill.map(function (s) { return String(s).toLowerCase(); }));
      skills = skills.filter(function (s) { return want.has(s.name.toLowerCase()) || want.has(path.basename(s.dir).toLowerCase()); });
    }
    if (!skills.length) { console.error('install: no installable SKILL.md found in ' + input); return 3; }

    const config = loadConfig(args.flags.config, dropUndef({ source: ownerRepo, version: effectiveVersion, policy: args.flags.policy }));

    for (const sk of skills) {
      const result = scanTarget(sk.dir, config);
      result.target = sk.name + (ownerRepo ? ' (' + ownerRepo + ')' : '');
      const decision = gateDecision(result, args.flags, config);

      if (!args.flags.json) console.log(report.human(result) + '\n');

      if (decision !== 'proceed') {
        worst = Math.max(worst, decision === 'abort' ? 2 : 1);
        if (decision === 'abort' && !args.flags.quiet) {
          let msg = '✋ ' + sk.name + ': BLOCKED — not installed.';
          if (ownerRepo && effectiveVersion) {
            msg += '\n   to override (only after a human review): shucky approve ' + ownerRepo + ' --at ' + effectiveVersion + ' --reason "…"';
          } else {
            msg += '\n   review the findings above. (remote owner/repo sources can be overridden via `shucky approve` once vetted.)';
          }
          console.error(msg);
        } else if (decision === 'skip' && !args.flags.quiet) {
          console.error('⚠ ' + sk.name + ': WARN — skipped (re-run with -y to install).');
        }
        summary.push({ skill: sk.name, verdict: result.verdict, installed: false });
        jsonOut.push({ skill: sk.name, verdict: result.verdict, installed: false });
        continue;
      }

      let placement;
      try {
        placement = placeSkill(sk.dir, sk.name, agentList, { scope: scope, copy: args.flags.copy, cwd: cwd, forceCreate: forceCreate });
      } catch (e) {
        worst = Math.max(worst, 3);
        console.error('install: placement failed for ' + sk.name + ' — ' + e.message);
        summary.push({ skill: sk.name, verdict: result.verdict, installed: false, error: e.message });
        continue;
      }

      const placedAgents = placement.results.filter(function (r) { return r.success; }).map(function (r) { return r.agent; });
      lock.addSkill(scope, placement.name, {
        source: ownerRepo || (parsed.type === 'local' ? null : parsed.url),
        sourceType: parsed.type,
        sourceUrl: parsed.url,
        ref: effectiveVersion,
        skillPath: path.relative(fetched.dir, sk.skillMdPath) || 'SKILL.md',
        hash: lock.computeFolderHash(sk.dir),
        verdict: result.verdict,
        rawVerdict: result.rawVerdict,
        overriddenByApproval: !!result.overriddenByApproval,
        agents: placedAgents
      }, cwd);

      summary.push({ skill: placement.name, verdict: result.verdict, installed: true, placement: placement });
      jsonOut.push({ skill: placement.name, verdict: result.verdict, installed: true, scope: scope, agents: placedAgents });
    }
  } finally {
    if (fetched && fetched.cleanup) fetched.cleanup();
  }

  if (args.flags.json) console.log(JSON.stringify({ scope: scope, skills: jsonOut }, null, 2));
  else printInstallSummary(summary, scope);

  if (args.flags.policy === 'report') return 0;
  return worst;
}

function printInstallSummary(summary, scope) {
  const installed = summary.filter(function (s) { return s.installed; });
  const failed = summary.filter(function (s) { return !s.installed; });
  console.log('');
  if (installed.length) {
    console.log('🦪 installed (' + scope + ' scope):');
    for (const s of installed) {
      const placed = s.placement ? s.placement.results.filter(function (r) { return r.success && !r.skipped; }).map(function (r) { return r.agent; }) : [];
      console.log('   ✓ ' + s.skill + '  [' + s.verdict + ']  → ' + (placed.length ? placed.join(', ') : '.agents/skills (canonical)'));
    }
  }
  for (const s of failed) {
    console.log('   ✗ ' + s.skill + '  [' + s.verdict + ']  not installed');
  }
}

// ---- list ----------------------------------------------------------------

function cmdList(args) {
  const cwd = process.cwd();
  const scopes = (args.flags.global || args.flags.scope === 'global') ? ['global']
    : (args.flags.scope === 'project') ? ['project'] : ['project', 'global'];
  const rows = [];
  for (const sc of scopes) for (const s of lock.listSkills(sc, cwd)) rows.push(Object.assign({ scope: sc }, s));

  if (args.flags.json) { console.log(JSON.stringify(rows, null, 2)); return 0; }
  if (!rows.length) { console.log('no skills installed by shucky yet. try:  shucky install <source>'); return 0; }
  for (const sc of scopes) {
    const items = rows.filter(function (s) { return s.scope === sc; });
    if (!items.length) continue;
    console.log(sc + ':');
    for (const s of items) {
      console.log('  ' + s.name + '  [' + (s.verdict || '?') + ']  ' +
        (s.source || s.sourceUrl || '') + (s.ref ? '@' + String(s.ref).slice(0, 12) : '') +
        '  → ' + ((s.agents || []).join(', ') || '(canonical)'));
    }
  }
  return 0;
}

// ---- approve (unchanged) -------------------------------------------------

function cmdApprove(args) {
  const source = args._[1];
  if (!source) { console.error('approve: missing <owner/repo>'); return 3; }
  const version = args.flags.at;
  if (!version) { console.error('approve: missing --at <version|commit>'); return 3; }

  const config = loadConfig(args.flags.config, {});
  if (config.allowOverride === false) { console.error('approve: overrides are disabled (allowOverride=false)'); return 3; }
  if (config.overrideRequiresReason && !args.flags.reason) { console.error('approve: --reason <text> is required'); return 3; }

  const entry = {
    source: source,
    version: version,
    reason: args.flags.reason || '',
    date: new Date().toISOString().slice(0, 10),
    approvedBy: args.flags.by || 'user'
  };
  let p;
  try { p = addApproval(config, entry); }
  catch (err) { console.error('approve error: ' + err.message); return 3; }
  console.log('recorded approval: ' + source + '@' + version + '  →  ' + p);
  return 0;
}

// ---- dispatch ------------------------------------------------------------

async function runCli(argv) {
  const args = parseArgs(argv);

  if (args.flags.version && args._.length === 0) {
    console.log(require('../package.json').version);
    return 0;
  }
  if (args.flags.help || args._.length === 0) {
    console.log(HELP);
    return 0;
  }

  const cmd = args._[0];
  if (cmd === 'scan') return cmdScan(args);
  if (cmd === 'install' || cmd === 'add' || cmd === 'i') return cmdInstall(args);
  if (cmd === 'list' || cmd === 'ls') return cmdList(args);
  if (cmd === 'approve') return cmdApprove(args);

  console.error('unknown command: ' + cmd);
  console.log(HELP);
  return 3;
}

module.exports = { runCli, parseArgs, HELP, cmdInstall, cmdScan, cmdList, gateDecision };

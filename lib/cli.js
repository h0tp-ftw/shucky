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
const { placeSkill, unplaceSkill } = require('./place');
const lock = require('./lock');
const registry = require('./registry');

const HELP = [
  'shucky — find, vet, and install agent skills. It shucks every skill before it lands.',
  '',
  'Usage:',
  '  shucky install <source> [options]      fetch → scan → install (alias: add, i)',
  '  shucky scan <path|source> [options]    vet a skill (local path or remote source)',
  '  shucky find [query] [--github]         search skills.sh + your sources (+GitHub) (alias: search)',
  '  shucky list [--global] [--json]        list skills shucky installed (alias: ls)',
  '  shucky remove <name> [--global]        uninstall a skill (alias: rm)',
  '  shucky update [name] [--global]        re-fetch + RE-SCAN + re-place installed skills',
  '  shucky self-update [--check]           update shucky itself (git pull / npm -g)',
  '  shucky source add|list|remove <spec>   manage the sources registry + curated lists',
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
  '  --list <name>           install a registered curated list (a bundle of skills)',
  '  --dir <path>            treat <path> as a local source (same as passing it positionally)',
  '  --copy                  copy files instead of symlinking',
  '  -y, --yes               assume yes (installs WARN skills; NEVER installs a BLOCK)',
  '',
  'source add options:  --name <n>  --trust <trusted|community>  --type <repo|registry|list>',
  '',
  'Scan/shared options:',
  '  --source <owner/repo>   provenance, for trusted-source relaxation',
  '  --at <version|commit>   the version being scanned (enables approval matching)',
  '  --policy <block|warn|report>  ·  --config <file>  ·  --json  ·  --quiet',
  '',
  'General:  -h, --help   ·   -v, --version',
  'Per-command help:  shucky <command> --help   (e.g. shucky install --help)',
  '',
  'Exit codes: 0 ok/pass · 1 warn (skipped) · 2 block (refused) · 3 error',
  'A BLOCK is overridable ONLY via `shucky approve` (no --force). shucky never executes a skill.'
].join('\n');

// Per-command help — printed by `shucky <command> --help`.
const COMMAND_HELP = {
  install: [
    'shucky install <source> — fetch a skill, SCAN it, and install it only if it passes.',
    'Aliases: add, i',
    '',
    'Usage:',
    '  shucky install <source> [options]',
    '  shucky install --list <name> [options]      install a registered curated list (a bundle)',
    '',
    'Argument:',
    '  <source>   where the skill comes from — any of:',
    '               owner/repo[/subpath][@skill][#ref]      GitHub shorthand',
    '               https://github.com/… (repo · /tree/… · /blob/…/SKILL.md)',
    '               gitlab URLs (incl. self-hosted) · any git URL (git@… · ssh://… · ….git)',
    '               gist:<id> · a raw SKILL.md URL · a .well-known host',
    '               a .tar.gz / .tgz / .zip archive (remote URL or local file)',
    '               a local ./path or /abs/path',
    '',
    'Options:',
    '  -g, --global              install user-wide for all agents (default: this project)',
    '      --scope <p>           project | global',
    '  -a, --agent <name>        target a specific agent, repeatable (default: auto-detected)',
    '      --all                 target every supported agent (~71)',
    '      --skill <name>        install only this skill from a multi-skill source (repeatable)',
    '      --list <name>         install a registered curated list instead of a single source',
    '      --dir <path>          treat <path> as a local source (same as the positional arg)',
    '      --copy                copy files instead of symlinking',
    '  -y, --yes                 assume yes — installs a WARN skill; NEVER installs a BLOCK',
    '      --source <owner/repo> assert provenance for trusted relax (local / raw sources)',
    '      --at <ver|commit>     pin a version for approval-matching',
    '      --policy <p>          block | warn | report   ·   --json   ·   -q, --quiet',
    '',
    'Gate:  PASS installs · WARN installs only with -y (or an interactive yes) · BLOCK installs',
    '       nothing (override only via `shucky approve`).  Exit: 0 ok · 1 warn-skipped · 2 block · 3 error.',
    '',
    'Examples:',
    '  shucky install anthropics/skills@pdf',
    '  shucky install owner/repo --global --agent claude-code --agent cursor',
    '  shucky install ./my-skill --copy',
    '  shucky install https://example.com/bundle.tar.gz',
    '  shucky install --list my-stack'
  ].join('\n'),

  scan: [
    'shucky scan <path|source> — vet a skill and print a block/warn/pass verdict. Installs nothing.',
    '',
    'Usage:',
    '  shucky scan <path|source> [options]',
    '',
    'Argument:',
    '  <path|source>   a local path, OR any remote source `install` accepts (fetched to a temp',
    '                  dir, scanned, then discarded).',
    '',
    'Options:',
    '      --source <owner/repo>   provenance, for trusted-source relax',
    '      --at <ver|commit>       version being scanned (enables approval matching)',
    '      --policy <p>            block | warn | report',
    '      --config <file>         path to a config.json',
    '      --json                  machine-readable evidence pack',
    '  -q, --quiet                 print only the verdict line',
    '',
    'Exit: 0 pass · 1 warn · 2 block · 3 error.',
    '',
    'Examples:',
    '  shucky scan ./some-skill',
    '  shucky scan anthropics/skills@pdf --json',
    '  shucky scan owner/repo --source owner/repo --at v1.2.3'
  ].join('\n'),

  find: [
    'shucky find [query] — search skills.sh + your registered sources. Installs nothing; each',
    'result is install-ready (and is scanned on install). Aliases: search, f, s',
    '',
    'Usage:',
    '  shucky find [query] [options]',
    '',
    'Argument:',
    '  [query]   text to match (optional; omit to browse).',
    '',
    'Options:',
    '      --github       also search GitHub — SKILL.md code search if GITHUB_TOKEN/GH_TOKEN is set,',
    '                     otherwise a repo search filtered to skill/agent repos',
    '      --local        search only your registered sources/lists (skip skills.sh)',
    '      --limit <n>    max results to show (default 25)',
    '      --json         machine-readable results',
    '',
    'Examples:',
    '  shucky find pdf',
    '  shucky find "changelog" --github --limit 10',
    '  shucky find --local'
  ].join('\n'),

  list: [
    'shucky list — list the skills shucky has installed (from its lockfiles). Alias: ls',
    '',
    'Usage:',
    '  shucky list [options]',
    '',
    'Options:',
    '  -g, --global       list global installs only (default: project + global)',
    '      --scope <p>    project | global',
    '      --json         machine-readable',
    '',
    'Examples:',
    '  shucky list',
    '  shucky list --global --json'
  ].join('\n'),

  remove: [
    'shucky remove <name> — uninstall a skill across all agent dirs + prune the lockfile.',
    'Aliases: rm, uninstall',
    '',
    'Usage:',
    '  shucky remove <name> [options]',
    '',
    'Argument:',
    '  <name>   the installed skill name (see `shucky list`).',
    '',
    'Options:',
    '  -g, --global       remove from global scope (default: project + global)',
    '      --scope <p>    project | global',
    '',
    'Examples:',
    '  shucky remove changelog-formatter',
    '  shucky remove pdf --global'
  ].join('\n'),

  update: [
    'shucky update [name] — re-fetch installed skills, RE-SCAN them, and re-place. A skill that',
    'now BLOCKS is left as-is and flagged (never silently reinstalled). Alias: upgrade',
    '',
    'Usage:',
    '  shucky update [name] [options]',
    '',
    'Argument:',
    '  [name]   a specific installed skill (optional; omit to update all).',
    '',
    'Options:',
    '  -g, --global       update global installs only (default: project + global)',
    '      --scope <p>    project | global',
    '',
    'Note: local / raw-file / well-known sources cannot be auto-updated and are skipped.',
    '',
    'Examples:',
    '  shucky update',
    '  shucky update pdf'
  ].join('\n'),

  'self-update': [
    'shucky self-update — update shucky itself (the CLI) to the latest version.',
    '',
    'Usage:',
    '  shucky self-update [--check]',
    '',
    'It detects how shucky was installed and runs the matching update:',
    '  • source / npm-link checkout  →  git pull --ff-only',
    '  • global npm install          →  npm install -g @h0tp/shucky@latest',
    '  • npx (ephemeral)             →  nothing to do; just invoke a newer @version',
    '',
    'Options:',
    '      --check     print what it would run, without doing it',
    '',
    'Note: this updates the shucky CLI itself. To re-fetch + RE-SCAN the skills shucky',
    'installed FOR you, use `shucky update` instead.'
  ].join('\n'),

  source: [
    'shucky source <add|list|remove> — manage the registry of skill sources (repos, registries,',
    'curated lists) that `find` searches and `install --list` installs.',
    '',
    'Usage:',
    '  shucky source add <spec> [--name <n>] [--trust <t>] [--type <t>] [-g]',
    '  shucky source list [--json]',
    '  shucky source remove <name> [-g]',
    '',
    'Subcommands:',
    '  add <spec>      register a source. <spec> = owner/repo, a URL, or a .json list manifest.',
    '  list            show registered sources (project + global).',
    '  remove <name>   unregister a source by name.',
    '',
    'add options:',
    '      --name <n>     override the auto-derived source name',
    '      --trust <t>    trusted | community — "trusted" feeds the relax policy (low/medium)',
    '      --type <t>     repo | registry | list (default: inferred from the spec)',
    '  -g, --global       store in the global registry (default: this project)',
    '',
    'A `list` source points at a .json manifest — ["owner/repo@skill", …] or',
    '{ "skills": [{ "source": "…", "skill": "…" }] } — installable via `install --list <name>`.',
    '',
    'Examples:',
    '  shucky source add anthropics/skills --trust trusted',
    '  shucky source add https://example.com/team.json --name team --type list',
    '  shucky source list',
    '  shucky source remove team'
  ].join('\n'),

  approve: [
    'shucky approve <owner/repo> --at <ver|commit> --reason <text> — log a human override of a',
    'BLOCK, pinned to an exact version/commit, in approved-skills.json. The ONLY way past a BLOCK.',
    '',
    'Usage:',
    '  shucky approve <owner/repo> --at <version|commit> --reason <text> [--by <name>] [--config <file>]',
    '',
    'Argument:',
    '  <owner/repo>   the source whose BLOCK you are overriding.',
    '',
    'Options:',
    '      --at <ver|commit>   REQUIRED — the exact version/commit being approved',
    '      --reason <text>     required (by default) — why it is accepted',
    '      --by <name>         who approved (default: user)',
    '      --config <file>     path to a config.json',
    '',
    'Examples:',
    '  shucky approve owner/repo --at 1.2.3 --reason "reviewed by security"',
    '  shucky approve owner/repo --at deadbeef0123 --reason "vetted" --by alice'
  ].join('\n')
};

const CMD_ALIASES = {
  install: 'install', add: 'install', i: 'install',
  scan: 'scan',
  find: 'find', search: 'find', f: 'find', s: 'find',
  list: 'list', ls: 'list',
  remove: 'remove', rm: 'remove', uninstall: 'remove',
  update: 'update', upgrade: 'update',
  'self-update': 'self-update', selfupdate: 'self-update',
  source: 'source',
  approve: 'approve'
};

// Help for a (possibly aliased) command; falls back to the global overview.
function helpFor(cmd) {
  const canon = CMD_ALIASES[cmd];
  return (canon && COMMAND_HELP[canon]) ? COMMAND_HELP[canon] : HELP;
}

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
    else if (a === '--name') args.flags.name = argv[++i];
    else if (a === '--trust') args.flags.trust = argv[++i];
    else if (a === '--type') args.flags.type = argv[++i];
    else if (a === '--limit') args.flags.limit = argv[++i];
    else if (a === '--local') args.flags.local = true;
    else if (a === '--github') args.flags.github = true;
    else if (a === '--check') args.flags.check = true;
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

function scopesFor(args) {
  if (args.flags.global || args.flags.scope === 'global') return ['global'];
  if (args.flags.scope === 'project') return ['project'];
  return ['project', 'global'];
}

// ---- scan (accepts remote sources too) -----------------------------------

function scanOverrides(args) {
  const o = {};
  if (args.flags.policy) o.policy = args.flags.policy;
  if (args.flags.source) o.source = args.flags.source;
  if (args.flags.at) o.version = args.flags.at;
  return o;
}

async function cmdScan(args) {
  const target = args._[1];
  if (!target) { console.error('scan: missing <path|source>'); return 3; }

  let parsed;
  try { parsed = parseSource(target); }
  catch (e) { console.error('scan: ' + e.message); return 3; }

  if (parsed.type === 'local') {
    const config = loadConfig(args.flags.config, scanOverrides(args));
    let result;
    try { result = scanTarget(path.resolve(target), config); }
    catch (err) { console.error('scan error: ' + err.message); return 3; }
    return emitScan(result, config, args);
  }

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
  // Curated list: resolve to member sources and install each (each independently re-scanned).
  if (args.flags.list) {
    let members;
    try { members = await registry.resolveList(args.flags.list, process.cwd()); }
    catch (e) { console.error('install --list: ' + e.message); return 3; }
    if (!members.length) { console.error('install --list: "' + args.flags.list + '" lists no skills'); return 3; }
    if (!args.flags.quiet) console.log('🦪 installing list "' + args.flags.list + '" — ' + members.length + ' skill(s)\n');
    let worstList = 0;
    for (const m of members) {
      const memberArgs = { _: ['install', m], flags: Object.assign({}, args.flags, { list: undefined, dir: undefined }) };
      worstList = Math.max(worstList, await cmdInstall(memberArgs));
    }
    return worstList;
  }

  const input = args.flags.dir || args._[1];
  if (!input) { console.error('install: missing <source>'); return 3; }

  let parsed;
  try { parsed = parseSource(input); }
  catch (e) { console.error('install: ' + e.message); return 3; }

  const scope = (args.flags.global || args.flags.scope === 'global') ? 'global' : 'project';
  const agentList = resolveAgentList(args.flags);
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
    // Sources the user registered as `trusted` get the same low/medium relax as the built-ins.
    const extraTrusted = registry.trustedOwners(cwd);
    if (extraTrusted.length) config.trustedSources = (config.trustedSources || []).concat(extraTrusted);

    for (const sk of skills) {
      const result = scanTarget(sk.dir, config);
      result.target = sk.name + (ownerRepo ? ' (' + ownerRepo + ')' : '');
      const decision = gateDecision(result, args.flags, config);

      if (!args.flags.json && !args.flags.quiet) console.log(report.human(result) + '\n');

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
        installSource: ownerRepo ? (ownerRepo + '@' + sk.name) : (parsed.type === 'local' ? null : parsed.url),
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
  else if (!args.flags.quiet) printInstallSummary(summary, scope);

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
  const scopes = scopesFor(args);
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

// ---- source registry -----------------------------------------------------

function cmdSource(args) {
  const sub = args._[1];
  const scope = (args.flags.global || args.flags.scope === 'global') ? 'global' : 'project';
  const cwd = process.cwd();

  if (sub === 'add') {
    const spec = args._[2];
    if (!spec) { console.error('source add: missing <spec> (owner/repo, a URL, or a .json list manifest)'); return 3; }
    if (args.flags.trust && args.flags.trust !== 'trusted' && args.flags.trust !== 'community') {
      console.error('source add: --trust must be "trusted" or "community"'); return 3;
    }
    let res;
    try { res = registry.addSource(scope, spec, { name: args.flags.name, trust: args.flags.trust, type: args.flags.type }, cwd); }
    catch (e) { console.error('source add: ' + e.message); return 3; }
    console.log('added source [' + scope + ']: ' + res.entry.name + '  ' + res.entry.type +
      (res.entry.trust ? ' (' + res.entry.trust + ')' : '') + '  → ' + res.entry.spec);
    return 0;
  }

  if (sub === 'remove' || sub === 'rm') {
    const name = args._[2];
    if (!name) { console.error('source remove: missing <name>'); return 3; }
    const ok = registry.removeSource(scope, name, cwd);
    console.log(ok ? 'removed source: ' + name : 'no such source in ' + scope + ' scope: ' + name);
    return ok ? 0 : 3;
  }

  // default / `list`
  const rows = registry.listSources(cwd);
  if (args.flags.json) { console.log(JSON.stringify(rows, null, 2)); return 0; }
  if (!rows.length) { console.log('no sources registered. add one:  shucky source add <owner/repo | url | list.json>'); return 0; }
  for (const s of rows) {
    console.log('  [' + s.scope + '] ' + s.name + '  ' + s.type + (s.trust ? ' (' + s.trust + ')' : '') + '  → ' + s.spec);
  }
  return 0;
}

// ---- remove --------------------------------------------------------------

function cmdRemove(args) {
  const name = args._[1];
  if (!name) { console.error('remove: missing <name>'); return 3; }
  const cwd = process.cwd();
  let removedAny = false;
  for (const scope of scopesFor(args)) {
    const entry = lock.getSkill(scope, name, cwd);
    if (!entry) continue;
    const res = unplaceSkill(name, entry.agents || [], { scope: scope, cwd: cwd });
    lock.removeSkill(scope, name, cwd);
    removedAny = true;
    console.log('removed "' + res.name + '" (' + scope + '): ' + res.removed.length + ' path(s) deleted');
  }
  if (!removedAny) { console.error('remove: "' + name + '" is not installed by shucky'); return 3; }
  return 0;
}

// ---- update (re-fetch → RE-SCAN → re-place) ------------------------------

async function cmdUpdate(args) {
  const cwd = process.cwd();
  const only = args._[1] || null;
  let worst = 0, any = false;
  for (const scope of scopesFor(args)) {
    for (const entry of lock.listSkills(scope, cwd)) {
      if (only && entry.name !== only) continue;
      const sourceStr = entry.installSource || entry.source || entry.sourceUrl;
      if (!sourceStr || ['local', 'rawfile', 'well-known'].indexOf(entry.sourceType) !== -1) {
        console.log('· ' + entry.name + ' (' + scope + '): not auto-updatable (source type ' + (entry.sourceType || 'unknown') + ') — skipped');
        continue;
      }
      any = true;
      const prior = entry.verdict;
      console.log('↻ updating ' + entry.name + ' (' + scope + ') ← ' + sourceStr);
      const memberArgs = {
        _: ['install', sourceStr],
        flags: {
          agent: (entry.agents && entry.agents.length) ? entry.agents.slice() : undefined,
          global: scope === 'global',
          quiet: true
        }
      };
      const code = await cmdInstall(memberArgs);
      worst = Math.max(worst, code);
      if (code === 2) {
        console.log('  ⚠ ' + entry.name + ' now BLOCKS (was ' + prior + ') — left as-is, NOT reinstalled. Run `shucky scan ' + sourceStr + '`.');
      } else {
        const now = lock.getSkill(scope, entry.name, cwd);
        console.log('  ' + entry.name + ': ' + prior + ' → ' + (now ? now.verdict : '?'));
      }
    }
  }
  if (only && !any) { console.error('update: "' + only + '" is not installed (or not auto-updatable)'); return 3; }
  if (!any) console.log('nothing to update.');
  return worst;
}

// ---- self-update (update shucky itself) ----------------------------------

function cmdSelfUpdate(args) {
  const pkgRoot = path.resolve(__dirname, '..');
  const version = require('../package.json').version;
  const check = !!args.flags.check;

  // Running ephemerally via npx — there's nothing installed in place to update.
  if (pkgRoot.indexOf(path.sep + '_npx' + path.sep) !== -1 || pkgRoot.indexOf('/_npx/') !== -1) {
    console.log('shucky ' + version + ' is running via npx (ephemeral) — nothing to update in place.');
    console.log('just invoke a newer pinned version:  npx @h0tp/shucky@<version> <command>');
    return 0;
  }

  let label, cmd, cmdArgs, cwd;
  if (fs.existsSync(path.join(pkgRoot, '.git'))) {
    label = 'source / npm-link checkout (' + pkgRoot + ')';
    cmd = 'git'; cmdArgs = ['-C', pkgRoot, 'pull', '--ff-only']; cwd = pkgRoot;
  } else {
    label = 'global npm install';
    cmd = 'npm'; cmdArgs = ['install', '-g', '@h0tp/shucky@latest'];
  }

  console.log('shucky ' + version + '   ·   installed from: ' + label);
  console.log((check ? '↳ would run:  ' : '↳ running:    ') + cmd + ' ' + cmdArgs.join(' '));
  if (check) return 0;

  try {
    const out = require('child_process').execFileSync(cmd, cmdArgs, { cwd: cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (out && out.trim()) console.log(out.trim());
    console.log('✓ updated — verify with:  shucky --version');
    return 0;
  } catch (e) {
    console.error('self-update failed: ' + ((e.stderr || e.message || '') + '').toString().trim());
    console.error('run it manually:  ' + cmd + ' ' + cmdArgs.join(' '));
    return 3;
  }
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
  const cmd = args._[0];
  if (args.flags.help || args._.length === 0) {
    console.log(helpFor(cmd));
    return 0;
  }

  if (cmd === 'scan') return cmdScan(args);
  if (cmd === 'install' || cmd === 'add' || cmd === 'i') return cmdInstall(args);
  if (cmd === 'list' || cmd === 'ls') return cmdList(args);
  if (cmd === 'source') return cmdSource(args);
  if (cmd === 'remove' || cmd === 'rm' || cmd === 'uninstall') return cmdRemove(args);
  if (cmd === 'update' || cmd === 'upgrade') return cmdUpdate(args);
  if (cmd === 'self-update' || cmd === 'selfupdate') return cmdSelfUpdate(args);
  if (cmd === 'find' || cmd === 'search' || cmd === 'f' || cmd === 's') return cmdFind(args);
  if (cmd === 'approve') return cmdApprove(args);

  console.error('unknown command: ' + cmd);
  console.log(HELP);
  return 3;
}

// cmdFind is defined in find.js wiring (added below via require) — placeholder until Phase-2 find lands.
let cmdFind = function () { console.error('find: not available'); return 3; };
try { cmdFind = require('./find').cmdFind; } catch (e) { /* find.js not present yet */ }

module.exports = { runCli, parseArgs, HELP, helpFor, cmdInstall, cmdScan, cmdList, cmdSource, cmdRemove, cmdUpdate, cmdSelfUpdate, gateDecision };

'use strict';

const path = require('path');
const { loadConfig } = require('./config');
const { scanTarget } = require('./scan');
const { addApproval } = require('./approvals');
const report = require('./report');

const HELP = [
  'shucky — pry open an agent skill and inspect it before you trust it.',
  '',
  'Usage:',
  '  shucky scan <path> [options]',
  '  shucky approve <owner/repo> --at <version|commit> --reason <text> [--by <name>]',
  '',
  'Scan options:',
  '  --source <owner/repo>   provenance, for trusted-source relaxation',
  '  --at <version|commit>   the version being scanned (enables approval matching)',
  '  --policy <block|warn|report>',
  '  --config <file>         path to a config.json (defaults to packaged config)',
  '  --json                  machine-readable output (the evidence pack)',
  '  --quiet                 print only the verdict line',
  '',
  'General:',
  '  -h, --help              show this help',
  '  -v, --version           print shucky version',
  '',
  'Exit codes: 0 pass · 1 warn · 2 block · 3 error',
  'shucky reads files as text and NEVER executes the skill under review.'
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
    else if (a === '-h' || a === '--help') args.flags.help = true;
    else if (a === '-v' || a === '--version') args.flags.version = true;
    else args._.push(a);
  }
  return args;
}

function cmdScan(args) {
  const target = args._[1];
  if (!target) { console.error('scan: missing <path>'); return 3; }

  const overrides = {};
  if (args.flags.policy) overrides.policy = args.flags.policy;
  if (args.flags.source) overrides.source = args.flags.source;
  if (args.flags.at) overrides.version = args.flags.at;
  const config = loadConfig(args.flags.config, overrides);

  let result;
  try { result = scanTarget(path.resolve(target), config); }
  catch (err) { console.error('scan error: ' + err.message); return 3; }

  if (args.flags.json) console.log(report.json(result));
  else if (args.flags.quiet) console.log('shucky: ' + result.verdict.toUpperCase() + ' (' + result.findings.length + ' findings)');
  else console.log(report.human(result));

  if (config.policy === 'report') return 0;
  return result.verdict === 'block' ? 2 : (result.verdict === 'warn' ? 1 : 0);
}

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
  if (cmd === 'approve') return cmdApprove(args);

  console.error('unknown command: ' + cmd);
  console.log(HELP);
  return 3;
}

module.exports = { runCli, parseArgs, HELP };

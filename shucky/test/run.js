'use strict';

// Zero-dependency test runner: node test/run.js
// Scans the bundled fixtures and asserts shucky behaves. NEVER executes fixtures.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../lib/config');
const { scanTarget } = require('../lib/scan');

const fixtures = path.join(__dirname, '..', 'fixtures');
let failures = 0;

function check(name, cond) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name);
  if (!cond) failures++;
}

const cfg = loadConfig();

// --- malicious fixture should be blocked, with the key categories detected ---
const mal = scanTarget(path.join(fixtures, 'malicious-example'), cfg);
check('malicious → block', mal.verdict === 'block');
check('malicious finds secret_access (critical)',
  mal.findings.some(function (f) { return f.ruleId === 'secret_access' && f.severity === 'critical'; }));
check('malicious finds network_exfil',
  mal.findings.some(function (f) { return f.ruleId === 'network_exfil'; }));
check('malicious finds obfuscation',
  mal.findings.some(function (f) { return f.ruleId === 'obfuscation'; }));
check('malicious finds destructive',
  mal.findings.some(function (f) { return f.ruleId === 'destructive'; }));
check('malicious finds prompt_injection (in prose comment)',
  mal.findings.some(function (f) { return f.ruleId === 'prompt_injection'; }));

// --- benign fixture should pass cleanly ---
const ben = scanTarget(path.join(fixtures, 'benign-example'), cfg);
check('benign → pass', ben.verdict === 'pass');
check('benign has zero findings', ben.findings.length === 0);

// --- opaque binary should be flagged and blocked ---
const bin = scanTarget(path.join(fixtures, 'binary-payload'), cfg);
check('binary payload → block', bin.verdict === 'block');
check('binary payload flags the opaque .so',
  bin.findings.some(function (f) { return f.ruleId === 'obfuscation' && /\.so$/.test(f.file); }));

// --- persistence mechanisms should be flagged and blocked ---
const per = scanTarget(path.join(fixtures, 'persistence-example'), cfg);
check('persistence → block', per.verdict === 'block');
check('persistence rule fires (cron / shell-rc)',
  per.findings.some(function (f) { return f.ruleId === 'persistence'; }));

// --- harvested-from-skill-vetter checks: agent state, browser, raw-IP exfil ---
const at = scanTarget(path.join(fixtures, 'agent-targeted'), cfg);
check('agent-targeted → block', at.verdict === 'block');
check('flags agent_state_access (SOUL.md / memory)',
  at.findings.some(function (f) { return f.ruleId === 'agent_state_access'; }));
check('flags browser_session (cookies)',
  at.findings.some(function (f) { return f.ruleId === 'browser_session'; }));
check('flags raw-IP exfil',
  at.findings.some(function (f) { return f.ruleId === 'network_exfil' && /203\.0\.113\.7/.test(f.snippet); }));

// --- medium-only: WARN by default, PASS when trusted (relax) ---
const med = scanTarget(path.join(fixtures, 'medium-only'), loadConfig());
check('medium-only (untrusted) → warn', med.verdict === 'warn');
const medTrusted = scanTarget(path.join(fixtures, 'medium-only'), loadConfig(null, { source: 'anthropics/some-package' }));
check('medium-only (trusted) → pass via relax', medTrusted.verdict === 'pass' && medTrusted.relaxed === true);

// --- a high/critical must STILL block even for a trusted source ---
const malTrusted = scanTarget(path.join(fixtures, 'malicious-example'), loadConfig(null, { source: 'anthropics/evil' }));
check('trusted source still blocks on high/critical', malTrusted.verdict === 'block');

// --- persistent approval override forces pass despite findings (uses a temp file) ---
const tmpApprovals = path.join(os.tmpdir(), 'shucky-test-approvals.json');
fs.writeFileSync(tmpApprovals, JSON.stringify({ approved: [
  { source: 'evil/repo', version: '1.0.0', reason: 'test override', date: '2026-06-18', approvedBy: 'tester' }
] }, null, 2));
const apprCfg = loadConfig(null, { source: 'evil/repo', version: '1.0.0', approvalsFile: tmpApprovals });
const malAppr = scanTarget(path.join(fixtures, 'malicious-example'), apprCfg);
check('approved override → pass despite findings',
  malAppr.verdict === 'pass' && !!malAppr.overriddenByApproval && malAppr.findings.length > 0);
check('approved override preserves rawVerdict (block)', malAppr.rawVerdict === 'block');
try { fs.unlinkSync(tmpApprovals); } catch (e) { /* ignore */ }

console.log('\n' + (failures === 0 ? 'ALL TESTS PASSED' : (failures + ' TEST(S) FAILED')));
process.exit(failures ? 1 : 0);

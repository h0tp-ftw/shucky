'use strict';

function human(result) {
  const out = [];
  out.push('shucky verdict: ' + result.verdict.toUpperCase() + '    (policy: ' + result.policy + ')');
  out.push('target: ' + result.target +
    (result.source ? '  source: ' + result.source : '') +
    (result.version ? '@' + result.version : '') +
    (result.relaxed ? '  [trusted: relaxed]' : ''));
  const c = result.counts;
  out.push('files scanned: ' + result.files.length +
    '   findings: ' + result.findings.length +
    '  (critical ' + (c.critical || 0) + ', high ' + (c.high || 0) +
    ', medium ' + (c.medium || 0) + ', low ' + (c.low || 0) + ')');
  out.push('');

  if (result.findings.length === 0) {
    out.push('  no deterministic red flags found.');
  } else {
    for (const f of result.findings) {
      out.push('  [' + f.severity.toUpperCase() + '] ' + f.ruleId + '  ' + f.file + ':' + f.line);
      if (f.snippet) out.push('      ' + f.snippet);
      out.push('      → ' + f.why);
    }
  }

  out.push('');
  if (result.overriddenByApproval) {
    const a = result.overriddenByApproval;
    out.push('APPROVED OVERRIDE on file: "' + (a.reason || '(no reason)') + '"' +
      ' — by ' + (a.approvedBy || '?') + ' on ' + (a.date || '?'));
    out.push('(deterministic verdict before override was: ' + result.rawVerdict.toUpperCase() + ')');
  }
  if (result.requireAgentReview) {
    out.push('NOTE: this is the deterministic floor only. A human/agent semantic review is');
    out.push('still required (intent vs. description, novel obfuscation, social engineering).');
  }
  if (result.verdict === 'block') {
    out.push('DECISION: BLOCKED — do not install without an explicit, logged override.');
  } else if (result.verdict === 'warn') {
    out.push('DECISION: WARN — review the findings above before trusting this skill.');
  } else {
    out.push('DECISION: PASS' + (result.overriddenByApproval ? ' (by override)' : ' (deterministic)') +
      ' — still do the semantic review before trusting.');
  }
  return out.join('\n');
}

function json(result) {
  return JSON.stringify(result, null, 2);
}

module.exports = { human, json };

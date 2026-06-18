'use strict';

const fs = require('fs');
const path = require('path');
const { RULES, SUSPICIOUS_BINARY_EXT, isProbablyBinary } = require('./rules');
const { loadApprovals, isApproved } = require('./approvals');

const MAX_READ_BYTES = 512 * 1024;
const SEVERITY_RANK = { low: 1, medium: 2, high: 3, critical: 4 };

function severityRank(s) { return SEVERITY_RANK[s] || 0; }

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return out; }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}

function isTrusted(source, trustedSources) {
  if (!source || !Array.isArray(trustedSources)) return false;
  const owner = String(source).toLowerCase().split('/')[0];
  return trustedSources.some(function (t) {
    t = String(t).toLowerCase();
    return owner === t || String(source).toLowerCase() === t;
  });
}

// Apply rules to one file's lines.
// In Markdown, code-execution rules run only INSIDE fenced code blocks; prose is checked for
// prompt_injection only — so a doc that merely *mentions* "curl | sh" in a sentence isn't
// flagged, but a real command in a ``` block is. Non-Markdown files (scripts, etc.) get every
// rule on every line.
function scanLines(rel, lines, isMarkdown, config, findings) {
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isMarkdown && /^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    for (const rule of RULES) {
      if (config.rules && config.rules[rule.id] === false) continue;
      if (isMarkdown && !inFence && rule.id !== 'prompt_injection') continue;
      for (const re of rule.patterns) {
        if (re.test(line)) {
          findings.push({
            ruleId: rule.id, severity: rule.severity, file: rel, line: i + 1,
            snippet: line.trim().slice(0, 160), why: rule.why
          });
          break;
        }
      }
    }
  }
}

// Read files as text and apply rules. NEVER executes anything.
function scanTarget(targetPath, config) {
  const stat = fs.statSync(targetPath);
  const baseDir = stat.isDirectory() ? targetPath : path.dirname(targetPath);
  const files = stat.isDirectory() ? walk(targetPath, []) : [targetPath];

  const findings = [];
  const fileInfos = [];

  for (const f of files) {
    const rel = path.relative(baseDir, f) || path.basename(f);
    const ext = path.extname(f).toLowerCase();
    let size = 0;
    try { size = fs.statSync(f).size; } catch (e) { /* ignore */ }

    let buf;
    try { buf = fs.readFileSync(f); }
    catch (e) { fileInfos.push({ path: rel, size: size, note: 'unreadable' }); continue; }

    if (isProbablyBinary(buf)) {
      fileInfos.push({ path: rel, size: size, binary: true });
      if (SUSPICIOUS_BINARY_EXT.has(ext)) {
        findings.push({
          ruleId: 'obfuscation', severity: 'high', file: rel, line: 0,
          snippet: '<binary ' + ext + '>',
          why: 'Ships compiled/opaque executable code inside a skill.'
        });
      }
      continue;
    }

    if (size > MAX_READ_BYTES) {
      fileInfos.push({ path: rel, size: size, note: 'skipped (>512KB)' });
      continue;
    }

    fileInfos.push({ path: rel, size: size });
    const isMarkdown = ext === '.md' || ext === '.markdown';
    scanLines(rel, buf.toString('utf8').split(/\r?\n/), isMarkdown, config, findings);
  }

  const trusted = isTrusted(config.source, config.trustedSources);
  const relaxed = trusted && config.trustedSourcePolicy === 'relax';

  const counts = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;

  // Severities that count toward the verdict (relax drops low/medium for trusted sources).
  const counting = findings.filter(function (f) {
    if (relaxed && (f.severity === 'low' || f.severity === 'medium')) return false;
    return true;
  }).map(function (f) { return f.severity; });

  const failOn = config.failOn || ['high', 'critical'];
  const warnOn = config.warnOn || ['medium'];
  const hits = function (set) { return set.some(function (s) { return counting.indexOf(s) !== -1; }); };

  let rawVerdict = 'pass';
  if (hits(failOn)) rawVerdict = 'block';
  else if (hits(warnOn)) rawVerdict = 'warn';

  // Persistent override: an exact source@version approved earlier forces pass (a logged override).
  let overriddenByApproval = null;
  if (config.source && config.version) {
    overriddenByApproval = isApproved(loadApprovals(config), config.source, config.version);
  }
  const verdict = overriddenByApproval ? 'pass' : rawVerdict;

  findings.sort(function (a, b) { return severityRank(b.severity) - severityRank(a.severity); });

  return {
    target: targetPath,
    source: config.source || null,
    version: config.version || null,
    trusted: trusted,
    relaxed: relaxed,
    policy: config.policy,
    files: fileInfos,
    findings: findings,
    counts: counts,
    verdict: verdict,
    rawVerdict: rawVerdict,
    overriddenByApproval: overriddenByApproval,
    requireAgentReview: config.requireAgentReview !== false
  };
}

module.exports = { scanTarget, severityRank, isTrusted };

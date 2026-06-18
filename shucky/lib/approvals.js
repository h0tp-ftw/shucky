'use strict';

const fs = require('fs');
const path = require('path');

// Resolve the approvals file. Relative paths are resolved against the package root.
function approvalsPath(config) {
  const file = (config && config.approvalsFile) || 'approved-skills.json';
  return path.isAbsolute(file) ? file : path.join(__dirname, '..', file);
}

function loadApprovals(config) {
  try {
    const raw = JSON.parse(fs.readFileSync(approvalsPath(config), 'utf8'));
    return Array.isArray(raw.approved) ? raw.approved : [];
  } catch (e) {
    return [];
  }
}

// An approval is pinned to an exact source + version/commit.
function isApproved(approvals, source, version) {
  if (!source || !version) return null;
  for (const a of approvals) {
    if (String(a.source).toLowerCase() === String(source).toLowerCase() &&
        String(a.version) === String(version)) {
      return a;
    }
  }
  return null;
}

function addApproval(config, entry) {
  const p = approvalsPath(config);
  let data = { approved: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (Array.isArray(raw.approved)) data = raw;
  } catch (e) { /* start fresh */ }
  // Replace any existing approval for the same source+version.
  data.approved = data.approved.filter(function (a) {
    return !(String(a.source).toLowerCase() === String(entry.source).toLowerCase() &&
             String(a.version) === String(entry.version));
  });
  data.approved.push(entry);
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
  return p;
}

module.exports = { loadApprovals, isApproved, addApproval, approvalsPath };

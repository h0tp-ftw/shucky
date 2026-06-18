'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  policy: 'block',
  failOn: ['high', 'critical'],
  warnOn: ['medium'],
  rules: {
    secret_access: true,
    agent_state_access: true,
    browser_session: true,
    network_exfil: true,
    obfuscation: true,
    destructive: true,
    persistence: true,
    prompt_injection: true,
    supply_chain: true,
    undeclared_capability: true,
    excessive_scope: true
  },
  trustedSources: [
    'anthropics', 'vercel-labs', 'microsoft', 'google', 'stripe',
    'cloudflare', 'netlify', 'huggingface', 'sentry', 'expo', 'figma', 'trailofbits'
  ],
  trustedSourcePolicy: 'relax',
  requireAgentReview: true,
  allowOverride: true,
  overrideRequiresReason: true,
  persistApprovals: true,
  approvalsFile: 'approved-skills.json'
};

// Load config from (in order of precedence, lowest first):
// packaged DEFAULTS -> config.json (packaged or --config) -> env vars -> CLI overrides.
function loadConfig(configPath, overrides) {
  let cfg = Object.assign({}, DEFAULTS);
  const p = configPath || path.join(__dirname, '..', 'config.json');
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    cfg = Object.assign(cfg, raw);
  } catch (e) {
    // No/invalid config file — fall back to defaults silently.
  }
  if (process.env.SHUCKY_POLICY) cfg.policy = process.env.SHUCKY_POLICY;
  if (process.env.SHUCKY_SOURCE) cfg.source = process.env.SHUCKY_SOURCE;
  if (overrides) Object.assign(cfg, overrides);
  return cfg;
}

module.exports = { loadConfig, DEFAULTS };

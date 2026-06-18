'use strict';

// Deterministic red-flag rules — the "floor" a malicious skill cannot talk the
// reviewing agent out of. Patterns are intentionally conservative; the agent's
// semantic review (see SKILL.md) covers intent and novel obfuscation on top.
//
// Some checks (browser_session, agent_state_access, IP-literal URLs) are adapted from
// the community skill-vetter skill (spclaudehome, MIT-0).
//
// Each rule: { id, severity, patterns: [RegExp], why }

const RULES = [
  {
    id: 'secret_access',
    severity: 'critical',
    patterns: [
      /\.ssh\/(id_[a-z0-9]+|authorized_keys|config)/i,
      /\bid_(rsa|ed25519|ecdsa|dsa)\b/i,
      /\.aws\/credentials/i,
      /\.config\/gcloud/i,
      /\.git-credentials\b/i,
      /(^|\s)\.netrc\b/i,
      /(^|[^a-z0-9_.])\.npmrc\b/i,
      /(^|\s)env\s*\|/,                 // `env | ...`  (dumping environment)
      /\bprintenv\b/,
      /169\.254\.169\.254/,             // cloud instance metadata
      /metadata\.google\.internal/i,
      /\/\.env(['"\s)]|$)/              // reading a .env file
    ],
    why: 'Accesses credentials/secrets (keys, env dump, cloud metadata, .env, .netrc).'
  },
  {
    id: 'agent_state_access',
    severity: 'medium',
    patterns: [
      /\b(SOUL|IDENTITY|MEMORY|USER)\.md\b/,
      /\.config\/openclaw/i,
      /\.claude\/(memory|projects)/i
    ],
    why: "Reads the agent's own memory/identity/state files (exfil or tampering risk)."
  },
  {
    id: 'browser_session',
    severity: 'high',
    patterns: [
      /cookies\.sqlite/i,
      /(key4\.db|logins\.json|signons\.sqlite)/i,
      /Login Data\b/,
      /(Chrome|Chromium|Firefox|Edge|Safari|Brave)[^\n]*(Cookies|Profile|User Data)/i
    ],
    why: 'Accesses browser cookies / saved sessions / stored credentials.'
  },
  {
    id: 'obfuscation',
    severity: 'high',
    patterns: [
      /base64\s+(-d|--decode)[^\n]*\|\s*(sh|bash|zsh)/i,
      /\|\s*base64\s+(-d|--decode)/i,
      /\beval\s*[("`$]/,
      /(curl|wget)\b[^\n|]*\|\s*(sh|bash|zsh)/i,   // curl ... | sh
      /\b(gzip|gunzip|xxd|openssl)\b[^\n]*\|\s*(sh|bash)/i,
      /\b(iex|invoke-expression)\b/i,              // PowerShell exec
      /\b(python[0-9.]*|perl|ruby|node)\s+-(e|c)\b[^\n]*(base64|eval|exec\(|atob|fromCharCode|http)/i
    ],
    why: 'Decodes/obfuscates then executes code (classic dropper pattern).'
  },
  {
    id: 'network_exfil',
    severity: 'high',
    patterns: [
      /(curl|wget|nc|ncat)\b[^\n]*(--data|--data-binary|-d\s|@\$|@\/|@~|@-)/i,
      /(curl|wget)\b[^\n]*\$\(/,                   // url/args built from command substitution
      /\|\s*(curl|wget|nc|ncat)\b/i,               // piping data out
      /(curl|wget)\b[^\n]*(webhook|requestbin|interactsh|burpcollab|pipedream|\.ngrok\.)/i,
      /(Invoke-WebRequest|Invoke-RestMethod|iwr|Net\.WebClient|DownloadString|DownloadFile)/i,
      /\b(scp|rsync|sftp)\b[^\n]*@[^\n]*:/i,       // copying data to a remote host
      /https?:\/\/(?!127\.0\.0\.1|0\.0\.0\.0|localhost)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i  // raw-IP URL
    ],
    why: 'Sends data to a remote host (possible exfiltration), incl. raw-IP endpoints.'
  },
  {
    id: 'destructive',
    severity: 'high',
    patterns: [
      /\brm\s+-[rf]{1,2}\b/i,
      /\bmkfs\b/i,
      /\bdd\b[^\n]*\bof=/i,
      /\bchmod\s+-?R?\s*777\b/,
      /:\(\)\s*\{\s*:\|:&\s*\}\s*;:/,              // fork bomb
      /git\s+push\b[^\n]*--force/i,
      /(^|\s)sudo\s/
    ],
    why: 'Destructive or privilege-escalating command.'
  },
  {
    id: 'persistence',
    severity: 'high',
    patterns: [
      /\bcrontab\b/i,
      /\/etc\/(cron|init\.d)|\/Library\/Launch(Agents|Daemons)/i,
      /\blaunchctl\s+(load|bootstrap|enable)/i,
      /\bsystemctl\s+(--user\s+)?enable/i,
      /HK(CU|LM)\\[^\n]*\\Run/i,
      />>\s*~?\/?(\.bashrc|\.zshrc|\.profile|\.bash_profile|\.zprofile)\b/i,
      /\bschtasks\b[^\n]*\/create/i
    ],
    why: 'Establishes persistence (autostart, cron, service, shell-rc, registry Run key).'
  },
  {
    id: 'prompt_injection',
    severity: 'high',
    patterns: [
      /ignore\b[^.\n]{0,40}(prior|previous|earlier|above)\b[^.\n]{0,30}(instruction|rule|prompt)/i,
      /disregard\b[^.\n]{0,40}(prior|previous|earlier|above|instruction|rule)/i,
      /do\s+not\s+(tell|inform|mention|report|alert|warn|reveal|disclose)\b/i,
      /this\s+(skill|file|tool|package)\s+(is|has been|was)\s+[^.\n]{0,20}(safe|approved|trusted|pre-?approved|verified|vetted|legit)/i,
      /\byou\s+are\s+now\b/i,
      /\balways\s+run\b/i,
      /do\s+not\s+(run|use|invoke)\s+(any\s+)?(scanner|security|review|shucky|check)/i
    ],
    why: 'Text aimed at the reviewing agent (instruction override / hiding actions).'
  },
  {
    id: 'supply_chain',
    severity: 'medium',
    patterns: [
      /(curl|wget)\b[^\n|]*\|\s*(sh|bash)/i,       // installer one-liner (also flagged as obfuscation)
      /\bnpm\s+(i|install)\b[^\n]*(http|git\+|github:)/i,
      /\bpip\s+install\b[^\n]*(http|git\+)/i,
      /\bnpx\s+(--yes\s+|-y\s+)?[@a-z][^\n]*@latest/i
    ],
    why: 'Fetches/installs remote code at run time (unpinned supply chain).'
  },
  {
    id: 'excessive_scope',
    severity: 'low',
    patterns: [
      /\bnc\s+-l/i,                                // listener
      /(^|\s)0\.0\.0\.0/,
      /\bfind\s+\/\s/,                            // find / ...
      /\bchmod\s+-R\b/i
    ],
    why: 'Broad/unscoped access beyond a typical skill task.'
  }
];

// `undeclared_capability` is intentionally NOT a deterministic rule — it requires
// comparing behavior against the SKILL.md description, which is the agent's job.

const SUSPICIOUS_BINARY_EXT = new Set([
  '.pyc', '.wasm', '.so', '.dylib', '.exe', '.dll', '.node', '.class', '.o', '.a', '.bin'
]);

function isProbablyBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

module.exports = { RULES, SUSPICIOUS_BINARY_EXT, isProbablyBinary };

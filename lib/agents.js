'use strict';

// shucky agent registry — where each coding agent reads its skills.
// Ported in full from vercel-labs/skills `src/agents.ts` (MIT). See NOTICE.
// detectInstalled() is synchronous here (plain existsSync); everything else mirrors upstream.

const os = require('os');
const path = require('path');
const fs = require('fs');
const join = path.join;

const home = os.homedir();
const xdgConfig = (process.env.XDG_CONFIG_HOME && path.isAbsolute(process.env.XDG_CONFIG_HOME))
  ? process.env.XDG_CONFIG_HOME : undefined;
const configHome = xdgConfig || join(home, '.config');
const codexHome = (process.env.CODEX_HOME && process.env.CODEX_HOME.trim()) || join(home, '.codex');
const claudeHome = (process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CONFIG_DIR.trim()) || join(home, '.claude');
const vibeHome = (process.env.VIBE_HOME && process.env.VIBE_HOME.trim()) || join(home, '.vibe');
const hermesHome = (process.env.HERMES_HOME && process.env.HERMES_HOME.trim()) || join(home, '.hermes');
const autohandHome = (process.env.AUTOHAND_HOME && process.env.AUTOHAND_HOME.trim()) || join(home, '.autohand');
const zedAppDataHome = process.env.APPDATA && process.env.APPDATA.trim();
const zedFlatpakConfigHome = process.env.FLATPAK_XDG_CONFIG_HOME && process.env.FLATPAK_XDG_CONFIG_HOME.trim();

function exists(p) { try { return !!p && fs.existsSync(p); } catch (e) { return false; } }
function pkgHasDep(pkgPath, dep) {
  try {
    const j = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return !!((j.dependencies && j.dependencies[dep]) || (j.devDependencies && j.devDependencies[dep]));
  } catch (e) { return false; }
}
function getOpenClawGlobalSkillsDir(homeDir) {
  homeDir = homeDir || home;
  if (exists(join(homeDir, '.openclaw'))) return join(homeDir, '.openclaw/skills');
  if (exists(join(homeDir, '.clawdbot'))) return join(homeDir, '.clawdbot/skills');
  if (exists(join(homeDir, '.moltbot'))) return join(homeDir, '.moltbot/skills');
  return join(homeDir, '.openclaw/skills');
}

function a(name, displayName, skillsDir, globalSkillsDir, detect, extra) {
  return Object.assign({ name: name, displayName: displayName, skillsDir: skillsDir, globalSkillsDir: globalSkillsDir, detectInstalled: detect }, extra || {});
}

const agents = {
  'aider-desk': a('aider-desk', 'AiderDesk', '.aider-desk/skills', join(home, '.aider-desk/skills'), function () { return exists(join(home, '.aider-desk')); }),
  amp: a('amp', 'Amp', '.agents/skills', join(configHome, 'agents/skills'), function () { return exists(join(configHome, 'amp')); }),
  antigravity: a('antigravity', 'Antigravity', '.agents/skills', join(home, '.gemini/antigravity/skills'), function () { return exists(join(home, '.gemini/antigravity')); }),
  'antigravity-cli': a('antigravity-cli', 'Antigravity CLI', '.agents/skills', join(home, '.gemini/antigravity-cli/skills'), function () { return exists(join(home, '.gemini/antigravity-cli')); }),
  astrbot: a('astrbot', 'AstrBot', 'data/skills', join(home, '.astrbot/data/skills'), function () { return exists(join(process.cwd(), 'data/skills')) || exists(join(home, '.astrbot')); }),
  'autohand-code': a('autohand-code', 'Autohand Code CLI', '.autohand/skills', join(autohandHome, 'skills'), function () { return exists(autohandHome); }),
  augment: a('augment', 'Augment', '.augment/skills', join(home, '.augment/skills'), function () { return exists(join(home, '.augment')); }),
  bob: a('bob', 'IBM Bob', '.bob/skills', join(home, '.bob/skills'), function () { return exists(join(home, '.bob')); }),
  'claude-code': a('claude-code', 'Claude Code', '.claude/skills', join(claudeHome, 'skills'), function () { return exists(claudeHome); }),
  openclaw: a('openclaw', 'OpenClaw', 'skills', getOpenClawGlobalSkillsDir(), function () { return exists(join(home, '.openclaw')) || exists(join(home, '.clawdbot')) || exists(join(home, '.moltbot')); }),
  cline: a('cline', 'Cline', '.agents/skills', join(home, '.agents', 'skills'), function () { return exists(join(home, '.cline')); }),
  'codearts-agent': a('codearts-agent', 'CodeArts Agent', '.codeartsdoer/skills', join(home, '.codeartsdoer/skills'), function () { return exists(join(home, '.codeartsdoer')); }),
  codebuddy: a('codebuddy', 'CodeBuddy', '.codebuddy/skills', join(home, '.codebuddy/skills'), function () { return exists(join(process.cwd(), '.codebuddy')) || exists(join(home, '.codebuddy')); }),
  codemaker: a('codemaker', 'Codemaker', '.codemaker/skills', join(home, '.codemaker/skills'), function () { return exists(join(home, '.codemaker')); }),
  codestudio: a('codestudio', 'Code Studio', '.codestudio/skills', join(home, '.codestudio/skills'), function () { return exists(join(home, '.codestudio')); }),
  codex: a('codex', 'Codex', '.agents/skills', join(codexHome, 'skills'), function () { return exists(codexHome) || exists('/etc/codex'); }),
  'command-code': a('command-code', 'Command Code', '.commandcode/skills', join(home, '.commandcode/skills'), function () { return exists(join(home, '.commandcode')); }),
  continue: a('continue', 'Continue', '.continue/skills', join(home, '.continue/skills'), function () { return exists(join(process.cwd(), '.continue')) || exists(join(home, '.continue')); }),
  cortex: a('cortex', 'Cortex Code', '.cortex/skills', join(home, '.snowflake/cortex/skills'), function () { return exists(join(home, '.snowflake/cortex')); }),
  crush: a('crush', 'Crush', '.crush/skills', join(home, '.config/crush/skills'), function () { return exists(join(home, '.config/crush')); }),
  cursor: a('cursor', 'Cursor', '.agents/skills', join(home, '.cursor/skills'), function () { return exists(join(home, '.cursor')); }),
  deepagents: a('deepagents', 'Deep Agents', '.agents/skills', join(home, '.deepagents/agent/skills'), function () { return exists(join(home, '.deepagents')); }),
  devin: a('devin', 'Devin for Terminal', '.devin/skills', join(configHome, 'devin/skills'), function () { return exists(join(configHome, 'devin')); }),
  dexto: a('dexto', 'Dexto', '.agents/skills', join(home, '.agents/skills'), function () { return exists(join(home, '.dexto')); }, { showInUniversalPrompt: false }),
  droid: a('droid', 'Droid', '.factory/skills', join(home, '.factory/skills'), function () { return exists(join(home, '.factory')); }),
  eve: a('eve', 'Eve', 'agent/skills', undefined, function () { var cwd = process.cwd(); return exists(join(cwd, 'agent')) && pkgHasDep(join(cwd, 'package.json'), 'eve'); }),
  firebender: a('firebender', 'Firebender', '.agents/skills', join(home, '.firebender/skills'), function () { return exists(join(home, '.firebender')); }, { showInUniversalPrompt: false }),
  forgecode: a('forgecode', 'ForgeCode', '.forge/skills', join(home, '.forge/skills'), function () { return exists(join(home, '.forge')); }),
  'gemini-cli': a('gemini-cli', 'Gemini CLI', '.agents/skills', join(home, '.gemini/skills'), function () { return exists(join(home, '.gemini')); }),
  'github-copilot': a('github-copilot', 'GitHub Copilot', '.agents/skills', join(home, '.copilot/skills'), function () { return exists(join(home, '.copilot')); }),
  goose: a('goose', 'Goose', '.goose/skills', join(configHome, 'goose/skills'), function () { return exists(join(configHome, 'goose')); }),
  'hermes-agent': a('hermes-agent', 'Hermes Agent', '.hermes/skills', join(hermesHome, 'skills'), function () { return exists(hermesHome); }),
  'inference-sh': a('inference-sh', 'inference.sh', '.inferencesh/skills', join(home, '.inferencesh/skills'), function () { return exists(join(home, '.inferencesh')); }),
  jazz: a('jazz', 'Jazz', '.jazz/skills', join(home, '.jazz/skills'), function () { return exists(join(home, '.jazz')) || exists(join(process.cwd(), '.jazz')); }),
  junie: a('junie', 'Junie', '.junie/skills', join(home, '.junie/skills'), function () { return exists(join(home, '.junie')); }),
  'iflow-cli': a('iflow-cli', 'iFlow CLI', '.iflow/skills', join(home, '.iflow/skills'), function () { return exists(join(home, '.iflow')); }),
  kilo: a('kilo', 'Kilo Code', '.kilocode/skills', join(home, '.kilocode/skills'), function () { return exists(join(home, '.kilocode')); }),
  'kimi-code-cli': a('kimi-code-cli', 'Kimi Code CLI', '.agents/skills', join(home, '.agents/skills'), function () { return exists(join(home, '.kimi-code')) || exists(join(home, '.kimi')); }),
  'kiro-cli': a('kiro-cli', 'Kiro CLI', '.kiro/skills', join(home, '.kiro/skills'), function () { return exists(join(home, '.kiro')); }),
  kode: a('kode', 'Kode', '.kode/skills', join(home, '.kode/skills'), function () { return exists(join(home, '.kode')); }),
  lingma: a('lingma', 'Lingma', '.lingma/skills', join(home, '.lingma/skills'), function () { return exists(join(home, '.lingma')); }),
  loaf: a('loaf', 'Loaf', '.agents/skills', join(home, '.agents/skills'), function () { return exists(join(home, '.loaf')); }, { showInUniversalPrompt: false }),
  mcpjam: a('mcpjam', 'MCPJam', '.mcpjam/skills', join(home, '.mcpjam/skills'), function () { return exists(join(home, '.mcpjam')); }),
  'mistral-vibe': a('mistral-vibe', 'Mistral Vibe', '.vibe/skills', join(vibeHome, 'skills'), function () { return exists(vibeHome); }),
  moxby: a('moxby', 'Moxby', '.moxby/skills', join(home, '.moxby/skills'), function () { return exists(join(home, '.moxby')); }),
  mux: a('mux', 'Mux', '.mux/skills', join(home, '.mux/skills'), function () { return exists(join(home, '.mux')); }),
  opencode: a('opencode', 'OpenCode', '.agents/skills', join(configHome, 'opencode/skills'), function () { return exists(join(configHome, 'opencode')); }),
  openhands: a('openhands', 'OpenHands', '.openhands/skills', join(home, '.openhands/skills'), function () { return exists(join(home, '.openhands')); }),
  ona: a('ona', 'Ona', '.ona/skills', join(home, '.ona/skills'), function () { return exists(join(home, '.ona')); }),
  pi: a('pi', 'Pi', '.pi/skills', join(home, '.pi/agent/skills'), function () { return exists(join(home, '.pi/agent')); }),
  qoder: a('qoder', 'Qoder', '.qoder/skills', join(home, '.qoder/skills'), function () { return exists(join(home, '.qoder')); }),
  'qoder-cn': a('qoder-cn', 'Qoder CN', '.qoder/skills', join(home, '.qoder-cn/skills'), function () { return exists(join(home, '.qoder-cn')); }),
  'qwen-code': a('qwen-code', 'Qwen Code', '.qwen/skills', join(home, '.qwen/skills'), function () { return exists(join(home, '.qwen')); }),
  replit: a('replit', 'Replit', '.agents/skills', join(configHome, 'agents/skills'), function () { return exists(join(process.cwd(), '.replit')); }, { showInUniversalList: false }),
  reasonix: a('reasonix', 'Reasonix', '.reasonix/skills', join(home, '.reasonix/skills'), function () { return exists(join(home, '.reasonix')); }),
  rovodev: a('rovodev', 'Rovo Dev', '.rovodev/skills', join(home, '.rovodev/skills'), function () { return exists(join(home, '.rovodev')); }),
  roo: a('roo', 'Roo Code', '.roo/skills', join(home, '.roo/skills'), function () { return exists(join(home, '.roo')); }),
  'tabnine-cli': a('tabnine-cli', 'Tabnine CLI', '.tabnine/agent/skills', join(home, '.tabnine/agent/skills'), function () { return exists(join(home, '.tabnine')); }),
  terramind: a('terramind', 'Terramind', '.terramind/skills', join(home, '.terramind/skills'), function () { return exists(join(home, '.terramind')); }),
  tinycloud: a('tinycloud', 'Tinycloud', '.tinycloud/skills', join(home, '.tinycloud/skills'), function () { return exists(join(home, '.tinycloud')); }),
  trae: a('trae', 'Trae', '.trae/skills', join(home, '.trae/skills'), function () { return exists(join(home, '.trae')); }),
  'trae-cn': a('trae-cn', 'Trae CN', '.trae/skills', join(home, '.trae-cn/skills'), function () { return exists(join(home, '.trae-cn')); }),
  warp: a('warp', 'Warp', '.agents/skills', join(home, '.agents/skills'), function () { return exists(join(home, '.warp')); }),
  windsurf: a('windsurf', 'Windsurf', '.windsurf/skills', join(home, '.codeium/windsurf/skills'), function () { return exists(join(home, '.codeium/windsurf')); }),
  zed: a('zed', 'Zed', '.agents/skills', join(home, '.agents/skills'), function () { return exists(join(configHome, 'zed')) || (!!zedAppDataHome && exists(join(zedAppDataHome, 'Zed'))) || (!!zedFlatpakConfigHome && exists(join(zedFlatpakConfigHome, 'zed'))); }),
  zencoder: a('zencoder', 'Zencoder', '.zencoder/skills', join(home, '.zencoder/skills'), function () { return exists(join(home, '.zencoder')); }),
  zenflow: a('zenflow', 'Zenflow', '.zencoder/skills', join(home, '.zencoder/skills'), function () { return exists(join(home, '.zencoder')); }),
  neovate: a('neovate', 'Neovate', '.neovate/skills', join(home, '.neovate/skills'), function () { return exists(join(home, '.neovate')); }),
  pochi: a('pochi', 'Pochi', '.pochi/skills', join(home, '.pochi/skills'), function () { return exists(join(home, '.pochi')); }),
  promptscript: a('promptscript', 'PromptScript', '.agents/skills', undefined, function () { return exists(join(process.cwd(), '.promptscript')) || exists(join(process.cwd(), 'promptscript.yaml')); }, { showInUniversalPrompt: false }),
  adal: a('adal', 'AdaL', '.adal/skills', join(home, '.adal/skills'), function () { return exists(join(home, '.adal')); }),
  universal: a('universal', 'Universal', '.agents/skills', join(configHome, 'agents/skills'), function () { return false; }, { showInUniversalList: false })
};

function getAgentConfig(type) { return agents[type]; }
function isUniversalAgent(type) { return !!agents[type] && agents[type].skillsDir === '.agents/skills'; }

function detectInstalledAgents() {
  const out = [];
  for (const type of Object.keys(agents)) {
    try { if (agents[type].detectInstalled()) out.push(type); } catch (e) { /* skip */ }
  }
  return out;
}

function getUniversalAgents() {
  return Object.keys(agents).filter(function (t) { return agents[t].skillsDir === '.agents/skills' && agents[t].showInUniversalList !== false; });
}
function getNonUniversalAgents() {
  return Object.keys(agents).filter(function (t) { return agents[t].skillsDir !== '.agents/skills'; });
}

// The canonical directory the vetted skill is copied into; non-universal agents symlink to it.
// Matches the reference: global → ~/.agents/skills, project → <cwd>/.agents/skills.
function getCanonicalSkillsDir(scope, cwd) {
  const base = scope === 'global' ? home : (cwd || process.cwd());
  return join(base, '.agents', 'skills');
}
// Base dir an agent reads skills from for the chosen scope. Universal agents resolve to the
// canonical dir (they share one copy and need no symlink). null if the agent has no such dir.
function getAgentBaseDir(type, scope, cwd) {
  if (isUniversalAgent(type)) return getCanonicalSkillsDir(scope, cwd);
  const c = agents[type];
  if (!c) return null;
  if (scope === 'global') return c.globalSkillsDir || null;
  return join(cwd || process.cwd(), c.skillsDir);
}

module.exports = {
  agents: agents,
  configHome: configHome,
  getAgentConfig: getAgentConfig,
  isUniversalAgent: isUniversalAgent,
  detectInstalledAgents: detectInstalledAgents,
  getUniversalAgents: getUniversalAgents,
  getNonUniversalAgents: getNonUniversalAgents,
  getCanonicalSkillsDir: getCanonicalSkillsDir,
  getAgentBaseDir: getAgentBaseDir,
  getOpenClawGlobalSkillsDir: getOpenClawGlobalSkillsDir
};

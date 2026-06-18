# Changelog

## 0.1.0 — unreleased

Initial build.

- Zero-dependency CLI: `shucky scan <path>` with `--json`, `--source`, `--at`, `--policy`,
  `--quiet`, `--config`, `--help`, `--version`; plus `shucky approve <owner/repo> --at <ver>
  --reason <text>` for persistent overrides.
- Deterministic rule engine: `secret_access`, `agent_state_access`, `browser_session`,
  `network_exfil`, `obfuscation`, `destructive`, `persistence`, `prompt_injection`,
  `supply_chain`, `excessive_scope`.
  - `browser_session`, `agent_state_access`, and raw-IP exfil URLs are adapted from the
    community **skill-vetter** skill (spclaudehome, MIT-0).
- Prose/fence-aware Markdown scanning: code-execution rules apply only inside fenced code
  blocks; prose is checked for prompt-injection only — cuts false positives on docs that
  *mention* a command.
- Reads files as text only — **never executes** the skill under review; flags opaque/compiled
  binaries instead of running them.
- Verdict model with block-on-risk default; trusted-source `relax` (high/critical still blocks);
  persistent approval overrides pinned to an exact `source@version`.
- Configurable via `config.json` + `SHUCKY_*` env vars + CLI flags. Exit codes `0`/`1`/`2`/`3`.
- Agent-native review protocol in `SKILL.md` (works without Node), injection-hardened (treats
  the skill as untrusted data, never executes it).
- Test runner (`test/run.js`, 21 checks) + fixtures: benign, malicious, binary, persistence,
  agent-targeted, medium-only.
- MIT LICENSE.

_Not yet published to npm._

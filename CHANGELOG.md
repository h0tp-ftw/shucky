# Changelog

## 0.2.0

shucky becomes find · scan · **install** — the safe front door for adding skills. Self-contained;
**no runtime dependency on `npx skills`** (its logic is reimplemented; `git` is the only external
binary, for git sources).

- **`shucky install <source>`** (`add`, `i`) — resolve → fetch → **scan** → gate → place → record.
  The scan gate is un-bypassable: BLOCK installs nothing, WARN installs only with `-y` (never a
  BLOCK), PASS installs. The *only* way past a BLOCK is a logged `shucky approve`. shucky scans the
  exact bytes it installs (one fetch — no time-of-check/time-of-use gap).
- **From anywhere:** `owner/repo[/sub][@skill][#ref]`, github/gitlab URLs (incl. self-hosted),
  `…/blob/…/SKILL.md`, any git/ssh URL, `gist:<id>`, a raw `SKILL.md` URL, and `.well-known` hosts —
  plus local paths. (Broader than `npx skills`, which rejects bare file URLs.)
- **Comprehensive multi-environment install** ported from `vercel-labs/skills` (MIT, see `NOTICE`):
  ~70-agent registry, canonical `.agents/skills` + per-agent symlinks, copy/junction fallback,
  agent detection, idempotent re-install, Claude-Code plugin manifests.
- **`shucky scan`** now also accepts remote sources (fetches into a temp dir, scans, cleans up).
- **`shucky list`** — lists skills shucky installed, from the lockfiles.
- **Hardened fetcher:** SSRF guard (metadata/loopback/private/`*.internal`) with DNS-rebind defense
  + redirect re-validation; the installer **drops symlinks** on copy (the scanner skips them, so
  dereferencing would smuggle in unscanned bytes); git runs `--depth 1`, no prompts/LFS, array-args.
- **Provenance lockfiles:** `shucky-skills.json` (project, committed, sorted, timestamp-free) and
  `~/.shucky/installed-skills.json` (global) record source, resolved commit, content hash, and the
  scan verdict — so a future `update` can re-scan and flag drift. Approvals pin to the commit SHA.
- New modules: `lib/sources.js`, `lib/safeurl.js`, `lib/fetch.js`, `lib/discover.js`,
  `lib/agents.js`, `lib/place.js`, `lib/lock.js`. New flags: `-g/--global`, `--scope`, `-a/--agent`,
  `--all`, `--skill`, `--dir`, `--copy`, `-y/--yes`.
- Tests: `test/run-install.js` (61 checks) covering source parsing, SSRF/rebind, discovery,
  placement (incl. symlink-drop), lockfiles, and the full install gate — 82 checks total.

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

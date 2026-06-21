# Changelog

## 0.4.7

- **Smarter `find` ranking.** Results are now **relevance-first** — shucky preserves the order each
  registry returned (skills.sh fuzzy, GitHub search) instead of overriding it with raw popularity, so
  a precise niche match no longer loses to a popular loose one. **Trusted sources get a bounded boost**,
  and **popularity is normalised per-source** (log scale) so GitHub star counts can't dominate skills.sh
  install counts. New pure, unit-tested `rankResults()` (5 checks → 189 total).

## 0.4.6

- **Docs — README rebalanced installer-first:** leads with the *one command · any source · into
  every agent · zero per-repo setup* story (the original motivation), with the scan gate framed as
  the killer differentiator rather than the headline. The from-anywhere source table moves up, and
  `find` now documents how it merges + ranks results. No code changes.

## 0.4.5

- **Docs — full README glow-up:** centered hero + badges (npm version, CI, Node, zero-deps,
  provenance, license); a real "it blocked a skill that told the reviewer to switch itself off"
  showpiece; a *from-anywhere* source table; the two-layer (deterministic floor + agent review)
  security model; and clean command / rule / source tables. npm-first install now that the package
  is live. No code changes.

## 0.4.4

- **`shucky self-update`** — update shucky *itself* (the CLI). It detects how shucky was installed and
  runs the matching update: `git pull --ff-only` for a source / `npm link` checkout, `npm i -g
  @h0tp/shucky@latest` for a global npm install, or a no-op + hint when run via npx. `--check`
  previews the command without running it. (To re-fetch + RE-SCAN the skills shucky installed *for
  you*, use `shucky update`.)

## 0.4.3

- **Comprehensive test suite + unified runner.** `npm test` now runs `test/run-all.js`, which runs
  every suite in its own process and prints one aggregated summary (per-suite ✓/✗ + grand total),
  showing full output only for a suite that fails. **183 zero-dep checks across 6 suites:**
  - `run-rules.js` — every deterministic scan rule fired in isolation, a meta-check that *all* rules
    are covered, and the prose-vs-fence Markdown logic.
  - `run-coverage.js` — edge cases across every module (sources/safeurl/discover/place/lock/registry/
    archive) plus full CLI integration: the install → list → update → remove lifecycle, multi-skill
    gating (worst-exit-wins), `--skill`, `--policy report`, and `--json` output shapes.
  - plus `run.js`, `run-install.js`, `run-manager.js`, `run-archive.js`.
  - Shared zero-dep harness `test/_util.js` (check / eq / throws / tmp / quiet / capture + tar/zip
    builders).

## 0.4.2

- **Per-command `--help`.** `shucky <command> --help` now prints detailed help for that command —
  usage, positional arguments, every option, and examples — for `install`, `scan`, `find`, `list`,
  `remove`, `update`, `source` (incl. its `add` / `list` / `remove` subcommands), and `approve`.
  Aliases (`add`/`i`, `rm`, `ls`, `search`, `upgrade`, …) resolve to the right help, and the global
  `shucky --help` points to it.

## 0.4.1

- **`shucky find --github`** — also search GitHub: precise `SKILL.md` **code search** when
  `GITHUB_TOKEN` / `GH_TOKEN` is set, otherwise an unauthenticated **repo search** filtered to
  skill/agent repos. Ranked + trust-annotated alongside skills.sh; opt-in (default `find` unchanged).
- **ClawHub-ready** — `SKILL.md` gains a `metadata.openclaw` block (emoji, `user-invocable`, an npm
  install helper for the `shucky` bin) so shucky publishes cleanly to [ClawHub](https://clawhub.ai).
  `CLAWHUB.md` documents the (account-gated) `clawhub skill publish` flow; users then
  `openclaw skills install shucky`.
- `safeGet` now supports custom request headers (for the GitHub API). New flags: `--github`, `--local`.

## 0.4.0

- **Archive sources** — `install`/`scan` now accept `.tar.gz` / `.tgz` / `.zip` (a remote URL,
  incl. GitHub `…/archive/….tar.gz`, or a local file). New `lib/archive.js` extracts with pure Node
  (zlib), hardened against the classic archive attacks: **zip-slip** (every entry path is resolved
  and must stay inside the destination), **symlink / hardlink / device entries are dropped** (never
  written — same reason placement drops symlinks), and **zip-bomb caps** (entry count, per-entry +
  total uncompressed size, plus gunzip / inflate `maxOutputLength`). Archives carry no owner/repo
  identity, so they are always fully scanned (no trust relax). "From anywhere" now includes tarballs.
- Tests: `test/run-archive.js` (10 checks, builds tar/zip in-process) — 112 zero-dep checks total.

## 0.3.0

Phase 2 — shucky becomes a full manager: it now manages many skill sources and discovers across them.

- **`shucky find [query]`** (`search`, `f`, `s`) — search the public registry (skills.sh) + your
  registered sources/lists; results ranked by installs and annotated with source-trust. Selecting
  one hands off to `install`, so every result is scanned before it lands. `--json`, `--limit`.
- **`shucky source add|list|remove <spec>`** — a registry of the repos / registries / curated lists
  you trust. `--trust trusted` feeds the scanner's relax policy (low/medium relax; high/critical
  still block). Two files: `~/.shucky/sources.json` (global) + `./shucky-sources.json` (project).
- **Curated lists:** register a `.json` manifest as a `list` source and install the whole bundle
  with `shucky install --list <name>` (each member independently scanned).
- **`shucky remove <name>`** (`rm`) — uninstall across agent dirs + prune the lockfile (path-guarded
  to the skill's own directory).
- **`shucky update [name]`** — re-fetch → **re-scan** → re-place installed skills; if a once-clean
  skill now BLOCKS it is left as-is and flagged, not silently reinstalled. Skips local/raw sources.
- New modules `lib/registry.js`, `lib/find.js`; `lib/place.js` gains `unplaceSkill`. New flags:
  `--name`, `--trust`, `--type`, `--limit`, `--list`.
- Tests: `test/run-manager.js` (20 checks) — 102 zero-dep checks total.

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

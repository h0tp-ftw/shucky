# Roadmap

## Done

### v0.1.0 — the scanner
- `shucky scan` deterministic rule engine + verdict model (block-on-risk, trusted-source relax,
  approval overrides), prose/fence-aware Markdown scanning, agent-native `SKILL.md` protocol.

### v0.2.0 — the installer (find · scan · install, self-contained)
- **`shucky install <source>`** — resolve → fetch → scan → gate → place → record. Un-bypassable
  gate (only `shucky approve` lifts a BLOCK; `-y` never installs one); scans the exact bytes it
  installs (no TOCTOU). From anywhere: github / gitlab (self-hosted) / git / local / `gist:` / raw
  `SKILL.md` URL / `.well-known`. Comprehensive ~70-agent install matrix ported from
  `vercel-labs/skills` (MIT). `scan` accepts remote sources; `list` reads the lock. Hardened
  fetcher (SSRF + DNS-rebind + redirect re-guard, symlink-drop, git sandboxing). Two lockfiles.

### v0.3.0 — the manager + discovery
- **`shucky find [query]`** — search skills.sh + the user's registered sources/lists, ranked +
  trust-annotated; every hit routes through the scan gate (find never installs directly).
- **`shucky source add|list|remove`** — sources registry (repos / registries / curated lists);
  `--trust trusted` feeds the relax policy. **Curated lists**: `shucky install --list <name>`
  installs a bundle, each member scanned. Global `~/.shucky/sources.json` + project `./shucky-sources.json`.
- **`shucky remove <name>`** — uninstall across agent dirs + prune lock (path-guarded).
- **`shucky update [name]`** — re-fetch → re-scan → re-place; a now-blocking skill is left as-is +
  flagged, never silently reinstalled.
- 102 zero-dep tests across `test/run.js` + `test/run-install.js` + `test/run-manager.js`.

## Next — Phase 3 (tail)
- **Archive sources** (`.tar.gz` / `.zip`) with full zip-slip / zip-bomb / symlink-entry guards.
- Search more public registries in `find` (GitHub code search, more well-known hosts); cache results.
- More rules (PowerShell `IEX`, env-var beaconing, base85/hex); `.shuckyignore`; per-rule severity
  overrides; HTML report; an example CI action that fails on BLOCK.
- Ship to **clawhub** (openclaw's registry), alongside `skill-vetter`.

## Won't do (by design)
- Claim to *prove* a skill safe. shucky reduces risk and forces a review step; static detectors are
  bypassable (Trail of Bits bypassed the major vendors' scanners). Defense-in-depth, not a
  guarantee — the agent semantic review and human confirmation are part of the design.

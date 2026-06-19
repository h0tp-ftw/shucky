# Roadmap

## Done

### v0.1.0 — the scanner
- `shucky scan` deterministic rule engine + verdict model (block-on-risk, trusted-source relax,
  approval overrides), prose/fence-aware Markdown scanning, agent-native `SKILL.md` protocol.

### v0.2.0 — the installer (find · scan · install, self-contained)
- **`shucky install <source>`** — resolve → fetch → scan → gate → place → record. Un-bypassable gate
  (only `shucky approve` lifts a BLOCK; `-y` never installs one); scans the exact bytes it installs.
  From anywhere: github / gitlab (self-hosted) / git / local / `gist:` / raw `SKILL.md` URL /
  `.well-known`. Comprehensive ~70-agent install matrix ported from `vercel-labs/skills` (MIT).
  Hardened fetcher (SSRF + DNS-rebind + redirect re-guard, symlink-drop, git sandboxing). 2 lockfiles.

### v0.3.0 — the manager + discovery
- **`shucky find`** (skills.sh + registered sources, trust-annotated, routed through the gate),
  **`shucky source add|list|remove`** (sources registry + curated lists; `--trust` feeds relax),
  **`install --list`** (curated bundle), **`shucky remove`**, **`shucky update`** (re-fetch →
  re-scan → re-place; a now-blocking skill is flagged, not reinstalled).

### v0.4.0 — archive sources
- **`.tar.gz` / `.tgz` / `.zip`** sources (remote URL incl. GitHub `…/archive/…`, or a local file),
  extracted by `lib/archive.js` (pure Node/zlib) with zip-slip / zip-bomb / symlink-drop guards.
  Archives carry no owner/repo identity → always fully scanned. 112 zero-dep tests across four files.

## Next — Phase 3 (tail)
- **More `find` registries** — GitHub code search for `SKILL.md`, more well-known hosts; result caching.
- More rules (PowerShell `IEX`, env-var beaconing, base85/hex); `.shuckyignore`; per-rule severity
  overrides; HTML report; an example CI action that fails on BLOCK.
- Ship to **clawhub** (openclaw's registry), alongside `skill-vetter`.

## Won't do (by design)
- Claim to *prove* a skill safe. shucky reduces risk and forces a review step; static detectors are
  bypassable (Trail of Bits bypassed the major vendors' scanners). Defense-in-depth, not a
  guarantee — the agent semantic review and human confirmation are part of the design.

# Roadmap

## Done

### v0.1.0 — the scanner
- `shucky scan` deterministic rule engine + verdict model (block-on-risk, trusted-source relax,
  approval overrides), prose/fence-aware Markdown scanning, agent-native `SKILL.md` protocol.

### v0.2.0 — the installer (find · scan · install, self-contained)
- **`shucky install <source>`** — resolve → fetch → scan → gate → place → record. Un-bypassable gate;
  scans the exact bytes it installs. From anywhere: github / gitlab (self-hosted) / git / local /
  `gist:` / raw `SKILL.md` URL / `.well-known`. ~70-agent install matrix ported from
  `vercel-labs/skills` (MIT). Hardened fetcher (SSRF + DNS-rebind + redirect re-guard, symlink-drop).

### v0.3.0 — the manager + discovery
- **`find`** (skills.sh + registered sources), **`source add|list|remove`** (registry + curated
  lists; `--trust` feeds relax), **`install --list`**, **`remove`**, **`update`** (re-fetch → re-scan
  → re-place).

### v0.4.0 — archive sources
- **`.tar.gz` / `.tgz` / `.zip`** sources (remote or local), extracted by `lib/archive.js` (pure
  Node/zlib) with zip-slip / zip-bomb / symlink-drop guards. Archives are always fully scanned.

### v0.4.1 — GitHub search + ClawHub-ready
- **`find --github`** — GitHub `SKILL.md` code search (with `GITHUB_TOKEN`), else a filtered repo
  search; ranked + trust-annotated alongside skills.sh (opt-in).
- **ClawHub-ready** — `SKILL.md` `metadata.openclaw` block + `CLAWHUB.md` document the account-gated
  `clawhub skill publish` flow (users then `openclaw skills install shucky`).
- 112 zero-dep tests across four files.

## Next
- **find:** result caching; more well-known hosts; rank by trust as well as popularity.
- More rules (PowerShell `IEX`, env-var beaconing, base85/hex); `.shuckyignore`; per-rule severity
  overrides; HTML report; an example CI action that fails on BLOCK.
- **Publish** (maintainer, account-gated): `npm publish @h0tp/shucky@0.4.x`; `clawhub skill publish`.

## Won't do (by design)
- Claim to *prove* a skill safe. shucky reduces risk and forces a review step; static detectors are
  bypassable (Trail of Bits bypassed the major vendors' scanners). Defense-in-depth, not a
  guarantee — the agent semantic review and human confirmation are part of the design.

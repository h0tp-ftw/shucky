# Roadmap

## Done

### v0.1.0 — the scanner
- `shucky scan` deterministic rule engine + verdict model (block-on-risk, trusted-source relax,
  approval overrides), prose/fence-aware Markdown scanning, agent-native `SKILL.md` protocol.

### v0.2.0 — the installer (find · scan · install, self-contained)
- **`shucky install <source>`** — resolve → fetch → scan → gate → place → record. The scan is
  un-bypassable: only `shucky approve` lifts a BLOCK (no `--force`; `-y` never installs one). It
  scans the **exact bytes it installs** — single fetch, no TOCTOU gap.
- **From anywhere:** github / gitlab (incl. self-hosted) / any git / local / `gist:` / raw
  `SKILL.md` URL / `.well-known`. Broader than `npx skills`, which rejects bare file URLs.
- **Comprehensive multi-environment install** ported from `vercel-labs/skills` (MIT, see NOTICE):
  ~70-agent registry, canonical `.agents/skills` + per-agent symlinks, copy/junction fallback,
  agent detection, idempotency, plugin-manifests.
- **`shucky scan`** now also accepts remote sources; **`shucky list`** reads the install lock.
- Hardened fetcher: SSRF + DNS-rebind + redirect re-guard, symlink-drop on copy, git sandboxing.
- Two lockfiles (project committed + global) recording verdict + commit. 82 zero-dep tests.
- **No runtime dependency on `npx skills`;** `git` is the only external binary.
- Published `@h0tp/shucky@0.1.0` already live on npm (scanner only).

## Next — Phase 2 (the manager + discovery)
1. **Sources registry + curated lists** (`lib/registry.js`): `shucky source add|list|remove`;
   entry `type: repo | registry | list`; a `list` is an installable curated bundle
   (`shucky install --list <name>`); trusted sources feed the relax policy.
2. **`shucky find <query>`** (`lib/find.js`) — search across the user's registered sources + public
   registries (skills.sh / GitHub / well-known), every hit routed through the scan gate. Folds in
   the `skill-finder` companion skill.
3. **`shucky remove <name>`** — uninstall across agent dirs + lock.
4. **`shucky update [name]`** — re-fetch → **re-scan** → re-place; warn if a once-clean skill now
   blocks (the lock already stores the verdict + commit for this).
5. Wire approvals into the agent-native flow; an example CI action that fails on BLOCK.

## Phase 3 (tail)
- **Archive sources** (`.tar.gz` / `.zip`) with full zip-slip / zip-bomb / symlink-entry guards.
- More rules (PowerShell `IEX`, env-var beaconing, base85/hex); `.shuckyignore`; per-rule severity
  overrides; HTML report.
- Ship to **clawhub** (openclaw's registry), alongside `skill-vetter`.

## Won't do (by design)
- Claim to *prove* a skill safe. shucky reduces risk and forces a review step; static detectors are
  bypassable (Trail of Bits bypassed the major vendors' scanners). Defense-in-depth, not a
  guarantee — the agent semantic review and human confirmation are part of the design.

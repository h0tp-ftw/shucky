# Roadmap

## Done — v0.1.0 (local, unpublished)

- **skill-finder** + **shucky** skills (agent-native, script-free SKILL.md).
- **shucky CLI** (zero deps): rule engine, verdict model (block-on-risk), trusted-source
  `relax`, persistent approval overrides, human + JSON output, exit codes.
- Prose/fence-aware scanning to cut false positives (docs that *mention* commands aren't flagged).
- Fixtures (benign / malicious / binary / medium-only) + zero-dep test suite — all green.

## Next (needs an explicit go-ahead for anything outward-facing)

1. **Publish `shucky` to npm** so `npx shucky@<version> scan` works. The name `shucky` was free
   on npm as of this build — reserve/verify before publishing. Keep zero deps; add a
   `prepublishOnly` self-scan. **Do not `npm publish` without explicit approval.**
2. **Remote scanning** in the CLI: `shucky scan owner/repo` → fetch raw `SKILL.md` + file list
   via the GitHub API (Node `https`, no deps) into a temp dir, read-only. (Local-path scanning
   is the current, common case.)
3. **Wire approvals into the agent flow:** finder/shucky `SKILL.md` instruct recording overrides
   via `shucky approve <owner/repo> --at <ver> --reason ...`.
4. **CI usage:** an example GitHub Action / pre-commit that runs `shucky scan` on a skills dir
   and fails on block. (openclaw already uses pre-commit + Actions — could integrate later.)
5. **More rules:** PowerShell/`IEX`, cron/scheduled tasks, env-var beaconing, base85/hex
   variants, zip-slip; plus an opt-in `.shuckyignore` and inline allow-comments for FP control.
6. **Optional:** per-rule severity overrides in config, HTML report output.

## Won't do (by design)

- Claim to *prove* a skill safe. shucky reduces risk and forces a review step; static detectors
  are bypassable (Trail of Bits bypassed the major vendors' scanners). This is defense-in-depth,
  not a guarantee — the agent semantic review and human confirmation are part of the design.

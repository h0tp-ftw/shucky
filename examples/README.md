# Examples — gating on shucky

Drop-in snippets for running `shucky` in automation so a risky skill can't land.

- **`github-action.yml`** — a GitHub Actions workflow that scans every skill under `skills/` and
  fails the build on a `block` verdict (exit code 2).
- **`pre-commit-config.yaml`** — a [pre-commit](https://pre-commit.com) hook that scans skills
  whenever a `SKILL.md` changes.

Both rely on shucky's exit codes: **`0` pass · `1` warn · `2` block · `3` error**.

## Caveats

- They **skip `skills/shucky` itself** — the scanner's own source documents attack strings (and
  shows dangerous commands in code blocks), so scanning it self-flags. That's expected; see
  shucky's "Known limitations".
- They assume shucky is vendored at `skills/shucky`. Once it's published to npm, swap
  `node skills/shucky/bin/shucky.js scan "$d"` for `npx shucky@<version> scan "$d"`.
- These are illustrative starting points, not hardened CI — adjust paths/policy to your repo.

# Publishing shucky to ClawHub

[ClawHub](https://clawhub.ai) is OpenClaw's skill registry. shucky is **ClawHub-ready**: its
`SKILL.md` carries the required `name` + `description` and a `metadata.openclaw` block (emoji,
`user-invocable`, and an npm install helper for the `shucky` bin).

Publishing is **account-gated** (your ClawHub identity), like `npm publish` — so it's a manual step
you run, not something the build does:

```bash
npm i -g clawhub            # the standalone ClawHub CLI (separate from openclaw)
clawhub login              # authenticate (your account)
clawhub whoami             # confirm
clawhub skill publish .    # from the repo root (this dir has SKILL.md + lib/ + bin/)
# or pin a version:
clawhub skill publish . --version 0.4.1
```

After publish, shucky lives at `https://clawhub.ai/<your-owner>/shucky` (hidden until ClawHub's
automated security review + verification complete). Users then install it with:

```bash
openclaw skills install shucky
```

## Notes

- **The skill directory is the repo root.** `SKILL.md` is the agent protocol; `lib/` + `bin/shucky.js`
  are the scanner/installer. ClawHub packages the whole directory; OpenClaw's gate sees the
  `metadata.openclaw.install` helper and offers to `npm i @h0tp/shucky` so the `shucky` bin is present.
- **Namespace.** An org namespace (e.g. `@openclaw/shucky`) needs publisher access to that org;
  otherwise it publishes under your personal handle (`@you/shucky`).
- **Keep versions in lockstep.** Bump the npm package (`@h0tp/shucky`) and the ClawHub release
  together so `openclaw skills install shucky` and `npx @h0tp/shucky` match.
- This is distribution only — shucky's behaviour (the un-bypassable scan gate) is identical however
  it's installed.

# shucky 🦪

[![tests](https://github.com/h0tp-ftw/shucky/actions/workflows/ci.yml/badge.svg)](https://github.com/h0tp-ftw/shucky/actions/workflows/ci.yml)

> Find, vet, and install agent skills from anywhere — **shucked before they land.**

A zero-dependency tool for `SKILL.md` skills. Skills run code in your environment and public
registries are largely unvetted, so shucky **fetches a skill from anywhere, scans it as untrusted
data, and only installs it if it passes** — block-on-risk by default. The safe front door:
`npx skills`, but it installs on *proof*, not trust.

No runtime dependency on any other tool. (Uses your system `git` for git sources.)

## Install

shucky is a single zero-dependency Node CLI — **Node ≥ 16** (plus your system `git` for git sources).
Published on npm with build provenance.

**Via npm / npx** (recommended):

```bash
npm i -g @h0tp/shucky            # global `shucky` command
npx @h0tp/shucky@0.4.4 --help    # run without installing (pin the version, never @latest)
```

**From source** (for hacking on shucky):

```bash
git clone https://github.com/h0tp-ftw/shucky && cd shucky
npm link                 # adds a `shucky` command pointing at your checkout
node bin/shucky.js --help   # …or run it directly, no link
```

**Update shucky later** with `shucky self-update` — it detects a global-npm vs git-checkout
install and runs the right thing (`--check` to preview).

## Quick start

```bash
shucky find pdf                            # discover skills (skills.sh + your sources)
shucky install anthropics/skills@pdf       # fetch → scan → install (into your detected agents)
shucky install owner/repo --global --agent claude-code
shucky install ./my-local-skill            # a local folder
shucky scan owner/repo                      # vet without installing (local OR remote)
shucky list                                 # what shucky installed
shucky remove pdf
```

Every command has detailed help — `shucky <command> --help`. shucky never runs a skill; it reads
files as text and installs only what passes the scan. (No `shucky` command yet? Use
`node bin/shucky.js <command>` from a clone — see **Install** above.)

## Commands

| command | what it does |
|---|---|
| `install <source>` (`add`, `i`) | fetch → **scan** → install into your agent dirs → record |
| `scan <path\|source>` | vet a skill → block / warn / pass (local or remote) |
| `find [query]` (`search`) | search skills.sh + your registered sources, ranked + trust-annotated |
| `list` (`ls`) | list skills shucky installed (`--global`, `--json`) |
| `remove <name>` (`rm`) | uninstall across agent dirs + prune the lock |
| `update [name]` | re-fetch → **re-scan** → re-place installed skills |
| `self-update [--check]` | update shucky itself (`git pull` / `npm -g`, auto-detected) |
| `source add\|list\|remove <spec>` | manage the sources registry + curated lists |
| `approve <owner/repo> --at <ver> --reason …` | log a human override of a BLOCK (pinned to a version/commit) |

> Run `shucky <command> --help` for usage, arguments, and examples of any command.

### Sources — "from anywhere"

`install` / `scan` accept any of:

- `owner/repo[/subpath][@skill][#ref]` — GitHub shorthand
- a `github.com` repo URL, `…/tree/<ref>/<path>`, or `…/blob/<ref>/SKILL.md`
- GitLab incl. self-hosted: `https://gitlab.example.com/g/r/-/tree/<ref>/<path>`
- any git URL: `git@host:owner/repo.git`, `ssh://…`, `https://….git`
- `gist:<id>` or a `gist.github.com` URL
- a **raw `SKILL.md` URL** (e.g. `raw.githubusercontent.com/…/SKILL.md`)
- a `.well-known` host serving `/.well-known/agent-skills/index.json`
- a **`.tar.gz` / `.zip` archive** (remote URL or local file) — extracted with zip-slip / zip-bomb / symlink guards
- a local `./path` or `/abs/path`

### Install options

```
-g, --global         install user-wide for all your agents (default: this project)
-a, --agent <name>   target a specific agent (repeatable; default: auto-detected)
--all                target every supported agent
--skill <name>       install only this skill from a multi-skill source (repeatable)
--copy               copy files instead of symlinking
-y, --yes            assume yes (installs WARN; NEVER installs a BLOCK)
```

## How install works

```
resolve → fetch (temp dir) → discover SKILL.md(s) → scan → gate → place → record
```

- **The scan is the gate, and it can't be bypassed.** BLOCK ⇒ nothing is written. WARN ⇒ installs
  only with `-y` (or an interactive yes). PASS ⇒ installs. The *only* way past a BLOCK is a logged
  `shucky approve` — there is no `--force`.
- shucky scans the **exact bytes it then installs** (one fetch, no re-download) — no
  time-of-check/time-of-use gap.
- Placement uses the `.agents/skills` convention: one canonical copy + a symlink into each detected
  agent (Claude Code, Cursor, Codex, Windsurf … ~70 agents); `--copy` copies instead.
- Every install is recorded in `shucky-skills.json` (project, committed) and
  `~/.shucky/installed-skills.json` (global) with the **scan verdict + resolved commit SHA**, so a
  re-scan can tell whether a once-clean skill changed. Approvals pin to the resolved commit, so any
  upstream change re-triggers a scan.

Exit codes: `0` ok/pass · `1` warn (skipped) · `2` block (refused) · `3` error — gate CI on them.

## Sources registry, curated lists & find

Register the repos / registries / lists you trust, then search and bulk-install across them:

```bash
shucky source add anthropics/skills --trust trusted        # a repo you trust (relaxes low/medium)
shucky source add https://example.com/team.json --name team  # a curated bundle (a .json list)
shucky source list

shucky find pdf            # search skills.sh + your sources, ranked by installs, trust-annotated
shucky install --list team # install every skill in the curated list (each one scanned)
```

- A `trusted` source feeds the scanner's relax policy (low/medium relax; **high/critical still block**).
- A `list` is a `.json` manifest — `["owner/repo@skill", …]` or `{ "skills": [{ "source", "skill" }] }`.
- `find` results are install-ready; picking one runs the full scan gate — **find never installs by itself.**
- Sources live in `~/.shucky/sources.json` (global) and `./shucky-sources.json` (project, committed).
- `find --github` also searches GitHub — precise `SKILL.md` code search with `GITHUB_TOKEN`, else filtered repo matches.

## What the scan checks (deterministic floor)

| rule | severity | catches |
|---|---|---|
| `secret_access` | critical | SSH/AWS keys, `.env`, `.npmrc`, `.netrc`, `env` dumps, cloud metadata |
| `agent_state_access` | medium | the agent's own memory/identity files |
| `browser_session` | high | browser cookies / saved logins |
| `network_exfil` | high | `curl`/`wget`/`nc`/`scp` exfil, PowerShell download, raw-IP URLs |
| `obfuscation` | high | `base64 -d \| sh`, `curl \| sh`, `eval`, `iex`, compiled binaries |
| `destructive` | high | `rm -rf`, `dd of=`, `chmod 777`, fork bombs, `git push --force`, `sudo` |
| `persistence` | high | cron, `systemctl enable`, launchd, `.bashrc`, registry Run keys |
| `prompt_injection` | high | text telling the *reviewer* to ignore rules / hide actions |
| `supply_chain` | medium | runtime installs of unpinned / remote packages |
| `excessive_scope` | low | listeners, `find /`, `chmod -R`, `0.0.0.0` |

Two layers by design: the deterministic CLI can't be socially engineered (a malicious `SKILL.md`
can't talk it out of a finding), and the agent-native `SKILL.md` protocol catches intent and novel
tricks the regexes miss. `undeclared_capability` (behavior ≠ description) is intentionally
agent-only judgment. **Neither layer alone is enough — and shucky never executes the skill.**

## Security model (the fetch surface)

shucky pulls untrusted content over the network, so the fetcher is hardened:

- **SSRF:** https-only; metadata IP / loopback / private ranges / `*.internal` blocked, re-checked
  **after DNS resolution** (rebind defense) and **on every redirect hop**.
- **No symlink escape:** the scanner skips symlinks, so the installer **drops** them too — it never
  copies a symlink's target into your skills dir.
- **git sandboxed:** `--depth 1`, no credential prompts, no LFS, array-args (no shell), validated
  ref, time/size caps.
- **Path traversal & archives:** subpaths and skill names are sanitized; archive extraction
  (`lib/archive.js`) is guarded against zip-slip, zip-bombs, and symlink/hardlink/device entries.

## Configuration (`config.json`)

```jsonc
{
  "policy": "block",                 // block | warn | report
  "failOn": ["high", "critical"],
  "warnOn": ["medium"],
  "trustedSources": ["anthropics", "vercel-labs", "..."],
  "trustedSourcePolicy": "relax",    // trusted: low/medium relax; high/critical STILL block
  "allowOverride": true,
  "overrideRequiresReason": true
}
```

Env: `SHUCKY_POLICY`, `SHUCKY_SOURCE`, `SHUCKY_MAX_FETCH_BYTES`. CLI flags override both. In `.md`
files, code-execution rules run only inside fenced blocks (prose is checked for prompt-injection
only), so a doc that merely *mentions* `curl … | sh` isn't flagged.

## Develop / test

```bash
npm test          # → test/run-all.js   (183 zero-dep checks across 6 suites, one aggregated summary)
```

Fixtures in `fixtures/` carry inert payloads and are **never executed**.

## Requirements

Node ≥ 16. `git` on PATH for git-type sources (GitHub / GitLab / SSH). No npm dependencies.

## Status

`v0.4.4` — find (incl. GitHub) · scan · install (incl. `.tar.gz`/`.zip`) · manage · self-update.
**Published on npm** (`@h0tp/shucky`, with build provenance). Also **ClawHub-ready** (see `CLAWHUB.md`).

## Credits

Source-spec parsing, the agent registry, and the install/symlink logic are reimplemented from
[`vercel-labs/skills`](https://github.com/vercel-labs/skills) (MIT) — see `NOTICE`. shucky adds the
mandatory scan gate and does **not** depend on that tool at runtime.

## License

MIT

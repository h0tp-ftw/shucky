# Clamshell skills 🦪

A small, portable suite of **agent skills** (the open `SKILL.md` standard) for safely
discovering and vetting *other* agent skills. Works on any agent that reads SKILL.md and can
run a shell or fetch URLs — Claude Code, Cursor, Codex, Gemini CLI, Copilot, Windsurf, etc.

## The skills

| Skill | What it does |
|---|---|
| **[`skill-finder`](./skill-finder/)** | Cross-registry search engine for skills — fans out across skills.sh, SkillsMP, and curated GitHub lists, ranks by source trust / installs / stars, and runs **shucky** before recommending. |
| **[`shucky`](./shucky/)** 🦪 | Safety scanner. Reads a skill as *untrusted data* (never executes it), applies deterministic red-flag rules + a semantic review, and returns **BLOCK / WARN / PASS**. Blocks on risk by default. |

They compose: **finder discovers → shucky vets → you install.**

## Design principles

- **Defense-in-depth.** Deterministic rules (an un-bypassable floor) → agent semantic review →
  human confirmation → trusted-source allowlist.
- **Injection-hardened.** The skill under review is treated as untrusted data, never as
  instructions. A skill that tells the reviewer *"I'm safe, skip the scan"* is flagged, not obeyed.
- **Two portable modes.** *Agent-native* (pure SKILL.md, runs anywhere) and a *zero-dependency
  CLI* (`shucky scan`) that provides the deterministic backstop wherever Node is available.

## Quickstart (install into any agent)

```bash
# portable installer — places each skill in the right dir per agent
npx skills add ./skills/skill-finder --agent claude-code cursor codex
npx skills add ./skills/shucky       --agent claude-code cursor codex
# ...or just copy the skill folder into wherever your agent reads skills
```

Run the scanner CLI directly (no install needed):

```bash
node skills/shucky/bin/shucky.js scan <path-to-a-skill>
```

## Layout

```
skills/
├── skill-finder/SKILL.md          # discovery skill (script-free)
└── shucky/                        # safety scanner
    ├── SKILL.md                   # the review protocol (agent-native + CLI)
    ├── config.json                # policy, rules, trusted sources
    ├── approved-skills.json       # persistent override allowlist
    ├── bin/shucky.js              # zero-dep CLI entry
    ├── lib/                       # config · rules · scan · report · cli
    ├── test/run.js                # zero-dep test runner
    └── fixtures/                  # benign + malicious sample skills
```

## Status

- **v0 (done):** both skills work agent-native today (pure SKILL.md, no infra).
- **v1 (in progress):** the `shucky` CLI is implemented and tested (zero dependencies). It is
  **not yet published** to npm — when it is, the scanner becomes `npx shucky@<version> scan <path>`.

## Safety

This is a local build. Nothing here has been published, pushed, or installed globally. `shucky`
has zero runtime dependencies and is open-source, so it can scan itself.

---
name: changelog-formatter
description: Format a list of merged PRs into a clean, grouped Markdown changelog.
---

# Changelog Formatter

Turn a plain list of merged pull requests into a grouped, readable changelog.

## Usage

1. Read the provided list of PR titles (or run `git log --merges --pretty=%s` if the user asks).
2. Group entries into Features / Fixes / Chores by conventional-commit prefix.
3. Output Markdown with a heading per group.

No network calls. No file writes outside the changelog the user asked for. No bundled scripts.

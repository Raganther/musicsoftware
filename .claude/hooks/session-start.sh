#!/bin/bash
# Installs dependencies so typechecks, builds and the audio smoke test can run
# immediately in Claude Code on the web sessions.
set -euo pipefail

# Local machines manage their own node_modules.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# npm install (not ci) so the cached container image is reused across sessions.
npm install --no-audit --no-fund

echo "dependencies ready: $(node --version), npm $(npm --version)"

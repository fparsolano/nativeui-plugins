#!/usr/bin/env bash
# codex-bootstrap.sh — one-liner installer for NativeUI on OpenAI Codex.
#   curl -fsSL https://raw.githubusercontent.com/fparsolano/nativeui-plugins/main/codex-bootstrap.sh | bash
# Clones (or updates) the public plugins mirror to a stable dir, then installs
# the NativeUI Codex plugin from the mirror marketplace. Re-running updates to
# the latest plugins.
set -euo pipefail
REPO="${NATIVEUI_PLUGINS_REPO:-https://github.com/fparsolano/nativeui-plugins.git}"
DEST="${NATIVEUI_PLUGINS_DIR:-$HOME/.nativeui/plugins-mirror}"
BRANCH="${NATIVEUI_PLUGINS_BRANCH:-main}"
command -v git >/dev/null 2>&1 || { echo "git is required" >&2; exit 1; }
if [ -d "$DEST/.git" ]; then
  echo "Updating $DEST ..."; git -C "$DEST" fetch --depth 1 origin "$BRANCH" && git -C "$DEST" reset --hard "origin/$BRANCH"
else
  echo "Cloning $REPO -> $DEST ..."; mkdir -p "$(dirname "$DEST")"; git clone --depth 1 -b "$BRANCH" "$REPO" "$DEST"
fi
if command -v codex >/dev/null 2>&1 && codex plugin --help >/dev/null 2>&1; then
  codex plugin marketplace add "$DEST"
  exec codex plugin add nativeui@nativeui-marketplace
fi
echo "Codex plugin CLI is unavailable; falling back to the legacy skill installer." >&2
exec bash "$DEST/nativeui-codex/install.sh"

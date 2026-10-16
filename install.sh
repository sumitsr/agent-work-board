#!/bin/sh
# Starts the board at login on macOS: fills in this folder and your node in the LaunchAgent template, then loads it.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node)" || { echo "install.sh: node (22 or newer) not found on PATH" >&2; exit 1; }
LABEL=com.example.agent-work-board
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$ROOT/data" "$HOME/Library/LaunchAgents"
sed -e "s|__NODE__|$NODE|g" -e "s|__ROOT__|$ROOT|g" "$ROOT/$LABEL.plist.template" > "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
# Put awb on PATH. A wrapper, not a symlink: awb finds awb.mjs next to itself.
mkdir -p "$HOME/.local/bin"
printf '#!/bin/sh\nexec "%s/awb" "$@"\n' "$ROOT" > "$HOME/.local/bin/awb"
chmod +x "$HOME/.local/bin/awb"
echo "Installed $PLIST and ~/.local/bin/awb. The board is at http://127.0.0.1:4747"

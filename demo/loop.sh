#!/bin/sh
# The README loop: 12 s of the recorded demo (the Overview updating, then envelopes flying in the Office),
# as an animated WebP. Needs ffmpeg and img2webp (libwebp). Run demo/record.mjs first.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
ffmpeg -loglevel error -ss "${START:-1.5}" -t "${LENGTH:-12}" -i "$HERE/out/agent-work-board-demo.mp4" -vf "fps=15,scale=1080:-1:flags=lanczos" "$TMP/f%04d.png"
img2webp -loop 0 -lossy -q "${QUALITY:-88}" -m 6 -d 67 "$TMP"/f*.png -o "$HERE/../docs/media/demo.webp" >/dev/null
rm -rf "$TMP"
ls -lh "$HERE/../docs/media/demo.webp"

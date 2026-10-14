#!/bin/sh
# Builds the native Mac app (its own window and Dock icon) and installs it to ~/Applications.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/build/Agent Work Board.app"
rm -rf "$HERE/build" && mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"
swiftc -O -swift-version 5 -framework Cocoa -framework WebKit "$HERE/AgentWorkBoard.swift" -o "$OUT/Contents/MacOS/AgentWorkBoard"
cp "$HERE/AppIcon.icns" "$OUT/Contents/Resources/AppIcon.icns"
cat > "$OUT/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Agent Work Board</string>
  <key>CFBundleDisplayName</key><string>Agent Work Board</string>
  <key>CFBundleIdentifier</key><string>com.example.agentworkboard</string>
  <key>CFBundleExecutable</key><string>AgentWorkBoard</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST
codesign --force -s - "$OUT"
rm -rf "$HOME/Applications/Agent Work Board.app"
cp -R "$OUT" "$HOME/Applications/"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$HOME/Applications/Agent Work Board.app"
echo "Installed: $HOME/Applications/Agent Work Board.app"

#!/usr/bin/env bash
set -u
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/share/pnpm:$HOME/bin:$PATH"
cd /home/kiran/code-wsl/mobily/android

# adb
ADB=""
for c in adb \
  /mnt/c/Users/kiran/AppData/Local/Android/Sdk/platform-tools/adb.exe \
  /mnt/c/Android/Sdk/platform-tools/adb.exe; do
  if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then ADB=$c; break; fi
done
echo "======== ADB ========"
echo "ADB=$ADB"
if [ -n "$ADB" ]; then "$ADB" devices -l 2>&1; else echo "adb not found"; ls /mnt/c/Users/kiran/AppData/Local/Android/Sdk/platform-tools/ 2>&1 | head; fi

echo "======== metro/expo processes ========"
pgrep -af 'metro|expo|react-native' 2>/dev/null | grep -vE 'pgrep|focus-check|cursor' | head -30 || echo none
ss -tlnp 2>/dev/null | grep -E '8081|19000|19001|8082|8083' || true

echo "======== how HTML loaded (grep) ========"
cd /home/kiran/code-wsl/mobily
grep -Rn "buildTerminal\|term\.html\|terminalDocument\|xtermAssets\|htmlSource\|WebView\|injectedJavaScript\|source=\{" android/src --include='*.ts' --include='*.tsx' --include='*.js' 2>/dev/null | head -60
grep -n "buildTerminal\|generate-terminal\|term.html\|xtermAssets" android/scripts/* android/src/terminal/* 2>/dev/null | head -40

echo "======== playwright test names (focus) ========"
grep -n "test('" android/tests/browser/terminalSnapshot.pw.mjs | grep -Ei 'focus|keyboard|touch|cursor|viewport|pan|tap' || true
grep -n "test('" android/tests/browser/terminalSnapshot.pw.mjs | head -40
#!/usr/bin/env bash
set -u
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/share/pnpm:$HOME/bin:$PATH"
cd /home/kiran/code-wsl/mobily

echo "======== GIT DIFF STAT ========"
git diff --stat -- android/src/terminal/terminalDocument.js android/tests/browser/terminalSnapshot.pw.mjs android/tests/terminalDocument.test.ts android/app.json

echo "======== GIT DIFF (full for small files / key hunks) ========"
git diff -- android/app.json
echo "----- terminalDocument.js -----"
git diff -- android/src/terminal/terminalDocument.js
echo "----- terminalDocument.test.ts -----"
git diff -- android/tests/terminalDocument.test.ts
echo "----- terminalSnapshot.pw.mjs (focus/keyboard/touch hunks) -----"
git diff -- android/tests/browser/terminalSnapshot.pw.mjs | head -400

echo "======== ADB DEVICES ========"
if command -v adb >/dev/null 2>&1; then
  adb devices -l
else
  echo "adb not on PATH"
  # try common windows path via wsl
  if [ -x /mnt/c/Users/kiran/AppData/Local/Android/Sdk/platform-tools/adb.exe ]; then
    /mnt/c/Users/kiran/AppData/Local/Android/Sdk/platform-tools/adb.exe devices -l
  else
    find /mnt/c/Users/kiran/AppData/Local/Android -name 'adb.exe' 2>/dev/null | head -5
  fi
fi

echo "======== android/package.json scripts ========"
node -e 'const p=require("./android/package.json"); console.log(JSON.stringify(p.scripts,null,2))'
#!/bin/bash
set -euo pipefail
export PATH="/home/kiran/.nvm/versions/node/v24.14.1/bin:/usr/bin:/bin"
echo "HOME=$HOME"
ls -la "$HOME/Android/Sdk" 2>&1 | head || true
ls -la /mnt/c/Users/kiran/AppData/Local/Android/Sdk 2>&1 | head || true
which adb || true
find "$HOME" /mnt/c/Users/kiran/AppData/Local -name adb -o -name adb.exe 2>/dev/null | head -20
echo "---"
# Windows adb via path we know works
WIN_ADB="/mnt/c/Users/kiran/AppData/Local/Microsoft/WinGet/Packages/Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe/platform-tools/adb.exe"
if [ -x "$WIN_ADB" ]; then
  echo "WIN_ADB ok"
  "$WIN_ADB" devices -l
fi

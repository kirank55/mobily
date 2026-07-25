#!/usr/bin/env bash
# HITL IME loop for Android terminal tap-to-open keyboard.
# Usage:
#   .scratch/ime-check.sh            # print current IME shown state
#   .scratch/ime-check.sh wait-tap   # prompt human to tap, then assert mInputShown
#   .scratch/ime-check.sh wait-toolba
set -euo pipefail

find_adb() {
  local c
  for c in adb \
    /mnt/c/Users/kiran/AppData/Local/Android/Sdk/platform-tools/adb.exe \
    /mnt/c/Android/Sdk/platform-tools/adb.exe \
    /mnt/c/Users/kiran/AppData/Local/Microsoft/WinGet/Packages/Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe/platform-tools/adb.exe; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ] || [ -f "$c" ]; then
      echo "$c"
      return 0
    fi
  done
  local win
  win="$(ls /mnt/c/Users/*/AppData/Local/Microsoft/WinGet/Packages/Google.PlatformTools_*/platform-tools/adb.exe 2>/dev/null | head -1 || true)"
  if [ -n "$win" ] && [ -f "$win" ]; then
    echo "$win"
    return 0
  fi
  return 1
}

ADB="$(find_adb)" || {
  echo "FAIL: adb not found"
  exit 2
}

echo "ADB=$ADB"
"$ADB" devices -l

ime_dump() {
  "$ADB" shell dumpsys input_method 2>/dev/null || true
}

ime_shown() {
  # Prefer mInputShown=true/false; fall back to InputShown
  local dump
  dump="$(ime_dump)"
  if echo "$dump" | grep -Eq 'mInputShown=true'; then
    echo true
    return 0
  fi
  if echo "$dump" | grep -Eq 'mInputShown=false'; then
    echo false
    return 0
  fi
  if echo "$dump" | grep -Eqi 'InputShown\s*[:=]\s*true'; then
    echo true
    return 0
  fi
  echo unknown
}

print_ime_context() {
  echo "=== IME snapshot ==="
  echo "mInputShown=$(ime_shown)"
  ime_dump | grep -E 'mInputShown|mFocusedWindow|mServedView|mCurMethodId|mInputShown' | head -30 || true
}

mode="${1:-status}"

case "$mode" in
  status)
    print_ime_context
    ;;
  wait-tap)
    print_ime_context
    echo
    echo "HITL: On the phone, dismiss keyboard if open, then TAP EMPTY TERMINAL SPACE once."
    echo "Press Enter here when done..."
    read -r _
    print_ime_context
    shown="$(ime_shown)"
    if [ "$shown" = true ]; then
      echo "RESULT: GREEN — keyboard shown after blank-space tap"
      exit 0
    fi
    echo "RESULT: RED — keyboard not shown after blank-space tap (mInputShown=$shown)"
    exit 1
    ;;
  wait-toolbar)
    print_ime_context
    echo
    echo "HITL: On the phone, dismiss keyboard if open, then tap the toolbar keyboard button (⌨) once."
    echo "Press Enter here when done..."
    read -r _
    print_ime_context
    shown="$(ime_shown)"
    if [ "$shown" = true ]; then
      echo "RESULT: GREEN — keyboard shown after toolbar button"
      exit 0
    fi
    echo "RESULT: RED — keyboard not shown after toolbar button (mInputShown=$shown)"
    exit 1
    ;;
  *)
    echo "Usage: $0 [status|wait-tap|wait-toolbar]"
    exit 2
    ;;
esac

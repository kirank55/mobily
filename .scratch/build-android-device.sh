#!/bin/bash
set -euo pipefail
export PATH="/home/kiran/.nvm/versions/node/v24.14.1/bin:/home/kiran/bin:/usr/bin:/bin"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
cd /home/kiran/code-wsl/mobily/android

WIN_ADB="/mnt/c/Users/kiran/AppData/Local/Microsoft/WinGet/Packages/Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe/platform-tools/adb.exe"

echo "ANDROID_HOME=$ANDROID_HOME"
if [ -x "$ANDROID_HOME/platform-tools/adb" ]; then
  # Point WSL adb client at the Windows adb server that owns the USB device.
  "$WIN_ADB" start-server >/dev/null 2>&1 || true
  export ADB_SERVER_SOCKET=tcp:$(grep -m1 nameserver /etc/resolv.conf | awk '{print $2}'):5037
  # If that fails, fall back to installing via Windows adb after gradle build.
fi

echo "WSL adb devices:"
adb devices -l || true
echo "Windows adb devices:"
"$WIN_ADB" devices -l

# Build debug APK with gradle (includes new Expo module), then install via Windows adb.
cd android
./gradlew :app:assembleDebug
APK="$(pwd)/app/build/outputs/apk/debug/app-debug.apk"
echo "APK=$APK"
"$WIN_ADB" -s 5f4e0081 install -r "$APK"
"$WIN_ADB" -s 5f4e0081 shell am force-stop io.github.kirank55.mobily
"$WIN_ADB" -s 5f4e0081 shell am start -n io.github.kirank55.mobily/.MainActivity
echo "INSTALL_OK"

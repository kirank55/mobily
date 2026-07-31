# Android emulator

Use this guide to run the Mobily Expo Android app on the local Android emulator. On Windows, run every command from an Ubuntu/WSL2 terminal; native Windows PowerShell is not supported for this repository.

## Expected emulator

The configured development AVD is:

| Name            | Device  | Android             |
| --------------- | ------- | ------------------- |
| `Mobily_API_36` | Pixel 6 | API 36 / Android 16 |

The SDK is installed at `~/Android/Sdk`. New WSL terminals get `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `adb`, and `emulator` from `~/.bashrc`.

## Start the emulator

Open a WSL terminal and start the AVD:

```bash
emulator -avd Mobily_API_36
```

Keep that terminal open while using the emulator. The first boot can take a few minutes while Android initializes the device.

Check that Android is ready:

```bash
adb devices
adb -s emulator-5554 shell getprop sys.boot_completed
```

The device should show as `device`, and the boot property should return `1`.

## Build and launch Mobily

Once the emulator is online, from the repository root run:

```bash
cd ~/code-wsl/mobily
pnpm --filter mobily-android android
```

Expo builds the debug app, installs it on the running emulator, and starts it. To test the full pairing flow, run the Station CLI in a separate WSL terminal as described in [`development.md`](development.md), then scan the displayed QR code from the Android app.

## Stop the emulator

Shut down the virtual device cleanly with:

```bash
adb -s emulator-5554 emu kill
```

You can start it again with the same `emulator -avd` command.

## Troubleshooting

If `adb devices` shows `offline`, wait for boot to finish and retry. If it remains offline, restart the ADB server:

```bash
adb kill-server
adb start-server
adb devices
```

If the emulator reports that KVM acceleration is unavailable, verify access to `/dev/kvm`:

```bash
id
ls -l /dev/kvm
```

The Linux user must belong to the `kvm` group. Add the user from Windows PowerShell if necessary, replacing `your-linux-user` with the WSL username:

```powershell
wsl.exe -d Ubuntu -u root -- usermod -aG kvm your-linux-user
```

Open a new WSL terminal after changing group membership. If the AVD is not listed, check the installed profiles with:

```bash
emulator -list-avds
```

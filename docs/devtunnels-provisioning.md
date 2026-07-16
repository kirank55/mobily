# Dev Tunnels First-Run Setup

Mobily uses Microsoft's official `devtunnel` helper to authenticate the Station
and host a temporary tunnel. The helper supports GitHub, Microsoft personal,
and Microsoft Entra ID accounts. It caches the selected account so Mobily does
not ask the operator to sign in on every run.

No Mobily OAuth client ID, client secret, or `MOBILY_DEVTUNNELS_*` environment
variable is required.

## Run Mobily

```bash
npx mobily --tunnel devtunnels
```

The CLI keeps the pairing QR visible in its terminal. When tmux is available,
open a second terminal and run the printed `tmux attach-session` command to use
the same Session from the Station while Mobily continues serving the phone.

If the helper is not installed, Mobily prints the appropriate official install
command. Install it in another terminal, then press Enter in Mobily to retry.

### Linux and WSL

```bash
curl -sL https://aka.ms/DevTunnelCliInstall | bash
```

### macOS

```bash
brew install --cask devtunnel
```

### Windows

```powershell
winget install Microsoft.devtunnel
```

## First login

Mobily checks the helper's cached login. When none exists, choose GitHub or
Microsoft and follow the device-code instructions printed in the terminal.
GitHub is the default when Enter is pressed without a selection.

The provider can also be selected explicitly:

```bash
npx mobily --tunnel devtunnels --devtunnels-provider github
npx mobily --tunnel devtunnels --devtunnels-provider microsoft
```

The helper runs these official commands internally:

```bash
devtunnel user login -g -d # GitHub
devtunnel user login -d    # Microsoft / Entra ID
```

After login, Mobily hosts its local HTTP/WebSocket port with anonymous tunnel
access. Anonymous access only reaches Mobily's pairing and WebSocket protocol;
the Android app must still pass Mobily's Device Key authentication.

See the [official Dev Tunnels CLI reference](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/cli-commands).

## Troubleshooting

Expected installation and sign-in failures are printed without a stack trace.
Use `--verbose` when diagnostic details are needed:

```bash
npx mobily --tunnel devtunnels --verbose
```

Mobily shuts temporary tunnels down through the helper's graceful Ctrl-C path,
then explicitly deletes the temporary tunnel ID as a cross-platform fallback.
If an older interrupted run left the account quota full, remove the unused
tunnels once and retry:

```bash
devtunnel delete-all
```

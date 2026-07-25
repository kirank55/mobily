# After unlocking the phone and opening the Mobily terminal (shell, no OpenCode):
#   1. Ensure Metro has reloaded (shake device -> Reload, or reopen terminal screen)
#   2. Run:  powershell -File .scratch/verify-ime-green.ps1
# It polls until you tap empty terminal space and mInputShown becomes true.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$here\ime-check.ps1" -Mode wait-tap -TimeoutSec 90

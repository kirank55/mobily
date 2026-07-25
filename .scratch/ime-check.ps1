# IME feedback loop for Android terminal tap-to-open keyboard (Windows adb).
# Usage:
#   .\.scratch\ime-check.ps1 status
#   .\.scratch\ime-check.ps1 wait-tap      # poll until keyboard shown or timeout (HITL)
#   .\.scratch\ime-check.ps1 wait-toolbar
param(
  [ValidateSet('status', 'wait-tap', 'wait-toolbar')]
  [string]$Mode = 'status',
  [int]$TimeoutSec = 45
)

$ErrorActionPreference = 'Stop'
$adb = (Get-Command adb -ErrorAction Stop).Source
Write-Host "ADB=$adb"
& $adb devices -l | Out-Host

function Get-ImeDump {
  & $adb shell dumpsys input_method 2>$null | Out-String
}

function Get-ImeShown {
  $dump = Get-ImeDump
  if ($dump -match '(?m)^\s*mInputShown=true\s*$') { return 'true' }
  if ($dump -match 'mInputShown=true') { return 'true' }
  if ($dump -match 'mInputShown=false') { return 'false' }
  return 'unknown'
}

function Show-ImeContext {
  Write-Host '=== IME snapshot ==='
  $shown = Get-ImeShown
  Write-Host "mInputShown=$shown"
  (Get-ImeDump) -split "`n" |
    Where-Object { $_ -match 'mInputShown=|mFocusedWindowSoftInputMode|mServedView=' } |
    Select-Object -First 12 |
    ForEach-Object { Write-Host $_.Trim() }
  return $shown
}

function Wait-ForImeShown {
  param([string]$Prompt, [int]$Seconds)
  Write-Host "Baseline:"
  [void](Show-ImeContext)
  # Best-effort dismiss
  if ((Get-ImeShown) -eq 'true') {
    & $adb shell input keyevent 4 2>$null | Out-Null
    Start-Sleep -Milliseconds 500
  }
  Write-Host ""
  Write-Host $Prompt
  Write-Host ("Polling mInputShown for {0}s..." -f $Seconds)
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if ((Get-ImeShown) -eq 'true') {
      Write-Host 'After action:'
      [void](Show-ImeContext)
      Write-Host 'RESULT: GREEN - keyboard shown'
      exit 0
    }
  }
  Write-Host 'After timeout:'
  $after = Show-ImeContext
  Write-Host ("RESULT: RED - keyboard not shown (mInputShown={0})" -f $after)
  exit 1
}

switch ($Mode) {
  'status' { [void](Show-ImeContext) }
  'wait-tap' {
    Wait-ForImeShown -Seconds $TimeoutSec -Prompt 'HITL: On the phone, TAP EMPTY TERMINAL SPACE once (shell, no OpenCode).'
  }
  'wait-toolbar' {
    Wait-ForImeShown -Seconds $TimeoutSec -Prompt 'HITL: On the phone, tap the toolbar keyboard button once.'
  }
}

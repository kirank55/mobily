$ErrorActionPreference = 'Stop'

function Invoke-Cdp {
  param($Ws, [string]$Method, $Params = @{})
  $script:cdpId++
  $id = $script:cdpId
  $payload = @{ id = $id; method = $Method; params = $Params } | ConvertTo-Json -Compress -Depth 8
  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $segment = [ArraySegment[byte]]::new($bytes)
  $send = $Ws.SendAsync($segment, [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None)
  $send.Wait()
  while ($true) {
    $buffer = New-Object byte[] 1048576
    $seg = [ArraySegment[byte]]::new($buffer)
    $result = $Ws.ReceiveAsync($seg, [Threading.CancellationToken]::None).Result
    $text = [Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
    $msg = $text | ConvertFrom-Json
    if ($msg.id -eq $id) {
      if ($msg.error) { throw ($msg.error | ConvertTo-Json -Compress) }
      return $msg.result
    }
  }
}

$appPid = (adb shell pidof com.anonymous.mobily).Trim()
Write-Host "appPid=$appPid"
adb forward --remove-all | Out-Null
adb forward tcp:9222 "localabstract:webview_devtools_remote_$appPid" | Out-Null

$list = Invoke-RestMethod -Uri 'http://127.0.0.1:9222/json/list'
$page = $list | Where-Object { $_.title -eq 'mobily terminal' } | Select-Object -First 1
if (-not $page) { $page = $list[0] }
Write-Host "WS $($page.webSocketDebuggerUrl)"

$ws = [Net.WebSockets.ClientWebSocket]::new()
$ws.ConnectAsync([Uri]$page.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
$script:cdpId = 0

[void](Invoke-Cdp $ws 'Runtime.enable')
$probe = Invoke-Cdp $ws 'Runtime.evaluate' @{
  expression = @'
(() => {
  const viewport = document.getElementById('viewport');
  const screen = document.querySelector('.xterm-screen');
  const vr = viewport.getBoundingClientRect();
  const sr = screen ? screen.getBoundingClientRect() : null;
  return {
    hasFocusHelper: document.documentElement.outerHTML.includes('focusTerminalInput'),
    active: document.activeElement && document.activeElement.className,
    viewport: { x: vr.left, y: vr.top, w: vr.width, h: vr.height },
    screen: sr ? { x: sr.left, y: sr.top, w: sr.width, h: sr.height } : null,
  };
})()
'@
  returnByValue = $true
}
Write-Host 'PROBE' ($probe.result.value | ConvertTo-Json -Compress)
$info = $probe.result.value
if (-not $info.hasFocusHelper) {
  Write-Host 'SHIPPED_HTML_MISSING_focusTerminalInput - reload the app bundle'
  exit 2
}

$x = [int]($info.viewport.x + $info.viewport.w / 2)
if ($info.screen) {
  $y = [Math]::Min([int]($info.viewport.y + $info.viewport.h - 4), [int]($info.screen.y + $info.screen.h + 8))
} else {
  $y = [int]($info.viewport.y + $info.viewport.h * 0.5)
}
Write-Host "TAP x=$x y=$y"

[void](Invoke-Cdp $ws 'Input.dispatchTouchEvent' @{
  type = 'touchStart'
  touchPoints = @(@{ x = $x; y = $y; id = 0 })
})
[void](Invoke-Cdp $ws 'Input.dispatchTouchEvent' @{
  type = 'touchEnd'
  touchPoints = @()
})
Start-Sleep -Milliseconds 700

$after = Invoke-Cdp $ws 'Runtime.evaluate' @{
  expression = @'
({
  active: document.activeElement && document.activeElement.className,
  isTextarea: !!(document.activeElement &&
    document.activeElement.classList.contains('xterm-helper-textarea')),
})
'@
  returnByValue = $true
}
Write-Host 'AFTER' ($after.result.value | ConvertTo-Json -Compress)
$ws.CloseAsync([Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', [Threading.CancellationToken]::None).Wait()

$ime = adb shell dumpsys input_method | Select-String -Pattern 'mInputShown=' | Select-Object -First 3
Write-Host 'IME' ($ime -join ' | ')
if (-not $after.result.value.isTextarea) { exit 1 }
if (($ime | Out-String) -notmatch 'mInputShown=true') {
  Write-Host 'RESULT: RED - focused but keyboard not shown (or CDP touch not treated as user gesture)'
  exit 1
}
Write-Host 'RESULT: GREEN'
exit 0

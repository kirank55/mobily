$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), 8081)
$listener.Start()
while ($true) {
  $client = $listener.AcceptTcpClient()
  $target = $null
  try {
    $target = [System.Net.Sockets.TcpClient]::new()
    $target.Connect('172.30.130.83', 8081)
    $left = $client.GetStream()
    $right = $target.GetStream()
    $copyLeft = $left.CopyToAsync($right)
    $copyRight = $right.CopyToAsync($left)
    [System.Threading.Tasks.Task]::WaitAny(@($copyLeft, $copyRight)) | Out-Null
  } catch {
  } finally {
    $client.Close()
    if ($null -ne $target) { $target.Close() }
  }
}

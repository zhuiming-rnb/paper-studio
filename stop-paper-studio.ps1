# Paper Studio - stop the hidden server (kills only the paper-studio node process)
$ErrorActionPreference = 'SilentlyContinue'
$targets = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'node.exe' -and $_.CommandLine -match 'server\.js'
}
if ($targets) {
  foreach ($t in $targets) {
    Stop-Process -Id $t.ProcessId -Force
    Write-Output ("stopped paper-studio server pid " + $t.ProcessId)
  }
} else {
  Write-Output 'paper-studio server is not running'
}

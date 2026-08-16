# Paper Studio - hidden launcher (no console windows)
# Started from the desktop shortcut via: powershell -WindowStyle Hidden -File launch.ps1
$ErrorActionPreference = 'SilentlyContinue'
$port = 3000
$dir = 'E:\workplace\paper-studio'
$url = "http://127.0.0.1:$port/api/papers"
$log = Join-Path $env:TEMP 'paper-studio-launch.log'

function Log($msg) {
  Add-Content -Path $log -Value ("[" + (Get-Date -Format 'HH:mm:ss') + "] " + $msg) -Encoding UTF8
}

function Test-Port {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1
    return $r.StatusCode -eq 200
  } catch {
    return $false
  }
}

# Already running? Just open the browser.
if (Test-Port) {
  Log 'server already running, opening browser'
  Start-Process $url
  exit 0
}

# Start the server hidden (no window, independent process).
Log 'starting hidden server'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm start' -WorkingDirectory $dir -WindowStyle Hidden

# Wait up to 30s for the server to be ready, then open the browser.
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Port) {
    Log "server ready after $($i + 1)s, opening browser"
    Start-Process $url
    exit 0
  }
}

Log 'server failed to become ready in 30s'
exit 1

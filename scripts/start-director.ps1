param([ValidateRange(1, 65535)][int]$Port = 8788)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$usersFile = Join-Path $root 'server\users.local.json'
$sessionFile = Join-Path $root 'server\session.secret'
$node = Join-Path $root 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $node)) { $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source }
if (-not $node -or -not (Test-Path -LiteralPath $node)) { throw 'Falta Node.js. Use el paquete en una PC con Node.js 24 o incluya runtime\node.exe.' }
if (-not (Test-Path -LiteralPath $usersFile)) { throw 'Falta server\users.local.json.' }
if (-not (Test-Path -LiteralPath $sessionFile)) {
  $bytes = [byte[]]::new(48)
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  [IO.File]::WriteAllText($sessionFile, [Convert]::ToBase64String($bytes))
}
$env:APP_ROOT = $root
$env:APP_DIST_DIR = Join-Path $root 'dist'
$env:APP_DATA_DIR = Join-Path $root 'var'
$env:APP_USERS_FILE = $usersFile
$env:APP_SESSION_SECRET = (Get-Content -Raw -LiteralPath $sessionFile).Trim()
$env:APP_COOKIE_SECURE = 'false'
$env:APP_HOST = '127.0.0.1'
$env:APP_PORT = [string]$Port
New-Item -ItemType Directory -Force -Path (Join-Path $root 'var') | Out-Null
Push-Location $root
try {
  $stdout = Join-Path $root 'var\server.log'
  $stderr = Join-Path $root 'var\server-error.log'
  $entry = Join-Path $root 'server\start.mjs'
  $server = Start-Process -FilePath $node -ArgumentList ('"' + $entry + '"') -WorkingDirectory $root -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 250
    try { $check = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2; if ($check.StatusCode -eq 200) { $ready = $true; break } } catch { }
  }
  if (-not $ready) { throw "El servidor no inició. Revisá $stderr" }
  Start-Process "http://127.0.0.1:$Port/" | Out-Null
  Wait-Process -Id $server.Id
}
finally { $env:APP_SESSION_SECRET = $null; Pop-Location }

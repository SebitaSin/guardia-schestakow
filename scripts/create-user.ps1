param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9._-]{3,64}$')][string]$Id,
  [Parameter(Mandatory = $true)][string]$Name,
  [Parameter(Mandatory = $true)][ValidateSet('VIEWER','STAFF','DRIVER','COORDINATOR','DIRECTION','ADMIN')][string]$Role,
  [string]$StaffId = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$usersFile = Join-Path $projectRoot 'server\users.local.json'
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
  $toolsDir = Join-Path (Split-Path -Parent (Split-Path -Parent $projectRoot)) 'tools'
  $candidate = Get-ChildItem -LiteralPath $toolsDir -Directory -Filter 'node-v*-win-x64' -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'node.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ($candidate) { $node = [pscustomobject]@{ Source = $candidate } }
}
if (-not $node) { throw 'No se encontró Node.js.' }
$password = Read-Host 'Contraseña (mínimo 12 caracteres)' -AsSecureString
$confirm = Read-Host 'Repetir contraseña' -AsSecureString
$ptr1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
$ptr2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirm)
try {
  $plain1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr1)
  $plain2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr2)
  if ($plain1 -ne $plain2) { throw 'Las contraseñas no coinciden.' }
  if ($plain1.Length -lt 12) { throw 'La contraseña debe tener al menos 12 caracteres.' }
  $hash = ($plain1 | & $node.Source (Join-Path $PSScriptRoot 'hash-password.mjs')).Trim()
} finally {
  if ($ptr1 -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr1) }
  if ($ptr2 -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr2) }
  $plain1 = $null
  $plain2 = $null
}

$users = @()
if (Test-Path -LiteralPath $usersFile) {
  $existing = Get-Content -Raw -LiteralPath $usersFile | ConvertFrom-Json
  $users = @($existing.users | Where-Object { $_.id -ne $Id })
}
$users += [pscustomobject]@{ id=$Id; name=$Name; role=$Role; staffId=($(if($StaffId){$StaffId}else{$null})); passwordHash=$hash }
$json = @{ users=$users } | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText($usersFile, ($json + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
Write-Host "Usuario guardado en $usersFile"

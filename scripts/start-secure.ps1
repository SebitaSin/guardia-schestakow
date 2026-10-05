param(
  [ValidateRange(1, 65535)][int]$Port = 8788
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$usersFile = Join-Path $projectRoot 'server\users.local.json'
$sessionFile = Join-Path $projectRoot 'server\session.secret'
$imapCredentialFile = Join-Path $projectRoot 'server\imap-credential.clixml'
$mapsCredentialFile = Join-Path $projectRoot 'server\google-maps-credential.clixml'
$openaiCredentialFile = Join-Path $projectRoot 'server\openai-credential.clixml'
if (-not (Test-Path -LiteralPath $usersFile)) {
  throw 'Falta server\users.local.json. Crear el primer usuario con scripts\create-user.ps1.'
}
if (-not (Test-Path -LiteralPath $sessionFile)) {
  $bytes = [byte[]]::new(48)
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  [IO.File]::WriteAllText($sessionFile, [Convert]::ToBase64String($bytes))
}
$env:APP_ROOT = $projectRoot
$env:APP_DATA_DIR = Join-Path $projectRoot 'var'
$env:APP_USERS_FILE = $usersFile
$env:APP_SESSION_SECRET = (Get-Content -Raw -LiteralPath $sessionFile).Trim()
$env:APP_COOKIE_SECURE = 'false'
$env:APP_HOST = '127.0.0.1'
$env:APP_PORT = [string]$Port
$env:WHATSAPP_PUBLIC_NUMBER = '2604056998'
if (Test-Path -LiteralPath $imapCredentialFile) {
  $imapCredential = Import-Clixml -LiteralPath $imapCredentialFile
  if (-not ($imapCredential -is [Management.Automation.PSCredential])) {
    throw 'La credencial IMAP protegida no tiene un formato válido.'
  }
  $imapPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($imapCredential.Password)
  try {
    $env:HOSPITAL_IMAP_ACCOUNT = $imapCredential.UserName
    $env:HOSPITAL_IMAP_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($imapPtr)
  } finally {
    if ($imapPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($imapPtr) }
  }
  if (-not $env:GMAIL_SYNC_ENABLED) { $env:GMAIL_SYNC_ENABLED = 'true' }
  if (-not $env:GMAIL_SYNC_HOURS) { $env:GMAIL_SYNC_HOURS = '24' }
}
if (Test-Path -LiteralPath $mapsCredentialFile) {
  $mapsCredential = Import-Clixml -LiteralPath $mapsCredentialFile
  if (-not ($mapsCredential -is [Management.Automation.PSCredential])) { throw 'La credencial protegida de Google Maps no tiene un formato válido.' }
  $mapsPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($mapsCredential.Password)
  try {
    $env:GOOGLE_MAPS_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($mapsPtr)
    $env:GOOGLE_ROUTES_API_KEY = $env:GOOGLE_MAPS_API_KEY
  } finally {
    if ($mapsPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($mapsPtr) }
  }
}
if (Test-Path -LiteralPath $openaiCredentialFile) {
  $openaiCredential = Import-Clixml -LiteralPath $openaiCredentialFile
  if (-not ($openaiCredential -is [Management.Automation.PSCredential])) { throw 'La credencial protegida de OpenAI no tiene un formato válido.' }
  $openaiPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($openaiCredential.Password)
  try { $env:OPENAI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($openaiPtr) }
  finally { if ($openaiPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($openaiPtr) } }
}

# WhatsApp Cloud API: credencial protegida (DPAPI) creada con CONFIGURAR-WHATSAPP.cmd
$whatsappCredentialFile = Join-Path $projectRoot 'server\whatsapp-credential.clixml'
if (Test-Path -LiteralPath $whatsappCredentialFile) {
  $wa = Import-Clixml -LiteralPath $whatsappCredentialFile
  if (-not ($wa -is [hashtable])) { throw 'La credencial protegida de WhatsApp no tiene un formato valido. Volve a correr CONFIGURAR-WHATSAPP.cmd.' }
  function ConvertFrom-WhatsAppSecret($value) {
    if ($null -eq $value) { return '' }
    if ($value -isnot [Security.SecureString]) { throw 'La credencial de WhatsApp no esta protegida. Volve a correr CONFIGURAR-WHATSAPP.cmd.' }
    return [Net.NetworkCredential]::new('', $value).Password
  }
  $env:WHATSAPP_PHONE_NUMBER_ID = [string]$wa.phoneNumberId
  $env:WHATSAPP_GRAPH_VERSION = [string]$wa.graphVersion
  $env:WHATSAPP_ACCESS_TOKEN = ConvertFrom-WhatsAppSecret $wa.accessToken
  $env:WHATSAPP_APP_SECRET = ConvertFrom-WhatsAppSecret $wa.appSecret
  $env:WHATSAPP_VERIFY_TOKEN = ConvertFrom-WhatsAppSecret $wa.verifyToken
}

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) {
  $toolsDir = Join-Path (Split-Path -Parent (Split-Path -Parent $projectRoot)) 'tools'
  $candidate = Get-ChildItem -LiteralPath $toolsDir -Directory -Filter 'node-v*-win-x64' -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'npm.cmd' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ($candidate) { $npm = [pscustomobject]@{ Source = $candidate } }
}
if (-not $npm) { throw 'No se encontró Node.js/npm. Instalá Node.js 24 o configurá la carpeta tools.' }

Push-Location $projectRoot
try {
  & $npm.Source run build
  if ($LASTEXITCODE -ne 0) { throw 'La compilación falló.' }
  & $npm.Source run serve
  if ($LASTEXITCODE -ne 0) { throw 'El servidor terminó con error.' }
} finally {
  $env:HOSPITAL_IMAP_PASSWORD = $null
  $env:GOOGLE_MAPS_API_KEY = $null
  $env:GOOGLE_ROUTES_API_KEY = $null
  $env:OPENAI_API_KEY = $null
  $env:WHATSAPP_ACCESS_TOKEN = $null
  $env:WHATSAPP_APP_SECRET = $null
  $env:WHATSAPP_VERIFY_TOKEN = $null
  Pop-Location
}

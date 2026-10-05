param([switch]$ConSecretoDeApp)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $projectRoot 'server\whatsapp-credential.clixml'

$existing = $null
if (Test-Path -LiteralPath $target) { try { $existing = Import-Clixml -LiteralPath $target } catch { $existing = $null } }

# Datos que no son secretos: no se preguntan.
$phoneId = if ($existing -and $existing.phoneNumberId) { [string]$existing.phoneNumberId } else { '1318060761395326' }
$version = if ($existing -and $existing.graphVersion) { [string]$existing.graphVersion } else { 'v23.0' }

Write-Host ''
Write-Host 'Pega el token de acceso (clic derecho). No se va a ver nada en pantalla. Despues Enter.'
$token = Read-Host 'Token' -AsSecureString
if ($token.Length -eq 0 -and $existing -and $existing.accessToken) { $token = $existing.accessToken }
if (-not $token -or $token.Length -lt 20) { throw 'No se pego un token valido. Copialo de nuevo y volve a abrir este programa.' }

$secret = if ($existing) { $existing.appSecret } else { $null }
if ($ConSecretoDeApp) {
  $typed = Read-Host 'Secreto de la app' -AsSecureString
  if ($typed.Length -gt 0) { $secret = $typed }
}

$verify = if ($existing -and $existing.verifyToken) { $existing.verifyToken } else {
  $bytes = [byte[]]::new(24)
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  ConvertTo-SecureString (([BitConverter]::ToString($bytes)).Replace('-', '').ToLower()) -AsPlainText -Force
}

@{ phoneNumberId = $phoneId; graphVersion = $version; accessToken = $token; appSecret = $secret; verifyToken = $verify } | Export-Clixml -LiteralPath $target
Write-Host ''
Write-Host 'LISTO. WhatsApp quedo guardado de forma protegida para este usuario de Windows.'
Write-Host 'Reiniciando el servidor para aplicar el cambio...'

# Cierra el servidor viejo (solo si es node escuchando en el puerto 8788) y lo vuelve a abrir.
$listener = Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $owner = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
  if ($owner -and $owner.ProcessName -eq 'node') {
    Stop-Process -Id $owner.Id -Force
    Start-Sleep -Seconds 2
  } else {
    Write-Host 'El puerto 8788 lo usa otro programa. Cerra la ventana negra del servidor a mano.'
  }
}
Start-Process -FilePath (Join-Path $projectRoot 'INICIAR-HOSPITAL-SEGURO.cmd') -WorkingDirectory $projectRoot
Write-Host 'Servidor abierto en otra ventana. Tarda un minuto en compilar. Podes cerrar esta ventana.'

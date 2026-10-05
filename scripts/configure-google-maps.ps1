$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $projectRoot 'server\google-maps-credential.clixml'

$browserKey = Read-Host 'Clave de navegador de Google Maps (restringida por dominio)'
if ([string]::IsNullOrWhiteSpace($browserKey) -or $browserKey.Length -lt 20) { throw 'La clave de navegador no parece válida.' }
$serverKey = Read-Host 'Clave de servidor para Geocoding API (restringida por IP)' -AsSecureString
$credential = [Management.Automation.PSCredential]::new($browserKey.Trim(), $serverKey)
$credential | Export-Clixml -LiteralPath $target
Write-Host 'Google Maps quedó guardado de forma protegida para este usuario de Windows.'

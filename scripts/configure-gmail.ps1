param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[^@\s]+@[^@\s]+\.[^@\s]+$')]
  [string]$Account
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $projectRoot 'server\imap-credential.clixml'
$password = Read-Host 'Contraseña de aplicación de Gmail (16 caracteres)' -AsSecureString
$credential = New-Object Management.Automation.PSCredential($Account, $password)
$credential | Export-Clixml -LiteralPath $destination -Force
Write-Host 'Credencial Gmail guardada con protección DPAPI de Windows.'
Write-Host 'Sólo este usuario de Windows en esta PC puede descifrarla.'

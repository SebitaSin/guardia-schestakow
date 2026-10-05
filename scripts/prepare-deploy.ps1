param(
  [Parameter(Mandatory = $true)][ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })][string]$UsersFile,
  [Parameter(Mandatory = $true)][ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })][string]$CatalogFile,
  [Parameter(Mandatory = $true)][ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })][string]$InternacionFile,
  [Parameter(Mandatory = $true)][ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })][string]$BrowserKeyFile,
  [Parameter(Mandatory = $true)][ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })][string]$ServerKeyFile
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $projectRoot 'deploy\private'
New-Item -ItemType Directory -Force -Path $target | Out-Null

$copies = @(
  @{ Source = $UsersFile; Destination = (Join-Path $target 'users.json') },
  @{ Source = $CatalogFile; Destination = (Join-Path $target 'catalog.json') },
  @{ Source = $InternacionFile; Destination = (Join-Path $target 'internacion.json') },
  @{ Source = $BrowserKeyFile; Destination = (Join-Path $target 'google-maps-browser-key.txt') },
  @{ Source = $ServerKeyFile; Destination = (Join-Path $target 'google-maps-server-key.txt') }
)

foreach ($item in $copies) {
  Copy-Item -LiteralPath $item.Source -Destination $item.Destination -Force
}

Write-Host "Archivos privados preparados en $target"
Write-Host 'No suba deploy/private al repositorio ni la envíe por chat.'

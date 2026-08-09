param(
  [Parameter(Mandatory=$true)][string]$SupabaseUrl,
  [Parameter(Mandatory=$true)][string]$AnonKey,
  [Parameter(Mandatory=$true)][string]$DeviceToken,
  [Parameter(Mandatory=$true)][string]$PrinterName
)

$ErrorActionPreference = "Stop"
$installDir = Join-Path $env:LOCALAPPDATA "MesaVivaConnector"
$startupDir = [Environment]::GetFolderPath("Startup")
$startupFile = Join-Path $startupDir "Mesa Viva Conector.cmd"
New-Item -ItemType Directory -Path $installDir -Force | Out-Null

$existingPid = Join-Path $installDir "connector.pid"
if (Test-Path -LiteralPath $existingPid) {
  $oldPid = Get-Content -LiteralPath $existingPid -ErrorAction SilentlyContinue
  if ($oldPid) { Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue }
}

Copy-Item -LiteralPath (Join-Path $PSScriptRoot "MesaVivaConnector.ps1") -Destination (Join-Path $installDir "MesaVivaConnector.ps1") -Force
@{ SupabaseUrl=$SupabaseUrl; AnonKey=$AnonKey; DeviceToken=$DeviceToken; PrinterName=$PrinterName } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installDir "config.json") -Encoding UTF8

$configPath = Join-Path $installDir "config.json"
$agentPath = Join-Path $installDir "MesaVivaConnector.ps1"
$startupCommand = "@echo off`r`nstart `"`" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$agentPath`" -ConfigPath `"$configPath`"`r`n"
Set-Content -LiteralPath $startupFile -Value $startupCommand -Encoding ASCII

$printer = Get-CimInstance Win32_Printer | Where-Object Name -eq $PrinterName | Select-Object -First 1
if (!$printer) { throw "A impressora '$PrinterName' não foi encontrada no Windows." }
[void](Invoke-CimMethod -InputObject $printer -MethodName SetDefaultPrinter)

Start-Process powershell.exe -ArgumentList @("-NoProfile","-WindowStyle","Hidden","-ExecutionPolicy","Bypass","-File",$agentPath,"-ConfigPath",$configPath) -WindowStyle Hidden
Start-Sleep -Seconds 3
Write-Output "Conector Mesa Viva instalado e iniciado para $PrinterName."

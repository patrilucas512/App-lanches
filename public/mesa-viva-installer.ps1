param(
  [Parameter(Mandatory=$true)][string]$SupabaseUrl,
  [Parameter(Mandatory=$true)][string]$AnonKey,
  [Parameter(Mandatory=$true)][string]$DeviceToken,
  [Parameter(Mandatory=$true)][string]$SiteBaseUrl
)

$ErrorActionPreference = "Stop"
$installDir = Join-Path $env:LOCALAPPDATA "MesaVivaConnector"
$startupFile = Join-Path ([Environment]::GetFolderPath("Startup")) "Mesa Viva Conector.cmd"
New-Item -ItemType Directory -Path $installDir -Force | Out-Null

$existingPid = Join-Path $installDir "connector.pid"
if (Test-Path -LiteralPath $existingPid) {
  $oldPid = Get-Content -LiteralPath $existingPid -ErrorAction SilentlyContinue
  if ($oldPid) { Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue }
}

$ignored = 'Microsoft Print|OneNote|Fax|XPS|PDF'
$printers = @(Get-CimInstance Win32_Printer | Where-Object { $_.Name -notmatch $ignored })
$printer = $printers | Where-Object Default | Select-Object -First 1
if (!$printer) { $printer = $printers | Where-Object { $_.Name -match 'POS|58|80|Thermal|Termica|Receipt|Cupom' } | Select-Object -First 1 }
if (!$printer) { $printer = $printers | Select-Object -First 1 }
if (!$printer) { throw "Nenhuma impressora instalada foi encontrada. Instale a impressora no Windows e tente novamente." }

$agentPath = Join-Path $installDir "MesaVivaConnector.ps1"
$configPath = Join-Path $installDir "config.json"
Invoke-WebRequest -UseBasicParsing -Uri "$($SiteBaseUrl.TrimEnd('/'))/mesa-viva-agent.ps1" -OutFile $agentPath
@{ SupabaseUrl=$SupabaseUrl; AnonKey=$AnonKey; DeviceToken=$DeviceToken; PrinterName=[string]$printer.Name } |
  ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8

$headers = @{ apikey=$AnonKey; Authorization="Bearer $AnonKey" }
$body = @{ requested_token=$DeviceToken; requested_printer_name=[string]$printer.Name } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri "$($SupabaseUrl.TrimEnd('/'))/rest/v1/rpc/activate_printer_connector" -Headers $headers -ContentType "application/json" -Body $body | Out-Null

$startupCommand = "@echo off`r`nstart `"`" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$agentPath`" -ConfigPath `"$configPath`"`r`n"
Set-Content -LiteralPath $startupFile -Value $startupCommand -Encoding ASCII
Start-Process powershell.exe -ArgumentList @("-NoProfile","-WindowStyle","Hidden","-ExecutionPolicy","Bypass","-File",$agentPath,"-ConfigPath",$configPath) -WindowStyle Hidden
Start-Sleep -Seconds 3
Write-Host ""
Write-Host "CONCLUIDO: impressao direta ativada em '$($printer.Name)'." -ForegroundColor Green
Write-Host "A cozinha ja pode imprimir com um clique."

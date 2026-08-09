param([string]$ConfigPath = "$env:LOCALAPPDATA\MesaVivaConnector\config.json")

$ErrorActionPreference = "Stop"
$connectorDir = Split-Path -Parent $ConfigPath
$logPath = Join-Path $connectorDir "connector.log"
$pidPath = Join-Path $connectorDir "connector.pid"

function Write-ConnectorLog([string]$Message) {
  Add-Content -LiteralPath $logPath -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message) -Encoding UTF8
  if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 1048576) {
    Get-Content -LiteralPath $logPath -Tail 500 | Set-Content -LiteralPath $logPath -Encoding UTF8
  }
}

if (!(Test-Path -LiteralPath $ConfigPath)) { throw "Configuracao do Conector Mesa Viva nao encontrada." }
$config = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
Set-Content -LiteralPath $pidPath -Value $PID -Encoding ASCII

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class MesaVivaRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOC_INFO_1 {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool OpenPrinter(string name, out IntPtr printer, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool ClosePrinter(IntPtr printer);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] static extern int StartDocPrinter(IntPtr printer, int level, [In] DOC_INFO_1 info);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndDocPrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool StartPagePrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndPagePrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool WritePrinter(IntPtr printer, byte[] bytes, int count, out int written);
  public static void Send(string printerName, byte[] bytes) {
    IntPtr printer;
    if (!OpenPrinter(printerName, out printer, IntPtr.Zero)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    try {
      var info = new DOC_INFO_1 { pDocName = "Mesa Viva - Comanda", pDataType = "RAW", pOutputFile = null };
      if (StartDocPrinter(printer, 1, info) == 0) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      try {
        if (!StartPagePrinter(printer)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try { int written; if (!WritePrinter(printer, bytes, bytes.Length, out written) || written != bytes.Length) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
        finally { EndPagePrinter(printer); }
      } finally { EndDocPrinter(printer); }
    } finally { ClosePrinter(printer); }
  }
}
"@

function Convert-ToPrinterText([string]$Text) {
  $normalized = $Text.Normalize([Text.NormalizationForm]::FormD)
  $builder = New-Object Text.StringBuilder
  foreach ($character in $normalized.ToCharArray()) {
    if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($character) -ne [Globalization.UnicodeCategory]::NonSpacingMark) { [void]$builder.Append($character) }
  }
  return $builder.ToString().Normalize([Text.NormalizationForm]::FormC)
}

function Send-Receipt([string]$Text, [string]$PrinterName) {
  $content = [Text.Encoding]::GetEncoding(850).GetBytes((Convert-ToPrinterText $Text) + "`r`n`r`n`r`n")
  $bytes = New-Object 'System.Collections.Generic.List[byte]'
  $bytes.AddRange([byte[]](27,64)); $bytes.AddRange($content); $bytes.AddRange([byte[]](29,86,66,0))
  [MesaVivaRawPrinter]::Send($PrinterName, $bytes.ToArray())
}

function Invoke-MesaVivaRpc([string]$FunctionName, [hashtable]$Body) {
  $headers = @{ apikey = [string]$config.AnonKey; Authorization = "Bearer $($config.AnonKey)" }
  return Invoke-RestMethod -Method Post -Uri "$($config.SupabaseUrl.TrimEnd('/'))/rest/v1/rpc/$FunctionName" -Headers $headers -ContentType "application/json" -Body ($Body | ConvertTo-Json -Compress)
}

Write-ConnectorLog "Conector iniciado para $($config.PrinterName)."
while ($true) {
  try {
    $response = Invoke-MesaVivaRpc "fetch_printer_jobs" @{ requested_token = [string]$config.DeviceToken }
    foreach ($job in @($response.jobs)) {
      try {
        Send-Receipt ([string]$job.text) ([string]$config.PrinterName)
        [void](Invoke-MesaVivaRpc "complete_printer_job" @{ requested_token=[string]$config.DeviceToken; requested_job_id=[string]$job.id; requested_success=$true; requested_error=$null })
        Write-ConnectorLog "Comanda $($job.id) impressa."
      } catch {
        $failure = $_.Exception.Message
        try { [void](Invoke-MesaVivaRpc "complete_printer_job" @{ requested_token=[string]$config.DeviceToken; requested_job_id=[string]$job.id; requested_success=$false; requested_error=$failure }) } catch {}
        Write-ConnectorLog "Falha na comanda $($job.id): $failure"
      }
    }
  } catch { Write-ConnectorLog "Falha de conexao: $($_.Exception.Message)" }
  Start-Sleep -Seconds 2
}

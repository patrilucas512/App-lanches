"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Connection = "usb" | "bluetooth" | "network";
type ConnectorStatus = { configured: boolean; online: boolean; printer_name?: string | null; last_seen_at?: string | null };
type Initial = { connection: Connection; name: string; paperWidth: 58 | 80; networkAddress: string; autoPrint: boolean; completed: boolean; connector: ConnectorStatus };
const connections: { id: Connection; title: string; description: string }[] = [
  { id: "usb", title: "USB", description: "Ideal para a impressora ligada ao computador do caixa ou da cozinha." },
  { id: "bluetooth", title: "Bluetooth", description: "Para impressoras pareadas com celular, tablet ou computador." },
  { id: "network", title: "Wi-Fi ou rede", description: "Para impressoras compartilhadas pelo endereço IP do estabelecimento." },
];

export function PrinterSetupWizard({ establishmentId, establishmentName, initial }: { establishmentId: string; establishmentName: string; initial: Initial }) {
  const supabase = useMemo(() => createClient(), []);
  const [step, setStep] = useState(initial.completed ? 3 : 1);
  const [connection, setConnection] = useState<Connection>(initial.connection);
  const [printerName, setPrinterName] = useState(initial.name);
  const [paperWidth, setPaperWidth] = useState<58 | 80>(initial.paperWidth);
  const [networkAddress, setNetworkAddress] = useState(initial.networkAddress);
  const [autoPrint, setAutoPrint] = useState(initial.autoPrint);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [connector, setConnector] = useState<ConnectorStatus>(initial.connector);
  const [installingConnector, setInstallingConnector] = useState(false);
  const [testingConnector, setTestingConnector] = useState(false);
  const [installerDownloaded, setInstallerDownloaded] = useState(false);
  useEffect(() => {
    if (step !== 3) return;
    async function refreshStatus() {
      const { data } = await supabase.rpc("get_printer_connector_status", { requested_establishment_id: establishmentId });
      if (data && typeof data === "object") {
        const next = data as ConnectorStatus;
        setConnector(next);
        if (next.online) setInstallerDownloaded(false);
      }
    }
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 4000);
    return () => window.clearInterval(timer);
  }, [establishmentId, step, supabase]);

  async function save() {
    setSaving(true); setMessage("Salvando configuração...");
    const { error } = await supabase.rpc("save_printer_settings", { requested_establishment_id: establishmentId, requested_connection: connection, requested_name: printerName, requested_paper_width: paperWidth, requested_network_address: networkAddress, requested_auto_print: autoPrint });
    setSaving(false);
    if (error) { setMessage(error.message); return; }
    setStep(3); setMessage("Impressora configurada com sucesso.");
  }

  function printTest() {
    setShowPrintPreview(true);
    setMessage("");
  }

  async function activateDirectPrinting() {
    setInstallingConnector(true);
    setMessage("Preparando o instalador individual deste estabelecimento...");
    const { data, error } = await supabase.rpc("register_printer_connector", {
      requested_establishment_id: establishmentId,
      requested_name: "Computador da cozinha",
      requested_printer_name: "Impressora do Windows",
    });
    if (error || !data || typeof data !== "object" || !("token" in data)) {
      setInstallingConnector(false);
      setMessage(error?.message || "Não foi possível gerar o instalador.");
      return;
    }
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !anonKey) {
      setInstallingConnector(false);
      setMessage("Configuração pública do sistema indisponível.");
      return;
    }
    const siteBaseUrl = window.location.origin;
    const token = String((data as { token: string }).token);
    const command = `@echo off\r\ntitle Instalador Mesa Viva\r\necho Ativando a impressao direta da cozinha...\r\nset "MV_INSTALLER=%TEMP%\\MesaVivaInstaller.ps1"\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri '${siteBaseUrl}/mesa-viva-installer.ps1' -OutFile '%MV_INSTALLER%'"\r\nif errorlevel 1 goto erro\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%MV_INSTALLER%" -SupabaseUrl "${supabaseUrl}" -AnonKey "${anonKey}" -DeviceToken "${token}" -SiteBaseUrl "${siteBaseUrl}"\r\nif errorlevel 1 goto erro\r\ndel "%MV_INSTALLER%" >nul 2>&1\r\necho.\r\necho Concluido. Volte ao painel Mesa Viva.\r\npause\r\ndel "%~f0"\r\nexit /b 0\r\n:erro\r\necho.\r\necho Nao foi possivel concluir. Instale a impressora no Windows e tente novamente.\r\npause\r\nexit /b 1\r\n`;
    const download = document.createElement("a");
    download.href = URL.createObjectURL(new Blob([command], { type: "application/octet-stream" }));
    download.download = "Ativar-Impressao-Mesa-Viva.cmd";
    document.body.appendChild(download);
    download.click();
    URL.revokeObjectURL(download.href);
    download.remove();
    setConnector({ configured: true, online: false });
    setInstallerDownloaded(true);
    setInstallingConnector(false);
    setMessage("Download concluído. Agora abra o arquivo Ativar-Impressao-Mesa-Viva.cmd para terminar.");
  }

  async function printDirectTest() {
    setTestingConnector(true);
    setMessage("Enviando teste para a impressora...");
    const receipt = `${establishmentName}\n\nTESTE DA IMPRESSORA\n------------------------------\nCONEXAO DIRETA: ATIVA\nPAPEL: ${paperWidth} mm\nDATA: ${new Date().toLocaleString("pt-BR")}\n------------------------------\nCONFIGURACAO CONCLUIDA\nMesa Viva`;
    const { error } = await supabase.rpc("queue_printer_test", { requested_establishment_id: establishmentId, requested_text: receipt });
    setTestingConnector(false);
    setMessage(error ? error.message : "Teste enviado diretamente para a impressora.");
  }

  function printReceipt() {
    const safeName = establishmentName.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
    const connectionLabel = connection === "usb" ? "USB" : connection === "bluetooth" ? "Bluetooth" : "Wi-Fi / rede";
    const frame = document.createElement("iframe");
    frame.title = "Impressão da notinha de teste";
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;";
    frame.onload = () => {
      const printWindow = frame.contentWindow;
      if (!printWindow) { frame.remove(); setMessage("Não foi possível abrir a impressão neste navegador."); return; }
      const cleanup = () => frame.remove();
      printWindow.addEventListener("afterprint", cleanup, { once: true });
      window.setTimeout(cleanup, 60000);
      printWindow.focus();
      printWindow.print();
    };
    frame.srcdoc = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Teste da impressora</title><style>@page{size:${paperWidth}mm ${paperWidth === 58 ? 100 : 120}mm;margin:2mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000}body{width:${paperWidth - 4}mm;font:12px/1.45 monospace;text-align:center}h1{font-size:16px;margin:0 0 14px}h2{font-size:14px;margin:10px 0}p{margin:7px 0}b,span{display:block}.label{font-size:9px;text-transform:uppercase}.line{border-top:1px dashed #000;margin:11px 0;width:100%}small{font-size:10px}</style></head><body><h1>${safeName}</h1><b>TESTE DA IMPRESSORA</b><div class="line"></div><p><b class="label">Conexão</b><span>${connectionLabel}</span></p><p><b class="label">Papel</b><span>${paperWidth} mm</span></p><p><b class="label">Data</b><span>${new Date().toLocaleString("pt-BR")}</span></p><div class="line"></div><h2>CONFIGURAÇÃO CONCLUÍDA</h2><small>Mesa Viva</small></body></html>`;
    document.body.appendChild(frame);
  }

  return <section className="panel printer-wizard">
    <header className="printer-wizard-head"><div><small>IMPRESSORA DA COZINHA</small><h2>Configure em poucos passos.</h2><p>Escolha como a impressora está conectada, ajuste o papel e imprima uma notinha de teste.</p></div><span>Etapa {step} de 3</span></header>
    <div className="printer-progress" aria-label={`Etapa ${step} de 3`}>{[1,2,3].map(value => <i className={value <= step ? "active" : ""} key={value}>{value}</i>)}</div>
    {step === 1 && <div className="printer-step"><h3>1. Como a impressora será conectada?</h3><div className="printer-connection-grid">{connections.map(option => <button type="button" className={connection === option.id ? "selected" : ""} onClick={() => setConnection(option.id)} key={option.id}><b>{option.title}</b><span>{option.description}</span></button>)}</div><button type="button" className="button dark" onClick={() => setStep(2)}>Continuar</button></div>}
    {step === 2 && <div className="printer-step"><h3>2. Ajuste sua impressora</h3><div className="printer-form-grid"><div className="field"><label>NOME PARA IDENTIFICAÇÃO</label><input value={printerName} onChange={event => setPrinterName(event.target.value)} maxLength={120} placeholder="Ex.: Impressora da cozinha" /></div><div className="field"><label>LARGURA DO PAPEL</label><select value={paperWidth} onChange={event => setPaperWidth(Number(event.target.value) as 58 | 80)}><option value={58}>58 mm — compacta</option><option value={80}>80 mm — profissional</option></select></div>{connection === "network" && <div className="field field-wide"><label>ENDEREÇO IP OU NOME NA REDE</label><input value={networkAddress} onChange={event => setNetworkAddress(event.target.value)} maxLength={160} placeholder="Ex.: 192.168.0.50" /></div>}<label className="printer-auto-print field-wide"><input type="checkbox" checked={autoPrint} onChange={event => setAutoPrint(event.target.checked)} /><span><b>Abrir impressão automaticamente</b><small>Quando chegar um pedido novo, a cozinha abrirá a impressão da notinha. O navegador poderá pedir confirmação.</small></span></label></div><div className="printer-actions"><button type="button" className="button outline" onClick={() => setStep(1)}>Voltar</button><button type="button" className="button dark" disabled={saving} onClick={() => void save()}>{saving ? "Salvando..." : "Salvar e continuar"}</button></div></div>}
    {step === 3 && <div className="printer-step printer-finish"><div><span className="printer-ready">CONFIGURAÇÃO SALVA</span><h3>3. Ative a impressão direta</h3><ol><li>Instale e conecte a impressora normalmente no Windows.</li><li>Clique em <b>Ativar impressão direta</b> e abra o arquivo baixado.</li><li>Faça isso somente uma vez. Depois, a tela da cozinha imprimirá com um clique.</li></ol>{installerDownloaded && !connector.online && <div className="printer-open-installer"><b>Falta apenas abrir o arquivo baixado</b><p>Clique em <strong>Ativar-Impressao-Mesa-Viva.cmd</strong> na lista de downloads do navegador. Aguarde a mensagem “Concluído”; esta tela e a cozinha ficarão verdes automaticamente.</p></div>}<div className="printer-summary"><span><small>CONEXÃO</small><b>{connection === "usb" ? "USB" : connection === "bluetooth" ? "Bluetooth" : "Wi-Fi / rede"}</b></span><span><small>PAPEL</small><b>{paperWidth} mm</b></span><span><small>COZINHA</small><b>{connector.online ? "Conectada" : "Aguardando"}</b></span></div></div><div className={`printer-test-card ${connector.online ? "connector-online" : ""}`}><span className="connector-status-dot" aria-hidden="true" /><b>{connector.online ? "Impressão direta ativa" : installerDownloaded ? "Abra o arquivo baixado" : connector.configured ? "Conclua no computador" : "Ative neste computador"}</b><p>{connector.online ? `${connector.printer_name || "Impressora"} conectada. A cozinha já imprime sem abrir outra tela.` : installerDownloaded ? "O navegador não pode executar o instalador sozinho. Abra o arquivo uma vez para concluir a conexão." : "O instalador encontra automaticamente a impressora instalada no Windows e mantém a conexão ativa."}</p>{connector.online ? <button type="button" className="button dark wide" disabled={testingConnector} onClick={() => void printDirectTest()}>{testingConnector ? "Enviando..." : "Imprimir teste direto"}</button> : <button type="button" className="button dark wide" disabled={installingConnector || installerDownloaded} onClick={() => void activateDirectPrinting()}>{installingConnector ? "Preparando..." : installerDownloaded ? "Aguardando a instalação" : "Ativar impressão direta"}</button>}<button type="button" className="printer-edit-button" onClick={() => setStep(1)}>Alterar configuração</button>{connector.online && <button type="button" className="printer-edit-button" onClick={() => void activateDirectPrinting()}>Instalar em outro computador</button>}<button type="button" className="printer-browser-fallback" onClick={printTest}>Usar impressão do navegador</button></div></div>}
    {message && <div className={message.includes("sucesso") || message.includes("Escolha") ? "form-message form-success" : "form-message"}>{message}</div>}
    {showPrintPreview && <div className="printer-preview-overlay" role="dialog" aria-modal="true" aria-label="Teste da impressora">
      <div className="printer-preview-modal">
        <button type="button" className="printer-preview-close" aria-label="Fechar" onClick={() => setShowPrintPreview(false)}>×</button>
        <div className="printer-test-preview" style={{ "--printer-paper-width": `${paperWidth}mm` } as React.CSSProperties}>
          <h1>{establishmentName}</h1><strong>TESTE DA IMPRESSORA</strong><hr />
          <p><b>Conexão</b><span>{connection === "usb" ? "USB" : connection === "bluetooth" ? "Bluetooth" : "Wi-Fi / rede"}</span></p>
          <p><b>Papel</b><span>{paperWidth} mm</span></p>
          <p><b>Data</b><span>{new Date().toLocaleString("pt-BR")}</span></p>
          <hr /><h2>CONFIGURAÇÃO CONCLUÍDA</h2><small>Mesa Viva</small>
        </div>
        <div className="printer-preview-actions"><button type="button" className="button dark wide" onClick={printReceipt}>Imprimir</button><p>Escolha a impressora instalada no computador e confirme.</p></div>
      </div>
    </div>}
  </section>;
}

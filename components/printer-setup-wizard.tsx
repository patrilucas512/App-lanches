"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Connection = "usb" | "bluetooth" | "network";
type Initial = { connection: Connection; name: string; paperWidth: 58 | 80; networkAddress: string; autoPrint: boolean; completed: boolean };
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
  const instructions = connection === "usb"
    ? ["Ligue a impressora e conecte o cabo USB.", "No computador, confirme que ela aparece em Impressoras e scanners.", "Clique em Imprimir teste e escolha a impressora instalada."]
    : connection === "bluetooth"
      ? ["Ative o Bluetooth no aparelho usado pela cozinha.", "Pareie a impressora nas configurações do celular, tablet ou computador.", "Clique em Imprimir teste e selecione a impressora pareada."]
      : ["Conecte a impressora à mesma rede do aparelho da cozinha.", "Adicione a impressora pelo IP nas configurações do computador ou tablet.", "Informe o IP abaixo e faça a impressão de teste."];

  async function save() {
    setSaving(true); setMessage("Salvando configuração...");
    const { error } = await supabase.rpc("save_printer_settings", { requested_establishment_id: establishmentId, requested_connection: connection, requested_name: printerName, requested_paper_width: paperWidth, requested_network_address: networkAddress, requested_auto_print: autoPrint });
    setSaving(false);
    if (error) { setMessage(error.message); return; }
    setStep(3); setMessage("Impressora configurada com sucesso.");
  }

  function printTest() {
    const popup = window.open("", "mesa-viva-printer-test", "width=420,height=650");
    if (!popup) { setMessage("Permita a abertura da janela para imprimir o teste."); return; }
    const safeName = establishmentName.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Teste de impressão</title><style>@page{size:${paperWidth}mm auto;margin:3mm}body{font:12px monospace;margin:0;width:${paperWidth - 8}mm;color:#000}h1{font-size:16px;text-align:center}p{margin:7px 0}.line{border-top:1px dashed #000;margin:10px 0}.ok{font-size:15px;font-weight:700;text-align:center}</style></head><body><h1>${safeName}</h1><p>TESTE DA IMPRESSORA</p><div class="line"></div><p>Conexão: ${connection.toUpperCase()}</p><p>Papel: ${paperWidth} mm</p><p>Data: ${new Date().toLocaleString("pt-BR")}</p><div class="line"></div><p class="ok">CONFIGURAÇÃO CONCLUÍDA</p><p style="text-align:center">Mesa Viva</p><script>setTimeout(()=>window.print(),250)<\/script></body></html>`);
    popup.document.close(); setMessage("Escolha sua impressora na janela que abriu.");
  }

  return <section className="panel printer-wizard">
    <header className="printer-wizard-head"><div><small>IMPRESSORA DA COZINHA</small><h2>Configure em poucos passos.</h2><p>Escolha como a impressora está conectada, ajuste o papel e imprima uma notinha de teste.</p></div><span>Etapa {step} de 3</span></header>
    <div className="printer-progress" aria-label={`Etapa ${step} de 3`}>{[1,2,3].map(value => <i className={value <= step ? "active" : ""} key={value}>{value}</i>)}</div>
    {step === 1 && <div className="printer-step"><h3>1. Como a impressora será conectada?</h3><div className="printer-connection-grid">{connections.map(option => <button type="button" className={connection === option.id ? "selected" : ""} onClick={() => setConnection(option.id)} key={option.id}><b>{option.title}</b><span>{option.description}</span></button>)}</div><button type="button" className="button dark" onClick={() => setStep(2)}>Continuar</button></div>}
    {step === 2 && <div className="printer-step"><h3>2. Ajuste sua impressora</h3><div className="printer-form-grid"><div className="field"><label>NOME PARA IDENTIFICAÇÃO</label><input value={printerName} onChange={event => setPrinterName(event.target.value)} maxLength={120} placeholder="Ex.: Impressora da cozinha" /></div><div className="field"><label>LARGURA DO PAPEL</label><select value={paperWidth} onChange={event => setPaperWidth(Number(event.target.value) as 58 | 80)}><option value={58}>58 mm — compacta</option><option value={80}>80 mm — profissional</option></select></div>{connection === "network" && <div className="field field-wide"><label>ENDEREÇO IP OU NOME NA REDE</label><input value={networkAddress} onChange={event => setNetworkAddress(event.target.value)} maxLength={160} placeholder="Ex.: 192.168.0.50" /></div>}<label className="printer-auto-print field-wide"><input type="checkbox" checked={autoPrint} onChange={event => setAutoPrint(event.target.checked)} /><span><b>Abrir impressão automaticamente</b><small>Quando chegar um pedido novo, a cozinha abrirá a impressão da notinha. O navegador poderá pedir confirmação.</small></span></label></div><div className="printer-actions"><button type="button" className="button outline" onClick={() => setStep(1)}>Voltar</button><button type="button" className="button dark" disabled={saving} onClick={() => void save()}>{saving ? "Salvando..." : "Salvar e continuar"}</button></div></div>}
    {step === 3 && <div className="printer-step printer-finish"><div><span className="printer-ready">CONFIGURAÇÃO ATIVA</span><h3>3. Conecte e faça o teste</h3><ol>{instructions.map(instruction => <li key={instruction}>{instruction}</li>)}</ol><div className="printer-summary"><span><small>CONEXÃO</small><b>{connection === "usb" ? "USB" : connection === "bluetooth" ? "Bluetooth" : "Wi-Fi / rede"}</b></span><span><small>PAPEL</small><b>{paperWidth} mm</b></span><span><small>AUTOMÁTICA</small><b>{autoPrint ? "Ativada" : "Desativada"}</b></span></div></div><div className="printer-test-card"><b>Teste antes de começar</b><p>Uma notinha será aberta no tamanho correto. Selecione a impressora e confirme.</p><button type="button" className="button dark wide" onClick={printTest}>Imprimir página de teste</button><button type="button" className="printer-edit-button" onClick={() => setStep(1)}>Alterar configuração</button></div></div>}
    {message && <div className={message.includes("sucesso") || message.includes("Escolha") ? "form-message form-success" : "form-message"}>{message}</div>}
  </section>;
}

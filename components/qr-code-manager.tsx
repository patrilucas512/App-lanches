"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";

type RestaurantTable = {
  id: string; establishment_id: string; table_number: string; table_name?: string | null;
  sector?: string | null; qr_code_url?: string | null; is_active: boolean;
};
type QrSettings = {
  title: string; subtitle: string; footerText: string; primaryColor: string;
  logoUrl: string; template: "simple" | "premium" | "counter"; waiterCallsEnabled: boolean;
};
type Metrics = { scans: number; topTable: string; peakHour: string; startedOrders: number; finishedOrders: number };

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image(); image.crossOrigin = "anonymous";
  image.onload = () => resolve(image); image.onerror = reject; image.src = src;
});

async function qrImage(link: string, color: string, logoUrl: string) {
  const raw = await QRCode.toDataURL(link, { width: 900, margin: 2, errorCorrectionLevel: "H", color: { dark: color, light: "#ffffff" } });
  if (!logoUrl) return raw;
  try {
    const [qr, logo] = await Promise.all([loadImage(raw), loadImage(logoUrl)]);
    const canvas = document.createElement("canvas"); canvas.width = 900; canvas.height = 900;
    const context = canvas.getContext("2d")!; context.drawImage(qr, 0, 0, 900, 900);
    context.fillStyle = "#ffffff"; context.beginPath(); context.roundRect(350, 350, 200, 200, 30); context.fill();
    context.drawImage(logo, 370, 370, 160, 160);
    return canvas.toDataURL("image/png");
  } catch { return raw; }
}

async function printableCard(link: string, settings: QrSettings, establishmentName: string, tableLabel?: string) {
  const qr = await loadImage(await qrImage(link, settings.primaryColor, settings.logoUrl));
  const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 1600;
  const context = canvas.getContext("2d")!;
  const premium = settings.template === "premium";
  context.fillStyle = premium ? settings.primaryColor : "#fffdf8"; context.fillRect(0, 0, 1200, 1600);
  context.textAlign = "center"; context.fillStyle = premium ? "#ffffff" : "#171713";
  context.font = "700 52px Arial"; context.fillText(establishmentName, 600, 105);
  context.font = "700 66px Arial"; context.fillText(settings.title, 600, 205);
  context.fillStyle = "#ffffff"; context.beginPath(); context.roundRect(120, 270, 960, 960, 42); context.fill();
  context.drawImage(qr, 170, 320, 860, 860);
  context.fillStyle = premium ? "#ffffff" : settings.primaryColor;
  context.font = "800 76px Arial"; context.fillText(tableLabel || (settings.template === "counter" ? "Acesse nosso cardápio digital" : "Cardápio digital"), 600, 1345);
  context.fillStyle = premium ? "rgba(255,255,255,.82)" : "#5f5b53";
  context.font = "36px Arial"; context.fillText(settings.subtitle, 600, 1420);
  context.font = "28px Arial"; context.fillText(settings.footerText, 600, 1490);
  return canvas.toDataURL("image/png");
}

function QrPreview({ link, color, logoUrl }: { link: string; color: string; logoUrl: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => { let active = true; void qrImage(link, color, logoUrl).then(value => { if (active) setSrc(value); }); return () => { active = false; }; }, [link, color, logoUrl]);
  return src ? <img className="qr-preview-image" src={src} alt="Prévia do QR Code" /> : <div className="qr-loading">Gerando...</div>;
}

export function QrCodeManager({ establishmentId, establishmentName, slug, initialTables, initialSettings, metrics }: {
  establishmentId: string; establishmentName: string; slug: string; initialTables: RestaurantTable[];
  initialSettings: QrSettings; metrics: Metrics;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [origin, setOrigin] = useState("");
  const [tables, setTables] = useState(initialTables);
  const [settings, setSettings] = useState(initialSettings);
  const [selectedId, setSelectedId] = useState<string>("general");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  const selected = tables.find(table => table.id === selectedId);
  const menuLink = selected
    ? `${origin}/loja/${slug}?mesa=${encodeURIComponent(selected.table_number)}&origem=qr`
    : `${origin}/loja/${slug}?origem=qr`;
  const tableLabel = selected ? `Mesa ${selected.table_number}${selected.table_name ? ` · ${selected.table_name}` : ""}` : undefined;

  async function saveTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = event.currentTarget; const data = new FormData(form);
    const raw = String(data.get("number")).trim();
    const number = /^\d+$/.test(raw) ? raw.padStart(2, "0") : raw.toUpperCase();
    const qrUrl = `${origin}/loja/${slug}?mesa=${encodeURIComponent(number)}&origem=qr`;
    const values = { establishment_id: establishmentId, table_number: number, table_name: String(data.get("name") || "") || null, sector: String(data.get("sector") || "") || null, qr_code_url: qrUrl };
    if (editingId) {
      const { data: updated, error } = await supabase.from("restaurant_tables").update(values).eq("id", editingId).select().single();
      if (error) setMessage(error.message); else { setTables(current => current.map(item => item.id === editingId ? updated : item)); setEditingId(null); form.reset(); setMessage("Mesa atualizada."); }
    } else {
      const { data: created, error } = await supabase.from("restaurant_tables").insert(values).select().single();
      if (error) setMessage(error.message); else {
        setTables(current => [...current, created].sort((a, b) => a.table_number.localeCompare(b.table_number)));
        setSelectedId(created.id); form.reset(); setMessage("Mesa criada e QR Code gerado.");
      }
    }
    setBusy(false);
  }
  async function toggleTable(table: RestaurantTable) {
    const { data, error } = await supabase.from("restaurant_tables").update({ is_active: !table.is_active }).eq("id", table.id).select().single();
    if (error) return setMessage(error.message);
    setTables(current => current.map(item => item.id === table.id ? data : item));
  }
  async function deleteTable(table: RestaurantTable) {
    if (!confirm(`Excluir a mesa ${table.table_number}?`)) return;
    const { error } = await supabase.from("restaurant_tables").delete().eq("id", table.id);
    if (error) return setMessage(error.message);
    setTables(current => current.filter(item => item.id !== table.id));
    if (selectedId === table.id) setSelectedId("general");
  }
  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const [qrResult, operationResult] = await Promise.all([
      supabase.from("qr_code_settings").upsert({
        establishment_id: establishmentId, title: settings.title, subtitle: settings.subtitle,
        footer_text: settings.footerText, primary_color: settings.primaryColor,
        logo_url: settings.logoUrl || null, print_template: settings.template,
      }, { onConflict: "establishment_id" }),
      supabase.from("establishment_settings").update({ waiter_calls_enabled: settings.waiterCallsEnabled }).eq("establishment_id", establishmentId),
    ]);
    setMessage(qrResult.error?.message || operationResult.error?.message || "Personalização salva.");
    setBusy(false);
  }
  async function downloadPng() {
    const image = await printableCard(menuLink, settings, establishmentName, tableLabel);
    const link = document.createElement("a"); link.href = image;
    link.download = selected ? `qr-mesa-${selected.table_number}.png` : `qr-cardapio-${slug}.png`; link.click();
  }
  async function downloadPdf() {
    const [{ jsPDF }, image] = await Promise.all([import("jspdf"), printableCard(menuLink, settings, establishmentName, tableLabel)]);
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    pdf.addImage(image, "PNG", 30, 8, 150, 200);
    pdf.save(selected ? `qr-mesa-${selected.table_number}.pdf` : `qr-cardapio-${slug}.pdf`);
  }
  async function downloadAllPdf() {
    const activeTables = tables.filter(table => table.is_active);
    if (!activeTables.length) return setMessage("Cadastre e ative ao menos uma mesa.");
    const { jsPDF } = await import("jspdf"); const pdf = new jsPDF({ unit: "mm", format: "a4" });
    for (let index = 0; index < activeTables.length; index++) {
      if (index > 0 && index % 4 === 0) pdf.addPage();
      const table = activeTables[index]; const link = `${origin}/loja/${slug}?mesa=${encodeURIComponent(table.table_number)}&origem=qr`;
      const image = await printableCard(link, settings, establishmentName, `Mesa ${table.table_number}`);
      const slot = index % 4; const x = slot % 2 === 0 ? 8 : 107; const y = slot < 2 ? 8 : 152;
      pdf.addImage(image, "PNG", x, y, 94, 125);
    }
    pdf.save(`qrcodes-mesas-${slug}.pdf`);
  }
  async function printCodes() {
    const popup = window.open("", "_blank");
    if (!popup) return setMessage("Permita a abertura da janela de impressão.");
    const images = [await printableCard(menuLink, settings, establishmentName, tableLabel)];
    popup.document.write(`<title>QR Codes — ${establishmentName}</title><style>@page{size:A4;margin:8mm}body{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:8mm}img{width:100%;break-inside:avoid}</style>${images.map(image => `<img src="${image}">`).join("")}<script>onload=()=>print()</script>`);
    popup.document.close();
  }

  return <div className="qr-manager">
    <div className="dashboard-cards qr-metrics">
      <article className="dash-card"><small>LEITURAS (30 DIAS)</small><strong>{metrics.scans}</strong></article>
      <article className="dash-card"><small>MESA MAIS ACESSADA</small><strong>{metrics.topTable}</strong></article>
      <article className="dash-card"><small>HORÁRIO DE PICO</small><strong>{metrics.peakHour}</strong></article>
      <article className="dash-card"><small>PEDIDOS VIA QR</small><strong>{metrics.startedOrders}</strong></article>
      <article className="dash-card"><small>ENVIADOS AO WHATSAPP</small><strong>{metrics.finishedOrders}</strong></article>
    </div>
    <div className="qr-layout">
      <section className="panel qr-preview-panel">
        <div className="qr-preview-card" data-template={settings.template} style={{ "--qr-color": settings.primaryColor } as React.CSSProperties}>
          <b>{establishmentName}</b><h2>{settings.title}</h2>
          {origin && <QrPreview link={menuLink} color={settings.primaryColor} logoUrl={settings.logoUrl} />}
          <strong>{tableLabel || (settings.template === "counter" ? "Acesse nosso cardápio digital" : "Cardápio digital")}</strong>
          <p>{settings.subtitle}</p><small>{settings.footerText}</small>
        </div>
        <div className="qr-link"><span>{menuLink}</span><button onClick={() => { void navigator.clipboard.writeText(menuLink); setMessage("Link copiado."); }}>Copiar link</button></div>
        <div className="qr-actions"><button className="button dark" onClick={downloadPng}>Baixar PNG</button><button className="button outline" onClick={downloadPdf}>Baixar PDF</button><button className="button outline" onClick={printCodes}>Imprimir</button></div>
      </section>
      <section className="panel">
        <h2>Personalização</h2><form className="form" onSubmit={saveSettings}>
          <div className="field"><label>TÍTULO</label><input value={settings.title} onChange={e => setSettings({ ...settings, title: e.target.value })} /></div>
          <div className="field"><label>SUBTÍTULO</label><input value={settings.subtitle} onChange={e => setSettings({ ...settings, subtitle: e.target.value })} /></div>
          <div className="field"><label>TEXTO INFERIOR</label><input value={settings.footerText} onChange={e => setSettings({ ...settings, footerText: e.target.value })} /></div>
          <div className="form-grid"><div className="field"><label>COR PRINCIPAL</label><input type="color" value={settings.primaryColor} onChange={e => setSettings({ ...settings, primaryColor: e.target.value })} /></div><div className="field"><label>MODELO</label><select value={settings.template} onChange={e => setSettings({ ...settings, template: e.target.value as QrSettings["template"] })}><option value="simple">Simples</option><option value="premium">Premium</option><option value="counter">Balcão</option></select></div></div>
          <div className="field"><label>URL DO LOGOTIPO</label><input type="url" value={settings.logoUrl} onChange={e => setSettings({ ...settings, logoUrl: e.target.value })} placeholder="https://..." /></div>
          <label className="choice-card"><input type="checkbox" checked={settings.waiterCallsEnabled} onChange={e => setSettings({ ...settings, waiterCallsEnabled: e.target.checked })} /><span><b>Permitir chamar garçom</b><small>Disponível apenas quando o cliente acessa por uma mesa.</small></span></label>
          <button className="button dark wide" disabled={busy}>Salvar personalização</button>
        </form>
      </section>
    </div>
    <section className="panel qr-tables-panel">
      <div className="panel-title-row"><div><h2>QR Codes por mesa</h2><p>Cadastre e selecione uma mesa para visualizar o QR Code correspondente.</p></div><button className="button outline" onClick={downloadAllPdf}>PDF com todas as mesas</button></div>
      <form className="table-create-form" onSubmit={saveTable}>
        <div className="field"><label>NÚMERO DA MESA</label><input name="number" required defaultValue={tables.find(table => table.id === editingId)?.table_number ?? ""} key={`number-${editingId}`} /></div>
        <div className="field"><label>NOME (OPCIONAL)</label><input name="name" defaultValue={tables.find(table => table.id === editingId)?.table_name ?? ""} key={`name-${editingId}`} /></div>
        <div className="field"><label>SETOR</label><input name="sector" defaultValue={tables.find(table => table.id === editingId)?.sector ?? ""} key={`sector-${editingId}`} /></div>
        <button className="button dark" disabled={busy}>{editingId ? "Salvar edição" : "Cadastrar mesa"}</button>
      </form>
      <div className="table-card-grid">
        <button className={`table-qr-card ${selectedId === "general" ? "selected" : ""}`} onClick={() => setSelectedId("general")}><span>GERAL</span><b>Cardápio</b><small>Redes sociais, balcão e fachada</small></button>
        {tables.map(table => <article className={`table-qr-card ${selectedId === table.id ? "selected" : ""} ${!table.is_active ? "inactive" : ""}`} key={table.id} onClick={() => setSelectedId(table.id)}>
          <span>{table.sector || "MESA"}</span><b>{table.table_number}</b><small>{table.table_name || (table.is_active ? "Ativa" : "Desativada")}</small>
          <div><button onClick={event => { event.stopPropagation(); setEditingId(table.id); }}>Editar</button><button onClick={event => { event.stopPropagation(); void toggleTable(table); }}>{table.is_active ? "Desativar" : "Ativar"}</button><button onClick={event => { event.stopPropagation(); void deleteTable(table); }}>Excluir</button></div>
        </article>)}
      </div>
    </section>
    {message && <div className={message.includes("erro") ? "form-message" : "form-message form-success"}>{message}</div>}
  </div>;
}

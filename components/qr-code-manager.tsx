"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";

type QrSettings = {
  title: string;
  subtitle: string;
  footerText: string;
  primaryColor: string;
  logoUrl: string;
  template: "simple" | "premium" | "counter";
};
type Metrics = {
  scans: number;
  peakHour: string;
  startedOrders: number;
  finishedOrders: number;
};

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = src;
});

async function qrImage(link: string, color: string, logoUrl: string) {
  const raw = await QRCode.toDataURL(link, {
    width: 900,
    margin: 2,
    errorCorrectionLevel: "H",
    color: { dark: color, light: "#ffffff" },
  });
  if (!logoUrl) return raw;
  try {
    const [qr, logo] = await Promise.all([loadImage(raw), loadImage(logoUrl)]);
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 900;
    const context = canvas.getContext("2d")!;
    context.drawImage(qr, 0, 0, 900, 900);
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.roundRect(350, 350, 200, 200, 30);
    context.fill();
    context.drawImage(logo, 370, 370, 160, 160);
    return canvas.toDataURL("image/png");
  } catch {
    return raw;
  }
}

async function printableCard(link: string, settings: QrSettings, establishmentName: string) {
  const qr = await loadImage(await qrImage(link, settings.primaryColor, settings.logoUrl));
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 1600;
  const context = canvas.getContext("2d")!;
  const premium = settings.template === "premium";
  context.fillStyle = premium ? settings.primaryColor : "#fffdf8";
  context.fillRect(0, 0, 1200, 1600);
  context.textAlign = "center";
  context.fillStyle = premium ? "#ffffff" : "#171713";
  context.font = "700 52px Arial";
  context.fillText(establishmentName, 600, 105);
  context.font = "700 66px Arial";
  context.fillText(settings.title, 600, 205);
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.roundRect(120, 270, 960, 960, 42);
  context.fill();
  context.drawImage(qr, 170, 320, 860, 860);
  context.fillStyle = premium ? "#ffffff" : settings.primaryColor;
  context.font = "800 62px Arial";
  context.fillText("Um QR Code para todas as mesas", 600, 1345);
  context.fillStyle = premium ? "rgba(255,255,255,.82)" : "#5f5b53";
  context.font = "36px Arial";
  context.fillText(settings.subtitle, 600, 1420);
  context.font = "28px Arial";
  context.fillText(settings.footerText, 600, 1490);
  return canvas.toDataURL("image/png");
}

function QrPreview({ link, color, logoUrl }: { link: string; color: string; logoUrl: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let active = true;
    void qrImage(link, color, logoUrl).then(value => {
      if (active) setSrc(value);
    });
    return () => { active = false; };
  }, [link, color, logoUrl]);
  return src
    ? <img className="qr-preview-image" src={src} alt="Prévia do QR Code geral" />
    : <div className="qr-loading">Gerando...</div>;
}

export function QrCodeManager({
  establishmentId,
  establishmentName,
  slug,
  initialSettings,
  metrics,
}: {
  establishmentId: string;
  establishmentName: string;
  slug: string;
  initialSettings: QrSettings;
  metrics: Metrics;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [origin, setOrigin] = useState("");
  const [settings, setSettings] = useState(initialSettings);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setOrigin(window.location.origin), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const menuLink = `${origin}/loja/${slug}?origem=qr`;

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    let logoUrl = settings.logoUrl;
    if (logoFile) {
      if (!logoFile.type.startsWith("image/") || logoFile.size > 8 * 1024 * 1024) {
        setMessage("Escolha uma imagem de até 8 MB."); setBusy(false); return;
      }
      const extension = logoFile.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
      const path = `${establishmentId}/branding/qr-logo-${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("product-images").upload(path, logoFile, { contentType: logoFile.type, cacheControl: "3600" });
      if (uploadError) { setMessage(uploadError.message); setBusy(false); return; }
      logoUrl = supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
      setSettings(current => ({ ...current, logoUrl }));
    }
    const { error } = await supabase.from("qr_code_settings").upsert({
      establishment_id: establishmentId,
      title: settings.title,
      subtitle: settings.subtitle,
      footer_text: settings.footerText,
      primary_color: settings.primaryColor,
      logo_url: logoUrl || null,
      print_template: settings.template,
    }, { onConflict: "establishment_id" });
    if (!error) setLogoFile(null);
    setMessage(error?.message || "Personalização salva.");
    setBusy(false);
  }

  async function downloadPng() {
    const image = await printableCard(menuLink, settings, establishmentName);
    const link = document.createElement("a");
    link.href = image;
    link.download = `qr-cardapio-${slug}.png`;
    link.click();
  }

  async function downloadPdf() {
    const [{ jsPDF }, image] = await Promise.all([
      import("jspdf"),
      printableCard(menuLink, settings, establishmentName),
    ]);
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    pdf.addImage(image, "PNG", 30, 8, 150, 200);
    pdf.save(`qr-cardapio-${slug}.pdf`);
  }

  async function printCode() {
    const popup = window.open("", "_blank");
    if (!popup) return setMessage("Permita a abertura da janela de impressão.");
    const image = await printableCard(menuLink, settings, establishmentName);
    popup.document.write(`<title>QR Code — ${establishmentName}</title><style>@page{size:A4;margin:8mm}body{margin:0;text-align:center}img{width:min(100%,150mm)}</style><img src="${image}"><script>onload=()=>print()</script>`);
    popup.document.close();
  }

  return <div className="qr-manager">
    <div className="dashboard-cards qr-metrics">
      <article className="dash-card"><small>LEITURAS (30 DIAS)</small><strong>{metrics.scans}</strong></article>
      <article className="dash-card"><small>HORÁRIO DE PICO</small><strong>{metrics.peakHour}</strong></article>
      <article className="dash-card"><small>PEDIDOS VIA QR</small><strong>{metrics.startedOrders}</strong></article>
      <article className="dash-card"><small>ENVIADOS À COZINHA</small><strong>{metrics.finishedOrders}</strong></article>
    </div>
    <section className="panel general-qr-explanation">
      <div><small>QR CODE ÚNICO</small><h2>Um código funciona em todas as mesas.</h2><p>Imprima o mesmo QR Code onde precisar. Ao finalizar o pedido, o cliente informa o nome e sobrenome e o número ou nome da mesa.</p></div>
      <span>Sem cadastrar mesas</span>
    </section>
    <div className="qr-layout">
      <section className="panel qr-preview-panel">
        <div className="qr-preview-card" data-template={settings.template} style={{ "--qr-color": settings.primaryColor } as React.CSSProperties}>
          <b>{establishmentName}</b>
          <h2>{settings.title}</h2>
          {origin && <QrPreview link={menuLink} color={settings.primaryColor} logoUrl={settings.logoUrl} />}
          <strong>Cardápio digital</strong>
          <p>{settings.subtitle}</p>
          <small>{settings.footerText}</small>
        </div>
        <div className="qr-link"><span>{menuLink}</span><button onClick={() => { void navigator.clipboard.writeText(menuLink); setMessage("Link copiado."); }}>Copiar link</button></div>
        <div className="qr-actions"><button className="button dark" onClick={downloadPng}>Baixar PNG</button><button className="button outline" onClick={downloadPdf}>Baixar PDF</button><button className="button outline" onClick={printCode}>Imprimir</button></div>
      </section>
      <section className="panel">
        <h2>Personalização</h2>
        <form className="form" onSubmit={saveSettings}>
          <div className="field"><label>TÍTULO</label><input value={settings.title} onChange={event => setSettings({ ...settings, title: event.target.value })} /></div>
          <div className="field"><label>SUBTÍTULO</label><input value={settings.subtitle} onChange={event => setSettings({ ...settings, subtitle: event.target.value })} /></div>
          <div className="field"><label>TEXTO INFERIOR</label><input value={settings.footerText} onChange={event => setSettings({ ...settings, footerText: event.target.value })} /></div>
          <div className="form-grid"><div className="field"><label>COR PRINCIPAL</label><input type="color" value={settings.primaryColor} onChange={event => setSettings({ ...settings, primaryColor: event.target.value })} /></div><div className="field"><label>MODELO</label><select value={settings.template} onChange={event => setSettings({ ...settings, template: event.target.value as QrSettings["template"] })}><option value="simple">Simples</option><option value="premium">Premium</option><option value="counter">Balcão</option></select></div></div>
          <div className="field">
            <label>LOGOTIPO</label>
            <label className="photo-picker">
              <input type="file" accept="image/*" onChange={event => setLogoFile(event.target.files?.[0] || null)} />
              <span>{logoFile ? logoFile.name : "Escolher imagem da galeria"}</span>
            </label>
            {settings.logoUrl && <img className="brand-logo-preview" src={settings.logoUrl} alt="Logotipo atual" />}
            <small>JPG, PNG ou WebP de até 8 MB.</small>
          </div>
          <button className="button dark wide" disabled={busy}>Salvar personalização</button>
        </form>
      </section>
    </div>
    {message && <div className={message.includes("erro") ? "form-message" : "form-message form-success"}>{message}</div>}
  </div>;
}

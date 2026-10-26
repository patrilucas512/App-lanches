"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { operationTheme, readableText } from "@/lib/operation-theme";
import { useRouter } from "next/navigation";

type Branding = {
  displayName: string;
  description: string;
  logoUrl: string;
  coverUrl: string;
  accentColor: string;
  lightColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  mutedColor: string;
};

const defaults: Branding = {
  displayName: "",
  description: "",
  logoUrl: "",
  coverUrl: "",
  accentColor: "#ff641f",
  lightColor: "#f6f2e9",
  backgroundColor: "#080807",
  surfaceColor: "#151411",
  textColor: "#fffaf1",
  mutedColor: "#aaa59c",
};

export function MenuBrandingManager({
  establishmentId,
  initial,
}: {
  establishmentId: string;
  initial: Branding;
}) {
  const [branding, setBranding] = useState({ ...defaults, ...initial });
  const router = useRouter();
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  function update<K extends keyof Branding>(key: K, value: Branding[K]) {
    setBranding(current => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const supabase = createClient();
    let nextLogoUrl = branding.logoUrl;
    let nextCoverUrl = branding.coverUrl;

    for (const file of [logoFile, coverFile]) {
      if (file && (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024)) {
        setMessage("Escolha uma imagem JPG, PNG ou WebP de até 8 MB.");
        setLoading(false);
        return;
      }
    }

    async function uploadBrandAsset(file: File, prefix: string) {
      const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
      const path = `${establishmentId}/branding/${prefix}-${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("product-images").upload(path, file, {
        contentType: file.type,
        cacheControl: "3600",
      });
      if (uploadError) throw uploadError;
      return supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
    }

    try {
      if (logoFile) nextLogoUrl = await uploadBrandAsset(logoFile, "menu-logo");
      if (coverFile) nextCoverUrl = await uploadBrandAsset(coverFile, "menu-cover");
    } catch (uploadError) {
      setMessage(uploadError instanceof Error ? uploadError.message : "Não foi possível enviar a imagem.");
      setLoading(false);
      return;
    }

    const { error } = await supabase.from("establishments").update({
      menu_display_name: branding.displayName.trim() || null,
      description: branding.description.trim() || null,
      menu_logo_url: nextLogoUrl || null,
      cover_url: nextCoverUrl || null,
      accent_color: branding.accentColor,
      secondary_color: branding.lightColor,
      menu_background_color: branding.backgroundColor,
      menu_surface_color: branding.surfaceColor,
      menu_text_color: branding.textColor,
      menu_muted_color: branding.mutedColor,
    }).eq("id", establishmentId);

    if (error) setMessage(error.message);
    else {
      setBranding(current => ({ ...current, logoUrl: nextLogoUrl, coverUrl: nextCoverUrl }));
      setLogoFile(null);
      setCoverFile(null);
      setMessage("Identidade de todas as áreas atualizada com sucesso.");
      router.refresh();
    }
    setLoading(false);
  }

  function restoreColors() {
    setBranding(current => ({
      ...current,
      accentColor: defaults.accentColor,
      lightColor: defaults.lightColor,
      backgroundColor: defaults.backgroundColor,
      surfaceColor: defaults.surfaceColor,
      textColor: defaults.textColor,
      mutedColor: defaults.mutedColor,
    }));
  }

  const previewLogo = logoFile ? URL.createObjectURL(logoFile) : branding.logoUrl;
  const previewCover = coverFile ? URL.createObjectURL(coverFile) : branding.coverUrl;
  const previewBackgroundText = readableText(branding.backgroundColor, branding.textColor);
  const previewSurfaceText = readableText(branding.surfaceColor, branding.textColor);
  const previewSurfaceMuted = readableText(branding.surfaceColor, branding.mutedColor);
  const previewOnAccent = readableText(branding.accentColor);

  return <section className="panel menu-branding-panel">
    <header className="menu-branding-heading">
      <div><small>PERSONALIZAR SITE</small><h2>Uma identidade para todo o estabelecimento.</h2><p>Edite uma vez: cardápio do cliente, painel, garçom, cozinha, caixa, entregas e motoboy recebem a mesma identidade com contraste automático.</p></div>
      <span className="status-pill">Personalizável</span>
    </header>
    <div className="menu-branding-layout">
      <form className="form menu-branding-form" onSubmit={submit}>
        <div className="field"><label>NOME EXIBIDO NO SISTEMA</label><input required minLength={2} maxLength={80} value={branding.displayName} onChange={event => update("displayName", event.target.value)} placeholder="Nome do estabelecimento" /><small>Este nome e logotipo identificam o estabelecimento em todas as áreas.</small></div>
        <div className="field"><label>TEXTO DE APRESENTAÇÃO DO CARDÁPIO</label><textarea maxLength={280} value={branding.description} onChange={event => update("description", event.target.value)} placeholder="Conte brevemente o que torna seu estabelecimento especial." /></div>
        <div className="field"><label>LOGOTIPO DO ESTABELECIMENTO</label><label className="photo-picker"><input type="file" accept="image/*" onChange={event => setLogoFile(event.target.files?.[0] || null)} /><span>{logoFile ? logoFile.name : "Escolher imagem da galeria"}</span></label><small>JPG, PNG ou WebP de até 8 MB.</small></div>
        <div className="field"><label>IMAGEM DE CAPA DO CARDÁPIO</label><label className="photo-picker"><input type="file" accept="image/*" onChange={event => setCoverFile(event.target.files?.[0] || null)} /><span>{coverFile ? coverFile.name : "Escolher foto de capa"}</span></label><small>Aparece no topo do cardápio. Use uma foto horizontal de até 8 MB.</small></div>
        <div className="menu-color-grid">
          <ColorField label="COR PRINCIPAL E BOTÕES" value={branding.accentColor} onChange={value => update("accentColor", value)} />
          <ColorField label="FUNDO DAS ÁREAS" value={branding.backgroundColor} onChange={value => update("backgroundColor", value)} />
          <ColorField label="CARDS, PAINÉIS E AVISOS DE PAGAMENTO" value={branding.surfaceColor} onChange={value => update("surfaceColor", value)} />
          <ColorField label="TEXTOS E FORMAS DE PAGAMENTO" value={branding.textColor} onChange={value => update("textColor", value)} />
          <ColorField label="TEXTOS SECUNDÁRIOS" value={branding.mutedColor} onChange={value => update("mutedColor", value)} />
          <ColorField label="FUNDO DO MODO CLARO" value={branding.lightColor} onChange={value => update("lightColor", value)} />
        </div>
        {message && <div className={message.includes("sucesso") ? "form-message form-success" : "form-message"}>{message}</div>}
        <div className="button-row"><button type="button" className="button" onClick={restoreColors}>Restaurar cores</button><button className="button dark" disabled={loading}>{loading ? "Salvando..." : "Salvar e aplicar em todo o sistema"}</button></div>
      </form>
      <div className="menu-branding-preview" style={{ backgroundColor: branding.backgroundColor, backgroundImage: previewCover ? `linear-gradient(180deg,rgba(0,0,0,.08),rgba(0,0,0,.62)),url(${previewCover})` : undefined, backgroundPosition: "center", backgroundSize: "cover", color: previewBackgroundText, borderColor: branding.surfaceColor }}>
        <small style={{ color: previewBackgroundText }}>PRÉVIA DO CARDÁPIO</small>
        <div className="menu-branding-preview-head">
          {previewLogo ? <img src={previewLogo} alt="Prévia do logotipo" /> : <span style={{ background: branding.accentColor }}>{branding.displayName.charAt(0) || "M"}</span>}
          <b>{branding.displayName || "Seu estabelecimento"}</b>
        </div>
        <div className="menu-branding-preview-card" style={{ background: branding.surfaceColor, color: previewSurfaceText }}>
          <span style={{ color: previewSurfaceText }}>DESTAQUE</span>
          <h3>Seu produto</h3>
          <p style={{ color: previewSurfaceMuted }}>{branding.description || "A apresentação acompanha a identidade escolhida."}</p>
          <button type="button" style={{ background: branding.accentColor, color: previewOnAccent }}>Adicionar</button>
          <div style={{ color: previewSurfaceText, background: branding.surfaceColor, border: `2px solid ${branding.accentColor}`, borderRadius: 12, padding: 14, marginTop: 16 }}><b>Pagamento confirmado ✓</b><p style={{ color: previewSurfaceText }}>Prévia dos avisos de pagamento e retirada.</p></div>
        </div>
      </div>
    </div>
    <div className="operation-theme branding-waiter-preview" style={operationTheme({ accent_color: branding.accentColor, menu_background_color: branding.backgroundColor, menu_surface_color: branding.surfaceColor, menu_text_color: branding.textColor, menu_muted_color: branding.mutedColor })}>
      <section className="waiter-tracker" aria-label="Prévia das cores da área do garçom">
        <header><div><small>PRÉVIA DA ÁREA DO GARÇOM</small><h2>Pedidos do salão</h2><p>Texto, fundo e botões acompanham as cores escolhidas acima.</p></div><div className="waiter-alert-controls"><span>Prévia</span></div></header>
        <div className="waiter-stage-grid"><div className="waiter-stage"><header><h3>Em preparo</h3><b>0</b></header><div className="empty-stage">Nenhum pedido nesta prévia.</div></div><div className="waiter-stage"><header><h3>Pagamento</h3></header><p>Confirmação e troco com leitura protegida por contraste.</p><button type="button" className="button dark">Exemplo de botão</button></div></div>
      </section>
    </div>
  </section>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className="field color-field"><label>{label}</label><div><input type="color" value={value} onChange={event => onChange(event.target.value)} /><input value={value.toUpperCase()} maxLength={7} pattern="#[0-9A-Fa-f]{6}" onChange={event => onChange(event.target.value)} aria-label={`${label} em hexadecimal`} /></div></div>;
}

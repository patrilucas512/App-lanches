"use client";

import { FormEvent, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type OnboardingInitialData = {
  hasEstablishment?: boolean;
  name?: string;
  slug?: string;
  description?: string;
  phone?: string;
  city?: string;
  state?: string;
  logoUrl?: string;
  coverUrl?: string;
  accentColor?: string;
  secondaryColor?: string;
  whatsapp?: string;
  address?: string;
};

type Values = {
  name: string; slug: string; description: string; phone: string; whatsapp: string;
  address: string; city: string; state: string; logoUrl: string; coverUrl: string;
  accentColor: string; secondaryColor: string; delivery: boolean; pickup: boolean;
  minimumOrder: string; estimatedMinutes: string; opensAt: string; closesAt: string;
  payments: string[]; zoneName: string; deliveryFee: string; freeDeliveryAbove: string;
  category: string; productName: string; productDescription: string; productPrice: string;
  productImage: string;
};

const steps = ["Negócio", "Identidade", "Operação", "Pagamentos", "Entrega", "Produto", "Publicar"];
const paymentOptions = [
  ["pix", "Pix"], ["cash", "Dinheiro"], ["credit_on_delivery", "Crédito na entrega"],
  ["debit_on_delivery", "Débito na entrega"],
];

function toCents(value: string) {
  return Math.round(Number(value.replace(",", ".")) * 100) || 0;
}

export function OnboardingForm({ initial }: { initial?: OnboardingInitialData }) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [publishedSlug, setPublishedSlug] = useState("");
  const [values, setValues] = useState<Values>({
    name: initial?.name ?? "", slug: initial?.slug ?? "", description: initial?.description ?? "",
    phone: initial?.phone ?? "", whatsapp: initial?.whatsapp ?? "", address: initial?.address ?? "",
    city: initial?.city ?? "", state: initial?.state ?? "", logoUrl: initial?.logoUrl ?? "",
    coverUrl: initial?.coverUrl ?? "", accentColor: initial?.accentColor ?? "#6d2627",
    secondaryColor: initial?.secondaryColor ?? "#f5efe5", delivery: true, pickup: true,
    minimumOrder: "20", estimatedMinutes: "45", opensAt: "18:00", closesAt: "23:00",
    payments: ["pix", "cash", "credit_on_delivery"], zoneName: "Região central",
    deliveryFee: "5", freeDeliveryAbove: "80", category: "Destaques", productName: "",
    productDescription: "", productPrice: "", productImage: "",
  });
  const progress = useMemo(() => `${((step + 1) / steps.length) * 100}%`, [step]);
  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues(current => ({ ...current, [key]: value }));
  const field = (key: keyof Values, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="field"><label>{label}</label><input value={String(values[key])} onChange={event => set(key, event.target.value as never)} {...props} /></div>
  );
  function validStep() {
    if (step === 0 && (values.name.trim().length < 2 || !values.whatsapp.trim())) return "Informe o nome e o WhatsApp do estabelecimento.";
    if (step === 3 && values.payments.length === 0) return "Escolha ao menos uma forma de pagamento.";
    if (step === 5 && (!values.productName.trim() || toCents(values.productPrice) <= 0)) return "Cadastre o nome e o preço do primeiro produto.";
    return "";
  }
  function next() {
    const error = validStep();
    if (error) return setMessage(error);
    setMessage(""); setStep(current => Math.min(current + 1, steps.length - 1));
  }
  async function publish(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setMessage("");
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return window.location.assign("/login");
      if (!initial?.hasEstablishment) {
        const { error: createError } = await supabase.rpc("create_establishment", {
          establishment_name: values.name.trim(), requested_slug: values.slug.trim(),
        });
        if (createError) throw createError;
      }
      const { data, error } = await supabase.rpc("complete_establishment_onboarding", {
        payload: {
          establishment: {
            name: values.name, description: values.description, phone: values.phone,
            logo_url: values.logoUrl, cover_url: values.coverUrl, accent_color: values.accentColor,
            secondary_color: values.secondaryColor, city: values.city, state: values.state,
          },
          settings: {
            whatsapp: values.whatsapp, address: { street: values.address, city: values.city, state: values.state },
            pickup_enabled: values.pickup, delivery_enabled: values.delivery,
            minimum_order_cents: toCents(values.minimumOrder),
            estimated_minutes: Number(values.estimatedMinutes), payment_methods: values.payments,
          },
          operation: { opens_at: values.opensAt, closes_at: values.closesAt },
          delivery_zone: {
            name: values.delivery ? values.zoneName : "", fee_cents: toCents(values.deliveryFee),
            free_delivery_above_cents: toCents(values.freeDeliveryAbove),
          },
          product: {
            category: values.category, name: values.productName, description: values.productDescription,
            price_cents: toCents(values.productPrice), image_url: values.productImage, active: true,
          },
        },
      });
      if (error) throw error;
      setPublishedSlug(data.slug);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível publicar sua loja.");
    } finally { setLoading(false); }
  }

  if (publishedSlug) {
    const path = `/loja/${publishedSlug}`;
    return <div className="onboarding-success">
      <span className="success-icon">✓</span><span className="kicker">LOJA PUBLICADA</span>
      <h1>Seu cardápio está no ar.</h1><p>Compartilhe o link e comece a receber pedidos pelo WhatsApp.</p>
      <a className="button dark wide" href={path}>Abrir meu cardápio</a>
      <button className="button ghost wide" onClick={() => navigator.clipboard.writeText(`${location.origin}${path}`)}>Copiar link</button>
      <a className="text-link" href="/painel">Ir para o painel →</a>
    </div>;
  }

  return <form className="form onboarding-form" onSubmit={publish}>
    <div className="onboarding-heading"><div><span className="kicker">ETAPA {step + 1} DE {steps.length}</span><h1>{steps[step]}</h1></div><strong>{Math.round(((step + 1) / steps.length) * 100)}%</strong></div>
    <div className="progress-track"><span style={{ width: progress }} /></div>
    {step === 0 && <div className="form-grid">
      {field("name", "NOME DO ESTABELECIMENTO", { required: true, minLength: 2, placeholder: "Ex.: App Lanches" })}
      {field("slug", "LINK PERSONALIZADO (OPCIONAL)", { pattern: "[a-z0-9-]+", placeholder: "app-lanches", disabled: initial?.hasEstablishment })}
      <div className="field field-wide"><label>DESCRIÇÃO</label><textarea value={values.description} onChange={e => set("description", e.target.value)} placeholder="Conte o que torna seu negócio especial." /></div>
      {field("phone", "TELEFONE", { type: "tel", placeholder: "(11) 99999-9999" })}
      {field("whatsapp", "WHATSAPP PARA PEDIDOS", { required: true, type: "tel", placeholder: "5511999999999" })}
      {field("address", "ENDEREÇO", { placeholder: "Rua, número e bairro" })}
      {field("city", "CIDADE")} {field("state", "UF", { maxLength: 2, placeholder: "SP" })}
    </div>}
    {step === 1 && <div className="form-grid">
      {field("logoUrl", "URL DO LOGOTIPO", { type: "url", placeholder: "https://..." })}
      {field("coverUrl", "URL DA IMAGEM DE CAPA", { type: "url", placeholder: "https://..." })}
      <div className="field"><label>COR PRINCIPAL</label><input type="color" value={values.accentColor} onChange={e => set("accentColor", e.target.value)} /></div>
      <div className="field"><label>COR SECUNDÁRIA</label><input type="color" value={values.secondaryColor} onChange={e => set("secondaryColor", e.target.value)} /></div>
    </div>}
    {step === 2 && <div className="form-grid">
      <label className="choice-card"><input type="checkbox" checked={values.delivery} onChange={e => set("delivery", e.target.checked)} /><span><b>Entrega</b><small>Levar o pedido até o cliente</small></span></label>
      <label className="choice-card"><input type="checkbox" checked={values.pickup} onChange={e => set("pickup", e.target.checked)} /><span><b>Retirada</b><small>Cliente retira no estabelecimento</small></span></label>
      {field("minimumOrder", "PEDIDO MÍNIMO (R$)", { inputMode: "decimal" })}
      {field("estimatedMinutes", "TEMPO ESTIMADO (MIN)", { type: "number", min: 5, max: 360 })}
      {field("opensAt", "ABERTURA", { type: "time" })} {field("closesAt", "FECHAMENTO", { type: "time" })}
    </div>}
    {step === 3 && <div className="choice-list">{paymentOptions.map(([code, label]) => <label className="choice-card" key={code}><input type="checkbox" checked={values.payments.includes(code)} onChange={e => set("payments", e.target.checked ? [...values.payments, code] : values.payments.filter(item => item !== code))} /><span><b>{label}</b></span></label>)}</div>}
    {step === 4 && (values.delivery ? <div className="form-grid">
      {field("zoneName", "REGIÃO DE ENTREGA", { placeholder: "Centro e bairros próximos" })}
      {field("deliveryFee", "TAXA (R$)", { inputMode: "decimal" })}
      {field("freeDeliveryAbove", "GRÁTIS ACIMA DE (R$)", { inputMode: "decimal" })}
    </div> : <div className="step-note"><b>Entrega desativada</b><p>Você poderá ativá-la e cadastrar regiões depois no painel.</p></div>)}
    {step === 5 && <div className="form-grid">
      {field("category", "CATEGORIA", { required: true })}
      {field("productName", "NOME DO PRODUTO", { required: true })}
      {field("productPrice", "PREÇO (R$)", { required: true, inputMode: "decimal", placeholder: "29,90" })}
      {field("productImage", "URL DA FOTO", { type: "url", placeholder: "https://..." })}
      <div className="field field-wide"><label>DESCRIÇÃO</label><textarea value={values.productDescription} onChange={e => set("productDescription", e.target.value)} /></div>
    </div>}
    {step === 6 && <div className="publish-summary">
      <span className="kicker">TUDO PRONTO</span><h2>{values.name}</h2>
      <p>Seu cardápio será publicado com identidade visual, operação, pagamentos, entrega e o produto <b>{values.productName}</b>.</p>
      <div><span>14 dias grátis</span><span>Sem comissão por pedido</span><span>Dados isolados e protegidos</span></div>
    </div>}
    {message && <div className="form-message">{message}</div>}
    <div className="form-actions">
      {step > 0 && <button type="button" className="button ghost" onClick={() => { setMessage(""); setStep(current => current - 1); }}>Voltar</button>}
      {step < steps.length - 1
        ? <button type="button" className="button dark" onClick={next}>Continuar →</button>
        : <button type="submit" className="button dark" disabled={loading}>{loading ? "Publicando..." : "Publicar minha loja →"}</button>}
    </div>
  </form>;
}

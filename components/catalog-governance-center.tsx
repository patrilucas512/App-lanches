"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Row = Record<string, any>;
type Tab = "products" | "changesets" | "pricing" | "availability" | "governance" | "distribution" | "health";
const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0) / 100);
const date = (value?: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";

export function CatalogGovernanceCenter({ storeId }: { storeId: string }) {
  const [data, setData] = useState<Row | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const [tab, setTab] = useState<Tab>("products");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("Carregando catálogo central...");
  const [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/catalog-management?store_id=${storeId}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Não foi possível carregar o catálogo.");
    setData(result); setMessage("");
  }, [storeId]);

  useEffect(() => { const timer = setTimeout(() => load().catch((error) => setMessage(error.message)), 0); return () => clearTimeout(timer); }, [load]);

  async function action(payload: Row, success: string, reload = true) {
    setBusy(true); setMessage("Processando...");
    try {
      const response = await fetch("/api/catalog-management", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ store_id: storeId, ...payload }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Operação não concluída.");
      setMessage(success); if (reload) await load(); return result;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha inesperada."); return null; }
    finally { setBusy(false); }
  }

  async function openProduct(product: Row) {
    setSelected({ loading: true, id: product.id, name: product.name });
    const response = await fetch(`/api/catalog-management?store_id=${storeId}&product_id=${product.id}`, { cache: "no-store" });
    const result = await response.json(); setSelected(response.ok ? result : { ...product, error: result.error });
  }

  async function createChangeset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const result = await action({ action: "create_changeset", name: form.get("name"), description: form.get("description"), scope_type: form.get("scope"), reason: "Criado no painel de catálogo" }, "Changeset criado. Adicione alterações e gere a prévia.");
    if (result) { setNewOpen(false); setTab("changesets"); }
  }

  const products = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return (data?.products || []).filter((product: Row) => !term || `${product.name} ${product.sku || ""} ${product.barcode || ""} ${product.internal_code || ""}`.toLocaleLowerCase("pt-BR").includes(term));
  }, [data?.products, search]);
  const active = (data?.products || []).filter((product: Row) => product.lifecycle_status === "active" && product.active).length;
  const unpublished = (data?.changesets || []).filter((changeset: Row) => !["published", "archived", "rolled_back"].includes(changeset.status)).length;

  if (!data) return <section className="catalog-loading"><span className="catalog-spinner" />{message}</section>;
  return <section className="catalog-center">
    <div className="catalog-kpis">
      <article><small>PRODUTOS ATIVOS</small><strong>{active}</strong><span>{data.products.length} cadastrados na operação</span></article>
      <article><small>MUDANÇAS PENDENTES</small><strong>{unpublished}</strong><span>Publicação sempre revisada</span></article>
      <article><small>INDISPONÍVEIS</small><strong>{data.health.productsUnavailable}</strong><span>Por loja, canal ou política</span></article>
      <article><small>CATÁLOGOS PUBLICADOS</small><strong>{data.publishedCatalogs.length}</strong><span>Última versão válida protegida</span></article>
    </div>
    <nav className="catalog-tabs" aria-label="Áreas do catálogo">
      {(["products", "changesets", "pricing", "availability", "governance", "distribution", "health"] as Tab[]).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{({ products: "Produtos", changesets: "Publicação", pricing: "Preços", availability: "Disponibilidade", governance: "Governança", distribution: "Distribuição", health: "Saúde" } as Record<Tab, string>)[item]}</button>)}
    </nav>
    {message && <div className="catalog-notice" role="status">{message}</div>}

    {tab === "products" && <div className="catalog-grid">
      <section className="catalog-panel catalog-products"><header><div><small>PRODUCT MASTER</small><h2>Produtos existentes</h2></div><button onClick={() => setNewOpen(true)}>+ Criar changeset</button></header>
        <div className="catalog-search"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome, SKU, código de barras..." /><span>{products.length} resultado(s)</span></div>
        <div className="catalog-table"><div className="catalog-table-head"><span>Produto</span><span>SKU / código</span><span>Preço base</span><span>Status</span></div>{products.map((product: Row) => <button className="catalog-product-row" key={product.id} onClick={() => openProduct(product)}><span><b>{product.name}</b><small>{product.product_type?.replaceAll("_", " ") || "simple"}</small></span><span><b>{product.sku || product.internal_code || "—"}</b><small>{product.barcode || "Sem código de barras"}</small></span><strong>{money(product.price_cents)}</strong><i className={product.active ? "ok" : "off"}>{product.lifecycle_status || (product.active ? "active" : "inactive")}</i></button>)}</div>
      </section>
      <aside className="catalog-panel catalog-detail">{selected ? selected.loading ? <div className="catalog-empty">Carregando detalhes...</div> : <ProductDetail detail={selected} onDraft={() => action({ action: "ai_content_draft", product_id: selected.product.id, name: selected.product.name, reason: "Solicitação humana no painel" }, "Descrição sugerida em rascunho; nada foi publicado.", false)} /> : <div className="catalog-empty"><b>Selecione um produto</b><span>Veja versões, variações, preços, modificadores e integrações sem duplicar o cadastro.</span></div>}</aside>
    </div>}

    {tab === "changesets" && <section className="catalog-panel"><header><div><small>DRAFT → VALIDATE → PREVIEW → PUBLISH</small><h2>Changesets de catálogo</h2></div><button onClick={() => setNewOpen(true)}>+ Nova alteração</button></header><div className="changeset-list">{data.changesets.map((item: Row) => <article key={item.id}><div><i className={`state ${item.status}`}>{item.status}</i><h3>{item.name}</h3><p>{item.description || "Alterações agrupadas para revisão segura."}</p><small>{item.catalog_changeset_items?.length || 0} item(ns) · atualizado {date(item.updated_at)}</small></div><div className="changeset-actions"><button className="ghost" disabled={busy} onClick={() => action({ action: "validate", changeset_id: item.id, reason: "Validação solicitada no painel" }, "Validação concluída.")}>Validar</button><button className="ghost" disabled={busy} onClick={() => action({ action: "preview", changeset_id: item.id, reason: "Prévia solicitada no painel" }, "Prévia gerada sem efeitos.")}>Prévia</button><button disabled={busy || !item.preview_summary?.requiresConfirmation} onClick={() => window.confirm("Publicar esta alteração? O processamento será assíncrono e a versão anterior permanecerá disponível em caso de falha.") && action({ action: "publish", changeset_id: item.id, human_confirmed: true, reason: "Publicação confirmada no painel" }, "Publicação enviada para processamento seguro.")}>Publicar</button></div></article>)}</div></section>}

    {tab === "pricing" && <section className="catalog-panel"><header><div><small>PRICING ENGINE REUTILIZADO</small><h2>Price books e precedência</h2></div><span className="catalog-chip">Loja + canal → loja → região → marca → organização</span></header><div className="card-grid">{data.priceBooks.map((book: Row) => <article key={book.id}><i className={`state ${book.status}`}>{book.status}</i><h3>{book.name}</h3><p>{book.scope_type} · versão {book.version}</p><strong>{book.price_book_items?.length || 0} preço(s)</strong><small>Vigência: {date(book.effective_from)}</small></article>)}{!data.priceBooks.length && <Empty text="Nenhum price book criado. O preço operacional atual continua válido." />}</div></section>}

    {tab === "availability" && <section className="catalog-panel"><header><div><small>LOJA · CANAL · HORÁRIO · ESTOQUE</small><h2>Perfis de disponibilidade</h2></div><span className="catalog-chip">Sem automação por demanda sem política</span></header><div className="card-grid">{data.availabilityProfiles.map((profile: Row) => <article key={profile.id}><i className={`state ${profile.active ? "active" : "inactive"}`}>{profile.active ? "ativo" : "inativo"}</i><h3>{profile.name}</h3><p>{profile.timezone}</p><strong>{profile.stock_policy?.replaceAll("_", " ")}</strong><small>{profile.channel_scope?.length ? profile.channel_scope.join(" · ") : "Todos os canais"}</small></article>)}{!data.availabilityProfiles.length && <Empty text="Crie perfis para café da manhã, happy hour ou disponibilidade por canal." />}</div></section>}

    {tab === "governance" && <section className="catalog-panel"><header><div><small>POLÍTICA POR CAMPO</small><h2>Governança e overrides</h2></div><span className="catalog-chip">Overrides permitidos não são erros</span></header><div className="governance-layout"><div><h3>Políticas configuradas</h3>{data.fieldPolicies.map((policy: Row) => <div className="policy-row" key={policy.id}><span><b>{policy.field_name}</b><small>{policy.scope_type}</small></span><i className={`state ${policy.policy === "locked" ? "warning" : "active"}`}>{policy.policy}</i></div>)}{!data.fieldPolicies.length && <Empty text="Nenhum bloqueio adicional: as regras atuais da loja continuam válidas." />}</div><div className="architecture-card"><h3>Herança segura</h3><ol><li>Produto operacional existente</li><li>Assignment para a unidade</li><li>Override permitido por campo</li><li>Price e availability resolvidos por contexto</li><li>Read model publicado por canal</li></ol></div></div></section>}

    {tab === "distribution" && <section className="catalog-panel"><header><div><small>MULTIUNIDADE · ROLLOUT</small><h2>Distribuição por loja</h2></div><span className="catalog-chip">Falha parcial aparece como parcial</span></header><div className="changeset-list">{data.distributions.map((job: Row) => <article key={job.id}><div><i className={`state ${job.status}`}>{job.status}</i><h3>Distribuição {String(job.id).slice(0, 8)}</h3><p>{job.target_scope} · política {job.conflict_policy}</p><small>{job.catalog_distribution_results?.length || 0} loja(s) processada(s) · {job.error_count} erro(s)</small></div><div className="distribution-results">{(job.catalog_distribution_results || []).slice(0, 5).map((result: Row) => <span key={result.store_id}><i className={`dot ${result.status}`} />{String(result.store_id).slice(0, 8)} · {result.status}</span>)}</div></article>)}{!data.distributions.length && <Empty text="Ainda não há rollouts de rede. Publicações locais permanecem isoladas." />}</div></section>}

    {tab === "health" && <section className="catalog-panel"><header><div><small>CHECKLIST TRANSPARENTE</small><h2>Saúde do catálogo</h2></div><span className="catalog-chip">Sem score opaco</span></header><div className="health-grid">{[["Sem imagem", data.health.productsWithoutImage], ["Sem descrição", data.health.productsWithoutDescription], ["Indisponíveis", data.health.productsUnavailable], ["Sem receita", data.health.productsWithoutRecipe], ["Sem canal", data.health.missingChannelAssignment], ["Modificadores inválidos", data.health.invalidModifiers], ["Possíveis duplicados", data.health.duplicateCandidates]].map(([label, value]) => <article key={String(label)} className={Number(value) ? "attention" : "healthy"}><span>{label}</span><strong>{value}</strong><small>{Number(value) ? "Revisão recomendada" : "Sem pendências"}</small></article>)}</div><div className="validation-list">{data.validationResults.slice(0, 20).map((issue: Row) => <p key={issue.id}><i className={`state ${issue.severity}`}>{issue.severity}</i><span><b>{issue.rule_code}</b>{issue.message}</span></p>)}</div></section>}

    {newOpen && <div className="catalog-modal" role="dialog" aria-modal="true"><form onSubmit={createChangeset}><header><div><small>NOVA ALTERAÇÃO CONTROLADA</small><h2>Criar changeset</h2></div><button type="button" className="close" onClick={() => setNewOpen(false)}>×</button></header><label>Nome<input name="name" required minLength={3} maxLength={140} placeholder="Ex.: Cardápio de verão 2027" /></label><label>Descrição<textarea name="description" rows={4} placeholder="Explique o objetivo e o impacto esperado." /></label><label>Escopo<select name="scope" defaultValue="store"><option value="store">Somente esta loja</option>{data.scope === "network" && <><option value="organization">Organização</option><option value="brand">Marca</option><option value="region">Região</option><option value="cluster">Cluster</option></>}</select></label><div className="catalog-warning">Criar o changeset não publica nada. Validação, prévia e confirmação continuam obrigatórias.</div><footer><button type="button" className="ghost" onClick={() => setNewOpen(false)}>Cancelar</button><button disabled={busy}>Criar rascunho</button></footer></form></div>}
  </section>;
}

function ProductDetail({ detail, onDraft }: { detail: Row; onDraft: () => void }) {
  const product = detail.product;
  return <><header><div><small>DETALHE DO PRODUTO</small><h2>{product.name}</h2></div><i className={`state ${product.active ? "active" : "inactive"}`}>{product.lifecycle_status}</i></header><p>{product.description || "Sem descrição cadastrada."}</p><div className="detail-price"><span><small>Preço base</small><strong>{money(product.price_cents)}</strong></span><span><small>Versão</small><strong>v{product.catalog_version}</strong></span></div><dl><div><dt>SKU</dt><dd>{product.sku || "—"}</dd></div><div><dt>Código de barras</dt><dd>{product.barcode || "—"}</dd></div><div><dt>Variações</dt><dd>{detail.variations.length}</dd></div><div><dt>Modificadores</dt><dd>{detail.modifierAssignments.length}</dd></div><div><dt>Preços por escopo</dt><dd>{detail.priceItems.length}</dd></div><div><dt>Versões preservadas</dt><dd>{detail.versions.length}</dd></div></dl><div className="catalog-safe-note">Receita, estoque, custo e estações continuam nos módulos oficiais. Dados de alergênicos aparecem somente quando cadastrados explicitamente.</div><button onClick={onDraft}>Sugerir descrição em rascunho</button></>;
}

function Empty({ text }: { text: string }) { return <div className="catalog-empty"><b>Nenhum registro</b><span>{text}</span></div>; }

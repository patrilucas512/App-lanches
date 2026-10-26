"use client";

import { FormEvent, useMemo, useState } from "react";
import { AdminBadge, AdminEmptyState, AdminField, AdminInput, AdminModal, AdminSwitch, AdminTextarea } from "@/components/admin-ui";
import { createClient } from "@/lib/supabase/client";

export type AddonGroupItem = { id: string; name: string; price_cents: number; active: boolean; sort_order: number };
export type AddonGroup = {
  id: string;
  name: string;
  description?: string | null;
  min_choices: number;
  max_choices: number;
  required: boolean;
  active: boolean;
  sort_order: number;
  addons: AddonGroupItem[];
  product_addon_groups: { product_id: string }[];
};
type ProductOption = { id: string; name: string };
type ItemDraft = { key: string; id?: string; name: string; price: string; active: boolean };

const groupSelect = "id,name,description,min_choices,max_choices,required,active,sort_order,addons(id,name,price_cents,active,sort_order),product_addon_groups(product_id)";
const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const emptyItem = (): ItemDraft => ({ key: crypto.randomUUID(), name: "", price: "", active: true });

export function AddonGroupsManager({ establishmentId, initialGroups, products }: { establishmentId: string; initialGroups: AddonGroup[]; products: ProductOption[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [groups, setGroups] = useState(initialGroups);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<AddonGroup | null>(null);
  const [open, setOpen] = useState(false);
  const [required, setRequired] = useState(false);
  const [active, setActive] = useState(true);
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [reordering, setReordering] = useState(false);
  const [orderSnapshot, setOrderSnapshot] = useState<string[]>([]);

  const ordered = useMemo(() => [...groups].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "pt-BR")), [groups]);
  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return ordered.filter(group => !term || `${group.name} ${group.description ?? ""} ${group.addons.map(item => item.name).join(" ")}`.toLocaleLowerCase("pt-BR").includes(term));
  }, [ordered, search]);

  function startNew() {
    setEditing(null); setRequired(false); setActive(true); setItems([emptyItem()]); setSelectedProducts([]); setMessage(""); setOpen(true);
  }

  function startEdit(group: AddonGroup) {
    setEditing(group); setRequired(group.required); setActive(group.active);
    setItems(group.addons.length ? [...group.addons].sort((a, b) => a.sort_order - b.sort_order).map(item => ({ key: item.id, id: item.id, name: item.name, price: (item.price_cents / 100).toFixed(2).replace(".", ","), active: item.active })) : [emptyItem()]);
    setSelectedProducts(group.product_addon_groups.map(link => link.product_id)); setMessage(""); setOpen(true);
  }

  function updateItem(key: string, field: "name" | "price", value: string) {
    setItems(current => current.map(item => item.key === key ? { ...item, [field]: value } : item));
  }

  async function reloadGroups() {
    const { data, error } = await supabase.from("addon_groups").select(groupSelect).eq("establishment_id", establishmentId).order("sort_order");
    if (error) throw error;
    setGroups((data ?? []) as AddonGroup[]);
  }

  async function saveGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") || "").trim();
    const minChoices = required ? Math.max(1, Number(data.get("min_choices")) || 1) : Math.max(0, Number(data.get("min_choices")) || 0);
    const maxChoices = Math.max(1, Number(data.get("max_choices")) || 1);
    if (!name) return setMessage("Informe o nome do grupo.");
    if (minChoices > maxChoices) return setMessage("A quantidade mínima não pode ser maior que a máxima.");
    const parsedItems = items.map(item => ({ ...item, name: item.name.trim(), price_cents: Math.round(Number(item.price.replace(",", ".") || 0) * 100) })).filter(item => item.name);
    if (!parsedItems.length) return setMessage("Cadastre pelo menos uma opção no grupo.");
    if (parsedItems.some(item => !Number.isFinite(item.price_cents) || item.price_cents < 0)) return setMessage("Informe preços válidos para os adicionais.");
    if (new Set(parsedItems.map(item => item.name.toLocaleLowerCase("pt-BR"))).size !== parsedItems.length) return setMessage("Não repita o mesmo adicional dentro do grupo.");

    setLoading(true); setMessage("Salvando grupo e vínculos...");
    try {
      const nextOrder = groups.length ? Math.max(...groups.map(group => group.sort_order)) + 1 : 0;
      const values = { establishment_id: establishmentId, name, description: String(data.get("description") || "").trim() || null, min_choices: minChoices, max_choices: maxChoices, required, active, sort_order: editing?.sort_order ?? nextOrder };
      const query = editing ? supabase.from("addon_groups").update(values).eq("id", editing.id).eq("establishment_id", establishmentId) : supabase.from("addon_groups").insert(values);
      const { data: savedGroup, error: groupError } = await query.select("id").single();
      if (groupError) throw groupError;
      const groupId = savedGroup.id as string;
      const previousIds = new Set(editing?.addons.map(item => item.id) ?? []);
      const retainedIds = new Set(parsedItems.flatMap(item => item.id ? [item.id] : []));
      const removedIds = [...previousIds].filter(id => !retainedIds.has(id));
      if (removedIds.length) {
        const { error } = await supabase.from("addons").delete().eq("establishment_id", establishmentId).eq("addon_group_id", groupId).in("id", removedIds);
        if (error) throw error;
      }
      for (const [index, item] of parsedItems.entries()) {
        const itemValues = { establishment_id: establishmentId, addon_group_id: groupId, name: item.name, price_cents: item.price_cents, active: item.active, sort_order: index };
        const itemQuery = item.id ? supabase.from("addons").update(itemValues).eq("id", item.id).eq("establishment_id", establishmentId) : supabase.from("addons").insert(itemValues);
        const { error } = await itemQuery;
        if (error) throw error;
      }
      const { error: unlinkError } = await supabase.from("product_addon_groups").delete().eq("establishment_id", establishmentId).eq("addon_group_id", groupId);
      if (unlinkError) throw unlinkError;
      if (selectedProducts.length) {
        const { error: linkError } = await supabase.from("product_addon_groups").insert(selectedProducts.map(productId => ({ establishment_id: establishmentId, product_id: productId, addon_group_id: groupId })));
        if (linkError) throw linkError;
      }
      await reloadGroups(); setOpen(false); setEditing(null); setMessage(editing ? "Grupo atualizado com sucesso." : "Grupo criado com sucesso.");
    } catch (error) {
      setMessage(`Não foi possível concluir: ${error instanceof Error ? error.message : "erro inesperado"}`);
    } finally { setLoading(false); }
  }

  async function toggleGroup(group: AddonGroup) {
    setLoading(true);
    const { error } = await supabase.from("addon_groups").update({ active: !group.active }).eq("id", group.id).eq("establishment_id", establishmentId);
    if (error) setMessage(`Não foi possível alterar o grupo: ${error.message}`);
    else { setGroups(current => current.map(item => item.id === group.id ? { ...item, active: !item.active } : item)); setMessage(group.active ? `${group.name} foi ocultado.` : `${group.name} está ativo.`); }
    setLoading(false);
  }

  async function duplicateGroup(group: AddonGroup) {
    setLoading(true); setMessage(`Duplicando ${group.name}...`);
    try {
      const nextOrder = groups.length ? Math.max(...groups.map(item => item.sort_order)) + 1 : 0;
      const { data, error } = await supabase.from("addon_groups").insert({ establishment_id: establishmentId, name: `${group.name} (cópia)`, description: group.description, min_choices: group.min_choices, max_choices: group.max_choices, required: group.required, active: false, sort_order: nextOrder }).select("id").single();
      if (error) throw error;
      if (group.addons.length) {
        const { error: itemsError } = await supabase.from("addons").insert(group.addons.map((item, index) => ({ establishment_id: establishmentId, addon_group_id: data.id, name: item.name, price_cents: item.price_cents, active: item.active, sort_order: index })));
        if (itemsError) throw itemsError;
      }
      await reloadGroups(); setMessage("Grupo duplicado como inativo. Os produtos não foram alterados.");
    } catch (error) { setMessage(`Não foi possível duplicar: ${error instanceof Error ? error.message : "erro inesperado"}`); }
    finally { setLoading(false); }
  }

  async function removeGroup(group: AddonGroup) {
    const count = group.product_addon_groups.length;
    if (!confirm(`Excluir o grupo “${group.name}”?${count ? ` Ele será desvinculado de ${count} produto${count === 1 ? "" : "s"}.` : ""} Os produtos e pedidos não serão excluídos.`)) return;
    setLoading(true);
    const { error } = await supabase.from("addon_groups").delete().eq("id", group.id).eq("establishment_id", establishmentId);
    if (error) setMessage(`Não foi possível excluir: ${error.message}`);
    else { setGroups(current => current.filter(item => item.id !== group.id)); setMessage("Grupo excluído. Produtos e histórico foram preservados."); }
    setLoading(false);
  }

  function beginReorder() { setSearch(""); setOrderSnapshot(ordered.map(group => group.id)); setReordering(true); setMessage("Use as setas e salve a nova ordem."); }
  function moveGroup(id: string, direction: -1 | 1) {
    setGroups(current => { const next = [...current].sort((a, b) => a.sort_order - b.sort_order); const index = next.findIndex(group => group.id === id); const target = index + direction; if (index < 0 || target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target], next[index]]; return next.map((group, sort_order) => ({ ...group, sort_order })); });
  }
  function cancelReorder() { const positions = new Map(orderSnapshot.map((id, index) => [id, index])); setGroups(current => current.map(group => ({ ...group, sort_order: positions.get(group.id) ?? group.sort_order }))); setReordering(false); setMessage("Ordem restaurada."); }
  async function saveOrder() {
    setLoading(true); const results = await Promise.all(ordered.map((group, sort_order) => supabase.from("addon_groups").update({ sort_order }).eq("id", group.id).eq("establishment_id", establishmentId)));
    const failed = results.find(result => result.error)?.error; if (failed) setMessage(`Não foi possível salvar a ordem: ${failed.message}`); else { setGroups(current => current.map(group => ({ ...group, sort_order: ordered.findIndex(item => item.id === group.id) }))); setReordering(false); setMessage("Ordem dos grupos salva."); } setLoading(false);
  }

  return <section className="admin-addon-manager" id="adicionais" aria-labelledby="addon-groups-title">
    <header className="admin-addon-head"><div><small>PERSONALIZAÇÕES DO CARDÁPIO</small><h2 id="addon-groups-title">Grupos de adicionais</h2><p>Crie escolhas reutilizáveis, defina limites e vincule cada grupo aos produtos certos.</p></div><div>{reordering ? <><button className="button outline" type="button" onClick={cancelReorder}>Cancelar</button><button className="button dark" type="button" disabled={loading} onClick={() => void saveOrder()}>Salvar ordem</button></> : <><button className="button outline" type="button" disabled={!groups.length} onClick={beginReorder}>↕ Reordenar</button><button className="button dark" type="button" onClick={startNew}>＋ Novo grupo</button></>}</div></header>
    <div className="admin-addon-toolbar"><label><span aria-hidden="true">⌕</span><input value={search} disabled={reordering} onChange={event => setSearch(event.target.value)} placeholder="Buscar grupos ou adicionais..." aria-label="Buscar grupos de adicionais" /></label><span>{visible.length} de {groups.length} grupos</span></div>
    {message && <div className={`form-message ${/sucesso|salv|ativo|preserv|ocult|restaur/i.test(message) ? "form-success" : ""}`}>{message}</div>}
    {visible.length ? <div className="admin-addon-list">{visible.map((group, index) => <article className={`admin-addon-group ${group.active ? "" : "inactive"}`} key={group.id}>
      <div className="admin-addon-group-main"><AdminBadge tone={group.required ? "accent" : "neutral"}>{group.required ? "Obrigatório" : "Opcional"}</AdminBadge><h3>{group.name}</h3>{group.description && <p>{group.description}</p>}<b>Mínimo {group.min_choices} · Máximo {group.max_choices} · {group.product_addon_groups.length} produto{group.product_addon_groups.length === 1 ? "" : "s"}</b><div className="admin-addon-chips">{group.addons.filter(item => item.active).length ? group.addons.filter(item => item.active).sort((a, b) => a.sort_order - b.sort_order).map(item => <span key={item.id}>{item.name}{item.price_cents > 0 ? ` + ${money(item.price_cents)}` : ""}</span>) : <span>Nenhuma opção ativa</span>}</div></div>
      {reordering ? <div className="admin-addon-reorder"><button type="button" disabled={index === 0} onClick={() => moveGroup(group.id, -1)}>↑</button><b>{String(index + 1).padStart(2, "0")}</b><button type="button" disabled={index === visible.length - 1} onClick={() => moveGroup(group.id, 1)}>↓</button></div> : <div className="admin-addon-actions"><div><AdminSwitch checked={group.active} disabled={loading} label={`${group.active ? "Desativar" : "Ativar"} ${group.name}`} onCheckedChange={() => void toggleGroup(group)} /><small>{group.active ? "Ativo" : "Inativo"}</small></div><button type="button" onClick={() => startEdit(group)}>Editar</button><button type="button" disabled={loading} onClick={() => void duplicateGroup(group)}>Duplicar</button><button type="button" className="danger-action" disabled={loading} onClick={() => void removeGroup(group)}>Excluir</button></div>}
    </article>)}</div> : <AdminEmptyState title="Nenhum grupo de adicionais" description={groups.length ? "Ajuste a busca para encontrar um grupo." : "Crie o primeiro grupo e vincule às opções do cardápio."} action={<button className="button dark" type="button" onClick={startNew}>Criar primeiro grupo</button>} />}

    <AdminModal open={open} title={editing ? `Editar ${editing.name}` : "Novo grupo de adicionais"} eyebrow="Personalização do cardápio" onClose={() => { if (!loading) setOpen(false); }} footer={<><button className="button outline" type="button" disabled={loading} onClick={() => setOpen(false)}>Cancelar</button><button className="button dark" type="submit" form="addon-group-form" disabled={loading}>{loading ? "Salvando..." : editing ? "Salvar grupo" : "Criar grupo"}</button></>}>
      <form id="addon-group-form" className="addon-group-form" onSubmit={saveGroup} key={editing?.id ?? "new-addon-group"}>
        <div className="addon-group-form-grid"><AdminField label="Nome" required><AdminInput name="name" required maxLength={100} defaultValue={editing?.name ?? ""} placeholder="Ex.: Extras e molhos" autoFocus /></AdminField><AdminField label="Descrição"><AdminTextarea name="description" maxLength={300} defaultValue={editing?.description ?? ""} placeholder="Explique esta escolha ao cliente" /></AdminField></div>
        <div className="addon-group-rules"><div><b>Escolha obrigatória</b><small>Quando ativa, o cliente precisa selecionar pelo menos uma opção.</small></div><AdminSwitch checked={required} onCheckedChange={setRequired} label="Alterar obrigatoriedade do grupo" /><AdminField label="Mínimo"><AdminInput name="min_choices" type="number" min={required ? 1 : 0} max={50} defaultValue={editing?.min_choices ?? (required ? 1 : 0)} /></AdminField><AdminField label="Máximo"><AdminInput name="max_choices" type="number" min={1} max={50} defaultValue={editing?.max_choices ?? 1} /></AdminField><div><b>Grupo ativo</b><small>Grupos inativos ficam salvos, mas não devem aparecer no cardápio.</small></div><AdminSwitch checked={active} onCheckedChange={setActive} label="Alterar status do grupo" /></div>
        <section className="addon-group-options"><header><div><small>OPÇÕES</small><h3>Adicionais deste grupo</h3></div><button type="button" onClick={() => setItems(current => [...current, emptyItem()])}>＋ Adicionar opção</button></header>{items.map((item, index) => <div className="addon-group-option-row" key={item.key}><input value={item.name} onChange={event => updateItem(item.key, "name", event.target.value)} placeholder="Nome do adicional" aria-label={`Nome do adicional ${index + 1}`} /><input value={item.price} onChange={event => updateItem(item.key, "price", event.target.value)} placeholder="0,00" inputMode="decimal" aria-label={`Preço do adicional ${index + 1}`} /><AdminSwitch checked={item.active} onCheckedChange={value => setItems(current => current.map(currentItem => currentItem.key === item.key ? { ...currentItem, active: value } : currentItem))} label={`Alterar status do adicional ${index + 1}`} /><button type="button" className="danger-action" onClick={() => setItems(current => current.length === 1 ? [emptyItem()] : current.filter(currentItem => currentItem.key !== item.key))}>Excluir</button></div>)}</section>
        <section className="addon-group-products"><header><small>PRODUTOS VINCULADOS</small><h3>Onde este grupo aparece</h3><p>Marque os produtos que usarão estas opções.</p></header>{products.length ? <div>{products.map(product => <label key={product.id}><input type="checkbox" checked={selectedProducts.includes(product.id)} onChange={() => setSelectedProducts(current => current.includes(product.id) ? current.filter(id => id !== product.id) : [...current, product.id])} /><span>{product.name}</span></label>)}</div> : <p>Nenhum produto cadastrado.</p>}</section>
        {message && <div className={`form-message ${/sucesso|salv/i.test(message) ? "form-success" : ""}`}>{message}</div>}
      </form>
    </AdminModal>
  </section>;
}

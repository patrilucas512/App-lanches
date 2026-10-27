"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AdminBadge, AdminEmptyState, AdminField, AdminInput, AdminModal, AdminSwitch, AdminTextarea } from "@/components/admin-ui";
import { createClient } from "@/lib/supabase/client";

type Category = { id: string; name: string; description?: string | null; active: boolean; sort_order: number };
type Addon = { name: string; price_cents: number };
type Product = {
  id: string;
  category_id?: string | null;
  name: string;
  description?: string | null;
  price_cents: number;
  compare_at_price_cents?: number | null;
  active: boolean;
  featured?: boolean;
  sort_order?: number;
  image_url?: string | null;
  ingredients?: string[];
  addon_options?: Addon[];
  barcode?: string | null;
};
type AddonDraft = { id: string; name: string; price: string };
type StatusFilter = "all" | "active" | "inactive" | "featured" | "bestsellers";

const productSelect = "id,category_id,name,description,price_cents,compare_at_price_cents,active,featured,sort_order,image_url,ingredients,addon_options,barcode";
const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const parseLines = (value: string) => value.split(/\n|,/).map(item => item.trim()).filter(Boolean);
const emptyAddon = (): AddonDraft => ({ id: crypto.randomUUID(), name: "", price: "" });

export function CatalogManager({ establishmentId, initialCategories, initialProducts, salesCounts = {}, defaultPreparationMinutes = 45 }: { establishmentId: string; initialCategories: Category[]; initialProducts: Product[]; salesCounts?: Record<string, number>; defaultPreparationMinutes?: number }) {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState(initialCategories);
  const [products, setProducts] = useState(initialProducts);
  const [selectedCategory, setSelectedCategory] = useState(initialCategories[0]?.id ?? "");
  const [editing, setEditing] = useState<Product | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formActive, setFormActive] = useState(true);
  const [formFeatured, setFormFeatured] = useState(false);
  const [categoryFormOpen, setCategoryFormOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryFormActive, setCategoryFormActive] = useState(true);
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryReorderMode, setCategoryReorderMode] = useState(false);
  const [categoryOrderSnapshot, setCategoryOrderSnapshot] = useState<string[]>([]);
  const [viewing, setViewing] = useState<Product | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [addonDrafts, setAddonDrafts] = useState<AddonDraft[]>([emptyAddon()]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [reorderMode, setReorderMode] = useState(false);
  const [orderSnapshot, setOrderSnapshot] = useState<string[]>([]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const orderedProducts = useMemo(() => [...products].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, "pt-BR")), [products]);
  const orderedCategories = useMemo(() => [...categories].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "pt-BR")), [categories]);
  const visibleCategories = useMemo(() => {
    const term = categorySearch.trim().toLocaleLowerCase("pt-BR");
    return orderedCategories.filter(category => !term || `${category.name} ${category.description ?? ""}`.toLocaleLowerCase("pt-BR").includes(term));
  }, [categorySearch, orderedCategories]);
  const visibleProducts = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
    const filtered = orderedProducts.filter(product => {
      const matchesSearch = !normalizedSearch || `${product.name} ${product.description ?? ""}`.toLocaleLowerCase("pt-BR").includes(normalizedSearch);
      const matchesCategory = categoryFilter === "all" || product.category_id === categoryFilter;
      const matchesStatus = statusFilter === "all" || (statusFilter === "active" && product.active) || (statusFilter === "inactive" && !product.active) || (statusFilter === "featured" && product.featured) || (statusFilter === "bestsellers" && (salesCounts[product.id] ?? 0) > 0);
      return matchesSearch && matchesCategory && matchesStatus;
    });
    return statusFilter === "bestsellers" ? filtered.sort((a, b) => (salesCounts[b.id] ?? 0) - (salesCounts[a.id] ?? 0)) : filtered;
  }, [categoryFilter, orderedProducts, salesCounts, search, statusFilter]);
  const productGroups = useMemo(() => {
    const productsByCategory = new Map<string, Product[]>();
    visibleProducts.forEach(product => {
      const key = product.category_id || "uncategorized";
      productsByCategory.set(key, [...(productsByCategory.get(key) ?? []), product]);
    });
    const groups = orderedCategories.map(category => ({
      id: category.id,
      name: category.name,
      products: productsByCategory.get(category.id) ?? [],
    })).filter(group => group.products.length > 0);
    const uncategorized = productsByCategory.get("uncategorized") ?? [];
    return uncategorized.length ? [...groups, { id: "uncategorized", name: "Sem categoria", products: uncategorized }] : groups;
  }, [orderedCategories, visibleProducts]);

  function choosePhoto(file?: File) {
    if (preview) URL.revokeObjectURL(preview);
    setMessage("");
    if (!file) { setPhoto(null); setPreview(""); return; }
    if (!file.type.startsWith("image/")) return setMessage("Escolha um arquivo de imagem.");
    if (file.size > 8 * 1024 * 1024) return setMessage("A foto deve ter no máximo 8 MB.");
    setPhoto(file); setPreview(URL.createObjectURL(file));
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const data = new FormData(form);
    const name = String(data.get("category_name") || "").trim();
    if (!name) return setMessage("Informe o nome da categoria.");
    const duplicate = categories.some(category => category.id !== editingCategory?.id && category.name.trim().toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"));
    if (duplicate) return setMessage("Já existe uma categoria com esse nome.");
    setLoading(true); setMessage("Salvando categoria...");
    const nextSortOrder = categories.length ? Math.max(...categories.map(category => category.sort_order)) + 1 : 0;
    const values = { establishment_id: establishmentId, name, description: String(data.get("category_description") || "").trim() || null, active: categoryFormActive, sort_order: editingCategory?.sort_order ?? nextSortOrder };
    const query = editingCategory ? supabase.from("categories").update(values).eq("id", editingCategory.id).eq("establishment_id", establishmentId) : supabase.from("categories").insert(values);
    const { data: category, error } = await query.select("id,name,description,active,sort_order").single();
    if (error) { setLoading(false); return setMessage(`Não foi possível salvar a categoria: ${error.message}`); }
    setCategories(current => editingCategory ? current.map(item => item.id === category.id ? category : item) : [...current, category]);
    setSelectedCategory(category.id); setEditingCategory(null); setCategoryFormOpen(false); form.reset(); setLoading(false);
    setMessage(editingCategory ? "Categoria atualizada com sucesso." : "Categoria criada com sucesso.");
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const data = new FormData(form);
    const normalPrice = Number(String(data.get("price")).replace(",", "."));
    const promotionalRaw = String(data.get("promotional_price") || "").trim();
    const promotionalPrice = promotionalRaw ? Number(promotionalRaw.replace(",", ".")) : null;
    if (!Number.isFinite(normalPrice) || normalPrice < 0) return setMessage("Informe um preço normal válido.");
    if (promotionalPrice !== null && (!Number.isFinite(promotionalPrice) || promotionalPrice < 0 || promotionalPrice >= normalPrice)) return setMessage("O preço promocional deve ser válido e menor que o preço normal.");
    const parsedAddons = addonDrafts.map(addon => ({ name: addon.name.trim(), rawPrice: addon.price.trim(), price_cents: Math.round(Number(addon.price.replace(",", ".")) * 100) }));
    if (parsedAddons.some(addon => (addon.name && (!Number.isFinite(addon.price_cents) || addon.price_cents < 0)) || (!addon.name && addon.rawPrice))) return setMessage("Preencha o nome e um preço válido para cada adicional.");
    const addonOptions = parsedAddons.filter(addon => addon.name).map(({ name, price_cents }) => ({ name, price_cents }));
    setLoading(true); setMessage(photo ? "Enviando a foto..." : "Salvando o produto...");
    let imageUrl: string | null | undefined = editing?.image_url ?? null; let uploadedPath: string | null = null;
    if (photo) {
      const extension = photo.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      uploadedPath = `${establishmentId}/products/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from("product-images").upload(uploadedPath, photo, { cacheControl: "3600", contentType: photo.type, upsert: false });
      if (error) { setLoading(false); return setMessage(`Não foi possível enviar a foto: ${error.message}`); }
      imageUrl = supabase.storage.from("product-images").getPublicUrl(uploadedPath).data.publicUrl;
    }
    const values = { establishment_id: establishmentId, category_id: String(data.get("category_id")), name: String(data.get("name")).trim(), description: String(data.get("description") || ""), price_cents: Math.round((promotionalPrice ?? normalPrice) * 100), compare_at_price_cents: promotionalPrice === null ? null : Math.round(normalPrice * 100), image_url: imageUrl, ingredients: parseLines(String(data.get("ingredients") || "")), addon_options: addonOptions, barcode: String(data.get("barcode") || "").trim() || null, active: formActive, featured: formFeatured, sort_order: editing?.sort_order ?? products.length };
    const query = editing ? supabase.from("products").update(values).eq("id", editing.id) : supabase.from("products").insert(values);
    const { data: product, error } = await query.select(productSelect).single();
    if (error) { if (uploadedPath) await supabase.storage.from("product-images").remove([uploadedPath]); setLoading(false); return setMessage(error.code === "23505" ? "Este código interno já está vinculado a outro produto." : error.message); }
    setProducts(current => editing ? current.map(item => item.id === product.id ? product : item) : [...current, product]);
    setEditing(null); setAddonDrafts([emptyAddon()]); setFormOpen(false); form.reset(); choosePhoto(); setLoading(false);
    setMessage(editing ? "Produto atualizado." : "Produto e foto salvos com sucesso.");
  }

  async function toggleProduct(product: Product) {
    const { error } = await supabase.from("products").update({ active: !product.active }).eq("id", product.id).eq("establishment_id", establishmentId);
    if (error) return setMessage(error.message);
    setProducts(current => current.map(item => item.id === product.id ? { ...item, active: !item.active } : item));
    setMessage(`${product.name} ${product.active ? "foi pausado" : "está ativo"}.`);
  }

  async function duplicateProduct(product: Product) {
    setLoading(true); setMessage(`Duplicando ${product.name}...`);
    const values = { establishment_id: establishmentId, category_id: product.category_id, name: `${product.name} (cópia)`, description: product.description, price_cents: product.price_cents, compare_at_price_cents: product.compare_at_price_cents, active: false, featured: false, sort_order: products.length, image_url: product.image_url, ingredients: product.ingredients ?? [], addon_options: product.addon_options ?? [], barcode: null };
    const { data, error } = await supabase.from("products").insert(values).select(productSelect).single();
    if (error) setMessage(`Não foi possível duplicar: ${error.message}`);
    else { setProducts(current => [...current, data]); setMessage("Produto duplicado como inativo. Revise e ative quando estiver pronto."); }
    setLoading(false);
  }

  function openNewCategory() {
    setEditingCategory(null); setCategoryFormActive(true); setCategoryFormOpen(true); setMessage("");
  }

  function openCategoryEdit(category: Category) {
    setEditingCategory(category); setCategoryFormActive(category.active); setCategoryFormOpen(true); setMessage("");
  }

  async function toggleCategory(category: Category) {
    setLoading(true); setMessage(`${category.active ? "Desativando" : "Ativando"} ${category.name}...`);
    const { error } = await supabase.from("categories").update({ active: !category.active }).eq("id", category.id).eq("establishment_id", establishmentId);
    if (error) { setLoading(false); return setMessage(`Não foi possível alterar a categoria: ${error.message}`); }
    setCategories(current => current.map(item => item.id === category.id ? { ...item, active: !item.active } : item));
    setMessage(category.active ? `${category.name} foi ocultada do cardápio público. Os produtos foram preservados.` : `${category.name} está ativa no cardápio público.`);
    setLoading(false);
  }

  async function duplicateCategory(category: Category) {
    setLoading(true); setMessage(`Duplicando ${category.name}...`);
    const existingNames = new Set(categories.map(item => item.name.toLocaleLowerCase("pt-BR")));
    let name = `${category.name} (cópia)`; let suffix = 2;
    while (existingNames.has(name.toLocaleLowerCase("pt-BR"))) name = `${category.name} (cópia ${suffix++})`;
    const nextSortOrder = categories.length ? Math.max(...categories.map(item => item.sort_order)) + 1 : 0;
    const { data, error } = await supabase.from("categories").insert({ establishment_id: establishmentId, name, description: category.description, active: false, sort_order: nextSortOrder }).select("id,name,description,active,sort_order").single();
    if (error) setMessage(`Não foi possível duplicar a categoria: ${error.message}`);
    else { setCategories(current => [...current, data]); setMessage("Categoria duplicada como inativa. Nenhum produto foi copiado ou alterado."); }
    setLoading(false);
  }

  function beginCategoryReorder() {
    setCategorySearch(""); setCategoryOrderSnapshot(orderedCategories.map(category => category.id)); setCategoryReorderMode(true);
    setMessage("Use as setas para organizar as categorias e salve a nova ordem.");
  }

  function moveCategory(categoryId: string, direction: -1 | 1) {
    setCategories(current => {
      const ordered = [...current].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "pt-BR"));
      const index = ordered.findIndex(category => category.id === categoryId); const target = index + direction;
      if (index < 0 || target < 0 || target >= ordered.length) return current;
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      return ordered.map((category, sort_order) => ({ ...category, sort_order }));
    });
  }

  function cancelCategoryReorder() {
    const positions = new Map(categoryOrderSnapshot.map((id, index) => [id, index]));
    setCategories(current => current.map(category => ({ ...category, sort_order: positions.get(category.id) ?? category.sort_order })));
    setCategoryReorderMode(false); setMessage("Reordenação das categorias cancelada.");
  }

  async function saveCategoryOrder() {
    setLoading(true); setMessage("Salvando a ordem das categorias...");
    const results = await Promise.all(orderedCategories.map((category, sort_order) => supabase.from("categories").update({ sort_order }).eq("id", category.id).eq("establishment_id", establishmentId)));
    const error = results.find(result => result.error)?.error;
    setMessage(error ? `Não foi possível salvar toda a ordem: ${error.message}` : "Ordem das categorias salva com sucesso.");
    setCategoryReorderMode(false); setLoading(false);
  }

  async function removeCategory(category: Category) {
    const productCount = products.filter(product => product.category_id === category.id).length;
    if (productCount) return setMessage(`Antes de excluir ${category.name}, exclua ou mova os ${productCount} produto(s) desta categoria.`);
    if (!window.confirm(`Excluir a categoria ${category.name}? Essa ação não poderá ser desfeita.`)) return;
    setLoading(true); setMessage("Excluindo categoria...");
    const { error } = await supabase.from("categories").delete().eq("id", category.id).eq("establishment_id", establishmentId);
    if (error) { setLoading(false); return setMessage(`Não foi possível excluir a categoria: ${error.message}`); }
    const remaining = categories.filter(item => item.id !== category.id);
    setCategories(remaining); if (selectedCategory === category.id) setSelectedCategory(remaining[0]?.id ?? "");
    setMessage("Categoria excluída com sucesso."); setLoading(false);
  }

  async function removeProduct(product: Product) {
    if (!window.confirm(`Excluir o produto ${product.name}? Ele será retirado do cardápio e essa ação não poderá ser desfeita.`)) return;
    setLoading(true); setMessage("Excluindo produto...");
    const { error } = await supabase.from("products").delete().eq("id", product.id).eq("establishment_id", establishmentId);
    if (error) { setLoading(false); return setMessage(`Não foi possível excluir o produto: ${error.message}`); }
    const imageIsShared = products.some(item => item.id !== product.id && item.image_url && item.image_url === product.image_url);
    const storageMarker = "/storage/v1/object/public/product-images/";
    const markerIndex = product.image_url?.indexOf(storageMarker) ?? -1;
    if (!imageIsShared && markerIndex >= 0 && product.image_url) {
      const imagePath = decodeURIComponent(product.image_url.slice(markerIndex + storageMarker.length));
      await supabase.storage.from("product-images").remove([imagePath]);
    }
    setProducts(current => current.filter(item => item.id !== product.id));
    if (editing?.id === product.id) { setEditing(null); setAddonDrafts([emptyAddon()]); choosePhoto(); }
    setMessage("Produto excluído com sucesso."); setLoading(false);
  }

  function startEdit(product: Product) {
    setEditing(product); setSelectedCategory(product.category_id || categories[0]?.id || ""); choosePhoto();
    setFormActive(product.active); setFormFeatured(Boolean(product.featured)); setFormOpen(true);
    setAddonDrafts(product.addon_options?.length ? product.addon_options.map(addon => ({ id: crypto.randomUUID(), name: addon.name, price: (addon.price_cents / 100).toFixed(2).replace(".", ",") })) : [emptyAddon()]);
  }

  function startNewProduct() {
    setEditing(null); setAddonDrafts([emptyAddon()]); setFormActive(true); setFormFeatured(false); choosePhoto(); setFormOpen(true);
  }

  function beginReorder() {
    setSearch(""); setCategoryFilter("all"); setStatusFilter("all");
    setOrderSnapshot(orderedProducts.map(product => product.id)); setReorderMode(true); setMessage("Use as setas para organizar os produtos e depois salve a ordem.");
  }

  function moveProduct(productId: string, direction: -1 | 1) {
    setProducts(current => {
      const ordered = [...current].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, "pt-BR"));
      const index = ordered.findIndex(product => product.id === productId); const target = index + direction;
      if (index < 0 || target < 0 || target >= ordered.length) return current;
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      return ordered.map((product, sort_order) => ({ ...product, sort_order }));
    });
  }

  function cancelReorder() {
    const positions = new Map(orderSnapshot.map((id, index) => [id, index]));
    setProducts(current => current.map(product => ({ ...product, sort_order: positions.get(product.id) ?? product.sort_order })));
    setReorderMode(false); setMessage("Reordenação cancelada.");
  }

  async function saveOrder() {
    setLoading(true); setMessage("Salvando a ordem...");
    const results = await Promise.all(orderedProducts.map((product, sort_order) => supabase.from("products").update({ sort_order }).eq("id", product.id).eq("establishment_id", establishmentId)));
    const error = results.find(result => result.error)?.error;
    setMessage(error ? `Não foi possível salvar toda a ordem: ${error.message}` : "Ordem dos produtos salva com sucesso.");
    setReorderMode(false); setLoading(false);
  }

  function updateAddon(id: string, field: "name" | "price", value: string) {
    setAddonDrafts(current => current.map(addon => addon.id === id ? { ...addon, [field]: value } : addon));
  }

  function categoryName(product: Product) {
    return categories.find(category => category.id === product.category_id)?.name ?? "Sem categoria";
  }

  function renderProductCard(product: Product, index: number, listLength: number) {
    return <article className={`admin-product-card ${product.active ? "" : "inactive"}`} key={product.id}>
      <div className="admin-product-image">{product.image_url ? <img src={product.image_url} alt={`Foto de ${product.name}`} /> : <span>SEM FOTO</span>}<div className="admin-product-badges">{product.featured && <AdminBadge tone="accent">Destaque</AdminBadge>}{(salesCounts[product.id] ?? 0) > 0 && <AdminBadge tone="warning">{salesCounts[product.id]} vendidos</AdminBadge>}</div></div>
      <div className="admin-product-info"><small>{categoryName(product)}</small><h3>{product.name}</h3><p>{product.description || "Sem descrição comercial."}</p><div className="admin-product-price">{product.compare_at_price_cents && product.compare_at_price_cents > product.price_cents ? <del>{money(product.compare_at_price_cents)}</del> : null}<strong>{money(product.price_cents)}</strong></div></div>
      <div className="admin-product-status"><span><AdminSwitch checked={product.active} disabled={loading} label={`${product.active ? "Desativar" : "Ativar"} ${product.name}`} onCheckedChange={() => void toggleProduct(product)} /><b>{product.active ? "Ativo" : "Inativo"}</b></span>{product.addon_options?.length ? <small>{product.addon_options.length} adicionais</small> : <small>Sem adicionais</small>}</div>
      {reorderMode ? <div className="admin-product-reorder"><button type="button" disabled={index === 0} aria-label={`Mover ${product.name} para cima`} onClick={() => moveProduct(product.id, -1)}>↑</button><b>Posição {index + 1}</b><button type="button" disabled={index === listLength - 1} aria-label={`Mover ${product.name} para baixo`} onClick={() => moveProduct(product.id, 1)}>↓</button></div> : <div className="admin-product-card-actions"><button type="button" onClick={() => startEdit(product)}>Editar</button><button type="button" disabled={loading} onClick={() => void duplicateProduct(product)}>Duplicar</button><button type="button" onClick={() => setViewing(product)}>Visualizar</button><button type="button" className="danger-action" disabled={loading} onClick={() => void removeProduct(product)}>Excluir</button></div>}
    </article>;
  }

  return <div className="catalog-admin-stack">
    <section className="catalog-products-admin" aria-labelledby="products-title">
      <header className="catalog-products-head">
        <div><small>GESTÃO DO CARDÁPIO</small><h2 id="products-title">Produtos</h2><p>Organize fotos, preços, disponibilidade e destaques sem alterar seus pedidos existentes.</p></div>
        <div className="catalog-products-actions">{reorderMode ? <><button type="button" className="button outline" onClick={cancelReorder}>Cancelar</button><button type="button" className="button dark" disabled={loading} onClick={() => void saveOrder()}>Salvar ordem</button></> : <><button type="button" className="button outline" onClick={beginReorder}>↕ Reordenar</button><button type="button" className="button dark" onClick={startNewProduct}>＋ Novo produto</button></>}</div>
      </header>
      <div className="catalog-product-toolbar">
        <label className="catalog-search"><span aria-hidden="true">⌕</span><input value={search} onChange={event => setSearch(event.target.value)} disabled={reorderMode} placeholder="Buscar produtos..." aria-label="Buscar produtos" /></label>
        <select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)} disabled={reorderMode} aria-label="Filtrar por categoria"><option value="all">Todas as categorias</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
        <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as StatusFilter)} disabled={reorderMode} aria-label="Filtrar por status"><option value="all">Todos</option><option value="active">Ativos</option><option value="inactive">Inativos</option><option value="featured">Destaques</option><option value="bestsellers">Mais vendidos</option></select>
        <span className="catalog-results-count">{visibleProducts.length} de {products.length}</span>
      </div>
      {message && <div className={`form-message catalog-global-message ${/salv|criad|atualiz|sucesso|duplicado|ativo|pausado/i.test(message) ? "form-success" : ""}`}>{message}</div>}
      {visibleProducts.length ? reorderMode ? <div className="admin-product-grid">{visibleProducts.map((product, index) => renderProductCard(product, index, visibleProducts.length))}</div> : <div className="admin-product-groups">{productGroups.map(group => {
        const activeCount = group.products.filter(product => product.active).length;
        return <section className="admin-product-group" key={group.id} aria-labelledby={`product-group-${group.id}`}>
          <header className="admin-product-group-head"><div><small>CATEGORIA</small><h3 id={`product-group-${group.id}`}>{group.name}</h3></div><div><strong>{group.products.length}</strong><span>{group.products.length === 1 ? "produto" : "produtos"}</span><small>{activeCount} ativos · {group.products.length - activeCount} inativos</small></div></header>
          <div className="admin-product-grid">{group.products.map((product, index) => renderProductCard(product, index, group.products.length))}</div>
        </section>;
      })}</div> : <AdminEmptyState title="Nenhum produto encontrado" description={products.length ? "Ajuste a busca ou os filtros para encontrar seus produtos." : "Cadastre o primeiro produto do estabelecimento para começar o cardápio."} action={<button type="button" className="button dark" onClick={startNewProduct}>Cadastrar produto</button>} />}
    </section>

    <section className="admin-category-manager" id="categorias" aria-labelledby="categories-title">
      <header className="admin-category-head"><div><small>ORGANIZAÇÃO DO CARDÁPIO</small><h2 id="categories-title">Categorias</h2><p>Organize a ordem de exibição e escolha quais grupos aparecem para seus clientes.</p></div><div>{categoryReorderMode ? <><button type="button" className="button outline" onClick={cancelCategoryReorder}>Cancelar</button><button type="button" className="button dark" disabled={loading} onClick={() => void saveCategoryOrder()}>Salvar ordem</button></> : <><button type="button" className="button outline" disabled={!categories.length} onClick={beginCategoryReorder}>↕ Reordenar</button><button type="button" className="button dark" onClick={openNewCategory}>＋ Nova categoria</button></>}</div></header>
      <div className="admin-category-toolbar"><label><span aria-hidden="true">⌕</span><input value={categorySearch} disabled={categoryReorderMode} onChange={event => setCategorySearch(event.target.value)} placeholder="Buscar categorias..." aria-label="Buscar categorias" /></label><span>{visibleCategories.length} de {categories.length} categorias</span></div>
      {visibleCategories.length ? <div className="admin-table-wrap admin-category-table-wrap"><table className="admin-table admin-category-table"><thead><tr><th>Nome</th><th>Produtos</th><th>Status</th><th>Ordem</th><th>Ações</th></tr></thead><tbody>{visibleCategories.map((category, index) => { const productCount = products.filter(product => product.category_id === category.id).length; const orderPosition = orderedCategories.findIndex(item => item.id === category.id) + 1; return <tr key={category.id} className={category.active ? "" : "inactive"}><td><div className="admin-category-name"><span>{String(orderPosition).padStart(2, "0")}</span><div><b>{category.name}</b><small>{category.description || "Sem descrição"}</small></div></div></td><td><b>{productCount}</b><small>{productCount === 1 ? " produto" : " produtos"}</small></td><td><div className="admin-category-status"><AdminSwitch checked={category.active} disabled={loading || categoryReorderMode} label={`${category.active ? "Desativar" : "Ativar"} categoria ${category.name}`} onCheckedChange={() => void toggleCategory(category)} /><AdminBadge tone={category.active ? "success" : "neutral"}>{category.active ? "Ativa" : "Inativa"}</AdminBadge></div></td><td>{categoryReorderMode ? <div className="admin-category-reorder"><button type="button" disabled={index === 0} onClick={() => moveCategory(category.id, -1)} aria-label={`Mover ${category.name} para cima`}>↑</button><b>{String(orderPosition).padStart(2, "0")}</b><button type="button" disabled={index === visibleCategories.length - 1} onClick={() => moveCategory(category.id, 1)} aria-label={`Mover ${category.name} para baixo`}>↓</button></div> : <b>{String(orderPosition).padStart(2, "0")}</b>}</td><td><div className="admin-category-actions"><button type="button" disabled={categoryReorderMode} onClick={() => openCategoryEdit(category)}>Editar</button><button type="button" disabled={loading || categoryReorderMode} onClick={() => void duplicateCategory(category)}>Duplicar</button><button type="button" className="danger-action" disabled={loading || categoryReorderMode} onClick={() => void removeCategory(category)}>Excluir</button></div></td></tr>; })}</tbody></table></div> : <AdminEmptyState title="Nenhuma categoria encontrada" description={categories.length ? "Ajuste a busca para encontrar uma categoria." : "Crie a primeira categoria para organizar os produtos do seu cardápio."} action={<button type="button" className="button dark" onClick={openNewCategory}>Criar categoria</button>} />}
    </section>
    <AdminModal open={categoryFormOpen} title={editingCategory ? `Editar ${editingCategory.name}` : "Nova categoria"} eyebrow="Organização do cardápio" onClose={() => { if (!loading) { setCategoryFormOpen(false); setEditingCategory(null); } }} footer={<><button type="button" className="button outline" disabled={loading} onClick={() => { setCategoryFormOpen(false); setEditingCategory(null); }}>Cancelar</button><button type="submit" form="category-editor-form" className="button dark" disabled={loading}>{loading ? "Salvando..." : editingCategory ? "Salvar categoria" : "Criar categoria"}</button></>}>
      <form id="category-editor-form" className="category-editor-form" onSubmit={saveCategory} key={editingCategory?.id || "new-category"}>
        <AdminField label="Nome" required hint="Use um nome curto, como Hambúrgueres, Bebidas ou Sobremesas."><AdminInput name="category_name" required maxLength={80} defaultValue={editingCategory?.name || ""} placeholder="Nome da categoria" autoFocus /></AdminField>
        <AdminField label="Descrição" hint="A descrição pode aparecer no cardápio público e ajuda o cliente a entender a seção."><AdminTextarea name="category_description" maxLength={300} defaultValue={editingCategory?.description || ""} placeholder="Descrição opcional" /></AdminField>
        <div className="category-editor-status"><div><b>Categoria ativa</b><small>Quando desativada, deixa de aparecer no cardápio público. Os produtos continuam salvos.</small></div><AdminSwitch checked={categoryFormActive} onCheckedChange={setCategoryFormActive} label="Alterar disponibilidade da categoria" /></div>
        {editingCategory && <div className="category-editor-summary"><span>{products.filter(product => product.category_id === editingCategory.id).length}</span><div><b>Produtos vinculados</b><small>Editar ou desativar a categoria não exclui nenhum desses produtos.</small></div></div>}
        {message && <div className={`form-message ${/salv|criad|atualiz|sucesso/i.test(message) ? "form-success" : ""}`}>{message}</div>}
      </form>
    </AdminModal>

    <AdminModal open={formOpen} title={editing ? `Editar ${editing.name}` : "Novo produto"} eyebrow="Cadastro de produto" onClose={() => { if (!loading) { setFormOpen(false); setEditing(null); setAddonDrafts([emptyAddon()]); choosePhoto(); } }} footer={<><button type="button" className="button outline" disabled={loading} onClick={() => { setFormOpen(false); setEditing(null); setAddonDrafts([emptyAddon()]); choosePhoto(); }}>Cancelar</button><button type="submit" form="product-editor-form" className="button dark" disabled={loading}>{loading ? "Salvando..." : editing ? "Salvar produto" : "Criar produto"}</button></>}>
      <form id="product-editor-form" className="product-editor-form" onSubmit={saveProduct} key={editing?.id || "new"}>
        <section className="product-editor-section product-editor-photo-section"><div><small>IMAGEM DO PRODUTO</small><h3>Foto principal</h3><p>Uma imagem clara e bem enquadrada ajuda o produto a vender mais.</p></div><label className="product-photo-upload"><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={event => choosePhoto(event.target.files?.[0])} />{preview ? <img src={preview} alt="Nova foto do produto" /> : editing?.image_url ? <img src={editing.image_url} alt="Foto atual do produto" /> : <span aria-hidden="true">＋</span>}<b>{photo ? photo.name : editing?.image_url ? "Trocar imagem" : "Escolher imagem"}</b><small>JPG, PNG, WebP ou HEIC · máximo 8 MB</small></label></section>

        <section className="product-editor-section"><div className="product-editor-section-title"><small>INFORMAÇÕES PRINCIPAIS</small><h3>Apresentação no cardápio</h3></div><div className="product-editor-grid">
          <div className="field field-wide"><label>NOME</label><input name="name" required maxLength={120} defaultValue={editing?.name} placeholder="Ex.: Brasa Bacon" /></div>
          <div className="field field-wide"><label>DESCRIÇÃO COMERCIAL</label><textarea name="description" maxLength={600} defaultValue={editing?.description || ""} placeholder="Descreva o produto de forma clara e atrativa." /></div>
          <div className="field"><label>CATEGORIA</label><select name="category_id" required value={selectedCategory} onChange={event => setSelectedCategory(event.target.value)}><option value="" disabled>Selecione</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
          <div className="field"><label>CÓDIGO INTERNO / CÓDIGO DE BARRAS</label><input name="barcode" defaultValue={editing?.barcode || ""} placeholder="Opcional" /><small>Também pode ser usado pelo leitor do caixa.</small></div>
        </div></section>

        <section className="product-editor-section"><div className="product-editor-section-title"><small>PREÇO E DESTAQUE</small><h3>Como o produto será oferecido</h3></div><div className="product-editor-grid">
          <div className="field"><label>PREÇO NORMAL</label><input name="price" inputMode="decimal" required placeholder="29,90" defaultValue={editing ? ((editing.compare_at_price_cents ?? editing.price_cents) / 100).toFixed(2).replace(".", ",") : ""} /></div>
          <div className="field"><label>PREÇO PROMOCIONAL</label><input name="promotional_price" inputMode="decimal" placeholder="Opcional" defaultValue={editing?.compare_at_price_cents ? (editing.price_cents / 100).toFixed(2).replace(".", ",") : ""} /><small>Quando preenchido, deve ser menor que o preço normal.</small></div>
          <div className="product-editor-toggle"><div><b>Produto ativo</b><small>Aparece normalmente no cardápio público.</small></div><AdminSwitch checked={formActive} onCheckedChange={setFormActive} label="Alterar disponibilidade do produto" /></div>
          <div className="product-editor-toggle"><div><b>Marcar como destaque</b><small>Recebe destaque visual no cardápio.</small></div><AdminSwitch checked={formFeatured} onCheckedChange={setFormFeatured} label="Alterar destaque do produto" /></div>
          <div className="product-preparation-note field-wide"><span>{defaultPreparationMinutes} min</span><div><b>Tempo estimado do estabelecimento</b><small>Usa o tempo padrão definido em Configurações, evitando informações diferentes para o cliente.</small></div></div>
        </div></section>

        <section className="product-editor-section"><div className="product-editor-section-title"><small>PERSONALIZAÇÃO</small><h3>Ingredientes e adicionais</h3></div><div className="field"><label>INGREDIENTES QUE O CLIENTE PODE RETIRAR</label><textarea name="ingredients" placeholder="Pão, cebola, tomate, molho" defaultValue={editing?.ingredients?.join(", ") || ""} /><small>Separe por vírgulas. O cliente poderá retirar cada ingrediente com um clique.</small></div><div className="field addon-admin-field"><label>ADICIONAIS DISPONÍVEIS</label><small>Cadastre cada opção e o valor que será somado automaticamente ao pedido.</small><div className="addon-admin-list">{addonDrafts.map((addon, index) => <div className="addon-admin-row" key={addon.id}><input aria-label={`Nome do adicional ${index + 1}`} value={addon.name} onChange={event => updateAddon(addon.id, "name", event.target.value)} placeholder="Ex.: Bacon extra" /><input aria-label={`Preço do adicional ${index + 1}`} value={addon.price} onChange={event => updateAddon(addon.id, "price", event.target.value)} inputMode="decimal" placeholder="R$ 5,00" /><button type="button" className="danger-action" aria-label={`Excluir adicional ${index + 1}`} onClick={() => setAddonDrafts(current => current.length === 1 ? [emptyAddon()] : current.filter(item => item.id !== addon.id))}>Excluir</button></div>)}</div><button type="button" className="add-addon-admin" onClick={() => setAddonDrafts(current => [...current, emptyAddon()])}>＋ Adicionar outra opção</button></div></section>

        {message && <div className={`form-message ${/salv|criad|atualiz|sucesso/i.test(message) ? "form-success" : ""}`}>{message}</div>}
      </form>
    </AdminModal>

    <AdminModal open={Boolean(viewing)} title={viewing?.name ?? "Produto"} eyebrow="Prévia do produto" onClose={() => setViewing(null)} footer={<button type="button" className="button dark" onClick={() => { if (viewing) startEdit(viewing); setViewing(null); }}>Editar produto</button>}>
      {viewing && <div className="admin-product-preview">{viewing.image_url ? <img src={viewing.image_url} alt={`Foto de ${viewing.name}`} /> : <div className="empty">Produto sem foto.</div>}<div><AdminBadge tone={viewing.active ? "success" : "danger"}>{viewing.active ? "Ativo" : "Inativo"}</AdminBadge><small>{categoryName(viewing)}</small><p>{viewing.description || "Sem descrição comercial."}</p><strong>{money(viewing.price_cents)}</strong>{viewing.ingredients?.length ? <p><b>Ingredientes:</b> {viewing.ingredients.join(", ")}</p> : null}</div></div>}
    </AdminModal>
  </div>;
}

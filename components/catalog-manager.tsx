"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Category = { id: string; name: string; description?: string | null; active: boolean; sort_order: number };
type Addon = { name: string; price_cents: number };
type Product = { id: string; category_id?: string | null; name: string; description?: string | null; price_cents: number; active: boolean; image_url?: string | null; ingredients?: string[]; addon_options?: Addon[] };

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const parseLines = (value: string) => value.split(/\n|,/).map(item => item.trim()).filter(Boolean);
const parseAddons = (value: string): Addon[] => value.split("\n").map(line => {
  const [name, rawPrice = "0"] = line.split("|");
  return { name: name.trim(), price_cents: Math.round(Number(rawPrice.trim().replace(",", ".")) * 100) };
}).filter(item => item.name && Number.isFinite(item.price_cents) && item.price_cents >= 0);

export function CatalogManager({ establishmentId, initialCategories, initialProducts }: { establishmentId: string; initialCategories: Category[]; initialProducts: Product[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState(initialCategories);
  const [products, setProducts] = useState(initialProducts);
  const [selectedCategory, setSelectedCategory] = useState(initialCategories[0]?.id ?? "");
  const [editing, setEditing] = useState<Product | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function choosePhoto(file?: File) {
    if (preview) URL.revokeObjectURL(preview);
    setMessage("");
    if (!file) { setPhoto(null); setPreview(""); return; }
    if (!file.type.startsWith("image/")) return setMessage("Escolha um arquivo de imagem.");
    if (file.size > 8 * 1024 * 1024) return setMessage("A foto deve ter no máximo 8 MB.");
    setPhoto(file); setPreview(URL.createObjectURL(file));
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const data = new FormData(form);
    const name = String(data.get("category_name") || "").trim();
    if (!name) return;
    const { data: category, error } = await supabase.from("categories").insert({ establishment_id: establishmentId, name, description: String(data.get("category_description") || ""), sort_order: categories.length }).select("id,name,description,active,sort_order").single();
    if (error) return setMessage(error.message);
    setCategories(current => [...current, category]); setSelectedCategory(category.id); form.reset(); setMessage("Categoria criada.");
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const data = new FormData(form);
    const price = Number(String(data.get("price")).replace(",", "."));
    if (!Number.isFinite(price) || price < 0) return setMessage("Informe um preço válido.");
    setLoading(true); setMessage(photo ? "Enviando a foto..." : "Salvando o produto...");
    let imageUrl: string | null | undefined = editing?.image_url ?? null; let uploadedPath: string | null = null;
    if (photo) {
      const extension = photo.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      uploadedPath = `${establishmentId}/products/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from("product-images").upload(uploadedPath, photo, { cacheControl: "3600", contentType: photo.type, upsert: false });
      if (error) { setLoading(false); return setMessage(`Não foi possível enviar a foto: ${error.message}`); }
      imageUrl = supabase.storage.from("product-images").getPublicUrl(uploadedPath).data.publicUrl;
    }
    const values = { establishment_id: establishmentId, category_id: String(data.get("category_id")), name: String(data.get("name")).trim(), description: String(data.get("description") || ""), price_cents: Math.round(price * 100), image_url: imageUrl, ingredients: parseLines(String(data.get("ingredients") || "")), addon_options: parseAddons(String(data.get("addons") || "")) };
    const query = editing ? supabase.from("products").update(values).eq("id", editing.id) : supabase.from("products").insert(values);
    const { data: product, error } = await query.select("id,category_id,name,description,price_cents,active,image_url,ingredients,addon_options").single();
    if (error) { if (uploadedPath) await supabase.storage.from("product-images").remove([uploadedPath]); setLoading(false); return setMessage(error.message); }
    setProducts(current => editing ? current.map(item => item.id === product.id ? product : item) : [product, ...current]);
    setMessage(editing ? "Produto atualizado." : "Produto e foto salvos com sucesso.");
    setEditing(null); form.reset(); choosePhoto(); setLoading(false);
  }

  async function toggleProduct(product: Product) {
    const { error } = await supabase.from("products").update({ active: !product.active }).eq("id", product.id);
    if (error) return setMessage(error.message);
    setProducts(current => current.map(item => item.id === product.id ? { ...item, active: !item.active } : item));
  }

  function startEdit(product: Product) { setEditing(product); setSelectedCategory(product.category_id || categories[0]?.id || ""); choosePhoto(); document.getElementById("product-form")?.scrollIntoView({ behavior: "smooth" }); }

  return <div className="catalog-admin-stack">
    <section className="panel category-admin"><div><small>ORGANIZAÇÃO DO CARDÁPIO</small><h2>Categorias personalizáveis</h2><p>Use categorias como Lanches, Pratos, Cervejas ou Refrigerantes. Você decide o que combina com seu restaurante, bar ou lanchonete.</p></div><form className="category-form" onSubmit={addCategory}><input name="category_name" required placeholder="Nome da nova categoria" /><input name="category_description" placeholder="Descrição (opcional)" /><button className="button dark">Criar categoria</button></form></section>
    <nav className="category-tabs" aria-label="Categorias">{categories.map(category => <button key={category.id} className={selectedCategory === category.id ? "active" : ""} onClick={() => setSelectedCategory(category.id)}>{category.name}<small>{products.filter(product => product.category_id === category.id).length}</small></button>)}</nav>
    <div className="panel-grid catalog-grid">
      <article className="panel"><h2>{categories.find(category => category.id === selectedCategory)?.name || "Produtos"}</h2>{products.filter(product => !selectedCategory || product.category_id === selectedCategory).length ? <div className="catalog-product-list">{products.filter(product => !selectedCategory || product.category_id === selectedCategory).map(product => <article className="catalog-product" key={product.id}>{product.image_url ? <img className="product-thumb" src={product.image_url} alt="" /> : <span className="product-thumb empty-thumb">Foto</span>}<div><h3>{product.name}</h3><p>{product.description || "Sem descrição"}</p><strong>{money(product.price_cents)}</strong>{product.addon_options?.length ? <small>{product.addon_options.length} adicionais configurados</small> : null}</div><div className="catalog-row-actions"><button onClick={() => startEdit(product)}>Editar</button><button onClick={() => toggleProduct(product)}>{product.active ? "Pausar" : "Ativar"}</button></div></article>)}</div> : <div className="empty">Nenhum produto nesta categoria.</div>}</article>
      <article className="panel" id="product-form"><h2>{editing ? `Editar ${editing.name}` : "Novo produto"}</h2><form className="form" onSubmit={saveProduct} key={editing?.id || "new"}>
        <div className="field"><label>CATEGORIA</label><select name="category_id" required value={selectedCategory} onChange={event => setSelectedCategory(event.target.value)}>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
        <div className="field"><label>NOME</label><input name="name" required defaultValue={editing?.name} /></div>
        <div className="field"><label>DESCRIÇÃO</label><textarea name="description" defaultValue={editing?.description || ""} /></div>
        <div className="field"><label>PREÇO</label><input name="price" inputMode="decimal" required placeholder="29,90" defaultValue={editing ? (editing.price_cents / 100).toFixed(2).replace(".", ",") : ""} /></div>
        <div className="field"><label>INGREDIENTES QUE O CLIENTE PODE RETIRAR</label><textarea name="ingredients" placeholder="Pão, cebola, tomate, molho" defaultValue={editing?.ingredients?.join(", ") || ""} /><small>Separe por vírgulas. O cliente poderá marcar “sem cebola”, por exemplo.</small></div>
        <div className="field"><label>ADICIONAIS</label><textarea name="addons" placeholder={"Queijo extra | 3,00\nBacon | 5,00"} defaultValue={editing?.addon_options?.map(addon => `${addon.name} | ${(addon.price_cents / 100).toFixed(2).replace(".", ",")}`).join("\n") || ""} /><small>Um por linha: nome | preço.</small></div>
        <div className="field"><label>FOTO DO PRODUTO OU BEBIDA</label><label className="photo-picker"><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={event => choosePhoto(event.target.files?.[0])} />{preview ? <img src={preview} alt="Prévia" /> : editing?.image_url ? <img src={editing.image_url} alt="Foto atual" /> : <span className="photo-picker-icon">＋</span>}<span><b>{photo ? photo.name : "Escolher foto da galeria"}</b><small>Abre a galeria do celular ou os arquivos do computador. Máximo 8 MB.</small></span></label></div>
        {message && <div className={`form-message ${/salv|criada|atualizado|sucesso/i.test(message) ? "form-success" : ""}`}>{message}</div>}
        <div className="form-actions">{editing && <button type="button" className="button outline" onClick={() => { setEditing(null); choosePhoto(); }}>Cancelar edição</button>}<button className="button dark" disabled={loading}>{loading ? "Salvando..." : editing ? "Salvar alterações" : "Adicionar produto"}</button></div>
      </form></article>
    </div>
  </div>;
}

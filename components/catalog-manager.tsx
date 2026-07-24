"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Product = { id: string; name: string; price_cents: number; active: boolean; image_url?: string | null };

export function CatalogManager({ establishmentId, categoryId, initialProducts }: { establishmentId: string; categoryId: string; initialProducts: Product[] }) {
  const [products, setProducts] = useState(initialProducts);
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

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const price = Number(String(data.get("price")).replace(",", "."));
    if (!Number.isFinite(price) || price < 0) return setMessage("Informe um preço válido.");
    setLoading(true); setMessage(photo ? "Enviando a foto..." : "Criando o produto...");
    const supabase = createClient();
    let imageUrl: string | null = null;
    let uploadedPath: string | null = null;
    if (photo) {
      const extension = photo.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      uploadedPath = `${establishmentId}/products/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("product-images").upload(uploadedPath, photo, {
        cacheControl: "3600", contentType: photo.type, upsert: false,
      });
      if (uploadError) { setLoading(false); return setMessage(`Não foi possível enviar a foto: ${uploadError.message}`); }
      imageUrl = supabase.storage.from("product-images").getPublicUrl(uploadedPath).data.publicUrl;
    }
    const { data: product, error } = await supabase.from("products").insert({
      establishment_id: establishmentId, category_id: categoryId, name: String(data.get("name")),
      description: String(data.get("description") || ""), price_cents: Math.round(price * 100),
      image_url: imageUrl,
    }).select("id, name, price_cents, active, image_url").single();
    if (error) {
      if (uploadedPath) await supabase.storage.from("product-images").remove([uploadedPath]);
      setLoading(false); return setMessage(error.message);
    }
    setProducts(current => [product, ...current]);
    setMessage("Produto e foto salvos com sucesso.");
    form.reset(); choosePhoto(); setLoading(false);
  }

  return <div className="panel-grid catalog-grid">
    <article className="panel"><h2>Produtos</h2>{products.length ? <table className="table"><thead><tr><th>FOTO</th><th>PRODUTO</th><th>PREÇO</th><th>STATUS</th></tr></thead><tbody>{products.map(product => <tr key={product.id}><td>{product.image_url ? <img className="product-thumb" src={product.image_url} alt="" /> : <span className="product-thumb empty-thumb">—</span>}</td><td>{product.name}</td><td>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(product.price_cents / 100)}</td><td>{product.active ? "Ativo" : "Pausado"}</td></tr>)}</tbody></table> : <div className="empty">Nenhum produto cadastrado.</div>}</article>
    <article className="panel"><h2>Novo produto</h2><form className="form" onSubmit={addProduct}>
      <div className="field"><label>NOME</label><input name="name" required /></div>
      <div className="field"><label>DESCRIÇÃO</label><textarea name="description" /></div>
      <div className="field"><label>PREÇO</label><input name="price" inputMode="decimal" required placeholder="29,90" /></div>
      <div className="field"><label>FOTO DO PRODUTO</label>
        <label className="photo-picker">
          <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={event => choosePhoto(event.target.files?.[0])} />
          {preview ? <img src={preview} alt="Prévia da foto selecionada" /> : <span className="photo-picker-icon">＋</span>}
          <span><b>{photo ? photo.name : "Escolher foto da galeria"}</b><small>Toque para abrir as fotos do celular ou os arquivos do computador. Máximo 8 MB.</small></span>
        </label>
      </div>
      {message && <div className={`form-message ${message.includes("sucesso") ? "form-success" : ""}`}>{message}</div>}
      <button className="button dark wide" disabled={loading}>{loading ? "Salvando..." : "Adicionar produto"}</button>
    </form></article>
  </div>;
}

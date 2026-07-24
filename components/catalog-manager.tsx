"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Product = { id: string; name: string; price_cents: number; active: boolean };

export function CatalogManager({ establishmentId, categoryId, initialProducts }: { establishmentId: string; categoryId: string; initialProducts: Product[] }) {
  const [products, setProducts] = useState(initialProducts);
  const [message, setMessage] = useState("");
  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const price = Number(String(data.get("price")).replace(",", "."));
    if (!Number.isFinite(price) || price < 0) return setMessage("Informe um preço válido.");
    const supabase = createClient();
    const { data: product, error } = await supabase.from("products").insert({ establishment_id: establishmentId, category_id: categoryId, name: String(data.get("name")), description: String(data.get("description") || ""), price_cents: Math.round(price * 100) }).select("id, name, price_cents, active").single();
    if (error) return setMessage(error.message);
    setProducts(current => [product, ...current]); setMessage("Produto criado com segurança."); form.reset();
  }
  return <div className="panel-grid"><article className="panel"><h2>Produtos</h2>{products.length ? <table className="table"><thead><tr><th>PRODUTO</th><th>PREÇO</th><th>STATUS</th></tr></thead><tbody>{products.map(product => <tr key={product.id}><td>{product.name}</td><td>{new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(product.price_cents / 100)}</td><td>{product.active ? "Ativo" : "Pausado"}</td></tr>)}</tbody></table> : <div className="empty">Nenhum produto cadastrado.</div>}</article><article className="panel"><h2>Novo produto</h2><form className="form" onSubmit={addProduct}><div className="field"><label>NOME</label><input name="name" required /></div><div className="field"><label>DESCRIÇÃO</label><textarea name="description" /></div><div className="field"><label>PREÇO</label><input name="price" inputMode="decimal" required placeholder="29,90" /></div>{message && <div className={`form-message ${message.includes("segurança") ? "form-success" : ""}`}>{message}</div>}<button className="button dark wide">Adicionar produto</button></form></article></div>;
}

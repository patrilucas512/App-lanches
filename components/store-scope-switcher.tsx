"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function StoreScopeSwitcher({ activeStoreId, organizationName, stores }: { activeStoreId: string; organizationName: string; stores: { id: string; name: string; unit_status: string }[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  async function changeStore(storeId: string) {
    if (storeId === "all") { router.push("/painel/unidades"); return; }
    setLoading(true);
    const response = await fetch("/api/organization/active-store", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ storeId }) });
    setLoading(false);
    if (response.ok) router.refresh();
  }
  return <div className="store-scope-bar">
    <span><small>EMPRESA</small><b>{organizationName}</b></span>
    <label><span>Unidade ativa</span><select aria-label="Selecionar unidade" value={activeStoreId} disabled={loading} onChange={event => changeStore(event.target.value)}>
      <option value="all">Todas as unidades</option>
      {stores.map(store => <option key={store.id} value={store.id}>{store.name}{store.unit_status !== "active" ? " · indisponível" : ""}</option>)}
    </select></label>
  </div>;
}

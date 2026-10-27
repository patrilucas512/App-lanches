"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function StoreStatusControl({ establishmentId, initialOpen }: { establishmentId: string; initialOpen: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(initialOpen);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function toggle() {
    const next = !open;
    if (!window.confirm(next ? "Abrir a loja e liberar novos pedidos?" : "Fechar a loja e bloquear novos pedidos?")) return;
    setBusy(true); setMessage("");
    const { data, error } = await supabase.rpc("set_store_open", { requested_establishment_id: establishmentId, requested_open: next });
    if (error) setMessage(error.message);
    else { setOpen(Boolean(data?.store_open ?? next)); setMessage(next ? "Loja aberta para novos pedidos." : "Loja fechada para novos pedidos."); }
    setBusy(false);
  }

  return <div className="store-status-control"><span className={`store-status-badge ${open ? "open" : "closed"}`}>● {open ? "Loja aberta" : "Loja fechada"}</span><button type="button" className={`button ${open ? "outline" : "dark"}`} disabled={busy} onClick={() => void toggle()}>{busy ? "Salvando..." : open ? "Fechar loja" : "Abrir loja"}</button>{message && <small>{message}</small>}</div>;
}

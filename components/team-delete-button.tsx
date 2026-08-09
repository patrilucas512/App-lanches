"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function TeamDeleteButton({ id, name, kind }: { id: string; name: string; kind: "waiter" | "kitchen" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (!window.confirm(`Excluir o cadastro de ${name}? O acesso será removido imediatamente.`)) return;
    setBusy(true); setError("");
    const supabase = createClient();
    const result = kind === "waiter"
      ? await supabase.rpc("delete_waiter", { requested_waiter_id: id })
      : await supabase.rpc("delete_kitchen_operator", { requested_operator_id: id });
    if (result.error) { setError(result.error.message); setBusy(false); return; }
    router.refresh();
  }

  return <div className="team-delete-wrap">
    <button type="button" className="team-delete-button" disabled={busy} onClick={() => void remove()}>{busy ? "Excluindo..." : "Excluir"}</button>
    {error && <small className="team-delete-error">{error}</small>}
  </div>;
}

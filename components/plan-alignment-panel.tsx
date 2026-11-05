"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Fase 99C: alinhar a loja ao plano (superadmin). Mostra a prévia antes; módulos usados nos últimos 30 dias só
// saem se forem marcados um a um; aplicar pede o slug da loja digitado.
type Item = { flag: string; used_30d: boolean | null; action: "remove" | "keep_used" };
type Preview = { slug: string; plan: string | null; has_row: boolean; items: Item[]; removes: number; kept_used: number; stays_by_plan?: number; note?: string };

const label = (flag: string) => flag.replace(/_enabled$/, "").replaceAll("_", " ");

export function PlanAlignmentPanel({ storeId }: { storeId: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmUsed, setConfirmUsed] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true); setMessage("");
    const { data, error } = await createClient().rpc("preview_store_plan_alignment", { requested_store_id: storeId });
    setBusy(false);
    if (error) return setMessage(error.message);
    setPreview(data as Preview); setConfirmUsed([]); setConfirmation("");
  }

  async function apply() {
    if (!preview) return;
    setBusy(true); setMessage("");
    const { data, error } = await createClient().rpc("align_store_to_plan", { requested_store_id: storeId, requested_confirmation: confirmation, requested_confirm_used: confirmUsed });
    setBusy(false);
    if (error) return setMessage(error.message === "CONFIRMATION_MISMATCH" ? "Digite o slug da loja exatamente como aparece." : error.message);
    const result = data as { turned_off: string[]; kept_used: string[] };
    setMessage(`${result.turned_off.length} módulo(s) desligado(s); ${result.kept_used.length} mantido(s) por uso recente.`);
    await load();
  }

  const used = preview?.items.filter((i) => i.action === "keep_used") ?? [];
  const removes = preview?.items.filter((i) => i.action === "remove") ?? [];
  return <article className="sa-panel plan-alignment">
    <h2>Alinhar a loja ao plano</h2>
    <p>Desliga na loja os módulos que o plano não inclui. Antes de aplicar, confira a prévia.</p>
    <button type="button" className="sa-link-button" onClick={load} disabled={busy}>{preview ? "Atualizar prévia" : "Ver prévia"}</button>
    {preview && <div>
      <p><b>Plano:</b> {preview.plan ?? "sem plano"} · ficam pelo plano: {preview.stays_by_plan ?? 0} · somem: {preview.removes} · usados nos últimos 30 dias: {preview.kept_used}</p>
      {preview.note && <p>{preview.note}</p>}
      {used.length > 0 && <fieldset>
        <legend>Usados nos últimos 30 dias (ficam, a menos que você marque)</legend>
        {used.map((i) => <label key={i.flag} style={{ display: "block" }}>
          <input type="checkbox" checked={confirmUsed.includes(i.flag)} onChange={(e) => setConfirmUsed((c) => e.target.checked ? [...c, i.flag] : c.filter((x) => x !== i.flag))} /> desligar mesmo assim: {label(i.flag)}
        </label>)}
      </fieldset>}
      {removes.length > 0 && <details><summary>{removes.length} módulo(s) que somem</summary><p>{removes.map((i) => label(i.flag)).join(", ")}</p></details>}
      {(removes.length > 0 || confirmUsed.length > 0) && <p>
        <label>Digite <b>{preview.slug}</b> para confirmar <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} aria-label="Slug da loja para confirmar" /></label>{" "}
        <button type="button" className="sa-link-button" onClick={apply} disabled={busy || confirmation !== preview.slug}>Alinhar ao plano</button>
      </p>}
    </div>}
    {message && <p role="status">{message}</p>}
  </article>;
}

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireSuperadmin() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login?next=/superadmin/dashboard");
  const { data: profile } = await supabase.from("profiles").select("id, full_name, is_superadmin").eq("id", userId).single();
  if (!profile?.is_superadmin) redirect("/painel?acesso=negado");
  return { supabase, userId, profile };
}

export function money(cents: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((cents ?? 0) / 100);
}

export function date(value: string | null | undefined, withTime = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", ...(withTime ? { timeStyle: "short" } : {}) }).format(new Date(value));
}

export function statusLabel(value: string | null | undefined) {
  const labels: Record<string, string> = { active: "Ativo", trialing: "Em teste", past_due: "Inadimplente", canceled: "Cancelado", unpaid: "Não pago", incomplete: "Incompleto", blocked: "Bloqueado", inactive: "Inativo", open: "Aberto", analyzing: "Em análise", waiting_customer: "Aguardando cliente", resolved: "Resolvido", closed: "Fechado" };
  return labels[value ?? ""] ?? value ?? "—";
}

import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function CheckoutResult({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams; const admin = createAdminClient();
  const { data: session } = checkout ? await admin.from("saas_checkout_sessions").select("status,establishment_name,plans(name)").eq("id", checkout).maybeSingle() : { data: null };
  const approved = session?.status === "approved";
  return <main className="saas-result-page"><section><small>MASTERAPP</small><h1>{approved ? "Pagamento confirmado" : "Pagamento em processamento"}</h1><p>{approved ? `Recebemos a contratação do plano ${session?.plans?.[0]?.name || "selecionado"} para ${session?.establishment_name}.` : "O banco ainda está processando a cobrança. A confirmação será atualizada automaticamente pelo webhook."}</p><Link className="sa-button" href="/login">Ir para o acesso</Link></section></main>;
}

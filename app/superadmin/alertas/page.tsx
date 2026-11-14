import { Empty, Metric, PageHead } from "@/components/superadmin-ui";
import { date, requireSuperadmin } from "@/lib/superadmin";

// Fase 98F: alertas automáticos do piloto (private.evaluate_pilot_alerts, agendado no pg_cron).
const RULE_LABEL: Record<string, string> = {
  stuck_order: "Pedido parado",
  payment_failed: "Pagamento falho",
  payment_pending: "Pagamento pendente",
  worker_stale: "Rotina parada",
  printer_offline: "Impressora sem sinal",
  api_error_rate: "Taxa de erro",
};

const SEV: Record<string, string> = { critical: "Crítico", high: "Alto", warning: "Atenção", medium: "Médio", low: "Baixo", info: "Informativo" };

type Alert = { id: string; rule_key: string; severity: string; title: string; summary: string; status: string; occurrences: number;
  first_seen_at: string; last_seen_at: string; resolved_at: string | null; establishments: { name: string } | null };
type Rule = { rule_key: string; enabled: boolean; threshold: number; window_minutes: number; cooldown_minutes: number; notify_owner: boolean; description: string };

export default async function PilotAlertsPage() {
  const { supabase } = await requireSuperadmin();
  const [{ data: alerts }, { data: rules }] = await Promise.all([
    supabase.from("pilot_alerts").select("id,rule_key,severity,title,summary,status,occurrences,first_seen_at,last_seen_at,resolved_at,establishments(name)").order("last_seen_at", { ascending: false }).limit(100),
    supabase.from("pilot_alert_rules").select("*").order("rule_key"),
  ]);
  const rows = (alerts ?? []) as unknown as Alert[];
  const open = rows.filter((row) => row.status === "open");
  return <>
    <PageHead eyebrow="OPERAÇÃO DO PILOTO" title="Alertas do piloto" description="Pedidos parados, pagamentos falhos ou pendentes, rotinas paradas, impressora sem sinal e taxa de erro. Avaliados a cada 5 minutos, sem duplicar: o mesmo alerta só avisa de novo depois do intervalo da regra." />
    <section className="sa-metrics">
      <Metric label="Abertos" value={open.length} tone={open.length ? "danger" : "default"} />
      <Metric label="Críticos" value={open.filter((row) => row.severity === "critical").length} />
      <Metric label="Resolvidos (últimos 100)" value={rows.length - open.length} />
    </section>
    <article className="sa-panel">
      {rows.map((row) => <div className="sa-log" key={row.id}>
        <div>
          <b>{row.status === "open" ? "● " : "✓ "}{row.title}</b>
          <small>{RULE_LABEL[row.rule_key] ?? row.rule_key} · {SEV[row.severity] ?? row.severity} · {row.establishments?.name ?? "Plataforma"} · {row.occurrences} avaliação(ões)</small>
          <p>{row.summary}</p>
        </div>
        <time>{row.status === "open" ? `desde ${date(row.first_seen_at, true)}` : `resolvido ${date(row.resolved_at ?? row.last_seen_at, true)}`}</time>
      </div>)}
      {!rows.length && <Empty title="Nenhum alerta" text="Quando uma regra disparar, o alerta aparece aqui e na central de notificações." />}
    </article>
    <article className="sa-panel">
      <h2>Regras</h2>
      {((rules ?? []) as Rule[]).map((rule) => <div className="sa-log" key={rule.rule_key}>
        <div><b>{RULE_LABEL[rule.rule_key] ?? rule.rule_key} {rule.enabled ? "" : "(desligada)"}</b><small>limite {rule.threshold} · janela {rule.window_minutes} min · repete aviso após {rule.cooldown_minutes} min · {rule.notify_owner ? "avisa o dono" : "só superadmin"}</small><p>{rule.description}</p></div>
      </div>)}
    </article>
  </>;
}

import Link from "next/link";

export function PageHead({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: React.ReactNode }) {
  return <header className="sa-page-head"><div><small>{eyebrow ?? "SUPER ADMIN"}</small><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}

export function Metric({ label, value, note, tone = "default" }: { label: string; value: React.ReactNode; note?: string; tone?: string }) {
  return <article className={`sa-metric ${tone}`}><small>{label}</small><strong>{value}</strong>{note && <span>{note}</span>}</article>;
}

export function Empty({ title, text }: { title: string; text: string }) {
  return <div className="sa-empty"><span>○</span><b>{title}</b><p>{text}</p></div>;
}

export function Badge({ value }: { value: string }) {
  return <span className={`sa-badge status-${value}`}>{value}</span>;
}

export function DetailLink({ href, children = "Ver detalhes" }: { href: string; children?: React.ReactNode }) {
  return <Link className="sa-link-button" href={href}>{children} →</Link>;
}

export function BarChart({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map(row => row.value));
  if (!rows.some(row => row.value)) return <Empty title="Ainda sem dados para o gráfico" text="Os indicadores aparecerão quando a plataforma registrar atividade." />;
  return <div className="sa-bars">{rows.map(row => <div key={row.label}><span>{row.label}</span><i><b style={{ width: `${Math.max(3, row.value / max * 100)}%` }} /></i><strong>{row.value}</strong></div>)}</div>;
}

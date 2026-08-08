import Link from "next/link";

export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link className={`brand ${compact ? "compact" : ""}`} href="/"><span className="brand-mark">M</span><span><b>MESA VIVA</b>{!compact && <small>TECNOLOGIA PARA RESTAURANTES</small>}</span></Link>;
}

export function MarketingHeader() {
  return <header className="marketing-header"><Brand /><nav><Link href="/#recursos">Recursos</Link><Link href="/planos">Planos</Link><Link className="button outline small header-login-button" href="/login">Entrar</Link><Link className="button dark small" href="/cadastro">Teste grátis</Link></nav></header>;
}

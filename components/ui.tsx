import Link from "next/link";

export function Brand({ compact = false, href = "/", name = "MASTERAPP", logo }: { compact?: boolean; href?: string; name?: string; logo?: string }) {
  return <Link className={`brand ${compact ? "compact" : ""}`} href={href}>{logo ? <img className="brand-mark" src={logo} alt={`Logo de ${name}`} /> : <span className="brand-mark">{name.charAt(0)}</span>}<span><b>{name}</b>{!compact && <small>TECNOLOGIA PARA RESTAURANTES</small>}</span></Link>;
}

export function MarketingHeader() {
  return <header className="marketing-header"><Brand /><nav><Link href="/#recursos">Recursos</Link><Link href="/planos">Planos</Link><Link className="button outline small header-login-button" href="/login">Entrar</Link><Link className="button dark small" href="/cadastro">Teste grátis</Link></nav></header>;
}

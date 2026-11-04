import Link from "next/link";
import { MODULE_RULES } from "@/lib/menu-entitlements";
import "./module-unavailable.css";

// Fase 98C: aviso padrão de módulo fora do plano ou desligado na loja. Usado pelo DashboardShell quando a
// tela aberta pertence a um módulo desligado e pela página /painel/modulo-indisponivel.
export function ModuleUnavailable({ moduleKey, reason, role }: { moduleKey: string; reason: "plan" | "store"; role?: string }) {
  const label = MODULE_RULES[moduleKey]?.label ?? "Este módulo";
  const isOwner = role === "owner";
  return <section className="admin-card module-unavailable" role="status" aria-labelledby="module-unavailable-title" data-module={moduleKey} data-reason={reason}>
    <p className="module-unavailable-eyebrow">Módulo não disponível</p>
    <h1 id="module-unavailable-title">{label}</h1>
    <p>{reason === "plan"
      ? `${label} não faz parte do plano desta loja.`
      : `${label} está desligado para esta loja pelo administrador.`}</p>
    {isOwner
      ? <p className="module-unavailable-actions">
          {reason === "plan" ? <Link className="button primary small" href="/painel/assinatura">Ver planos</Link> : <Link className="button primary small" href="/painel/configuracoes">Abrir configurações</Link>}
          <Link href="/painel/suporte">Falar com o suporte</Link>
        </p>
      : <p className="module-unavailable-actions">Fale com o responsável pela loja para liberar o acesso.</p>}
    <p><Link href="/painel">Voltar ao painel</Link></p>
  </section>;
}

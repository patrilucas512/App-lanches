# Fase 33 — Centro de Comando Executivo

O Centro de Comando é uma camada interna de consolidação para o Super Administrador. Receita, vendas, clientes, produto, suporte, tecnologia, segurança e execução continuam usando seus módulos oficiais como fontes de verdade.

## Arquitetura

- Rota: `/superadmin/centro-de-comando`.
- API autenticada: `/api/executive-command`.
- Motor determinístico: `lib/executive-command/core.ts`.
- A Fase 33 só persiste atenção executiva, briefs, watchlist, riscos, recomendações, preferências, thresholds e snapshots de insights.
- Revenue Ops fornece forecast, cobertura e attainment; Aprovações Internas e ActionEngine continuam sendo o fluxo oficial de aprovação.

## Segurança e governança

- RLS habilitado em todas as tabelas, sem política ampla `FOR ALL`.
- Acesso por Super Admin ou permissões `executive_command_center:view/manage`.
- Toda mutação exige confirmação, motivo e evento de auditoria.
- A IA usa ferramentas controladas e não executa mudanças críticas.
- Fatos, cálculos, estimativas, riscos e hipóteses permanecem diferenciados.
- Correlações são apresentadas como associação, nunca como causalidade.

## Atenção executiva

Impacto considera MRR, clientes, criticidade, duração e tendência. Urgência considera prazo, velocidade, SLA e incidente ativo. A prioridade automática usa 60% de impacto e 40% de urgência. Override manual exige justificativa e fica auditado.

Sinais com a mesma causa-raiz são agrupados. A lista diária limita o ruído aos 5–10 itens mais relevantes. Scorecards usam thresholds configurados e informam quando a amostra é insuficiente.

## Continuidade

Brief diário, revisão semanal, MBR, modo conselho, watchlist, registro de riscos, playbooks orientativos, exportação e conversão de recomendação em tarefa interna estão preparados. Nenhuma recomendação é aplicada sem ação humana.

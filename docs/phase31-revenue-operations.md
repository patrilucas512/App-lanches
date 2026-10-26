# Fase 31 — Revenue Operations

## Fonte de verdade

`RevenueMetricsService` consolida os módulos existentes. Billing continua sendo a fonte de assinaturas e preços. MRR usa somente assinaturas ativas: valor mensal ou valor anual dividido por 12. ARR é MRR × 12. Movimentos usam chave idempotente e nunca repetem uma assinatura ou origem.

## Fórmulas

- Net New MRR = New + Expansion + Reactivation − Contraction − Churn.
- ARPA = MRR / clientes ativos.
- GRR = (MRR inicial − contraction − churn) / MRR inicial.
- NRR = (MRR inicial + expansion + reactivation − contraction − churn) / MRR inicial.
- CAC = gasto de marketing real / clientes adquiridos; sem ambos, o resultado é “dados insuficientes”.
- Gross Margin = (receita − COGS SaaS) / receita.
- Pipeline coverage = pipeline / (meta − closed won). É estimativa, não garantia.

COGS SaaS inclui custos variáveis identificados de IA, voz, WhatsApp, gateway, infraestrutura variável e parceiros. Custos administrativos não são incluídos. Entradas manuais distinguem `actual` e `estimated`.

## Governança

Metas, forecast, budgets, cenários, custos e snapshots exigem confirmação, motivo, usuário e timestamp. Overrides de probabilidade são separados da probabilidade da etapa. Cenários são versionados. O fechamento pode travar snapshots. O Copiloto apenas explica dados classificados como fato, cálculo, estimativa ou hipótese; não altera preço, meta ou contrato.

As permissões são `revenue_ops:view`, `revenue_ops:manage`, `revenue_ops:targets`, `revenue_ops:forecast`, `revenue_ops:budget`, `revenue_ops:executive` e `revenue_ops:unit_economics`. Dados executivos são protegidos por RLS. A interface não revela nomes no indicador de concentração.

## Limitações conscientes

Coortes M3/M6/M12 e LTV histórico precisam de histórico suficiente. CAC não aparece sem gasto real. Associação entre suporte, adoção e churn não significa causalidade. Exportação entrega CSV/XLSX e PDF pelo fluxo de impressão do navegador. Resumos diário/semanal/mensal são preparados como rascunho e não enviados automaticamente.

## Fase 32 recomendada (não iniciada)

Evoluir importadores de custos, calendário fiscal, coortes mais longas, conciliação assistida e distribuição aprovada de board packs, mantendo revisão humana e as mesmas fontes de verdade.

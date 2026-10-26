# Fase 54 — Relatórios Avançados

## 1. Diagnóstico inicial

O projeto já possuía relatórios operacionais isolados, o Centro de Analytics da Fase 34, `SemanticMetricsService`, `analytics_metric_catalog`, marts, cache, export jobs, RBAC organizacional, Network Scope, automações, notificações e storage privado. A pressão identificada estava em telas que ainda consultam OLTP para visões operacionais. Elas não foram reescritas: o Reporting usa warehouse para histórico, read models para operação recente e fonte híbrida quando o período cruza as duas janelas.

## 2. Arquitetura de reporting

`reporting/` é uma camada de composição governada: Dataset Registry → validação → Query Planner → Semantic/Metric Catalog → execução inline ou fila → cache tenant-scoped → export/distribuição. Não existe entrada de SQL, nome de tabela ou coluna física vindo do cliente.

## 3–5. Arquivos, migrations e Dataset Registry

- `lib/reporting/core.ts`: registry tipado, filtros, datas relativas, planner, políticas, CSV e IA.
- `app/api/reports/route.ts`: API autenticada e tenant-scoped.
- `app/api/reports/worker/route.ts`: execuções, exportações, schedules, notificações e cleanup.
- `app/api/reports/export/[id]/route.ts`: download autenticado por signed URL de 60 segundos.
- `components/reporting-center.tsx` e `app/painel/relatorios/*`: biblioteca e builder.
- `supabase/migrations/20261023053000_phase54_advanced_reporting.sql`: domínio completo e integrações.

O registry expõe `sales`, `orders`, `order_items`, `customers`, `inventory`, `payments`, `kitchen`, `delivery`, `marketing` e `network_performance`. São contratos semânticos versionados, não tabelas físicas.

## 6–8. Métricas, dimensões e Report Builder

As fórmulas continuam no `analytics_metric_catalog`. A migration apenas amplia esse catálogo existente com chaves ainda ausentes; o Report Builder referencia as chaves e a API confirma que cada métrica está certificada antes da execução. Dimensões têm operadores, sensibilidade, permissões de visualização/exportação e masking. O builder oferece dataset, métricas, dimensões, período relativo, visualização e preview de até 100 linhas, sem SQL.

## 9–10. Filtros, agrupamentos e comparação

Operadores são allow-listed; expressões arbitrárias são rejeitadas. Agrupamentos são limitados a três níveis. Métricas não aditivas rejeitam `sum`. Comparações suportam período anterior, ano anterior, meta e benchmark de rede autorizado; divisão por zero retorna variação percentual nula.

## 11–13. Execução, planner e cache

O planner escolhe `warehouse`, `operational` ou janela híbrida, calcula volume aproximado, limita intervalo/linhas e envia consultas grandes para `report_execution_jobs`. O cache inclui organização, lojas, versão, definição, período e permissões, impedindo reutilização entre tenants. Realtime usa TTL curto; histórico aceita TTL maior.

## 14. Exportações

CSV protege contra formula injection. XLSX usa `xlsx`; PDF usa `jsPDF` e produz resumo. Arquivos ficam no bucket privado `report-exports`, têm expiração, cleanup e download autenticado por signed URL. Exportação financeira/PII exige `reports:export_sensitive` e gera auditoria.

## 15–16. Agendamento e distribuição

Schedules aceitam somente daily/weekly/monthly e timezone explícito. Destinos iniciais: in-app e email. Relatório confidencial usa link autenticado; anexo para email externo é bloqueado. Destinatários inativos são ignorados. Falha de entrega reutiliza a execução existente com backoff.

## 17–18. Biblioteca, compartilhamento e versionamento

A biblioteca oferece modelos oficiais somente leitura; personalização cria cópia. Definições publicadas preservam versões anteriores. Compartilhamento interno separa view/edit/schedule e nunca substitui a permissão do módulo. Favoritos, recentes, busca por metadata, templates e snapshots imutáveis foram modelados.

## 19. AI Report Builder

A IA converte linguagem natural em definição draft validada pelo registry. SQL e métricas inexistentes são recusados. O usuário sempre revisa antes de salvar. Tools previstas: `getReports`, `runReport`, `getScheduledReports`, `getReportExecutionStatus`, `getReportLibrary` e `getAvailableReportMetrics`.

## 20–22. Workspace, Data Platform e governança

Relatórios compatíveis podem usar o widget `saved_report`, que mostra somente resumo da última execução. A execução histórica usa marts da Fase 34; não duplica cálculo de faturamento, ticket, margem ou CMV. `ReportGovernanceService` está representado pelas validações centrais: dataset/metric/dimension access, export policy, scope, sensibilidade e distribuição.

## 23–25. Permissões, auditoria e observabilidade

Permissões: `reports:view`, `create`, `edit`, `share`, `schedule`, `export`, `export_sensitive`, `view_financial`, `view_network`, `manage_templates`. Permissões dos módulos continuam cumulativas. Eventos auditados incluem create, publish, share, schedule, execução/export sensível e download. `report_usage_hourly` suporta total, latência, falhas, queue lag, geração de export, duração no warehouse e cache hit rate. Diagnostic ID acompanha execuções.

## 26. Testes

`tests/advanced-reporting-phase54.test.mjs` cobre os 30 cenários obrigatórios: registry, validação semântica, datas/timezone, não aditividade, scope/RBAC, execução, cache, três formatos, expiração, schedules, distribuição, confidencialidade, sharing/versioning, IA, freshness e performance.

## 27. Limitações atuais

- Pivot inicial é agrupamento/subtotal, não uma planilha multidimensional livre.
- A primeira interface prioriza seletores claros; drag-and-drop fica opcional.
- Datasets de domínios ainda sem mart certificado aparecem registrados, mas retornam estado vazio até o pipeline correspondente publicar fatos certificados.
- PDF é executivo e propositalmente não suporta milhões de linhas.
- Cancelamento de consulta já iniciada é best effort.
- Offline mostra apenas o último snapshot/cache; nova execução e exportação exigem conexão.

## 28. Recomendações para a próxima fase

Validar uso real e custos antes de ampliar datasets, adicionar adapters reais de email, configurar políticas de retenção por plano, calibrar concorrência por tenant e evoluir gráficos/drilldowns apenas a partir dos caminhos mais usados. A Fase 55 não foi iniciada.

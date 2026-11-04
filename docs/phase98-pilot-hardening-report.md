# Fase 98: Endurecimento para a loja piloto, relatório

Data: 04/11/2026. Branch `claude/fase-98-endurecimento-piloto`. Em construção durante a fase; as seções
finais são preenchidas ao fim.

## 98C. APIs de módulo ainda sem trava (pendência)

As telas de todos os módulos com flag mostram o aviso padrão (o bloqueio está no `DashboardShell`). Nas APIs,
16 rotas ganharam a trava `requireModuleEnabled` e 5 já tinham trava própria (`FEATURE_DISABLED`, 403).

Estas 27 pastas de API de módulo **não conferem a flag** quando chamadas diretamente. Os dados continuam
restritos à própria loja pelas permissões de cada rota; o risco é usar um módulo fora do plano pela API.
Cada uma resolve a loja de um jeito diferente, por isso não entraram na troca automática:

`app/api/asset-management`, `app/api/customer-journeys`, `app/api/customer-subscriptions`,
`app/api/document-compliance`, `app/api/enterprise-architecture`, `app/api/enterprise-portfolio`,
`app/api/fiscal`, `app/api/food-quality`, `app/api/forecasting`, `app/api/franchise-finance`,
`app/api/hardware-hub`, `app/api/incidents`, `app/api/integrated-business-planning`, `app/api/knowledge`,
`app/api/learning`, `app/api/marketing-intelligence`, `app/api/marketplace-integrations`,
`app/api/master-data`, `app/api/network-governance`, `app/api/offline`, `app/api/performance-management`,
`app/api/process-intelligence`, `app/api/procurement-intelligence`, `app/api/profitability`,
`app/api/transport-management`, `app/api/vendor-management`, `app/api/workforce-planning`.

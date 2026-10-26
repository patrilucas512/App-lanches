# Fase 74 — Planejamento Integrado de Negócio

1. **Diagnóstico inicial:** Forecasting, metas, orçamento, Supply Chain, produção, compras, capacidade, workforce, Marketing, Financeiro, TMS, Reporting e Data Platform foram mantidos como fontes oficiais.
2. **Arquitetura:** IBP é uma camada coordenadora versionada, não um novo motor operacional.
3. **Arquivos criados:** core de domínio, API, central visual, estilos, migration, testes e este relatório.
4. **Arquivos modificados:** menu, Copiloto, Automação, Relatórios, Data Platform e scripts.
5. **Migration:** tabelas IBP, flags, índices, grants, RLS e métricas semânticas.
6. **Planning cycles:** semanal, mensal, trimestral, anual e customizado; week/month apenas.
7. **Plan versions:** working, submitted, approved e superseded com lock otimista.
8. **Snapshots:** cada fonte possui versão, data, hash e qualidade.
9. **Assumptions:** categorias, confiança não probabilística, evidências, revisão e outcome humano.
10. **Lineage:** medidas apontam módulo, versão e componente de origem.
11. **Demand Review:** baseline estatístico, overrides, Marketing e abertura/fechamento separados.
12. **Consensus forecast:** resultado aprovado, nunca média automática e sem editar o forecast fonte.
13. **Supply Review:** reutiliza Supply Chain e exibe demanda não restrita versus oferta viável.
14. **Constraints:** gaps, opções e decisão humana; sinal positivo representa shortage.
15. **Capacity Review:** capacidade agregada de operação, workforce, warehouse e transporte.
16. **Financial Review:** Plan, Budget, Target, Forecast e Actual separados; sem nova DRE.
17. **Scenarios:** deltas sobre uma versão base, sempre dry run.
18. **Scenario comparison:** impactos comparáveis sem escolher automaticamente o melhor cenário.
19. **Decisions:** constraints podem referenciar o Decision Log existente.
20. **Stage gates:** requisitos explícitos, override autorizado com motivo e sem avanço automático.
21. **Approvals:** aprovação humana obrigatória; IA não aprova.
22. **Plan publication:** somente versão aprovada, bloqueada e calculada; não executa operações.
23. **Execution bridge:** publica targets, requisitos e drafts para domínios oficiais.
24. **Rolling plan:** actuals avançam numa nova versão; histórico aprovado fica preservado.
25. **Plan vs actual:** variance e drivers somente quando suportados por fontes.
26. **Reporting/Workspace:** dez datasets, dez templates e cards executivos.
27. **Executive Command Center:** dados do plano ficam disponíveis para resumo, gaps, riscos e decisões.
28. **Copilot:** fatos, premissas, restrições, cenários e decisões separados, sem causalidade inventada.
29. **Data Platform:** oito fatos e cinco dimensões IBP agregadas.
30. **Security/RBAC:** escopo local, regional, corporativo e rede; financeiro separado.
31. **Audit:** eventos materiais de ciclo, versão, premissa, decisão, aprovação, publicação e targets.
32. **Observability:** status de cálculo, qualidade, frescor, gaps e falhas ficam explícitos.
33. **Tests:** 39 cenários cobrem os 30 testes obrigatórios e nove adicionais.
34. **Limitações:** cálculo assíncrono depende do worker/agenda da instalação e dados-fonte reais.
35. **Recomendação para a Fase 75:** iniciar apenas sob nova instrução; a Fase 74 não executa operações automaticamente.

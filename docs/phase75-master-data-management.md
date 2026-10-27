# Fase 75 — Master Data Management

## Relatório de entrega

1. **Diagnóstico inicial.** O Catalog/PIM, Customer 360, fornecedores, unidades, equipe, ativos, Geo, mappings externos, Integration Hub, busca, Data Platform e mecanismos existentes de merge foram inspecionados. A decisão arquitetural foi acrescentar uma camada de identidade e governança, mantendo cada domínio como fonte oficial.
2. **Arquitetura MDM.** A solução é multi-tenant e server-only, formada por registro mestre, identificadores, fontes, matching, qualidade, golden records, aliases, reconciliação, governança e APIs internas. Não é um banco operacional universal.
3. **Arquivos criados.** Migration da Fase 75, `lib/master-data/core.ts`, API principal e worker MDM, página/CSS/componente Dados Mestres, testes e este relatório.
4. **Arquivos modificados.** Navegação, busca global, automações, reporting, Data Platform, Copilot, Workspace, Integration Hub e scripts de teste foram ampliados de forma incremental.
5. **Migrations.** `20261027033910_phase75_master_data_management.sql` cria tabelas, índices, RLS, políticas, RPCs protegidas, métricas, comandos de busca e widgets. A migration não foi aplicada em produção nesta entrega.
6. **Master Entity Registry.** `master_entity_registry` referencia a entidade canônica oficial e não copia seu cadastro operacional.
7. **Master keys.** Chaves estáveis `MDM-<TIPO>-<SEQUÊNCIA>` coexistem com os IDs dos domínios, sem substituí-los.
8. **Identifiers.** Identificadores têm tipo, origem, escopo, validade, verificação, unicidade configurável e proteção por hash para valores sensíveis.
9. **Source records.** `master_source_records` registra origem, primeira/última observação e hash opcional, sem duplicar PII completa.
10. **Normalization.** Normalizadores tipados tratam SKU, barcode/GTIN, telefone, e-mail, documentos e IDs externos com política e versão.
11. **Matching.** O serviço combina features determinísticas e fuzzy, pesos explícitos, requisitos e nível de confiança.
12. **Duplicate detection.** O worker usa blocking keys por tenant/tipo, limites por bucket e lotes; não executa comparação global O(n²).
13. **Match explainability.** Cada candidato guarda razões, pesos, similaridade, conflitos, versão da regra e recomendação.
14. **Golden records.** Versões do golden record guardam resolução e confiança; o domínio operacional permanece autoritativo.
15. **Survivorship.** A resolução por campo prioriza verificação, confiança e recência, respeitando locks manuais e registrando linhagem.
16. **Merge Center.** A UI Dados Mestres possui fila, comparação lado a lado, decisões humanas e navegação por 12 subseções.
17. **Merge saga.** O fluxo é preview, aprovação, lock, alias, validação e reconciliação; integrações cross-domain usam compensação, não transação distribuída presumida.
18. **Aliases.** `master_entity_aliases` preserva o registro original, resolve cadeias para o canônico e bloqueia ciclos.
19. **Reversal.** Unmerge apenas desativa alias quando não existem efeitos irreversíveis; o histórico do merge permanece.
20. **Data Quality.** Regras tipadas e versionadas cobrem completude, formato, unicidade, referência, valores, faixa, consistência e freshness; issues nunca são ocultadas.
21. **Stewardship.** Responsáveis podem ser definidos por entidade e escopo sem criar cargo obrigatório no RH.
22. **Governance policies.** Políticas versionadas cobrem criação, atualização, merge, archive, identificadores, precedência, aprovação, qualidade e retenção.
23. **Change requests.** Correções são solicitadas ao serviço oficial do domínio; MDM não faz update direto em campos de outro módulo.
24. **Legacy/external ID crosswalk.** Crosswalks idempotentes preservam sistema externo, ID, entidade mestre, canônico e status.
25. **Integration Hub integration.** `resolveMasterIdentifier` oferece resolução canônica protegida e detecta colisão sem escolher vencedor.
26. **Catalog/Customer/Supplier/Asset integrations.** Produto bloqueia merge em conflito operacional; cliente delega ao Customer 360 com opt-out prevalente; fornecedor financeiro exige segunda aprovação; ativo preserva histórico.
27. **Data Platform.** Dimensões e fatos MDM foram registrados para rollup sem reescrever fatos históricos.
28. **Reconciliation.** O serviço compara IDs do domínio e registro mestre, gera findings e nunca aplica reparo destrutivo automático.
29. **Global Search.** SKU, barcode, telefone/e-mail protegidos, códigos externos e legados resolvem para a entidade canônica.
30. **Reporting/Workspace.** Sete datasets, oito modelos previstos e widgets de qualidade, duplicidades e reconciliação foram integrados.
31. **Copilot.** Oito tools MDM fornecem fatos, fontes, conflitos e ação recomendada; IA não executa merge nem altera golden record.
32. **Security/privacy/RBAC.** RLS, isolamento por organização, backend authorization, masking, service role explícita e permissões por risco protegem dados cross-domain.
33. **Audit.** Registro imutável de ações inclui ator, motivo, estado anterior/posterior, correlation ID e metadados redigidos.
34. **Observability.** Foram definidos dez sinais de resolução, conflitos, candidatos, jobs, merge, qualidade, reconciliação, aliases e change requests, além do health service.
35. **Tests.** A suíte cobre os 30 cenários obrigatórios e casos adicionais de tenant, store, consentimento, histórico, stale preview, concorrência, bulk, privacidade, colisão, versão e escala.
36. **Limitations.** A primeira versão não migra referências operacionais em massa, não faz auto-merge crítico, não oferece governança offline e depende de eventos/domínios para materializar correções.
37. **Recomendações para a Fase 76.** Manter a próxima fase separada. Recomenda-se validar a migration em staging, carregar blocking indexes gradualmente, ativar flags por tenant e medir latência/falsos positivos antes de expandir automação.

## Critérios operacionais

- Caminho síncrono limitado a identificadores exatos; fuzzy, qualidade completa e reconciliação são assíncronos.
- Merge crítico exige preview e confirmação humana; store/supplier de alto risco admitem aprovação em duas pessoas.
- Registros fonte e fatos históricos não são removidos nem reescritos silenciosamente.
- Customer 360 continua dono da identidade de cliente; Catalog/PIM, Finance, Assets e demais domínios mantêm seus campos autoritativos.

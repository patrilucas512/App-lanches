# Fase 64 — Financeiro de Franquias

## 1. Diagnóstico inicial
O MasterApp já possuía Financeiro gerencial, contratos/documentos, pagamentos/conciliação, governança de rede, Fiscal, Reporting, Data Platform, automações e aprovações. A Fase 64 acrescenta uma camada especializada de royalties, fundos e acertos entre franqueador e unidades, sem duplicar essas fontes oficiais e sem misturar a cobrança da assinatura SaaS.

## 2. Arquitetura Franchise Finance
Fluxo: contrato e perfil → política de base → regra efetiva versionada → cálculo assíncrono → avaliação → revisão/aprovação → settlement → conta a receber oficial → pagamento/conciliação → ledger especializado → extrato. Organização, marca, região, loja, perfil e período formam os limites de escopo.

## 3. Arquivos criados
Foram criados o core em `lib/franchise_finance`, as rotas de API e worker, a página e o componente do painel, CSS, migration, testes da fase e este relatório.

## 4. Arquivos modificados
O shell recebeu navegação e entitlement; Copiloto e Automation Center receberam ferramentas, eventos e ações; `package.json` recebeu o comando `test:phase64`.

## 5. Migrations
A migration foi criada pela CLI oficial. Ela ainda não foi aplicada em produção. Há tabelas, índices, RLS, grants explícitos, função de claim com `SKIP LOCKED`, registros de integração e expansão controlada do tipo de origem no Financeiro.

## 6. Financial profiles
O perfil liga organização, marca/região opcionais, estabelecimento franqueado, contrato, vigência, moeda, ciclo, termos e responsáveis. Só estabelecimentos com vínculo válido podem operar fora do modo sombra.

## 7. Fee rules
As regras suportam royalty, fundo de marketing, publicidade, tecnologia, treinamento, operações, campanhas, taxa fixa e tipo customizado seguro. Métodos: fixo, percentual, híbrido, faixas, garantia mínima e fórmula registrada.

## 8. Rule versioning
Cada versão tem vigência, snapshot e hash. Versões históricas são append-only; uma mudança futura cria nova versão, sem reescrever o cálculo de períodos anteriores.

## 9. Basis policies
A política define métrica certificada, inclusões, exclusões, canais/categorias excluídos, timezone, reconhecimento e arredondamento. O detalhamento conserva cada componente incluído ou excluído e seu motivo.

## 10. Calculations
O cálculo é determinístico, em centavos, sem `eval`, SQL ou JavaScript arbitrário. Limite mínimo e teto máximo são aplicados explicitamente; faixas são validadas contra sobreposição.

## 11. Calculation snapshots
Cada avaliação preserva regra, política, componentes, cálculo, timezone, reconhecimento e hash. Reprocessamento idempotente não altera o snapshot já aprovado.

## 12. Assessments
Avaliações pertencem a um perfil, regra e período. Base, taxa, valor calculado, ajustes, total, estado e evidências ficam separados para revisão.

## 13. Adjustments
Crédito, débito, correção, desconto, ajuste de período anterior e saldo de abertura exigem valor positivo, motivo, referência e auditoria. Casos críticos usam aprovação reforçada.

## 14. Exemptions e waivers
Isenções têm período, tipo, percentual/valor, justificativa, aprovação e documento de referência. Waiver não apaga cobrança: gera registro e, quando aplicado, lançamento reversível.

## 15. Period close
Qualidade de dados pode liberar, alertar ou bloquear. Aprovação exige revisão; fechamento exige período aprovado. Reabertura exige permissão, motivo e aprovação quando a política de duas pessoas estiver ativa.

## 16. Settlements
O settlement consolida avaliações e ajustes do período, guarda vencimento e estado e, somente após confirmação/aprovação, cria conta a receber no Financeiro oficial com `masterapp_saas_billing=false`.

## 17. Ledger
O ledger especializado é append-only e usa débitos/créditos de um único lado. Correções são novas entradas de reversão; update e delete são bloqueados por trigger.

## 18. Reconciliation
O pagamento permanece em `financial_entry_payments` e a conciliação oficial em `financial_reconciliations`. A camada de franquia registra vínculo, diferença, referência, pagamento parcial, excesso como crédito e itens não identificados.

## 19. Marketing fund
Contas de fundo podem ser nacionais, regionais ou locais. Contribuições vêm de avaliações próprias; despesas apenas referenciam lançamentos oficiais aprovados. O saldo é gerencial e não é apresentado como confirmação bancária.

## 20. Statements
Extratos são snapshots versionados com período, avaliações, settlement e ledger. Têm o rótulo “controle gerencial” e não se apresentam como documento fiscal.

## 21. Disputes
Contestação pode apontar avaliação ou settlement, guarda motivo, evidência, responsável, SLA e resolução. Abrir disputa não modifica automaticamente o saldo nem a cláusula contratual.

## 22. Financial Management integration
Contas a receber, pagamentos, categorias e status continuam no módulo Financeiro existente. A Fase 64 apenas adiciona origem, referência e rastreabilidade de franquia.

## 23. Contracts/Fiscal integration
Regras e perfis referenciam contratos/documentos existentes. O módulo não inventa cláusula e não emite nota, boleto, débito automático ou obrigação fiscal; o Fiscal continua sendo a fonte dessas operações.

## 24. Reporting/Workspace integration
Datasets, métricas certificadas e seis widgets foram registrados. Consultas respeitam organização/escopo e fatos/dimensões de warehouse ficam acessíveis somente por jobs confiáveis.

## 25. Executive Command Center
Os indicadores disponibilizam royalties calculados/recebidos, inadimplência gerencial, fundo, fechamento, contestações e projeção. Aging não contém consequência jurídica hardcoded.

## 26. Copilot
Oito ferramentas consultivas foram adicionadas. Respostas separam Base, Regra, Cálculo, Ajustes, Total e Status, informam dados ausentes e nunca aprovam, alteram contrato ou movimentam dinheiro.

## 27. Data Platform
Foram definidos fatos de avaliações, settlements, pagamentos, ajustes, contribuições e disputas, dimensões operacionais e dez métricas semânticas. Forecast é rotulado como estimativa e nunca como receita reconhecida.

## 28. Security/RBAC
Há 13 permissões, RLS, grants explícitos, isolamento por organização, restrição por lojas autorizadas, visão própria e visão de rede. Tabelas sensíveis não são expostas diretamente a `anon`.

## 29. Audit
Perfis, versões, exclusões, cálculo, aprovação, lock/reopen, ajuste, waiver, settlement, conciliação manual e disputas produzem eventos com antes/depois, motivo e ator quando aplicável.

## 30. Observability
Jobs têm tentativas, backoff, lock, erro, resultado e dead letter. O desenho cobre falha de cálculo, latência de fechamento, falha de settlement/extrato, divergência de conciliação e erro de ledger/fundo.

## 31. Tests
A suíte obrigatória contém 30 testes: perfil, seis modalidades/limites, exclusões, versão, período/snapshot/arredondamento, ajustes/waivers, lock/reopen, settlement/pagamentos/conciliação, fundo, disputa, resolução de escopo, acessos, auditoria, imutabilidade e isolamento tenant.

## 32. Limitations
Não há débito automático, emissão fiscal, boleto nativo, transferência financeira, reconhecimento contábil ou aplicação automática de cláusula. Importação de saldo exige fluxo futuro de preview/aprovação. A migration e a publicação dependem de autorização explícita.

## 33. Recommendations for Phase 65
Antes de iniciar outra fase, validar a migration em ambiente de homologação com contratos reais anonimizados, executar fechamento paralelo de dois períodos, revisar regras contábeis/fiscais com responsáveis humanos, medir uma rede grande e aprovar o playbook de implantação. A Fase 65 não foi iniciada.

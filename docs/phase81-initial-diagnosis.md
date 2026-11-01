# Fase 81 — diagnóstico inicial

## Inventário existente

- A Fase 20 já é o Integration Hub canônico: `integrations`, `webhook_endpoints`, eventos, entregas, sincronizações, logs, API keys, rate limits, idempotência, Vault e validação contra SSRF.
- A Fase 69 mantém os adaptadores especializados de marketplaces, capability matrix, verificação de assinatura, retry, mapeamento e reconciliação.
- A Fase 75 mantém o MDM, identificadores, crosswalks e resolução de entidades. A orquestração apenas chama esse contrato.
- A Fase 76 mantém contratos, compatibilidade de schema, lineage e análise de impacto. Fluxos apenas referenciam contratos publicados.
- A Fase 26 já mantém primitives operacionais de jobs, DLQ e circuit breaker; a Fase 81 adiciona estado específico de execução sem substituir o runtime operacional.
- Automation Center, ActionEngine, Policy Engine, Incident Management, Feature Management e Secret Management continuam donos de agenda, efeitos de negócio, decisão, incidente, rollout e credenciais.

## Problemas encontrados

- A configuração de integrações está distribuída entre webhooks, integrações genéricas, OAuth e adapters especializados.
- Não existe um registro único de conectores tipados e versionados nem um DAG declarativo auditável.
- Mapeamentos, retries e reconciliações são específicos por módulo e não têm uma visão operacional unificada.
- Não há uma tela única para runs, steps, DLQ, ownership de campos, reconciliação e impacto de mudança.

## Decisões arquiteturais

1. Criar `integration_orchestration/` como control plane; ele nunca grava diretamente em domínios operacionais.
2. Fluxos são DAGs declarativos, versionados e imutáveis após publicação.
3. Conectores, ações, triggers e transformações usam catálogos fechados e contratos tipados.
4. Credenciais são somente referências a Secret Management; nenhum segredo entra no banco, payload de run ou log.
5. URLs e redirecionamentos obedecem à proteção SSRF da Fase 20 e a allowlists do conector.
6. Toda execução é tenant-scoped, idempotente, limitada, observável e reconciliável.
7. Falha externa degrada o fluxo e nunca bloqueia pedido, pagamento, cozinha ou operação principal.
8. MDM, Data Contracts, ActionEngine, Policy Engine, Automation Center e Incident Management são integrações, não duplicações.
9. Replay de DLQ e teste de conexão são previews governados; execução real exige worker autorizado.
10. Nenhum editor aceita JavaScript, SQL, template executável, shell ou HTTP arbitrário.

## Limites da entrega

- A migration é aditiva, com RLS e grants explícitos.
- Nenhum conector ou fluxo fica ativo por seed.
- A publicação em produção e a aplicação da migration dependem de autorização posterior.
- A Fase 82 não faz parte desta entrega.

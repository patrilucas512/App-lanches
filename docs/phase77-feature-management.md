# Fase 77 — Feature Management e Configuração Central

Data: 2026-10-27

## Resultado

A Fase 77 cria o control plane central para feature flags, configurações tipadas, rollout gradual, canary, kill switch, overrides temporários e segmentação. Ela não substitui entitlement comercial, release engineering, experimentação ou herança de rede: esses domínios continuam sendo as fontes oficiais das Fases 22, 27, 28 e 46.

## Relatório final — 41 tópicos

1. **Diagnóstico inicial:** inventário de `plans`, `store_feature_flags`, flags técnicas, experimentos, releases e configurações de rede em `phase77-initial-diagnosis.md`.
2. **Registry:** `feature_definitions` registra chave, owner, categoria, tipo, defaults, ciclo de vida e prazo de limpeza.
3. **Tipos:** boolean, string, number, enum e structured; structured exige schema.
4. **Segredos:** chaves com token, senha, credencial, secret ou private key são rejeitadas.
5. **Ambientes:** development, preview, staging e production, com proteção e aprovação configuráveis.
6. **Versionamento:** versões publicadas são imutáveis e identificadas por fingerprint.
7. **Safe default:** toda feature possui fallback tipado e conservador.
8. **Entitlements:** a Fase 22 é consultada antes de qualquer regra de ativação.
9. **Releases:** versões podem referenciar `platform_releases` da Fase 27.
10. **Experimentos:** atribuições da Fase 28 são consumidas, sem segunda randomização.
11. **Herança:** configuração efetiva segue loja → região → marca → organização → global → safe default, alinhada à Fase 46.
12. **Precedência:** kill switch → entitlement → blocklist → override → experimento → targeting → rollout → default.
13. **Bucket:** SHA-256 estável em 10.000 basis points por feature, tipo e sujeito.
14. **Sticky rollout:** o mesmo sujeito permanece no mesmo cohort enquanto salt e identidade não mudarem.
15. **Targeting:** organização, marca, região, loja, plano, papel, plataforma, versão e atributos controlados.
16. **Sem expressão arbitrária:** condições são dados declarativos; nenhum código fornecido por usuário é executado.
17. **Dependências:** grafo explícito, validação em serviço e trigger de proteção contra ciclos.
18. **Allowlists/blocklists:** programas de acesso separados das regras comuns e com expiração opcional.
19. **Overrides:** exceções exigem motivo, período válido e auditoria; o escopo mais específico prevalece.
20. **Kill switches:** valor seguro por ambiente, motivo obrigatório e ação crítica controlada.
21. **Rollouts:** estratégias percentage, canary, ring e scheduled.
22. **Estágios:** percentuais em basis points, duração mínima e aprovação humana nos estágios de maior exposição.
23. **Health gates:** erro, latência, conversão e amostra são evidências transparentes; nenhuma causalidade é inventada.
24. **Rollback:** preserva versão anterior, exige justificativa e gera trilha de auditoria.
25. **Canary:** cohort, baseline, candidate e evidências ligados ao release oficial.
26. **Changesets:** agrupam mudanças, validação e prévia de impacto antes de publicação.
27. **Agendamento:** fila idempotente para publicar, ativar, pausar, avançar, reverter, desativar ou expirar.
28. **Cache:** TTL limitado, invalidação por feature e avaliação em lote sem consulta remota por flag após aquecimento.
29. **Last-known-good:** falhas de validação usam último valor válido ou safe default.
30. **Client-safe:** somente valor efetivo e versão são expostos; regras, listas e metadados internos ficam no servidor.
31. **Telemetria:** avaliações são agregadas/amostradas por janela, sem registrar payload individual completo.
32. **RBAC:** permissões separadas para leitura, definição, publicação, rollout, override, kill switch, configuração e auditoria.
33. **RLS:** tabelas protegidas, sem grant para `anon` ou `authenticated`; acesso administrativo passa pelo backend.
34. **Auditoria:** ator, ação, entidade, ambiente, escopo, motivo, antes/depois, correlation id e metadados redigidos.
35. **ActionEngine:** avanço, rollback e kill switch são ações materiais com aprovação humana indicada.
36. **Automation Center:** triggers de rollout, saúde, override, kill switch e cleanup; ações controladas e idempotentes.
37. **Reporting/Workspace:** datasets, templates e widgets de saúde, rollouts, expiração e dívida de cleanup.
38. **Data Platform:** facts, dimensions e quatro métricas semânticas certificadas, sem replicar payload bruto.
39. **Copilot:** explica decisões e simula, mas não publica, avança rollout nem aciona kill switch.
40. **Interface:** área Super Admin em modo escuro com Overview, Features, Configurations, Rollouts, Canary, Overrides, Kill Switches, Experiments, Health, Cleanup, Audit e Settings.
41. **Testes:** 64 verificações cobrem registry, tipagem, precedência, targeting, cache, performance, segurança, integrações e UI.

## Modelo operacional

O runtime recebe um snapshot já carregado com definição, entitlement, kill switch, overrides, assignment experimental, regras e rollout. A decisão é local, determinística e cacheável. O servidor pode retornar ao cliente apenas `{ value, version }` para definições marcadas `client_safe`.

Mudanças em produção são versionadas. Ambientes protegidos entram em revisão; stages acima do limiar configurado exigem aprovação humana. O monitor de saúde pode recomendar pause ou rollback, mas não toma decisões destrutivas sozinho.

## Segurança e privacidade

- Feature Management não armazena credenciais.
- `service_role` aparece apenas no banco/servidor.
- A view de saúde usa `security_invoker=true`.
- Auditoria não recebe segredos e usa hashes para IP/user-agent quando esses sinais forem necessários.
- A telemetria é agregada; allowlists e targeting interno não são enviados ao navegador.
- A migration não expõe automaticamente tabelas novas na Data API pública.

## Rollout da própria Fase 77

1. Aplicar a migration em produção após autorização explícita.
2. Validar seeds dos ambientes, registry migrado da Fase 27 e métricas.
3. Publicar a aplicação.
4. Executar smoke test autenticado no Super Admin.
5. Manter os leitores legados em modo de compatibilidade durante a migração gradual.
6. Migrar feature por feature, comparar decisões em shadow mode e só então retirar o leitor legado.

## Fora do escopo

- Nenhuma migration foi aplicada em produção neste estágio.
- Nenhuma publicação foi executada antes da autorização.
- A Fase 78 não foi iniciada.

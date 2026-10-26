# Guia de engenharia de qualidade

## Como testar

- `pnpm test:unit`, `test:integration`, `test:e2e`, `test:contract`, `test:security` e `test:performance-smoke` executam camadas independentes.
- `pnpm test:phase27` protege a própria infraestrutura da Fase 27.
- Testes com escrita exigem `TEST_ENVIRONMENT=development|staging`, URL não produtiva e credenciais próprias.
- Um teste não pode depender da execução de outro. Use factories e idempotency keys novas.

## Migration segura

Crie migrations com a CLI, rode `pnpm qa:migration-safety` e faça dry run em banco isolado. Prefira expand/contract: adicionar, migrar aplicação, backfill em job e só então remover em uma release posterior. DROP, RENAME, rewrite e índice bloqueante precisam de revisão explícita.

## Feature flag

Recursos de alto risco começam internos, depois 5%, 25% e 100%. Use alvo por organização/plano quando necessário. O kill switch sempre prevalece e precisa funcionar sem novo deploy.

## Release

1. Quality Gate verde.
2. Artefato imutável + SBOM.
3. Staging isolado e smoke read-only.
4. Aprovação do ambiente `production` para release sensível.
5. Publicação nativa do Sites usando o mesmo commit/artefato.
6. Registro em `platform_releases`, auditoria e smoke pós-deploy.

## Hotfix

Execute testes relevantes, secret/migration scan, build e smoke. Não pule o registro de release. Rode a suíte completa como follow-up.

## Definition of Done

Código, testes de comportamento, observability, migration segura, documentação e feature flag quando o risco justificar. Bug crítico corrigido sem teste de regressão não está concluído.


# Ambientes, preview e dados sintéticos

| Ambiente | Dados | Gateway | Mensagens | Fiscal | Uso |
|---|---|---|---|---|---|
| Development | sintéticos | mock | interceptado | homologação | desenvolvimento local |
| Staging | sintéticos | sandbox | allowlist de teste | homologação | E2E, contract, DAST e chaos controlado |
| Production | reais | produção | produção | produção | somente smoke read-only |

O seed só executa quando `app.masterapp_test_environment` é `development` ou `staging`. Organizações sintéticas usam `is_test_organization=true`. O guard impede que staging compartilhe URL ou projeto Supabase com produção.

Preview environments ficam desativados por padrão até existir um branch Supabase isolado e uma URL temporária. Branches Supabase possuem banco, API, Auth e Storage isolados; migrations e seed devem ser recriados por branch.

Chaos testing é permitido apenas em staging para timeout de IA/gateway, webhook duplicado, fila atrasada e cache indisponível. Nenhum chaos é executado em produção.


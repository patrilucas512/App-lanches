# Fase 25 — auditoria de segurança e arquitetura

## Inventário revisado

- Autenticação: Supabase Auth único, cookies SSR por `@supabase/ssr`, refresh no proxy e perfis vinculados a `auth.users`.
- Sessões: tokens do Supabase com rotação do provedor; a Fase 25 adiciona inventário de dispositivos, revogação lógica e `signOut` nativo por escopo.
- RBAC: `organization_members`, `establishment_members`, helpers no schema `private` e políticas RLS por empresa/unidade.
- API: chaves somente em hash, prefixo identificável, scopes, expiração, rotação com janela curta, rate limit e acesso por unidade.
- OAuth: Authorization Code/PKCE, access e refresh tokens em hash, consentimento e revogação.
- Integrações: webhooks assinados, idempotência, retries, circuit breaker existente e validação contra SSRF.
- Storage: buckets privados dependem de RLS; uploads da Fase 25 têm contrato de MIME, extensão, tamanho e filename.
- Banco: Postgres/Supabase com RLS em tabelas expostas e funções privilegiadas com `search_path` vazio.
- Backup: execução pertence ao provedor; o MasterApp monitora metadados, retenção, criptografia e resultados.
- Logs/auditoria: logs operacionais existentes foram preservados; `security_audit_logs` é append-only e correlacionável.
- Observabilidade: status público existente ampliado para banco, fila, billing, integrações e fiscal.
- Secrets: tokens já permanecem no backend; a Fase 25 registra rotação sem armazenar o valor do secret.
- Deploy: Sites/Cloudflare Worker, Supabase externo e publicação versionada por commit.

## Riscos identificados e tratamento

1. Login direto no navegador não possuía atraso progressivo: adicionado preflight server-side por conta + IP com lock temporário.
2. Ausência de inventário próprio de dispositivos: adicionada trilha de sessão sem localização precisa e sem tokens.
3. Auditoria legada não contém todos os campos enterprise: criada trilha append-only específica, sem substituir logs existentes.
4. Restore podia ser confundido com execução real: a interface registra e monitora testes; não promete restore quando o provider não o executou.
5. SSO pode causar lockout: enforcement exige conta break-glass e o papel JIT padrão nunca é owner.
6. CSP estrita colide com scripts/estilos inline exigidos pela stack atual: a política limita origens e mantém `unsafe-inline` apenas onde o runtime atual necessita. Recomenda-se nonce na próxima atualização da stack.

## Controles aplicados

- TOTP nativo do Supabase Auth e AAL2 no login.
- Códigos de recuperação gerados criptograficamente, mostrados uma vez e persistidos somente como SHA-256 contextualizado.
- Políticas de MFA, sessão, retenção, RPO/RTO, manutenção e somente leitura.
- SSO SAML/OIDC por domínio, JIT com papel mínimo e conta de emergência.
- Eventos e incidentes de segurança separados de suporte.
- Auditoria exportável com reautenticação MFA quando a política exigir.
- Security headers, proteção de origem, SSRF, hashing com comparação constante e validação de upload.
- Entitlements por plano para MFA, SSO, auditoria, alertas, sessões enterprise e allowlist.

## Limitações honestas

- A ativação final de um IdP SAML/OIDC e seus secrets/certificados privados depende da configuração backend do Supabase e não é feita pelo formulário público.
- A revogação lógica aparece imediatamente no MasterApp; invalidação criptográfica de access tokens já emitidos respeita o ciclo do Supabase Auth. Ações sensíveis devem validar `session_id`/AAL.
- GeoIP exibe somente país/região quando o proxy fornece o cabeçalho.
- Backup, PITR e failover dependem do plano e da infraestrutura do provedor. A interface não inventa disponibilidade.
- Malware scanning foi preparado como ponto de integração; não há scanner binário embutido no Worker.
- Passkeys/WebAuthn e SCIM permanecem modelados como evolução, sem implementação falsa nesta fase.


# Fase 29 — CRM Comercial do MasterApp

Domínio interno e independente dos consumidores dos restaurantes. Acesso pelo Super Admin em `/superadmin/vendas`.

## Arquitetura

- `sales_leads`, `sales_accounts` e `sales_contacts` separam prospect, empresa e pessoas.
- `sales_pipelines`, `sales_stages`, `sales_opportunities` e `opportunity_stage_history` mantêm pipeline customizável e rastreável.
- `sales_tasks`, `sales_activities` e `sales_demos` guardam próximo passo e histórico estruturado.
- `sales_proposals` usa os planos reais de billing, versões e aprovação de desconto/preço customizado.
- `sales_conversion_handoffs` faz a conversão idempotente e prepara billing, onboarding e Customer Success.
- `sales_referrals` reutiliza `partner_accounts`; pagamento de comissão não é automático.
- Atribuição UTM preserva first touch e last touch sem misturar PII nos eventos de produto.

## Segurança

Todas as tabelas usam RLS e `private.sales_allowed`. O endpoint público aceita apenas campos mínimos, usa honeypot, fingerprint com hash, rate limit e apenas sugere duplicados. Automações nascem desativadas e nunca enviam mensagens; o Sales Copilot produz rascunhos com confirmação humana.

## Operação

O forecast é ponderado e sempre identificado como estimativa. Uma perda exige motivo. Registros comerciais são arquivados em vez de apagados. Alterações materiais escrevem no `superadmin_audit_logs`.

## Limitações conhecidas

- PDF profissional e aceite público por link assinado estão modelados no banco, mas a primeira interface usa proposta versionada no CRM; o envio externo permanece manual.
- Captcha é progressivo por integração futura; honeypot e rate limit já estão ativos.
- Importação atual cobre CSV seguro; XLSX reutilizará o motor da Fase 23 em uma evolução de interface.
- Comissões de parceiros são apenas preparadas.
- Onboarding só começa após o vínculo seguro do proprietário da nova organização.

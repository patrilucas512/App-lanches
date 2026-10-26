# Fase 49 — Documentos, contratos e obrigações

## 1. Diagnóstico inicial

Foram reutilizados o bucket privado `internal-work`, anexos e documentos internos, aprovação da Fase 32, documentos de fornecedores, documentos de ativos, unidades, notificações, financeiro e governança de rede. Não foi criado sistema paralelo de fornecedor, ativo, aprovação ou armazenamento.

## 2–5. Arquitetura, arquivos e migrations

`compliance_documents` centraliza metadata e aponta para versões imutáveis em `compliance_document_versions`. A migration 49 cria domínio, RLS, ACL, auditoria, facts/dimensions e cinco entitlements. API, core, interface e navegação foram adicionados em `/painel/documentos`.

## 6–16. Domínio

Documentos permitem categorias customizadas, vencimento, responsável, confidencialidade e relacionamento. Versões preservam arquivo, hash e estado do scan. Contratos, licenças, certificados, seguros, obrigações, ocorrências, lembretes, renovações e padrões internos obrigatórios possuem histórico. Notice period é calculado separadamente do término. Aprovação reutiliza `internal_approvals`.

## 17–19. Integrações e Data Platform

Fornecedor, ativo, unidade, financeiro, checklist e governança são referências às entidades existentes. IA só sugere classificação, metadata, resumo ou obrigação e exige confirmação humana com proveniência da versão. Attention items são representados por alertas deduplicados. Facts cobrem contratos, vencimentos, obrigações, renovações e aprovações.

## 20–22. Segurança, permissões e auditoria

Arquivos ficam no bucket privado e downloads usam URL assinada por cinco minutos. ACL suporta organização, região, unidade, papel e usuário, inclusive valor contratual separado. Download confidencial, versão, aprovação, renovação, dispensa e alterações são auditáveis sem registrar conteúdo completo. Não há exclusão física pela UI.

## 23. Testes

O contrato automatizado cobre os 25 testes obrigatórios e guardrails adicionais de assinatura, parecer jurídico e navegação.

## 24. Limitações

Sem assinatura jurídica completa, OCR pesado, antivírus síncrono, parecer legal, sinistros completos ou geração automática de contas a pagar. Scan e extração foram preparados como processamento assíncrono. Templates são padrões internos, não lista oficial de obrigações legais.

## 25. Recomendações para a Fase 50

Evoluir provedores de assinatura, OCR/scan assíncrono, watermark e políticas de retenção somente após definir fornecedores e governança. A Fase 50 não foi iniciada.

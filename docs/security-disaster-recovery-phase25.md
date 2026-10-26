# Runbook interno de Disaster Recovery

> Documento interno. Nunca publicar credenciais, endereços privados, tokens ou detalhes exploráveis em avisos públicos.

## Declaração de metas

RPO e RTO são metas configuráveis por organização. Só devem virar SLA depois de medição real, contrato com provedores e teste aprovado. O registro em `organization_security_settings` não constitui promessa.

## Fluxo de resposta

1. Identificar e classificar o incidente; abrir `security_incidents` separado do suporte.
2. Definir comandante, componentes afetados, impacto e canal seguro de comunicação.
3. Conter: ativar manutenção ou somente leitura; congelar writes quando necessário.
4. Confirmar integridade do último backup elegível, checksum, criptografia e retenção.
5. Restaurar primeiro em ambiente isolado. Nunca testar restore destrutivo na produção.
6. Validar autenticação, isolamento de tenants, pedidos, pagamentos, storage, filas, billing, WhatsApp, IA, integrações e fiscal.
7. Comparar amostras e invariantes; registrar inconsistências em `restore_test_runs`.
8. Reativar serviços por etapas, observar erros e manter possibilidade de rollback.
9. Comunicar clientes afetados quando necessário, sem divulgar detalhes exploráveis.
10. Resolver, registrar linha do tempo e concluir postmortem com ações e responsáveis.

## Cenários

### Banco indisponível

- Confirmar status do Supabase e conexões sem fazer retry agressivo.
- Colocar operações mutáveis em manutenção/somente leitura.
- Avaliar PITR somente se habilitado pelo provedor.
- Validar RLS, funções, contagens, pagamentos e sequência dos pedidos depois do restore.

### Storage indisponível

- Preservar referências; não substituir URLs por dados locais inseguros.
- Desativar uploads e manter leitura quando segura.
- Restaurar objetos críticos e validar hashes/metadados antes de reabrir upload.

### Região ou deploy indisponível

- Confirmar saúde de Sites/Cloudflare e Supabase separadamente.
- Usar uma versão de Sites já verificada para rollback do código.
- Failover multi-região só pode ser acionado quando a réplica e o runbook do provedor existirem e tiverem sido testados.

### Provedor crítico indisponível

- Abrir circuit breaker do conector, preservar idempotência e fila.
- Não marcar pagamento, mensagem, emissão fiscal ou entrega como concluída sem confirmação oficial.
- Reprocessar com a mesma chave idempotente após recuperação.

## Teste trimestral mínimo

- Restaurar backup em ambiente isolado.
- Validar autenticação sem expor usuários reais.
- Executar checks de tenant leakage e integridade referencial.
- Comparar contagens e checksums amostrais.
- Medir duração real e comparar com RTO/RPO configurados.
- Registrar resultado, inconsistências e ação corretiva.

## Pós-incidente

O postmortem deve conter resumo, impacto, linha do tempo, causa contribuidora, detecção, contenção, recuperação e ações. Não atribuir culpa individual. Itens exploráveis ficam em canal interno restrito.


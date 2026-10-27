# Fase 53 — Workspace e Home por função

## 1. Diagnóstico inicial
A Home antiga permanece em `/painel`; ela fazia consultas próprias extensas. A nova `/home` compõe fontes oficiais sem reescrever módulos.

## 2. Arquitetura de workspace
Contexto autenticado → resolução de função/unidade → template → política → override pessoal → filtro de permissão → dados em lote.

## 3. Arquivos criados
Migração, domínio `lib/workspace`, API, Home, design system, testes e este relatório.

## 4. Arquivos modificados
Shell ganhou Minha Home e entitlements; o pós-login administrativo direciona para `/home`.

## 5. Migrations
Registros, templates, políticas, instâncias, revisões, auditoria, uso e desempenho, todos aditivos.

## 6. Workspace resolution
Preset de sistema é base; organização, função, unidade e usuário podem sobrepor sem cópia desnecessária.

## 7. Widget Registry
Contrato seguro declara componente, fonte, permissão, escopo, tamanho, configuração, atualização e segurança para display.

## 8. Presets
Presets iniciais para proprietário, gerente, caixa, cozinha, delivery, estoque e operação padrão.

## 9. Layout engine
Ordenação determinística, largura validada, limite de widgets e normalização responsiva sem dependência pesada.

## 10. User customization
Modo de edição explícito, adicionar, remover, mover, redimensionar, salvar e restaurar.

## 11. Mandatory widgets
Política injeta obrigatórios e impede remoção, mantendo personalizações existentes.

## 12. Store/network context
Somente unidades autorizadas podem ser selecionadas; visão de rede exige acesso multiunidade.

## 13. Period context
Hoje, ontem, 7 e 30 dias; widgets podem declarar configuração própria validada.

## 14. WidgetDataService
Backend valida contrato e escopo, reúne fontes oficiais em um único lote e normaliza respostas.

## 15. Realtime
Pedidos e notificações atualizam por Realtime; fallback usa consulta moderada e pausa com aba oculta.

## 16. Caching
Chave inclui tenant, usuário, permissões, unidades, período, widget e configuração.

## 17. Mobile/tablet
Desktop usa grid, tablet reduz colunas e mobile vira pilha tocável.

## 18. Display mode
Apenas widgets `display_safe`; nenhum dado sensível é liberado só por estar no layout.

## 19. Migração dos dashboards existentes
O dashboard anterior foi preservado; widgets apontam para módulos e métricas oficiais.

## 20. Security/RBAC
Permissões são verificadas no servidor; escopo não é aceito livremente do navegador.

## 21. Observability
Tempo da Home, requisições, falhas, latência, cache, custo e saúde de widget possuem estruturas próprias.

## 22. Analytics
Facts leves de adoção e desempenho, sem guardar histórico invasivo de cada clique.

## 23. Audit
Publicação corporativa e alterações sensíveis são auditadas; movimentos pessoais usam revisões leves.

## 24. Tests
36 verificações cobrem os 30 cenários obrigatórios, segurança, integração e preservação do dashboard.

## 25. Limitations
Primeira versão não inclui link público, scripts remotos, IA autônoma ou construtor visual complexo.

## 26. Recomendações para a Fase 54
Medir uso real antes de ampliar presets e somente iniciar a próxima fase mediante instrução explícita.

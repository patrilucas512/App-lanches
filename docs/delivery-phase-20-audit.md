# Fase 20 — Consulta de auditoria

Amplia a consulta dos registros já existentes, sem regravar eventos, criar tabela ou alterar permissões. `delivery_events` oferece histórico operacional; `audit_logs` oferece ações com prefixos `delivery.` e `driver.`, incluindo políticas de repasse, ajustes, fechamentos e desativação.

O botão Consultar histórico e auditoria na Central de Entregas carrega a consulta apenas quando solicitado. Filtros por fonte e dia no horário do aparelho, paginação de 20 itens e atualização manual. Os IDs e a transição original ficam disponíveis para conferência; nomes de motoboys refletem o cadastro atual.

Cada consulta aplica o estabelecimento e usa a sessão autenticada, além das políticas RLS existentes. Nenhum metadado arbitrário, código secreto, dado de cartão ou coordenada é selecionado. Valores e motivos financeiros continuam no módulo de repasses. A tela não permite editar nem excluir logs.

Limite: esta fase não cria retroativamente eventos ausentes nem unifica todas as fontes do sistema (gateway, financeiro, GPS) em um único log. Não se deve inferir inexistência de uma ação pela ausência de registro. A trilha recente existente continua disponível sem abrir a consulta completa.

Validação: TypeScript, compilação e testes de contrato das projeções, escopo e paginação. Verificação em sessão administrativa com eventos reais, fechamento financeiro e múltiplas páginas permanece pendente. Não foram criados pedidos ou lançamentos reais para testes.

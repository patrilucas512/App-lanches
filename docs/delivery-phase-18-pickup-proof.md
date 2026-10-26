# Fase 18 — Prova de retirada

A Central de Entregas consulta os eventos `pickup_verified` existentes, inclusive após a conclusão. Não há nova tabela, migration, regravação do histórico ou mudança financeira.

Mapeamento dos conceitos solicitados:

| Conceito | Fonte existente |
| --- | --- |
| handoff_at | delivery_events.occurred_at no evento pickup_verified; deliveries.picked_up_at na operação |
| handoff_driver_id | delivery_events.actor_driver_id |
| handoff_code_verified | ocorrência do evento pickup_verified, criado somente após a validação no servidor |
| Atribuição responsável | metadata.assignment_id do evento |

A interface não presume prova pelo status atual nem pelo motoboy atualmente atribuído. Exibe o responsável do evento original. Nomes são consultados no cadastro atual; os identificadores registrados permitem conferência. Cadastros não disponíveis não recebem nomes inventados.

Consulta autenticada protegida pelas políticas RLS existentes e filtro de estabelecimento. Somente leitura, 20 registros por página, ordenação por horário e ID, filtro por dia no fuso do aparelho. O botão Atualizar recarrega os dados. Nenhum código secreto é exibido.

Verificação: compilação, TypeScript e testes de contrato do código. Ainda é necessário conferir em sessão administrativa uma retirada real com código correto, a consulta após conclusão e os filtros com múltiplas páginas. Testes de contrato não substituem esse teste ponta a ponta.

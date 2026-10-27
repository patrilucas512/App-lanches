# Fase 19 — Consulta de provas de entrega

Reutiliza os campos de `deliveries` persistidos atomicamente pela Fase 9 e preservados nas fases seguintes: `delivered_at`, `delivered_driver_profile_id`, `delivery_confirmation_method`, `delivery_pin_verified`, `delivery_verified_by`, motivo da exceção e coordenadas/precisão/horário do sinal GPS.

Nenhuma migration, alteração financeira, nova captura GPS ou mudança de permissões. A leitura utiliza a sessão autenticada e as políticas RLS existentes, com filtro explícito de estabelecimento. A Central de Entregas permanece na área administrativa.

A seção Provas de entrega possui filtros por dia (fuso do aparelho) e método, 20 registros por página e atualização manual. Mostra a identidade vinculada na conclusão, não a atribuição atual. Nomes refletem o cadastro atual; IDs persistidos permitem conferência. O PIN secreto não é consultado.

Somente método PIN com indicador de validação verdadeiro aparece como PIN validado. Registros antigos, incompletos e exceções têm textos próprios. GPS ausente não significa falha na entrega. Um sinal registrado é histórico, não posição ao vivo ou garantia de endereço exato; precisão e horário são exibidos quando disponíveis.

Validação: testes executáveis das classificações e coordenadas, testes de contrato da consulta, TypeScript e compilação. Conferência ponta a ponta com uma entrega real e uma exceção administrativa ainda pendente; nenhum pedido real foi alterado para testar esta fase.

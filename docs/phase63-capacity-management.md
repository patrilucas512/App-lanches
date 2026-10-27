# Fase 63 — Gestão de capacidade e proteção operacional

## 1. Diagnóstico inicial
O MasterApp já possuía pedidos em `orders`/`table_orders`, produção em `kitchen_tasks`, planos de produção e estações do KDS, cálculo local `KitchenCapacityService`, ETA e despacho na logística, reservas, presença da equipe, previsões e disponibilidade do catálogo. A fase adiciona coordenação e leitura unificada; nenhuma dessas fontes foi duplicada.

## 2. Arquitetura Capacity Management
Fluxo: fontes oficiais → eventos/deltas → modelos efetivos → filas derivadas → slots → promessa → políticas explicáveis. O engine é secundário e o core mantém fallback quando ele estiver indisponível.

## 3. Arquivos criados
`lib/capacity-management/core.ts`, rotas `app/api/capacity-management`, painel `app/painel/capacidade`, componente, CSS, migration, testes e este relatório.

## 4. Arquivos modificados
`components/dashboard-shell.tsx` recebeu navegação/entitlement. Copiloto e Automation Center receberam ferramentas e ações registradas. `package.json` recebeu `test:phase63`.

## 5. Migrations
A migration foi criada pela CLI oficial e não foi aplicada. Ela cria tabelas tenant-scoped, RLS, grants explícitos, índices, jobs, funções atômicas e snapshots de promessa.

## 6. Capacity models
Modelam loja, cozinha, estação, expedição, retirada, despacho, salão, zona, balcão ou recurso customizado em pedidos, itens, pontos, covers, entregas ou workload customizado.

## 7. Product workload
Perfis ligam produto/variação à estação, pontos e tempo. Origem sugerida exige revisão. Combo com perfil próprio não soma componentes novamente.

## 8. EffectiveCapacityService
Combina base, janela, equipe, estação, ativo e override. Retorna capacidade efetiva/disponível, utilização, confiança e fatores limitantes sem IA.

## 9. DemandLoadService
Separa carga comprometida de forecast ponderado. Carga real prevalece; previsão de baixa confiança nunca é motivo isolado de bloqueio.

## 10. Operational queues
São snapshots derivados de referências de tarefa/pedido. Não copiam pedidos nem substituem tickets do KDS.

## 11. Capacity slots
Guardam total, reservado, comprometido, disponível, estado e versão por recurso/janela.

## 12. Slot holds
`reserve_capacity_slot` bloqueia a linha, expira holds e impede oversubscription. Idempotência é obrigatória e TTL fica entre 30 e 900 segundos.

## 13. OrderPromiseService
Gera intervalo com preparação, expedição, despacho, viagem, fila e buffer. Baixa confiança amplia a faixa; não há falsa precisão.

## 14. Scheduled orders
Pedido agendado segue validar → hold → checkout → commit. Se o último slot for tomado, a operação retorna conflito para apresentar alternativa.

## 15. Large order policies
Definem limiar de workload, lead time, aprovação e canais. Pedido grande não é recusado sem contexto.

## 16. Channel throttling
Ações seguem a ordem: notificar, ampliar ETA, limitar slots, restringir grandes pedidos e pausar canal por último.

## 17. Hysteresis e recovery
Spike curto é ignorado. Ativação exige duração mínima; recuperação exige limiar inferior sustentado e reabertura gradual.

## 18. Order risk
Risco considera tempo restante, produção, backlog e espera de entrega. O modelo não declara atraso antes de ocorrer e não reprioriza injustamente.

## 19. Future capacity forecast
Slots futuros mostram utilização `Projected`, confiança e compromissos. A projeção não é apresentada como certeza.

## 20. Simulation
O simulador aceita apenas números controlados, roda em dry run e nunca altera operação, preço ou disponibilidade.

## 21. Catalog e KDS
Catálogo segue como disponibilidade oficial. `capacity_constrained` é condição adicional. KDS fornece tarefas, estação, batching e fila real.

## 22. Delivery e Reservations
Viagem reutiliza `DeliveryETAService`; despacho usa motoboys/backlog. Reservas e eventos geram demanda futura sem misturar capacidade de mesa e cozinha.

## 23. Workforce
Capacidade futura usa planejamento; capacidade ao vivo usa presença real. Ausência e check-in geram delta, não recálculo de rede inteira.

## 24. Campaign e Journey
Marketing e jornadas consultam a API central. Sobrecarga gera alerta ou aprovação, nunca bloqueio obrigatório e nunca perde consentimento.

## 25. Notification e Automation
Cinco eventos e cinco ações foram registrados. Alertas têm deduplicação/cooldown; ação operacional passa por registry/ActionEngine.

## 26. Incident Management
Somente indisponibilidade extrema persistente pode virar candidato a incidente. Pico normal não cria incidente.

## 27. Reporting e Workspace
Seis datasets e cinco widgets cobrem utilização, slots, filas, promessa, overrides, throttling e backlog.

## 28. Data Platform
O modelo prevê fatos de utilização, slots, filas, promessas, overrides, throttling e risco; dimensões não carregam PII.

## 29. Fallback e resiliência
Fallbacks: ETA estático, permitir loja física, desabilitar agendamento ou manter últimos slots publicados. Falha do engine não derruba PDV.

## 30. Segurança e RBAC
Nove permissões separam leitura, futuro, modelos, slots, overrides, policies, canal, simulação e rede. Pausa de canal é elevada.

## 31. Audit
Modelos, slots, throttle, pausa/reabertura, policies, ajustes e overrides geram auditoria; consultas comuns não.

## 32. Observabilidade
Jobs registram tentativas, lock, resultado e dead letter. Métricas incluem latência, conflitos, overrides, throttle, falhas, promessa e lag.

## 33. Tests
Há 30 testes cobrindo modelo, workload, capacidade, equipe, estação, demanda, slots, concorrência, promises, policies, histerese, recovery, risco, simulação, fallback, RBAC, auditoria, cache e tenants.

## 34. Limitações
Esta versão coordena e materializa capacidade e o checkout público já executa reserve/commit com hold temporário, liberação em falha e fallback conservador. Os demais canais podem adotar o mesmo contrato gradualmente. Auto-throttle nasce inativo. Calibração histórica sugere, mas não aprova peso. O worker usa polling seguro quando realtime não estiver disponível.

## 35. Recomendações para a Fase 64
Não iniciar automaticamente. Avaliar carga real por loja, ativação progressiva das flags no checkout, testes com múltiplos workers, calibração por estação e revisão humana das policies antes de ampliar automação.

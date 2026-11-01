Verificação da Fase 38 contra o banco real do `masterapp-dev`: `node scripts/dev/cx-smoke.mjs`.

O script recusa outros projetos e só cria clientes, pedidos e avaliações fictícios. Ele ativa as flags da Fase 38 na loja de teste, encerra as pesquisas ativas de execuções anteriores e deixa os dados no banco, porque a auditoria é imutável.

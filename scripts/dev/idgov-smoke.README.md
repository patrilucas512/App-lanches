Verificação da Fase 93 contra o banco real do `masterapp-dev`: `node scripts/dev/idgov-smoke.mjs`.

O script recusa outros projetos e usa só usuários fictícios `idgov.*@masterapp-dev.test`. Ele ativa as flags da Fase 93 na loja de teste, deixa concessões e auditoria no banco e termina desligando e bloqueando o usuário `idgov.funcionario`; a execução seguinte o desbloqueia.

# Runbooks da Fase 27

## Pipeline falhou

Identifique a suíte, preserve logs sanitizados, reproduza localmente e corrija a causa. Não use rerun repetido para esconder flaky. Registre o teste no catálogo quando houver não determinismo.

## Staging quebrado

Bloqueie promoção, confirme que o banco e as credenciais são exclusivos, verifique migrations e restaure o último artefato saudável. Nunca aponte staging para produção.

## Migration falhou

Interrompa a release. Não reaplique cegamente. Avalie lock, transação, estado parcial e compatibilidade. Para expand/contract, a aplicação anterior deve continuar compatível.

## Deploy falhou

Mantenha a versão anterior ativa, marque a release como `failed`, registre correlation ID e preserve o artefato. Só tente novamente após diagnóstico.

## Rollback

Congele novos deploys, solicite rollback com justificativa, obtenha aprovação e republique o artefato anterior. Banco não é revertido automaticamente: migrations expansivas permanecem até um plano de contract seguro.

## Incidente crítico

Ative deploy freeze, use kill switch do recurso arriscado, preserve pedidos/pagamentos/cozinha e associe regressão à release. Auto-rollback permanece desligado até existir baseline suficiente.


# Modelo inicial de capacidade

O banco atual não apresenta saturação: 7/60 conexões, zero bloqueios e cache superior a 99,9%. A baseline de produção registra 23.225 requisições em 24 horas, mas isso não mede o pico suportado por uma instância.

## Cenários de carga

- login e dashboard;
- pedidos simultâneos e atualização da cozinha;
- WhatsApp/web chat;
- campanhas;
- API pública;
- reservas e estoque.

O script `scripts/load-test-phase26.mjs` executa 100, 500 ou 1.000 clientes com limite explícito. Produção é bloqueada por padrão. Soak/stress devem usar ambiente isolado e registrar CPU, memória, conexões, p95, erros e crescimento da fila.

## Autoscaling

Sinais: requests/sec, CPU, queue depth, idade do job mais antigo, chamadas ativas e conexões WebSocket. Definir mínimo/máximo antes de habilitar. Uma campanha nunca recebe prioridade sobre pedidos.

## Atualização do documento

Depois de cada teste controlado, registrar commit, ambiente, dataset, concurrency, throughput, p50/p95/p99, error rate, recursos e primeiro ponto de saturação. Só então declarar “uma instância suporta X req/s”.

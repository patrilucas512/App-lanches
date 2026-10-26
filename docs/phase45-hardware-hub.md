# Fase 45 — Hardware Hub

## 1. Resultado
Hub central para dispositivos físicos, preservando o conector legado de impressoras.
## 2. Arquitetura
Domínio em `lib/hardware_hub`, API própria e painel desacoplado de pedidos, KDS, caixa, estoque e totens.
## 3. Agente local
Contrato de polling de saída; não exige porta de entrada na loja.
## 4. Registro
Token de uso único com validade de 15 minutos e credencial final exibida somente na ativação.
## 5. Credenciais
Somente hashes no banco; agente não recebe conta nem credencial administrativa.
## 6. Comandos
Whitelist fechada para imprimir, gaveta, display, balança, terminal e teste.
## 7. Bloqueios
Shell, scripts, URLs arbitrárias e acesso genérico ao sistema de arquivos são proibidos.
## 8. Replay
Idempotência por loja, TTL, expiração e tamanho máximo de 64 KB.
## 9. Dispositivos
Impressoras, gaveta, pinpad, leitores, balança e display do cliente.
## 10. Conectividade
Rede, USB, Bluetooth, serial, agente local e provedor em nuvem.
## 11. Impressão
Roteamento por documento e estação KDS, prioridade, fallback e DLQ.
## 12. Compatibilidade
`printer_devices` e `printer_jobs` continuam ativos e foram estendidos, sem recriação destrutiva.
## 13. Reimpressão
É explícita, idempotente, exige motivo e gera auditoria.
## 14. Gaveta
Abertura automática é reservada ao fluxo de dinheiro; abertura manual exige proprietário e motivo.
## 15. Terminal
Intent criado no backend, lock por terminal, estados pendente/desconhecido e reconciliação.
## 16. PCI
PAN, CVV e trilha magnética não são persistidos.
## 17. Balança
Unidades normalizadas em gramas; preço final calculado pelo backend.
## 18. Scanner
Debounce por dispositivo/código e cadastro alternativo de códigos por produto.
## 19. Display
Somente informação operacional, total e mensagens seguras.
## 20. Observabilidade
Saúde de agente/dispositivo, erros seguros, cooldown, criticidade e trilha de auditoria.
## 21. Continuidade
Falha local não aprova pagamento nem altera estado financeiro; ações podem permanecer na fila segura da Fase 44.
## 22. Permissões
Modelo previsto: view, manage, test, routing, diagnostics, agent_manage, manual drawer e terminal_manage.
## 23. Feature flags
Hardware Hub, agente local, impressão avançada, terminal e balança são controláveis por plano.
## 24. Copilot
Somente inspeciona saúde, explica falhas e sugere fallback; ações sensíveis continuam humanas.
## 25. Métricas
Disponibilidade, sucesso de comandos, falha de impressão e taxa de estado desconhecido do terminal.
## 26. Validação
30 testes cobrem segurança, idempotência, filas, dispositivos, interface e compatibilidade. A Fase 46 não foi iniciada.

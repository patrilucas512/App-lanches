# Sincronização Master App → Claude (31/10/2026)

## Fontes
- **GitHub:** `patrilucas512/App-lanches`
  - `main` (commit `0bff533`): fases 1–74 completas (app Next.js + migrações + edge functions)
  - `codex/masterapp-phase75-mdm` (commit `a750514`): fase 75 (Master Data Management)
- **Supabase:** projeto `qjwmjwubtgqginwhmajv` (sa-east-1), com 264 migrações aplicadas e as últimas aplicadas em 31/10/2026

## O que foi trazido
Este branch (`claude/sync-supabase-phase92`) parte da fase 75 e adiciona 22 migrações que **existiam só no banco** (fases 76–92), exportadas de `supabase_migrations.schema_migrations`. O md5 de cada arquivo foi conferido com o banco.

| Fase | Módulo |
|---|---|
| 76 | Governança de dados |
| 77 | Gestão de features (+ índices) |
| 78 | FinOps da plataforma (+ índices FK) |
| 79 | Policy engine (+ índices FK) |
| 80 | Governança de IA |
| 81 | Orquestração de integrações |
| 82 | Digital twin |
| 84 | Network Operations Center |
| 85 | Confiabilidade de serviço |
| 86 | Continuidade de negócios (+ índices FK) |
| 87 | Gestão de riscos corporativos (+ índices FK) |
| 88 | Gestão de mudanças + conclusão dos widgets do workspace |
| 89 | Process intelligence |
| 90 | Arquitetura corporativa |
| 91 | Gestão de portfólio |
| 92 | Gestão de fornecedores |

## Lacunas conhecidas
1. **O front-end das fases 76–92 não está no GitHub.** No banco estão as tabelas, RPCs e políticas, mas faltam as telas e os arquivos `lib/` correspondentes, que nunca receberam push. Se existirem em outro lugar (ambiente do Codex/ChatGPT, máquina local), precisam ser trazidos. Se não existirem, terão de ser reconstruídos a partir do schema.
2. **Não há fases 83 nem 57** no banco nem no repositório.
3. **Fase 71 (`supply_chain_planning`)** não tinha sido aplicada no Supabase. **Aplicada em 31/10/2026** (versão `20261031054928`); o arquivo foi renomeado para essa versão.
4. **Fase 75:** o arquivo do repositório (41.088 bytes) difere levemente do que foi aplicado no banco (41.067 bytes), provavelmente por causa do commit "fix: correct phase 75 metric seed syntax".
5. **Timestamps:** os nomes de arquivo das fases 1–75 no repositório usam timestamps diferentes das versões registradas no banco. Os arquivos das fases 76–92 usam as versões reais do banco. Antes de rodar `supabase db push`, alinhe isso (por exemplo, com `supabase migration repair`).
6. Os arquivos exportados terminam com `\n\r\n`, exatamente como estão no banco.

## Hospedagem e status (31/10/2026, 02h50)
- **SaaS em produção:** https://mesa-viva-patrilucas.patricklucas512.chatgpt.site (hospedado pelo ChatGPT/Codex; `/painel` redireciona para `/login`).
- **Landing page:** Vercel, projeto `delivery-land-page` (time `lucas-patrick`). O acesso ao time pela integração do Claude ainda precisa de autorização.
- **Banco:** fases 1–92 aplicadas, incluindo a 71. Nenhum alerta de segurança novo.
- **GitHub:** o branch `claude/sync-supabase-phase92` foi publicado. **PR #2** (https://github.com/patrilucas512/App-lanches/pull/2) aguarda merge no `main`.
- **Build/typecheck:** não foi possível rodar no ambiente do Claude (sem acesso ao registro do npm).

## Agente IA (Atendente IA)
Faz parte do mesmo app: painel em `app/painel/atendente-ia`, `components/ai-attendant-manager.tsx` e `lib/ai-attendant/`, além das fases de WhatsApp/IA (`whatsapp_ai_attendant_phase2`, `whatsapp_ai_management_phase6`, `manager_copilot_phase9`, `phase80_ai_governance`). As edge functions de WhatsApp estão em `supabase/functions/`.

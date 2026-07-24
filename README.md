# Mesa Viva

Plataforma SaaS multiempresa para cardápios digitais, pedidos e gestão de restaurantes.

## O que já está implementado

- landing page e página de planos;
- autenticação com Supabase e onboarding do estabelecimento;
- isolamento multi-tenant com PostgreSQL RLS;
- papéis `owner`, `manager`, `attendant` e `catalog_editor`;
- painel, catálogo, pedidos, equipe e assinatura;
- cardápio público em `/loja/:slug`, carrinho e pedido atômico;
- limites de produtos e equipe por plano;
- Stripe Checkout, Customer Portal e webhooks idempotentes;
- painel reservado para superadministrador.

## Desenvolvimento

Copie `.env.example` para `.env.local`, configure as credenciais e execute:

```bash
pnpm install
pnpm dev
```

As migrações versionadas estão em `supabase/migrations`.

## Segurança

Decisões de autorização e cobrança são validadas no servidor ou no PostgreSQL. As tabelas expostas usam RLS, e o cardápio público acessa somente RPCs com campos explicitamente permitidos.

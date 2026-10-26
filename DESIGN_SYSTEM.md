# MasterApp Admin Design System

Base visual da modernização incremental do painel administrativo. Estes estilos são isolados pela classe `.admin-theme` e não alteram o cardápio público, cozinha, caixa ou autenticação até a refatoração do layout global.

## Direção visual

- Fundo: preto e grafite profundo.
- Superfícies: cartões escuros com borda discreta.
- Destaque: laranja para ações, preços, switches e estados importantes.
- Texto: branco quente, reduzindo o contraste agressivo do branco puro.
- Títulos: Manrope em peso forte, caixa alta e espaçamento compacto.
- Corpo: Manrope com alta legibilidade.

## Tokens principais

| Token | Valor | Uso |
| --- | --- | --- |
| `--admin-bg` | `#090907` | Fundo do painel |
| `--admin-surface` | `#131310` | Cards e modais |
| `--admin-surface-raised` | `#1a1a16` | Campos e áreas elevadas |
| `--admin-accent` | `#ff5a1f` | Ações, preços e destaques |
| `--admin-text` | `#f7f3eb` | Texto principal |
| `--admin-muted` | `#aaa399` | Texto secundário |
| `--admin-success` | `#59ce8f` | Sucesso e ativo |
| `--admin-danger` | `#f56b6b` | Exclusão e erro |

## Escala

- Espaçamento: 4, 8, 12, 16, 20, 24, 32 e 40px.
- Raios: 8, 12, 16 e 20px.
- Alvo mínimo de toque: 44px.
- Container administrativo: máximo de 1480px.
- Grid de produtos: 4, 3, 2 ou 1 coluna conforme o espaço.

## Componentes disponíveis

O arquivo `components/admin-ui.tsx` contém:

- `AdminButton`
- `AdminField`
- `AdminInput`
- `AdminTextarea`
- `AdminSelect`
- `AdminBadge`
- `AdminCard`
- `AdminSwitch`
- `AdminModal`
- `AdminEmptyState`
- `AdminSkeleton`

## Acessibilidade

- Foco visível em laranja.
- Contraste adequado em superfícies escuras.
- Switch com `role="switch"` e estado anunciado.
- Modal com `role="dialog"`, `aria-modal`, fechamento por Escape e clique externo.
- Estados de erro anunciados com `role="alert"`.
- Respeito a `prefers-reduced-motion`.

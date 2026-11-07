# 0009. Início em `/` e catálogo em `/catalog`

- **Data:** 2026-11-07
- **Status:** Aceito
- **Tipo:** feature

## Contexto
A página inicial era o catálogo, sem lugar para criar projetos nem ver os recentes.

## Decisão
- Nova tela Início em `/`; o catálogo foi para `/catalog` (links do runtime ajustados).
- Criar Mini app abre o editor como "App sem título" (como no Figma); Formulário e Workflow aparecem "Em breve".
- O que cada papel pode fazer fica na barra lateral (`navItems`), com contador de aprovações.

## Consequências
- Links antigos para `/` levam ao Início, não ao catálogo.
- Nomes "sem título" repetidos são aceitos: o slug ganha sufixo único.

**Arquivos:** `web/src/app/features/home/`, `web/src/app/app.routes.ts`, `web/src/app/shell.ts`

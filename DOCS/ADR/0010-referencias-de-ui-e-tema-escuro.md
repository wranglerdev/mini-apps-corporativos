# 0010. Referências de UI por área e tema claro/escuro

- **Data:** 2026-11-07
- **Status:** Aceito
- **Tipo:** ui

## Contexto
A UI estava sem identidade clara e cada área do produto lembra uma ferramenta diferente que os usuários já conhecem.

## Decisão
- Base Linear/Vercel (Geist, neutro, cor só para ação); Início = Figma; editor = moldura Figma + paleta Bubble; automações = nós n8n; execuções = waterfall trigger.dev; formulário = Typeform.
- Tokens com versão escura em `ui.css`; `ThemeService` alterna sistema/claro/escuro (`data-theme`).
- Editor em tela inteira (`app-page width="tool"` + `app-toolbar`); a barra lateral recolhe no editor.
- Status viraram pílula com ponto (antes, carimbo inclinado).

## Consequências
- Telas só podem usar tokens (cor fixa quebra o tema escuro).
- Fontes trocadas (ver `DEPENDENCIAS.md`); ícones num mapa único em `UiIcon`, fácil de trocar pelo design system.
- Tabela completa em `PRD.md` > Referências de UI.

**Arquivos:** `web/src/app/ui/ui.css`, `web/src/app/ui/ui.ts`, `web/src/styles.css`, `web/src/app/layout/layout.ts`, `web/src/app/shell.ts`

# 0016. Aba do editor na URL (`?aba=`)

- **Data:** 2026-11-08
- **Status:** Aceito
- **Tipo:** ui

## Contexto
As abas do editor (mini app, formulário, workflow) eram só estado do componente: reload ou link compartilhado
sempre abria a primeira aba.

## Decisão
- A aba ativa vai no query param `?aba=` de `/builder/:id` (ex.: `/builder/{id}?aba=execucoes`), lido via
  `withComponentInputBinding` como input do `EditorPage`. Trocar de aba usa `replaceUrl` (não enche o histórico).
- Abas por tipo e a regra "aba inválida ou de outro tipo → primeira do tipo" ficam em `editor-ops.ts`
  (`EDITOR_TABS`, `editorTab`), testadas em `editor-ops.spec.ts`.
- Descartado: segmento de rota (`/builder/:id/:aba`), que pede rota nova sem ganho; `localStorage`, que não vale
  para link compartilhado.

## Consequências
- Reload e link abrem na mesma aba; o "Voltar" do navegador sai do editor em vez de percorrer abas.
- Estado interno das abas (página/componente selecionado, execução aberta) continua fora da URL.

**Arquivos:** `web/src/app/features/builder/editor-page.ts`, `web/src/app/features/builder/editor-ops.ts`,
`web/src/app/features/builder/editor-ops.spec.ts`

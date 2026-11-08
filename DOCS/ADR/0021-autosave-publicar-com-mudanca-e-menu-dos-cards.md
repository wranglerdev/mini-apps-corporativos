# 0021. Salvamento automático, publicar só com mudança e menu nos cards

- **Data:** 2026-11-08
- **Status:** Aceito
- **Tipo:** ui

## Contexto
O rascunho só era salvo no botão "Salvar" (ou ao publicar/testar), "Publicar" criava versão nova mesmo sem mudança, e
os cards da Início só abriam o editor (duplicar/excluir ficavam em Meus apps).

## Decisão
- **Salvamento automático**: 2,5 s depois da última edição (`AUTOSAVE_MS`), sem banner e sem travar os botões; o selo do
  editor mostra "Não salvo", "Salvando…" ou "Erro ao salvar" (motivo no tooltip). Um contador de edições impede que a
  resposta de um salvamento apague o que foi digitado enquanto ele ia ao servidor (a edição fica pendente e salva depois).
- **Publicar** desliga quando não há o que publicar (`hasUnpublishedChanges`: sem edição pendente e rascunho salvo igual à
  versão em produção, comparando o JSON que vem do mesmo serializador). Só no front: o backend continua aceitando.
- **Menu dos cards** (Início, quem gerencia): botão direito ou botão ⋯ abrem o `ui-menu` (primitiva nova em `ui/ui.ts`,
  posição com `placeBelow`): Editar, Abrir versão publicada (mini app/formulário), Duplicar, Excluir com confirmação no
  próprio menu (sem `confirm()` do navegador). Esc, clique fora ou rolar fecham; setas andam entre os itens.

## Consequências
- Erro de validação no rascunho (ex.: nome de variável inválido) não salva até ser corrigido; o selo avisa.
- Quem trocar o design system reimplementa também o `ui-menu` (ver TROCA-DE-ADAPTADORES).

**Arquivos:** `web/src/app/features/builder/editor-page.ts`, `web/src/app/features/builder/editor-ops.ts`, `web/src/app/ui/ui.ts`,
`web/src/app/ui/ui.css`, `web/src/app/ui/placement.ts`, `web/src/app/features/home/home.ts`, `web/src/app/features/home/home-page.ts`

# 0020. "Catálogo" vira "Biblioteca", com os templates

- **Data:** 2026-11-08
- **Status:** Aceito
- **Tipo:** ui

## Contexto
A página `/catalog` ("Catálogo") listava os apps publicados liberados para o departamento; os templates ficavam em
"Meus apps". O nome "Catálogo" passa a ser a próxima feature (dados enviados entre os apps num só lugar, card "Em breve"
na Início), e templates e apps publicados são a mesma ideia: coisas prontas para usar ou copiar.

## Decisão
- A página vira **Biblioteca** em `/biblioteca` (`LibraryPage`): **Templates** (só builders: "Usar template" cria a cópia no
  workspace escolhido e abre o editor) e **apps publicados** liberados para o departamento (abrir/clonar).
- `/catalog` redireciona para `/biblioteca` (links salvos continuam valendo). Menu lateral, Início, volta do app rodando e
  textos do editor ("Mostrar na Biblioteca") usam o nome novo.
- "Meus apps" perde a seção de templates (o seletor "Começar de" do formulário de novo app continua).
- Sem migração: o campo `InCatalog`, `GET /api/apps/catalog` e `GET /api/apps/templates` mantêm os nomes.

## Consequências
- "Catálogo" fica livre para a feature nova.
- Nomes internos (`inCatalog`, `api.catalog()`) não batem com o texto da tela; trocar exigiria migrar dados sem ganho agora.

**Arquivos:** `web/src/app/features/pages.ts`, `web/src/app/app.routes.ts`, `web/src/app/shell.ts`, `web/src/app/ui/ui.ts`,
`web/src/app/features/builder/apps-page.ts`, `web/src/app/features/builder/editor-page.ts`, `web/src/app/features/home/home-page.ts`,
`web/src/app/features/runtime/app-runner.ts`

# 0022. Mini app publicado em tela limpa, para o usuário final

- **Data:** 2026-11-08
- **Status:** Aceito
- **Tipo:** ui

## Contexto
O mini app publicado (`/run/{slug}`) abria dentro da moldura da plataforma: barra lateral, migalha "Biblioteca" e chip
"versão N". Isso é visão de quem constrói o app; o usuário final daquela página não precisa disso.

## Decisão
- `/run/` entra em `isBareRoute` (como o formulário respondido): sem barra lateral, em tela inteira.
- O cabeçalho do app publicado mostra só o título e "Imprimir página": sem migalha nem versão.
- O preview do rascunho (`/preview/{id}`) não muda: continua na moldura, com migalha "Editor" e selo "Rascunho".

## Consequências
- Para voltar à plataforma a partir do app publicado, o usuário usa o navegador (ou um link/ação do próprio app).
- Rotas bare não buscam o contador de aprovações.

**Arquivos:** `web/src/app/shell.ts`, `web/src/app/shell.spec.ts`, `web/src/app/features/runtime/app-runner.ts`, `web/src/styles.css`

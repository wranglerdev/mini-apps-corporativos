# 0023. Seed de demonstração com cenário corporativo

- **Data:** 2026-11-08
- **Status:** Aceito
- **Tipo:** feature

## Contexto
O banco subia com dois apps copiados de templates e sem dados, o que não bastava para apresentar o produto: faltavam
formulários, workflows, aprovações, respostas e execuções. Montar isso à mão antes de cada demo não escala.

## Decisão
- `Showcase` (`SeedShowcase.cs`) define 11 projetos em RH, TI e Financeiro (mini app, formulário e workflow em cada área),
  com dados de produção (copiados no rascunho), aprovações pendentes e decididas, versões, contadores de formulário e auditoria.
- Os projetos se chamam (Onboarding → Boas-vindas, Reembolso aprovado → Pagamento, webhook → Alertas), com Ids gerados no seed.
- As execuções de workflow entram na fila como `queued` e o worker as executa ao subir a API: o histórico é real, não
  inventado. Uma delas falha de propósito (lista inválida no "para cada") para mostrar a reexecução.
- Datas são relativas ao dia em que o banco é criado, para a demo não envelhecer.
- `marina@corp.local` (builder do Financeiro) entra em `mock-auth.json`, para o Financeiro ter quem gerencie.
- Junto: a tabela do app mostra data e número em pt-BR (como o PDF) e "Resolvido", "Aberto" e "Em andamento" viram carimbo.

## Consequências
- `SeedTests` garante que todo projeto valida, que os registros passam no `RecordValidator` e que as entradas das
  execuções batem com o gatilho: o seed quebrado falha no teste, não na subida da API.
- O seed ficou maior (um arquivo só de dados). No ambiente corporativo ele não roda: o banco real começa vazio ou com o
  seed só da Biblioteca.

**Arquivos:** `api/src/Infra/Persistence/SeedShowcase.cs`, `api/src/Infra/Persistence/Seed.cs`, `api/tests/Tests/SeedTests.cs`, `mock-auth.json`, `web/src/app/features/runtime/data-blocks.ts`

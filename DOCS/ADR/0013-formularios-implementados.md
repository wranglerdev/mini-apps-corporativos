# 0013. Formulários dentro do AppDefinition, com tipo derivado e link público limitado

- **Data:** 2026-11-07
- **Status:** Aceito
- **Tipo:** feature

## Contexto
O MVP do PRD-FORMS precisava sair sem migrations (o banco usa `EnsureCreated`) e reaproveitar o que já existe: publicação, versões, tabela, exportação e automações.

## Decisão
- `AppDefinition.Form` (perguntas → campos de uma tabela de respostas). `App.Kind` é **derivado** dele: sem coluna nova nem migração. Descartado: coluna `Kind` (exigiria apagar o banco de dev).
- Lógica de pulo sobre a resposta da própria pergunta, só para frente (sem ciclos). Mesma regra em `FormFlow` (back) e `form-flow.ts` (front); o servidor recalcula o caminho no envio.
- Link público opcional: usuário opcional no `FormService`, `anonimo` sem login, limite nativo do ASP.NET Core por usuário ou IP, `Forms:AllowPublic` para a governança.
- Contadores (abriu, chegou à pergunta) numa porta nova, `IFormCounters`, com tabela criada por `CREATE TABLE IF NOT EXISTS`.

## Consequências
- Formulário herda versões, rollback, permissões, exportação e automações sem código novo.
- O front sobe sem login (user = null) para o link público; o SSO corporativo precisa liberar `/f/*` e `/api/forms/*`.
- Limite em memória vale por instância; em várias instâncias, usar gateway ou limitador distribuído.
- Pergunta de arquivo fica fora da paleta até haver envio de arquivo sem login.

**Arquivos:** `api/src/Domain/Forms/`, `api/src/Api/Program.cs`, `web/src/app/features/forms/`, `DOCS/PRD-FORMS.md`

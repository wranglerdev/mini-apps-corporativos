# CLAUDE.md — Mini apps

MVP de plataforma low-code corporativa (clone simplificado do Bubble). Front Angular 20 em `web/`,
back .NET 10 em `api/`. Documentação em `DOCS/` (PRD, arquitetura, dependências, troca de adaptadores, TDD, histórico de decisões em `DOCS/ADR/`).

## Comandos

```bash
cd api/src/Api && dotnet run      # API em http://localhost:5072 (cria data/app.db + seed)
cd web && npm start                          # http://localhost:4200 (proxy /api → 5072)
cd api && dotnet test                        # testes backend
cd web && npm test                           # testes frontend (ChromeHeadless)
```

Resetar dados: apagar `api/src/Api/data/`.

## Filosofia (obrigatório)

- **YAGNI e KISS.** Implementar a forma mais simples que atende a jornada. Nada de abstração "para o futuro"
  além das portas já existentes. Na dúvida, não adicione.
- **Mínimo de dependências.** Antes de adicionar pacote, tente BCL/.NET, APIs do navegador ou Angular.

## Versões travadas (obrigatório)

- **NUNCA migrar o Angular nem o .NET para outra versão.** O projeto é Angular 20 e .NET 10 e continua assim.
  Não rodar `ng update` de major, não trocar `TargetFramework`, não subir pacotes `@angular/*`, `@angular/build`,
  `@angular/cli`, `typescript` ou `Microsoft.*`/EF Core para versões de outra major, mesmo que `npm outdated` ou
  `dotnet list package --outdated` sugiram. Atualização de patch/minor dentro da mesma major só com pedido explícito.

## Regras de arquitetura (obrigatório)

1. Backend em camadas: `Api` (controllers finos + `CompositionRoot`) → `Domain` (regras + portas) ← `Infra` (adaptadores).
   **`Domain` não referencia nenhum pacote nem outro projeto.**
2. Toda integração externa entra por uma **porta** em `Domain/Ports.cs` (ou `Identity.cs` para auth) e um
   **adaptador** registrado **somente** em `api/src/Api/CompositionRoot.cs`.
3. Regras de acesso ficam em `AccessRules` (back) e espelhadas em `core/auth/auth.ts` (front, só para UI).
   Serviços de domínio sempre checam acesso; controllers não.
4. Front: HTTP **somente** via `core/api.ts`; auth **somente** via a porta `AuthService`; componentes visuais
   **somente** via `ui/ui.ts` (`UI`). Não use elementos nativos estilizados nem libs de UI nas features.
   **Toda tela** segue a estrutura de `layout/layout.ts` (`LAYOUT`): `<app-page>` (largura + aviso) →
   `<app-page-header>` (migalha, título, `[meta]`, `[actions]`; em telas `width="tool"` use `<app-toolbar>`) → `<app-section>` (title/description, `[actions]`;
   `layout="card|plain|aside"`) e `<app-empty>` para vazios. Não crie cabeçalhos/espaçamentos próprios por tela;
   se faltar algo, evolua a primitiva. Ações destrutivas de uma seção vão no `[actions]` dela.
5. Angular moderno: standalone, `signal/computed/linkedSignal`, `input()/output()/model()`, `inject()`,
   `@if/@for/@switch/@let`, zoneless. Sem NgModules, sem `@Input()`/`@Output()` decorators, sem FormsModule.
   Templates Angular não aceitam arrow functions: crie métodos.
6. Usuário de dev é definido **somente** em `mock-auth.json` (raiz), lido por `api/src/Api/Auth/MockUserProvider.cs`.
   Não criar troca de usuário/adaptador pela UI. Front só lê `/api/me` (`core/auth/dev-auth.ts`).
   E-mail é só log (`LogEmailSender`).
7. Condições têm duas implementações que DEVEM se comportar igual: `Conditions.Evaluate` (backend, workflows) e
   `web/src/app/features/runtime/visibility.ts` (front, visibilidade). Mudou uma, mude a outra e os dois testes.
   O mesmo vale para o caminho do formulário: `FormFlow` (`api/src/Domain/Forms/FormDefinition.cs`) e
   `web/src/app/features/forms/form-flow.ts` (testes `FormTests` e `form-flow.spec.ts` usam a mesma pesquisa).
8. Sem nome de produto em nomes de arquivo/projeto/namespace (`Api`, `Domain`, `Infra`, `Tests`). O nome exibido
   no front está só em `PRODUCT_NAME` (`web/src/app/app.ts`).

## Manutenção dos DOCS (obrigatório, no mesmo change)

- Adicionou/removeu/atualizou dependência → atualizar `DOCS/DEPENDENCIAS.md` (pacote, versão, arquivos onde é usado, motivo).
- UI: identidade visual (tokens claro/escuro, tipos, pílulas de status) definida em `web/src/app/ui/ui.css`; layout em `web/src/styles.css`.
  Referências por área (Linear/Vercel, Figma, Bubble, n8n, trigger.dev, Typeform) na tabela "Referências de UI" de `DOCS/PRD.md`.
  Sem cores fixas nas telas: só tokens (o tema escuro depende disso).
  Ao mexer em tela, conferir com prints (Chrome headless/CDP) em desktop e 390px.
- Criou/alterou porta, adaptador, registro no `CompositionRoot`, wrapper de `ui/` ou ponto marcado `[TROCA]`
  → atualizar `DOCS/TROCA-DE-ADAPTADORES.md` com os arquivos impactados.
- Mudou escopo/feature → atualizar a tabela de status em `DOCS/PRD.md`.
- Mudou estrutura/fluxo → `DOCS/ARQUITETURA.md`.
- Decisão entre alternativas, refactor amplo, dependência/porta/adaptador, feature ou UI relevante → ADR curto em
  `DOCS/ADR/` + linha no índice (skill `adr`). ADR aceito não se reescreve: decisão nova substitui a antiga.

## Testes (TDD)

- Só unitários, por jornada do usuário (ver `DOCS/TDD.md`). Nova regra de jornada = teste antes/junto.
- Back: testar o Domain com os fakes de `tests/Tests/Fakes.cs` (sem Moq, sem banco).
- Front: lógica em funções puras/serviços (`editor-ops.ts`, `auth.ts`, `RunContext`) e testar ali; componentes
  só quando a jornada depende do template (ex.: formulário gerado).
- `dotnet test` e `npm test` devem passar antes de concluir qualquer tarefa.

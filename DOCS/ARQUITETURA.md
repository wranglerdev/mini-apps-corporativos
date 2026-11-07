# Arquitetura

```
mock-auth.json   usuário logado em dev (lido pelo MockUserProvider)
web/  (Angular 20, standalone, signals, zoneless, control flow @if/@for)
  └─ /api (proxy dev) ──►  api/  (.NET 10)
                            Api     → Controllers finos + CompositionRoot + mock de auth
                            Domain  → Entidades, regras (RBAC, validação, workflows), PORTAS (interfaces)
                            Infra   → ADAPTADORES: EF Core/SQLite (repositories), e-mail log, HTTP, arquivos
                            Tests   → xUnit sobre o Domain com fakes em memória
```

Regra de dependência: `Api → Domain ← Infra`. **Domain não referencia nada** (nem EF, nem ASP.NET).

## Modelo de dados

Um app é **um documento JSON** (`AppDefinition`: páginas, tabelas, workflows). Isso simplifica tudo:

| Conceito | Implementação |
|---|---|
| Rascunho | `App.Draft` |
| Produção | `App.Published` + `App.PublishedVersion` |
| Versão | `AppVersion` (cópia imutável da definição) |
| Template / clone | cópia de `Draft` para outro app |
| Registros | `DataRecord { AppId, Env, TableId, Data (JSON) }` — `Env` separa dados de rascunho e produção |
| Workflow | `AppDefinition.Automation` + um `WorkflowDef` cujos passos (`ActionDef`) formam árvore (`Steps`/`Else`). `App.Kind` = `workflow` |
| Formulário | `AppDefinition.Form` (`FormDef`: perguntas → campos de uma tabela de respostas). `App.Kind` = `form` quando existe (derivado, sem coluna) |

Tabelas SQLite: `Workspaces`, `Apps`, `AppVersions`, `Records`, `Approvals`, `AuditEntries`, `ScheduleStates`, `FormCounters`,
`WorkflowRuns`, `RunSteps`, `Secrets` (as quatro últimas também criadas com `CREATE TABLE IF NOT EXISTS` no `InitDatabase`, para bancos antigos).

## Fluxos principais

- **Abrir app**: `AppService.OpenAsync(appId, env)` / `OpenPublishedAsync(slug)` resolve `AppScope`
  (app, workspace, definição do ambiente, `CanManage`) **já com a checagem de acesso**. Records e workflows
  sempre partem dele.
- **CRUD**: `RecordService` → `AccessRules.CanWrite/VisibleFields` → `RecordValidator.Normalize` → repositório →
  auditoria → `WorkflowEngine.RunTriggersAsync` (recordCreated/recordUpdated).
- **Workflow de clique**: botão → `POST /api/apps/{id}/{env}/workflows/{wf}/run` com os inputs da página →
  `WorkflowResult { navigateTo, log }` aplicado pelo `RunContext` no front.
- **Layout**: `PageDef.Components` é uma árvore; só `container` tem `Children` (grade própria de 12 colunas, até 4 níveis,
  validado em `AppDefinition.Validate`). No editor, `editor-ops.ts` opera por id (`findComponent`, `insertComponent(…, parentId)`,
  `moveComponent(id, parentId, index)`) e a `DesignTab` desenha a árvore com um `ng-template` recursivo; no runtime,
  `RenderedComponent` se renderiza recursivamente.
- **Canvas do editor** (`builder/design-tab.ts`): prévias realistas (o `RenderedComponent` em modo design monta formulário,
  tabela, lista e gráfico com dados de exemplo tirados do schema), marcador "Soltar aqui" e guias de coluna só durante o
  arraste, barra de ações no item selecionado, painel Estrutura (árvore) + caminho do item, prévia Computador/Celular e
  atalhos (Delete, Ctrl+D, Alt+↑/↓, Esc). A grade usa `@container` (não `@media`): reage à largura da folha/área de
  conteúdo, por isso a prévia de celular é fiel ao app.
- **Visibilidade condicional**: `ComponentDef.VisibleWhen` (mesmo formato de `ConditionDef`) é avaliado no navegador por
  `runtime/visibility.ts` (espelho de `Conditions.Evaluate` do backend) com as variáveis do `RunContext`: inputs da página +
  `user.role/department/email/canManage`. Componente oculto não é renderizado; filhos de container oculto também não.
- **Encadeamento de workflows**: `WorkflowEngine` carrega `depth`; `createRecord`/`updateRecord` chamam `RunTriggersAsync`
  (registro criado/atualizado) e `runWorkflow` chama `RunAsync` com `depth + 1`; acima de `MaxChainDepth` (5) a cadeia para.
  `ApprovalService.DecideAsync` dispara "registro atualizado" após gravar o status.
- **Agendados**: `ScheduledWorkflowsHostedService` (Api) chama `ScheduledWorkflowService.RunDueAsync(now)` a cada minuto;
  o domínio calcula `Schedule.NextRun` e guarda a última execução em `IScheduleStore` (tabela `ScheduleStates`).
- **Webhook de entrada**: `POST /api/hooks/{app}/{tabela}` → `RecordService.ReceiveWebhookAsync` →
  `AppService.OpenForIntegrationAsync` (versão publicada, sem usuário) → valida a chave (tempo constante) →
  grava como usuário técnico `webhook` → workflows de "registro criado".
- **Renomear campo**: `AppDefinition.FieldRenames(antes, depois)` compara campos pelo Id; `AppService` chama
  `IRecordRepository.RenameFieldsAsync` no rascunho (ao salvar) e na produção (ao publicar/rollback).
- **Consultar registros**: `GET .../records?q=&page=&size=` → `RecordService.QueryAsync` (decide os campos
  pesquisáveis = visíveis para o usuário, limita `size` a 100) → `IRecordRepository.QueryAsync` filtra/pagina no banco.
  No SQLite: `json_each` sobre a coluna JSON `Data` + função `norm()` registrada por `SqliteFunctions` (mesma regra de
  `TextSearch.Normalize` do domínio). Gráficos: `GET .../records/summary?groupBy=` → `CountByAsync` (`json_extract` + `GROUP BY`).
  No front, `useRecordPage` (run-context) refaz a consulta ao mudar busca/página ou após escrita e descarta respostas
  atrasadas; a busca espera 300 ms sem digitação (`debounced`).
- **Exportar/importar**: `GET .../records/export?format=xlsx|pdf|csv` → `RecordService.ExportAsync` (campos visíveis;
  xlsx/csv com valores crus e reimportáveis; PDF com `ReportDocument` legível: gráficos `ReportChart` vindos dos componentes "Gráfico" da tabela, células com quebra de linha) → `ISpreadsheet`/`IPdfReport`.
  `POST .../records/import` (multipart) detecta `.xlsx` pela assinatura zip, senão lê CSV.
- **Anexos**: `/api/apps/{app}/{env}/files` → `FileService` checa acesso ao app/ambiente → `IFileStorage` com scope = app.
- **Formulário**: `/f/{slug}` → `GET /api/forms/{slug}` (`FormService.OpenAsync`: login + departamento, ou link público se
  `Form.Public` e `Forms:AllowPublic`; sem login = `SystemUsers.Anonymous`) → o front navega com `form-flow.ts` → `POST
  /api/forms/{slug}/responses` → `FormService` recalcula o caminho (`FormFlow.Path`), valida só as perguntas dele e chama
  `RecordService.InsertFormResponseAsync` (grava, audita `form.submit`, dispara `recordCreated`). Contadores: `POST .../events`
  (`open`, `q:{id}`) → `IFormCounters`; resumo em `GET /api/apps/{id}/form/stats`. Rascunho: `/api/apps/{id}/form/draft`.
  Rotas `/api/forms/*` têm limite (`AddRateLimiter` em `Program.cs`: por usuário logado ou por IP).
- **Workflow (projeto)**: gatilho (manual `POST /api/apps/{id}/{env}/runs`, agendador, webhook `POST /api/hooks/wf/{id}`) só
  **enfileira** (`FlowService.EnqueueAsync` → `IRunStore`, status `queued`). `FlowWorkerHostedService` chama
  `FlowRunner.ProcessNextAsync` a cada segundo: abre a definição do ambiente, carrega `{{secrets.*}}` (`ISecretStore`) e percorre
  a árvore de passos — "se", "para cada" (itens como trechos), "esperar", "transformar" e ações (`WorkflowEngine.ExecuteActionAsync`,
  o mesmo código das automações de mini app) com tentativas, espera crescente e tempo limite. Cada trecho vira um `RunStep`
  (entrada/saída mascaradas e truncadas); a saída do passo entra no contexto como `steps.<id>.*` (`JsonVars`). Falha em produção
  manda e-mail a quem criou. Reexecução a partir de um passo reaproveita as saídas da execução de origem.
- **Aprovação**: ação `requestApproval` grava `Approval` + status "Pendente" no registro + e-mail;
  `ApprovalService.DecideAsync` atualiza registro, notifica solicitante e audita.

## Frontend

```
src/app/
  core/            api.ts (único cliente HTTP), models.ts, auth/ (porta AuthService, interceptor, guards, RBAC)
    auth/dev-auth.ts  DevAuthService: lê /api/me (usuário vem de mock-auth.json no backend)
  ui/              DESIGN SYSTEM: ui.ts (wrappers) + ui.css (tokens/estilos)
  layout/          ESTRUTURA DAS TELAS: app-page, app-page-header, app-toolbar, app-section, app-empty (desenham com ui/)
  app.ts + shell.ts  MOLDURA: barra lateral (navItems por papel, contador de aprovações, recolhe no editor) e ThemeService
  features/
    home/          home-page (Início em `/`) + home.ts (tipos de projeto, recentes, miniatura, link por tipo; regras puras)
    flows/         flow-tab (editor de passos), runs-tab (execuções + waterfall), secrets-tab; flow-ops.ts (árvore de passos,
                   variáveis, linha do tempo; regras puras)
    forms/         form-runner (/f/:slug e /f-preview/:id), question-view, abas do editor (form-tab, form-responses-tab,
                   form-share-tab); form-flow.ts (caminho, espelho de FormFlow) e form-ops.ts (editor) são regras puras
    builder/       apps-page, editor-page, design/data/workflows tabs, editor-ops.ts (regras puras do editor)
    runtime/       app-runner (modo usuário), run-context, form-block, data-blocks, rendered-component
    pages.ts       catálogo (`/catalog`), aprovações, admin
```

- Layout padronizado: toda tela é `app-page` → `app-page-header` → `app-section`s. Larguras: `default` (1120px, leitura),
  `wide` (editor e app em execução), `narrow` (760px). Estilos da estrutura ficam em `styles.css` ("Layout"); no celular
  a barra lateral vira barra superior com navegação rolável e grades viram uma coluna (`minmax(0, 1fr)`, sem rolagem lateral).
- Telas de ferramenta (editor): `app-page width="tool"` + `app-toolbar` (voltar, nome editável, abas, ações). A moldura
  recolhe a barra lateral (`isToolRoute`) e a área abaixo da barra ocupa a altura da janela; Design e Automações usam
  `.editor` (painel esquerdo, `.canvas`, painel direito), Dados e Publicação rolam em `.tool-scroll`.
- Automações no editor: nós em coluna (`workflows-tab`), resumo de cada nó por funções puras (`triggerSummary`,
  `conditionSummary`, `actionSummary` em `editor-ops.ts`).
- Miniatura do Início: `AppSummary.sketch` (backend) = tipo e largura dos 8 primeiros componentes da 1ª página
  (rascunho para quem gerencia, publicada no catálogo); o front desenha os blocos em CSS (`sketchBlocks`).
- Tema: tokens em `ui.css` com versão escura; `ThemeService` grava `data-theme` em `<html>` (ou nada = segue o sistema)
  e `index.html` aplica o tema salvo antes do bootstrap.
- Estado com `signal`/`computed`/`linkedSignal`; edição da definição sempre por `structuredClone` + `set`.
- `RenderedComponent` é usado tanto no canvas do editor (`design=true`, placeholders) quanto no runtime.
- Rotas builder/runtime são lazy (`loadComponent`).

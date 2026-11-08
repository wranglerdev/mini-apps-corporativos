# Troca de adaptadores (migração para o ambiente corporativo)

Todo ponto de troca está marcado no código com `[TROCA]` ou com o cabeçalho "PORTA"/"ADAPTADOR".
Busque: `grep -rn "\[TROCA\]\|PORTA\|ADAPTADOR" api/src web/src`.

O domínio (`Domain`) e as features do front **não mudam** em nenhuma das trocas abaixo.

## Autenticação (lib interna / SSO)

**Hoje (dev):** o usuário logado é o `currentUser` de `mock-auth.json` na raiz. O backend relê o arquivo a cada
request: edite, salve e recarregue a página. Não há troca de usuário pela UI.

| Camada | Arquivo | O que fazer |
|---|---|---|
| Porta (back) | `api/src/Domain/Identity/Identity.cs` → `IUserProvider.GetCurrentUser()` | Manter. É o equivalente ao `obterUsuario` da lib interna |
| Adaptador (back) | `api/src/Api/Auth/MockUserProvider.cs` | **Apagar a pasta `Auth/`**. Criar `CorpUserProvider : IUserProvider` que chama a lib interna e mapeia perfil → `Role` (admin/builder/user) e unidade → `Department` |
| Config do mock | `mock-auth.json` (raiz) + chave opcional `MockAuth:File` no appsettings | **Apagar** |
| Registro (back) | `api/src/Api/CompositionRoot.cs` | Trocar `AddScoped<IUserProvider, MockUserProvider>()`; adicionar middleware de autenticação da lib em `Program.cs` se houver |
| Porta (front) | `web/src/app/core/auth/auth.ts` → `AuthService` (`user`, `init()`, `headers()`) | Manter |
| Adaptador (front) | `web/src/app/core/auth/dev-auth.ts` (`DevAuthService`: lê `/api/me`, sem headers) | **Apagar.** Criar `CorpAuthService extends AuthService` com a lib interna (`headers()` devolve o `Authorization`) |
| Registro (front) | `web/src/app/app.config.ts` | Trocar `useClass: DevAuthService` |
| Testes | `api/tests/Tests/Fakes.cs` (`FakeUsers`) | Nada — testes não dependem do mock |

RBAC (`AccessRules` no back, `canBuild/isAdmin/canWrite/visibleFields` no front) continua igual.
Downloads usam `HttpClient` + Blob, então funcionam com bearer token (não dependem de cookie).

## E-mail (API interna)

| Arquivo | O que fazer |
|---|---|
| `api/src/Domain/Ports.cs` → `IEmailSender`, `EmailMessage` | Manter |
| `api/src/Infra/Integrations/Integrations.cs` → `LogEmailSender` | Criar `CorpEmailSender : IEmailSender` chamando a API interna (HttpClient tipado) |
| `api/src/Api/CompositionRoot.cs` | Trocar o registro (`AddHttpClient<IEmailSender, CorpEmailSender>()`) |

Quem envia e-mail hoje: `WorkflowEngine` (ações sendEmail e requestApproval) e `ApprovalService` (decisão).
Teams/Slack: criar outro adaptador da mesma porta ou uma porta `INotifier` nova.

## Persistência

Opção A — **trocar só o banco relacional (SQL Server, PostgreSQL, Oracle)** — 2 arquivos:

| Arquivo | O que fazer |
|---|---|
| `api/src/Infra/Infra.csproj` | Trocar `Microsoft.EntityFrameworkCore.Sqlite` pelo provider (ex.: `...SqlServer`) |
| `api/src/Infra/InfraServiceCollection.cs` | `UseSqlite` → `UseSqlServer`; remover criação de diretório; trocar `EnsureCreated` por migrations (hoje, tabela nova exige apagar o banco de dev) |
| `api/src/Api/appsettings.json` | `ConnectionStrings:Default` |

Opção B — **outra tecnologia (Dapper, API de dados interna, NoSQL)**: reimplementar as interfaces de
`api/src/Domain/Ports.cs` (`IWorkspaceRepository`, `IAppRepository`, `IRecordRepository`,
`IApprovalRepository`, `IAuditLog`) num novo projeto/pasta e registrar no `CompositionRoot`.
Arquivos substituídos: `Infra/Persistence/AppDbContext.cs`, `Repositories.cs`, `Seed.cs`, `InfraServiceCollection.cs`.
Colunas JSON: `Apps.Draft/Published`, `AppVersions.Definition`, `Records.Data`, `Apps.AllowedDepartments`.

Os fakes de `api/tests/Tests/Fakes.cs` são o contrato executável esperado dos repositórios.

**Consultas no banco (atenção na troca):** `IRecordRepository.QueryAsync` (busca + paginação) e `CountByAsync`
(agregação) usam SQL específico do SQLite em `Infra/Persistence/Repositories.cs` (`json_each`, `json_extract`) e a
função `norm()` registrada em `Infra/Persistence/SqliteFunctions.cs`. No novo banco, reescreva só esses dois métodos
(ex.: SQL Server `OPENJSON` + collation `AI_CI`; PostgreSQL `jsonb_each_text` + `unaccent`) e adapte
`api/tests/Tests/QueryTests.cs` → `SqliteRecordRepositoryTests`, que valida o comportamento esperado contra o banco real.

## Arquivos (anexos)

| Arquivo | O que fazer |
|---|---|
| `api/src/Domain/Ports.cs` → `IFileStorage` (`SaveAsync(scope, nome, stream)`, `OpenAsync(scope, id)`; scope = id do app) | Manter. O controle de acesso fica no `FileService`, não no adaptador |
| `api/src/Infra/Integrations/Integrations.cs` → `LocalFileStorage` | Novo adaptador (blob/SharePoint) |
| `api/src/Api/CompositionRoot.cs` | Trocar o registro; `Storage:UploadsPath` deixa de ser usado |

## Documentos (.xlsx e PDF)

| Arquivo | O que fazer |
|---|---|
| `api/src/Domain/Ports.cs` → `ISpreadsheet` (`Write`, `Read`), `IPdfReport` (`Render(ReportDocument)`) | Manter |
| `api/src/Infra/Documents/XlsxSpreadsheet.cs`, `PdfReportWriter.cs` | Substituir por adaptador sobre a lib corporativa (ex.: ClosedXML, QuestPDF, serviço interno de relatórios) |
| `api/src/Api/CompositionRoot.cs` | Trocar os dois `AddSingleton` |
| `api/tests/Tests/DocumentTests.cs` | `SpreadsheetTests`/`PdfReportTests` testam o adaptador atual; `ExportImportJourneyTests` vale para qualquer adaptador |

O conteúdo do relatório (título, resumo, formatação pt-BR) é montado no domínio (`RecordService.ReportAsync`);
o adaptador só desenha.

## Agendador de workflows

| Arquivo | O que fazer |
|---|---|
| `api/src/Api/ScheduledWorkflowsHostedService.cs` | Relógio em processo (a cada minuto). Com várias instâncias da API, troque por um job único da plataforma (Hangfire, Quartz, CronJob) que chame `ScheduledWorkflowService.RunDueAsync(now)`, ou adicione lock distribuído |
| `api/src/Api/CompositionRoot.cs` | Remover/trocar `AddHostedService<ScheduledWorkflowsHostedService>()` |
| `api/src/Domain/Ports.cs` → `IScheduleStore` | Manter. Implementação em `Infra/Persistence/Repositories.cs` (`ScheduleStore`, tabela `ScheduleStates`) acompanha a troca de banco |

Fuso horário: hoje usa o relógio local do servidor (`DateTime.Now`). Se o servidor corporativo rodar em UTC, passe a hora
local da empresa para `RunDueAsync`.

## Webhook de entrada

`HooksController` (`api/src/Api/Controllers/Controllers.cs`, rota `/api/hooks/{appId}/{tableId}`) autentica pela
chave `X-Webhook-Key` da tabela, não pelo usuário. Ao plugar o SSO corporativo, marque esse endpoint como
`[AllowAnonymous]` (ou exclua a rota do middleware de autenticação). Nada muda no domínio.

## Formulários (link público, contadores, limite)

| Arquivo | O que fazer |
|---|---|
| `api/src/Api/Controllers/Controllers.cs` → `FormsController` (`/api/forms/{slug}`) | Usuário **opcional**: ao plugar o SSO, deixe a rota fora da autenticação obrigatória (`[AllowAnonymous]`), mas mantendo o usuário quando houver. O `FormService` decide o acesso |
| `api/src/Domain/Ports.cs` → `IFormCounters`; `api/src/Infra/Persistence/Repositories.cs` → `FormCounters` | Trocar junto com a persistência (tabela `FormCounters`) |
| `api/src/Api/Program.cs` (`AddRateLimiter`, políticas `forms` e `form-submit`) | Em várias instâncias, o limite em memória vale por instância: trocar por gateway/WAF ou limitador distribuído |
| `appsettings.json` → `Forms:AllowPublic`, `Forms:SubmitsPerHour`, `Forms:RequestsPerMinute` | Governança: `AllowPublic=false` desliga todos os links públicos |
| `web/src/app/core/auth/dev-auth.ts` | O app sobe sem login (user = null) para o link público funcionar; o adaptador corporativo precisa permitir o mesmo nas rotas `/f/*` |

## Workflows (fila, histórico, segredos)

| Arquivo | O que fazer |
|---|---|
| `api/src/Domain/Ports.cs` → `IRunStore`; `api/src/Infra/Persistence/Repositories.cs` → `RunStore` | Fila = execuções `queued` no banco. No corporativo: fila real (Service Bus, RabbitMQ, Hangfire) mantendo o histórico (`RunSteps`) |
| `api/src/Api/FlowWorkerHostedService.cs` | Worker em processo, uma execução por vez. Separar em serviço próprio; com várias instâncias, garantir que cada execução seja pega uma vez |
| `api/src/Domain/Ports.cs` → `ISecretStore`; `Repositories.cs` → `SecretStore` + `SecretCipher` (AES-GCM, chave em `Secrets:KeyFile`, padrão `data/secrets.key`) | Trocar por adaptador do cofre corporativo (Key Vault, CyberArk); a chave local some. **Não versionar `data/secrets.key`** |
| `api/src/Api/Controllers/Controllers.cs` → `FlowHooksController` (`/api/hooks/wf/{appId}`) | Autentica por `X-Webhook-Key`: fora do SSO, como `/api/hooks` |
| `api/src/Domain/Ports.cs` → `IHttpConnector.SendAsync(..., headers)` | Cabeçalhos do passo "Chamar API" (ex.: `Authorization` com segredo). Política de domínios permitidos (egress), se exigida, entra no adaptador |

## Conector REST

`HttpConnector` (Infra) atende a ação `callApi`. Para gateway/proxy corporativo ou autenticação de saída,
configure o `AddHttpClient<IHttpConnector, HttpConnector>(...)` no `CompositionRoot` (handlers, base address).

## Design system

| Arquivo | O que fazer |
|---|---|
| `web/src/app/ui/ui.ts` | Reimplementar os templates de `UiButton`, `UiInput` (inclui `inline`, `mono` e o autocomplete de variáveis `suggestions`/`complete`, cuja lógica pura fica em `ui/completion.ts`), `UiSelect`, `UiCheckbox`, `UiCard`, `UiTable`, `UiBarChart`, `UiNotice`, `UiStamp`, `UiSegmented`, `UiIcon`, `UiAnswer`, `UiChoices`, `UiScale` (respostas de formulário) com os componentes do DS corporativo, **mantendo selectors e inputs/models**. Ícones: trocar só o mapa `ICONS` (ou o template de `UiIcon`) pela biblioteca de ícones do DS |
| `web/src/app/ui/ui.css` | Substituir pelos tokens/estilos do DS (ou remover se o DS trouxer CSS próprio). Tema escuro: mesmos tokens redefinidos em `:root[data-theme='dark']` e em `prefers-color-scheme: dark` |
| `web/src/styles.css` | Só layout (moldura com barra lateral, grid, Início, editor, nós de automação, índices). Usa só os tokens de `ui.css` (sem cores fixas, exceto os gradientes dos ícones de tipo de projeto) |
| `web/src/index.html` | Links das fontes (Google Fonts) e o script que aplica o tema salvo antes do Angular. Trocar as fontes pelas do DS |
| `web/src/app/shell.ts` | `ThemeService` (claro/escuro/sistema em `data-theme` + `localStorage`). Se o DS tiver o próprio controle de tema, trocar aqui |
| `web/package.json` + `DOCS/DEPENDENCIAS.md` | Adicionar o pacote do DS |

`web/src/app/layout/` (estrutura das telas: `app-page` com larguras default/wide/narrow/tool/stage, `app-page-header`, `app-toolbar`, `app-section`, `app-empty`) **não muda** na troca: só usa `UiCard`, `UiNotice`, `UiIcon` etc. e classes de layout de
`styles.css`. Se o DS corporativo trouxer o próprio "page header"/"section", reimplemente os templates de `layout.ts`
mantendo selectors e inputs, e as telas continuam iguais.

As features importam apenas `UI` de `ui/ui.ts` e `LAYOUT` de `layout/layout.ts`. Elementos nativos fora de `ui/` restritos a: `<input type="file">`
(form-block, data-blocks), `<form>`, links e cabeçalhos de página.

## URL da API

`web/src/app/core/api.ts` (`base = '/api'`) e `web/proxy.conf.json` (dev).

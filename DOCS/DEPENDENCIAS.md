# Dependências

> Regra: **toda dependência nova entra nesta tabela no mesmo commit**, com motivo e onde é usada.
> Preferir a plataforma (BCL do .NET, APIs do navegador, Angular) antes de adicionar pacote.

## Backend (.NET 10)

| Pacote | Versão | Projeto | Onde é usado | Por quê | Troca no corp |
|---|---|---|---|---|---|
| Microsoft.EntityFrameworkCore.Sqlite | 10.0.14 | Infra | `Persistence/AppDbContext.cs` (`json_extract` mapeado), `Persistence/Repositories.cs` (SQL de busca/agregação), `Persistence/SqliteFunctions.cs` (`CreateFunction("norm")`), `InfraServiceCollection.cs` (`UseSqlite`, `SqliteConnectionStringBuilder`); também usado em `tests/Tests/QueryTests.cs` | ORM + banco embutido sem servidor | Sim — trocar provider ou repositórios ([guia](TROCA-DE-ADAPTADORES.md#persistência)) |
| (framework) Microsoft.AspNetCore.App | 10.0 | Api | Controllers, ProblemDetails, `AddHttpClient` | Web API | — |
| xunit | 2.9.3 | Tests | todos os testes | Testes unitários | — |
| xunit.runner.visualstudio | 3.1.4 | Tests | runner | `dotnet test` | — |
| Microsoft.NET.Test.Sdk | 17.14.1 | Tests | runner | `dotnet test` | — |
| coverlet.collector | 6.0.4 | Tests | cobertura (opcional) | template padrão | — |

**Domain não tem dependências.** Testes usam fakes escritos à mão (`tests/Tests/Fakes.cs`), sem Moq.
`Tests` referencia `Infra` só para testar os geradores de `.xlsx`/PDF (lógica pura, sem banco nem I/O).

**Sem pacote para Excel/PDF (de propósito):** `Infra/Documents/XlsxSpreadsheet.cs` usa `System.IO.Compression` + `System.Xml.Linq` (BCL); `Infra/Documents/PdfReportWriter.cs` escreve PDF 1.4 com fontes padrão. Se o corporativo precisar de recursos além (fórmulas, estilos ricos, gráficos no PDF), troque o adaptador por ClosedXML/QuestPDF e registre o pacote aqui.

## Frontend (Angular 20)

| Pacote | Onde é usado | Por quê |
|---|---|---|
| @angular/core, common, compiler, platform-browser | toda a aplicação | framework |
| @angular/core/rxjs-interop (parte de core) | `app.ts` (`toSignal` da URL) | layout largo no editor |
| @angular/router | `app.routes.ts`, guards em `core/auth/auth.ts`, `RunContext.navigate` | rotas builder × runtime |
| @angular/common/http (parte de common) | `core/api.ts`, `core/auth/auth.ts` (interceptor), `core/auth/dev-auth.ts` | chamadas à API |
| rxjs | `core/api.ts` (`firstValueFrom`) | exigido pelo HttpClient; convertemos para Promise |
| tslib | build | runtime do TypeScript |
| Dev: @angular/build, cli, compiler-cli, typescript | build/serve | toolchain |
| Dev: karma, karma-*, jasmine-core, @types/jasmine | `*.spec.ts` | testes padrão do Angular 20 |
| Fontes Geist + Geist Mono (Google Fonts, CDN) | `web/src/index.html` (link), `web/src/app/ui/ui.css` (`--font-display`, `--font-body`, `--font-mono`) | identidade visual (referência Linear/Vercel); sem rede, cai em Inter/Segoe UI/fonte do sistema. Some ao trocar o design system. Substituiu Bricolage Grotesque + Public Sans em 2026-11-07 |

Removido do template: `@angular/forms` (formulários usam os wrappers de `ui/` com `model()`).
Sem bibliotecas de UI, drag-and-drop (HTML5 nativo), gráficos (barras em CSS) ou CSV (implementado no backend).
Workflows sem pacote novo: fila/worker com `BackgroundService`, cron próprio (`Domain/Flows/FlowRules.cs`), segredos com
`System.Security.Cryptography.AesGcm` e limite de envios de formulário com o rate limiter nativo do ASP.NET Core.

## Última verificação (2026-11-06)

`npm outdated`, `npm audit --omit=dev`, `dotnet list package --outdated` e `--vulnerable`.

- **Vulnerabilidades:** nenhuma (npm e NuGet).
- **Backend:** `Microsoft.EntityFrameworkCore.Sqlite` 10.0.14 está na última versão.
- **Frontend:** Angular na última da linha 20 (`20.3.35`, CLI/build `20.3.42`). Existe Angular 22, mas o projeto é
  Angular 20 e **não migra** (regra em `CLAUDE.md`, "Versões travadas"; vale também para o .NET 10).
- **Só ferramentas de teste/build têm major nova** (não vão para produção):
  - npm: `typescript` 5.9 → 7.0, `jasmine-core` 5.9 → 7.0, `@types/jasmine` 5.1 → 7.0,
    `karma-jasmine-html-reporter` 2.1 → 2.3 (TypeScript e Jasmine acompanham a versão suportada pelo Angular 20; não subir isolado).
  - NuGet (Tests): `Microsoft.NET.Test.Sdk` 17.14 → 18.11, `xunit.runner.visualstudio` 3.1 → 4.0, `coverlet.collector` 6.0 → 10.1.

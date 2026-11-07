using Domain;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Api.Controllers;

// Controllers são finos: recebem HTTP, chamam o serviço de domínio e devolvem o resultado.

public record SketchBlock(string Type, int Span);

public record AppSummary(Guid Id, Guid WorkspaceId, string Name, string Slug, string Description, int? PublishedVersion, bool IsTemplate, bool InCatalog, DateTime UpdatedAt, List<SketchBlock> Sketch, string Kind)
{
    /// <summary>Miniatura: primeiros componentes da 1ª página (publicada no catálogo, rascunho para quem gerencia).</summary>
    public static AppSummary From(App a) => From(a, a.Draft);
    public static AppSummary FromPublished(App a) => From(a, a.Published ?? a.Draft);

    private static AppSummary From(App a, AppDefinition d) =>
        new(a.Id, a.WorkspaceId, a.Name, a.Slug, a.Description, a.PublishedVersion, a.IsTemplate, a.InCatalog, a.UpdatedAt,
            [.. (d.Pages.FirstOrDefault()?.Components ?? []).Take(8).Select(c => new SketchBlock(c.Type, c.Span))], a.Kind);
}

public record CreateAppRequest(Guid WorkspaceId, string Name, Guid? TemplateId, string? Kind);
public record FormSubmitRequest(Dictionary<string, string?> Answers, string? Website);
public record FormEventRequest(string Key);
public record DuplicateRequest(Guid WorkspaceId, string? Name);
public record RunView(Guid AppId, string Name, string Slug, int? Version, AppDefinition Definition, bool CanManage);
public record CreateWorkspaceRequest(string Name, string Department);
public record DecideRequest(bool Approve, string? Comment);

[ApiController, Route("api/me")]
public class MeController(IUserProvider users) : ControllerBase
{
    [HttpGet] public CurrentUser Get() => users.GetCurrentUser();
}

[ApiController, Route("api/workspaces")]
public class WorkspacesController(WorkspaceService workspaces) : ControllerBase
{
    [HttpGet] public Task<List<Workspace>> List() => workspaces.ListManagedAsync();
    [HttpPost] public Task<Workspace> Create(CreateWorkspaceRequest r) => workspaces.CreateAsync(r.Name, r.Department);
}

[ApiController, Route("api/apps")]
public class AppsController(AppService apps) : ControllerBase
{
    [HttpGet] public async Task<IEnumerable<AppSummary>> List() => (await apps.ListManagedAsync()).Select(AppSummary.From);
    [HttpGet("templates")] public async Task<IEnumerable<AppSummary>> Templates() => (await apps.ListTemplatesAsync()).Select(AppSummary.From);
    [HttpGet("catalog")] public async Task<IEnumerable<AppSummary>> Catalog() => (await apps.CatalogAsync()).Select(AppSummary.FromPublished);
    [HttpGet("{id:guid}")] public Task<App> Get(Guid id) => apps.GetAsync(id);
    [HttpPost] public Task<App> Create(CreateAppRequest r) => apps.CreateAsync(r.WorkspaceId, r.Name, r.TemplateId, r.Kind);
    [HttpPut("{id:guid}")] public Task<App> Update(Guid id, AppChanges changes) => apps.UpdateAsync(id, changes);
    [HttpDelete("{id:guid}")] public Task Delete(Guid id) => apps.DeleteAsync(id);
    [HttpPost("{id:guid}/publish")] public Task<AppVersion> Publish(Guid id) => apps.PublishAsync(id);
    [HttpGet("{id:guid}/versions")] public Task<List<AppVersion>> Versions(Guid id) => apps.VersionsAsync(id);
    [HttpPost("{id:guid}/rollback/{number:int}")] public Task<App> Rollback(Guid id, int number) => apps.RollbackAsync(id, number);
    [HttpPost("{id:guid}/duplicate")] public Task<App> Duplicate(Guid id, DuplicateRequest r) => apps.DuplicateAsync(id, r.WorkspaceId, r.Name);
}

/// <summary>Modo usuário: URL interna /run/{slug} serve a versão publicada.</summary>
[ApiController, Route("api/run")]
public class RunController(AppService apps) : ControllerBase
{
    [HttpGet("{slug}")]
    public async Task<RunView> Get(string slug)
    {
        var s = await apps.OpenPublishedAsync(slug);
        var definition = JsonUtil.Clone(s.Definition);
        foreach (var t in definition.Tables) t.WebhookKey = null; // segredo não vai para o navegador do usuário
        return new RunView(s.App.Id, s.App.Name, s.App.Slug, s.App.PublishedVersion, definition, s.CanManage);
    }
}

[ApiController, Route("api/apps/{appId:guid}/{env}/tables/{tableId}/records")]
public class RecordsController(RecordService records) : ControllerBase
{
    /// <summary>GET ...records?q=texto&amp;page=1&amp;size=20 — busca e paginação no servidor (size máx. 100).</summary>
    [HttpGet]
    public Task<PagedRecords> Query(Guid appId, string env, string tableId, [FromQuery] string? q, [FromQuery] int page = 1, [FromQuery] int size = 20) =>
        records.QueryAsync(appId, env, tableId, q, page, size);

    /// <summary>GET ...records/summary?groupBy=Campo — contagem por valor (gráficos).</summary>
    [HttpGet("summary")]
    public Task<List<GroupCount>> Summary(Guid appId, string env, string tableId, [FromQuery] string groupBy) =>
        records.SummaryAsync(appId, env, tableId, groupBy);

    /// <summary>GET ...records/labels — id → rótulo, para campos de relação.</summary>
    [HttpGet("labels")]
    public Task<List<RecordLabel>> Labels(Guid appId, string env, string tableId) => records.LabelsAsync(appId, env, tableId);

    [HttpPost]
    public Task<RecordWriteResult> Create(Guid appId, string env, string tableId, Dictionary<string, string?> data) =>
        records.CreateAsync(appId, env, tableId, data);

    [HttpPut("{recordId:guid}")]
    public Task<RecordWriteResult> Update(Guid appId, string env, string tableId, Guid recordId, Dictionary<string, string?> data) =>
        records.UpdateAsync(appId, env, tableId, recordId, data);

    [HttpDelete("{recordId:guid}")]
    public Task Delete(Guid appId, string env, string tableId, Guid recordId) => records.DeleteAsync(appId, env, tableId, recordId);

    /// <summary>GET .../export?format=csv|xlsx|pdf</summary>
    [HttpGet("export")]
    public async Task<IActionResult> Export(Guid appId, string env, string tableId, [FromQuery] string format = "csv")
    {
        var file = await records.ExportAsync(appId, env, tableId, format);
        return File(file.Content, file.ContentType, file.FileName);
    }

    /// <summary>POST multipart (campo "file"): .xlsx ou .csv.</summary>
    [HttpPost("import")]
    public async Task<ImportResult> Import(Guid appId, string env, string tableId, IFormFile file)
    {
        await using var stream = file.OpenReadStream();
        return await records.ImportAsync(appId, env, tableId, stream);
    }
}

[ApiController, Route("api/apps/{appId:guid}/{env}/workflows/{workflowId}/run")]
public class WorkflowsController(WorkflowService workflows) : ControllerBase
{
    [HttpPost]
    public Task<WorkflowResult> Run(Guid appId, string env, string workflowId, Dictionary<string, string?> context) =>
        workflows.RunClickAsync(appId, env, workflowId, context);
}

[ApiController, Route("api/approvals")]
public class ApprovalsController(ApprovalService approvals) : ControllerBase
{
    [HttpGet] public Task<List<Approval>> Mine() => approvals.ListMineAsync();
    [HttpPost("{id:guid}/decide")] public Task<Approval> Decide(Guid id, DecideRequest r) => approvals.DecideAsync(id, r.Approve, r.Comment);
}

[ApiController, Route("api/audit")]
public class AuditController(AuditService audit) : ControllerBase
{
    [HttpGet] public Task<List<AuditEntry>> List([FromQuery] int take = 200) => audit.ListAsync(take);
}

[ApiController, Route("api/apps/{appId:guid}/{env}/files")]
public class FilesController(FileService files) : ControllerBase
{
    [HttpPost]
    public async Task<StoredFile> Upload(Guid appId, string env, IFormFile file)
    {
        await using var stream = file.OpenReadStream();
        return await files.UploadAsync(appId, env, file.FileName, stream);
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> Download(Guid appId, string env, string id)
    {
        var (file, content) = await files.OpenAsync(appId, env, id);
        return File(content, "application/octet-stream", file.Name);
    }
}

/// <summary>
/// Webhook de entrada: POST /api/hooks/{appId}/{tableId} com header X-Webhook-Key e JSON { "Campo": "valor" }.
/// [TROCA] No corporativo, este endpoint deve ficar fora do SSO (AllowAnonymous): a chave é a autenticação.
/// </summary>
[ApiController, Route("api/hooks/{appId:guid}/{tableId}")]
public class HooksController(RecordService records) : ControllerBase
{
    [HttpPost]
    public Task<RecordWriteResult> Receive(Guid appId, string tableId, [FromHeader(Name = "X-Webhook-Key")] string? key,
        Dictionary<string, string?> data) => records.ReceiveWebhookAsync(appId, tableId, key, data);
}

/// <summary>
/// Formulário pelo link /f/{slug}. No corporativo, estas rotas ficam fora da autenticação OBRIGATÓRIA (usuário opcional):
/// o FormService decide (login + departamento, ou link público). Limitadas por "forms" (Program.cs).
/// </summary>
[ApiController, Route("api/forms/{slug}"), EnableRateLimiting("forms")]
public class FormsController(FormService forms) : ControllerBase
{
    [HttpGet] public Task<FormView> Get(string slug) => forms.OpenAsync(slug);
    [HttpPost("responses"), EnableRateLimiting("form-submit")]
    public Task<FormSubmitResult> Submit(string slug, FormSubmitRequest r) => forms.SubmitAsync(slug, r.Answers, r.Website);
    [HttpPost("events")] public Task Track(string slug, FormEventRequest r) => forms.TrackAsync(slug, r.Key);
}

/// <summary>Builder: testar o rascunho do formulário e ver o resumo da versão publicada.</summary>
[ApiController, Route("api/apps/{appId:guid}/form")]
public class FormAdminController(FormService forms) : ControllerBase
{
    [HttpGet("draft")] public Task<FormView> Draft(Guid appId) => forms.OpenDraftAsync(appId);
    [HttpPost("draft/responses")] public Task<FormSubmitResult> SubmitDraft(Guid appId, FormSubmitRequest r) => forms.SubmitDraftAsync(appId, r.Answers);
    [HttpGet("stats")] public Task<FormStats> Stats(Guid appId) => forms.StatsAsync(appId);
}

public record RerunRequest(string? FromStepId);
public record SecretRequest(string Name, string Value);

/// <summary>Projetos de workflow: executar agora / testar, execuções e reexecução.</summary>
[ApiController, Route("api/apps/{appId:guid}/{env}/runs")]
public class RunsController(FlowService flows) : ControllerBase
{
    [HttpGet] public Task<List<WorkflowRun>> List(Guid appId, string env) => flows.ListAsync(appId, env);
    [HttpPost] public Task<WorkflowRun> RunNow(Guid appId, string env) => flows.RunNowAsync(appId, env);
    [HttpGet("{runId:guid}")] public Task<RunDetail> Get(Guid appId, Guid runId) => flows.GetAsync(appId, runId);
    [HttpPost("{runId:guid}/rerun")] public Task<WorkflowRun> Rerun(Guid appId, Guid runId, RerunRequest r) => flows.RerunAsync(appId, runId, r.FromStepId);
}

/// <summary>Gatilho webhook de workflow. Autentica pela chave (X-Webhook-Key), não pelo usuário: fica fora do SSO, como /api/hooks.</summary>
[ApiController, Route("api/hooks/wf/{appId:guid}")]
public class FlowHooksController(FlowService flows) : ControllerBase
{
    [HttpPost]
    public async Task<object> Receive(Guid appId, [FromHeader(Name = "X-Webhook-Key")] string? key, [FromBody] System.Text.Json.Nodes.JsonNode? body)
    {
        var run = await flows.ReceiveWebhookAsync(appId, key, body);
        return new { run.Id, run.Number, run.Status };
    }
}

/// <summary>Segredos do workspace ({{secrets.NOME}}). O valor nunca volta pela API.</summary>
[ApiController, Route("api/workspaces/{workspaceId:guid}/secrets")]
public class SecretsController(SecretService secrets) : ControllerBase
{
    [HttpGet] public Task<List<SecretInfo>> List(Guid workspaceId) => secrets.ListAsync(workspaceId);
    [HttpPut] public Task Set(Guid workspaceId, SecretRequest r) => secrets.SetAsync(workspaceId, r.Name, r.Value);
    [HttpDelete("{name}")] public Task Delete(Guid workspaceId, string name) => secrets.DeleteAsync(workspaceId, name);
}

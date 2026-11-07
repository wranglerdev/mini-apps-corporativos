using Domain;

namespace Tests;

// Fakes em memória das portas do domínio — sem libs de mock (menos dependências).

public class FakeUsers : IUserProvider
{
    public static readonly CurrentUser Admin = new("admin@corp.local", "Admin", Role.Admin, "Governança");
    public static readonly CurrentUser BuilderRh = new("ana@corp.local", "Ana", Role.Builder, "RH");
    public static readonly CurrentUser BuilderTi = new("bruno@corp.local", "Bruno", Role.Builder, "TI");
    public static readonly CurrentUser UserRh = new("joao@corp.local", "João", Role.User, "RH");
    public static readonly CurrentUser UserFin = new("carla@corp.local", "Carla", Role.User, "Financeiro");

    /// <summary>null = ninguém logado (ex.: respondente de link público).</summary>
    public CurrentUser? Current { get; set; } = Admin;
    public CurrentUser GetCurrentUser() => Current ?? throw new UnauthorizedException();
}

public class FakeWorkspaces : IWorkspaceRepository
{
    public List<Workspace> Items { get; } = [];
    public Task<List<Workspace>> ListAsync() => Task.FromResult(Items.ToList());
    public Task<Workspace?> GetAsync(Guid id) => Task.FromResult(Items.FirstOrDefault(w => w.Id == id));
    public Task AddAsync(Workspace w) { Items.Add(w); return Task.CompletedTask; }
}

public class FakeApps : IAppRepository
{
    public List<App> Items { get; } = [];
    public List<AppVersion> Versions { get; } = [];
    public Task<List<App>> ListAsync() => Task.FromResult(Items.ToList());
    public Task<App?> GetAsync(Guid id) => Task.FromResult(Items.FirstOrDefault(a => a.Id == id));
    public Task<App?> GetBySlugAsync(string slug) => Task.FromResult(Items.FirstOrDefault(a => a.Slug == slug));
    public Task AddAsync(App app) { Items.Add(app); return Task.CompletedTask; }
    public Task UpdateAsync(App app) => Task.CompletedTask;
    public Task DeleteAsync(Guid id) { Items.RemoveAll(a => a.Id == id); Versions.RemoveAll(v => v.AppId == id); return Task.CompletedTask; }
    public Task AddVersionAsync(AppVersion v) { Versions.Add(v); return Task.CompletedTask; }
    public Task<List<AppVersion>> ListVersionsAsync(Guid appId) => Task.FromResult(Versions.Where(v => v.AppId == appId).ToList());
}

public class FakeRecords : IRecordRepository
{
    public List<DataRecord> Items { get; } = [];
    public Task<List<DataRecord>> ListAsync(Guid appId, string env, string tableId) =>
        Task.FromResult(Items.Where(r => r.AppId == appId && r.Env == env && r.TableId == tableId).ToList());
    public Task<DataRecord?> GetAsync(Guid id) => Task.FromResult(Items.FirstOrDefault(r => r.Id == id));

    public Task<(List<DataRecord> Items, int Total)> QueryAsync(RecordQuery q)
    {
        var term = string.IsNullOrWhiteSpace(q.Search) ? null : TextSearch.Normalize(q.Search.Trim());
        var all = Items.Where(r => r.AppId == q.AppId && r.Env == q.Env && r.TableId == q.TableId)
            .Where(r => term is null || q.SearchFields.Any(f => r.Data.GetValueOrDefault(f) is { } v && TextSearch.Normalize(v).Contains(term)))
            .OrderByDescending(r => r.CreatedAt).ThenBy(r => r.Id).ToList();
        return Task.FromResult((all.Skip(q.Skip).Take(q.Take).ToList(), all.Count));
    }

    public Task<List<GroupCount>> CountByAsync(Guid appId, string env, string tableId, string field) =>
        Task.FromResult(Items.Where(r => r.AppId == appId && r.Env == env && r.TableId == tableId)
            .GroupBy(r => r.Data.GetValueOrDefault(field)).Select(g => new GroupCount(g.Key, g.Count())).ToList());

    public Task AddAsync(DataRecord r) { Items.Add(r); return Task.CompletedTask; }
    public Task UpdateAsync(DataRecord r) => Task.CompletedTask;
    public Task DeleteAsync(Guid id) { Items.RemoveAll(r => r.Id == id); return Task.CompletedTask; }
    public async Task RenameFieldsAsync(Guid appId, string env, string tableId, IReadOnlyDictionary<string, string> renames)
    {
        foreach (var r in await ListAsync(appId, env, tableId))
            r.Data = r.Data.ToDictionary(kv => renames.GetValueOrDefault(kv.Key, kv.Key), kv => kv.Value);
    }
}

public class FakeFiles : IFileStorage
{
    public Dictionary<(string Scope, string Id), (string Name, byte[] Bytes)> Items { get; } = [];

    public async Task<StoredFile> SaveAsync(string scope, string fileName, Stream content)
    {
        using var ms = new MemoryStream();
        await content.CopyToAsync(ms);
        var id = Guid.NewGuid().ToString("N");
        Items[(scope, id)] = (fileName, ms.ToArray());
        return new StoredFile(id, fileName);
    }

    public Task<(StoredFile File, Stream Content)?> OpenAsync(string scope, string id) =>
        Task.FromResult<(StoredFile, Stream)?>(Items.TryGetValue((scope, id), out var f)
            ? (new StoredFile(id, f.Name), new MemoryStream(f.Bytes)) : null);
}

public class FakeScheduleStore : IScheduleStore
{
    public Dictionary<(Guid, string), DateTime> Items { get; } = [];
    public Task<DateTime?> GetLastRunAsync(Guid appId, string workflowId) =>
        Task.FromResult(Items.TryGetValue((appId, workflowId), out var at) ? at : (DateTime?)null);
    public Task SetLastRunAsync(Guid appId, string workflowId, DateTime at) { Items[(appId, workflowId)] = at; return Task.CompletedTask; }
}

public class FakeFormCounters : IFormCounters
{
    public Dictionary<(Guid, string), int> Items { get; } = [];
    public Task IncrementAsync(Guid appId, string key) { Items[(appId, key)] = Items.GetValueOrDefault((appId, key)) + 1; return Task.CompletedTask; }
    public Task<Dictionary<string, int>> GetAsync(Guid appId) =>
        Task.FromResult(Items.Where(kv => kv.Key.Item1 == appId).ToDictionary(kv => kv.Key.Item2, kv => kv.Value));
}

public class FakeApprovals : IApprovalRepository
{
    public List<Approval> Items { get; } = [];
    public Task<List<Approval>> ListForUserAsync(string email) =>
        Task.FromResult(Items.Where(a => a.Approver == email || a.RequestedBy == email).ToList());
    public Task<Approval?> GetAsync(Guid id) => Task.FromResult(Items.FirstOrDefault(a => a.Id == id));
    public Task AddAsync(Approval a) { Items.Add(a); return Task.CompletedTask; }
    public Task UpdateAsync(Approval a) => Task.CompletedTask;
}

public class FakeAudit : IAuditLog
{
    public List<AuditEntry> Items { get; } = [];
    public Task WriteAsync(AuditEntry e) { Items.Add(e); return Task.CompletedTask; }
    public Task<List<AuditEntry>> ListAsync(int take) => Task.FromResult(Items.TakeLast(take).ToList());
}

public class FakeEmail : IEmailSender
{
    public List<EmailMessage> Sent { get; } = [];
    public Task SendAsync(EmailMessage m) { Sent.Add(m); return Task.CompletedTask; }
}

public class FakeHttp : IHttpConnector
{
    public List<(string Method, string Url, string? Body)> Calls { get; } = [];
    public List<IReadOnlyDictionary<string, string>?> Headers { get; } = [];
    /// <summary>Respostas programadas, na ordem; acabou a fila = 200 {"ok":true}.</summary>
    public Queue<HttpCallResult> Responses { get; } = new();
    /// <summary>Demora de cada chamada (testes de tempo limite).</summary>
    public TimeSpan Latency { get; set; }
    public async Task<HttpCallResult> SendAsync(string method, string url, string? body, IReadOnlyDictionary<string, string>? headers = null)
    {
        Calls.Add((method, url, body));
        Headers.Add(headers);
        if (Latency > TimeSpan.Zero) await Task.Delay(Latency);
        return Responses.Count > 0 ? Responses.Dequeue() : new HttpCallResult(200, "{\"ok\":true}");
    }
}

public class FakeRunStore : IRunStore
{
    public List<WorkflowRun> Runs { get; } = [];
    public List<RunStep> Steps { get; } = [];
    public Task AddAsync(WorkflowRun run) { Runs.Add(run); return Task.CompletedTask; }
    public Task UpdateAsync(WorkflowRun run) => Task.CompletedTask;
    public Task<WorkflowRun?> GetAsync(Guid id) => Task.FromResult(Runs.FirstOrDefault(r => r.Id == id));
    public Task<List<WorkflowRun>> ListAsync(Guid appId, string env, int take) =>
        Task.FromResult(Runs.Where(r => r.AppId == appId && r.Env == env).OrderByDescending(r => r.Number).Take(take).ToList());
    public Task<int> NextNumberAsync(Guid appId) => Task.FromResult(Runs.Where(r => r.AppId == appId).Select(r => r.Number).DefaultIfEmpty(0).Max() + 1);
    public Task<WorkflowRun?> NextQueuedAsync() => Task.FromResult(Runs.Where(r => r.Status == RunStatus.Queued).OrderBy(r => r.CreatedAt).FirstOrDefault());
    public Task AddStepAsync(RunStep step) { Steps.Add(step); return Task.CompletedTask; }
    public Task UpdateStepAsync(RunStep step) => Task.CompletedTask;
    public Task<List<RunStep>> StepsAsync(Guid runId) => Task.FromResult(Steps.Where(s => s.RunId == runId).OrderBy(s => s.Order).ToList());
    public Task<int> DeleteOlderThanAsync(DateTime before)
    {
        var old = Runs.Where(r => r.CreatedAt < before).Select(r => r.Id).ToHashSet();
        Steps.RemoveAll(s => old.Contains(s.RunId));
        return Task.FromResult(Runs.RemoveAll(r => old.Contains(r.Id)));
    }
}

public class FakeSecretStore : ISecretStore
{
    public Dictionary<(Guid, string), (string Value, string By)> Items { get; } = [];
    public Task<List<SecretInfo>> ListAsync(Guid ws) =>
        Task.FromResult(Items.Where(kv => kv.Key.Item1 == ws).Select(kv => new SecretInfo(kv.Key.Item2, kv.Value.By, DateTime.UtcNow)).ToList());
    public Task SetAsync(Guid ws, string name, string value, string by) { Items[(ws, name)] = (value, by); return Task.CompletedTask; }
    public Task DeleteAsync(Guid ws, string name) { Items.Remove((ws, name)); return Task.CompletedTask; }
    public Task<Dictionary<string, string>> ValuesAsync(Guid ws) =>
        Task.FromResult(Items.Where(kv => kv.Key.Item1 == ws).ToDictionary(kv => kv.Key.Item2, kv => kv.Value.Value));
}

/// <summary>Monta o grafo de serviços com fakes e workspaces RH/TI prontos.</summary>
public class World
{
    public FakeUsers Users { get; } = new();
    public FakeWorkspaces Workspaces { get; } = new();
    public FakeApps Apps { get; } = new();
    public FakeRecords Records { get; } = new();
    public FakeApprovals ApprovalsRepo { get; } = new();
    public FakeAudit Audit { get; } = new();
    public FakeEmail Email { get; } = new();
    public FakeHttp Http { get; } = new();
    public FakeFiles Files { get; } = new();
    public FakeScheduleStore ScheduleStore { get; } = new();
    public FakeFormCounters FormCounters { get; } = new();
    public FakeRunStore RunStore { get; } = new();
    public FakeSecretStore SecretStore { get; } = new();
    public FormSettings FormSettings { get; set; } = new(AllowPublic: true);

    public Workspace Rh { get; } = new() { Name = "RH", Department = "RH" };
    public Workspace Ti { get; } = new() { Name = "TI", Department = "TI" };

    public AppService AppService { get; }
    public WorkflowEngine Engine { get; }
    public RecordService RecordService { get; }
    public WorkflowService WorkflowService { get; }
    public ApprovalService ApprovalService { get; }
    public FileService FileService { get; }
    public ScheduledWorkflowService Scheduler { get; }
    public FlowService Flows { get; }
    public FlowRunner Runner { get; }
    public SecretService Secrets { get; }
    /// <summary>Esperas pedidas pelo FlowRunner (tentativas e passo "esperar"); nos testes não esperam de verdade.</summary>
    public List<TimeSpan> Waits { get; } = [];
    /// <summary>Recriado a cada acesso para respeitar FormSettings alterado no teste.</summary>
    public FormService FormService => new(Apps, Workspaces, AppService, RecordService, Records, FormCounters, Users, FormSettings);

    public World()
    {
        Workspaces.Items.AddRange([Rh, Ti]);
        AppService = new AppService(Apps, Workspaces, Records, Users, Audit);
        Engine = new WorkflowEngine(Records, ApprovalsRepo, Email, Http, Audit);
        RecordService = new RecordService(Records, AppService, Engine, new Infra.XlsxSpreadsheet(), new Infra.PdfReportWriter(), Users, Audit);
        WorkflowService = new WorkflowService(AppService, Engine, Users);
        ApprovalService = new ApprovalService(ApprovalsRepo, Records, AppService, Engine, Email, Users, Audit);
        FileService = new FileService(Files, AppService, Users, Audit);
        Flows = new FlowService(Apps, AppService, RunStore, Users);
        Scheduler = new ScheduledWorkflowService(Apps, AppService, Engine, ScheduleStore, Audit, Flows);
        Runner = new FlowRunner(RunStore, Apps, AppService, Engine, SecretStore, Email, Audit) { Delay = (t, _) => { Waits.Add(t); return Task.CompletedTask; } };
        Secrets = new SecretService(SecretStore, Workspaces, Users, Audit);
    }

    public World As(CurrentUser? user) { Users.Current = user; return this; }

    /// <summary>
    /// Pesquisa do RH (como no protótipo): Nome, Área, Nota (≥ 7 pula Melhorias), Melhorias (obrigatória no caminho),
    /// Contato (Não = fim), E-mail. Liberada só para RH; `isPublic` liga o link público.
    /// </summary>
    public async Task<App> CreateSurveyAsync(bool publish = true, bool isPublic = false, params WorkflowDef[] workflows)
    {
        As(FakeUsers.BuilderRh);
        var app = await AppService.CreateAsync(Rh.Id, "Pesquisa de onboarding", null, ProjectKinds.Form);
        var draft = app.Draft;
        var table = draft.Tables.Single();
        table.Fields =
        [
            new FieldDef { Id = "f-nome", Name = "Nome", Required = true },
            new FieldDef { Id = "f-area", Name = "Área", Type = FieldType.Select, Options = ["RH", "TI"], Required = true },
            new FieldDef { Id = "f-nota", Name = "Nota", Type = FieldType.Number, Required = true },
            new FieldDef { Id = "f-melhorias", Name = "Melhorias", Required = true },
            new FieldDef { Id = "f-contato", Name = "Contato", Type = FieldType.Select, Options = [.. QuestionKinds.YesNoOptions], Required = true },
            new FieldDef { Id = "f-email", Name = "E-mail", Required = true }
        ];
        draft.Form!.Public = isPublic;
        draft.Form.Questions =
        [
            new QuestionDef { Id = "q1", FieldId = "f-nome", Kind = QuestionKinds.Short, Title = "Qual é o seu nome?" },
            new QuestionDef { Id = "q2", FieldId = "f-area", Kind = QuestionKinds.Choice, Title = "Em qual área?" },
            new QuestionDef { Id = "q3", FieldId = "f-nota", Kind = QuestionKinds.Scale, Title = "Nota do onboarding",
                Jumps = [new JumpDef { Op = "gt", Value = "6", GoTo = "q5" }] },
            new QuestionDef { Id = "q4", FieldId = "f-melhorias", Kind = QuestionKinds.Long, Title = "O que melhorar?" },
            new QuestionDef { Id = "q5", FieldId = "f-contato", Kind = QuestionKinds.YesNo, Title = "Podemos falar com você?",
                Jumps = [new JumpDef { Op = "eq", Value = "Não", GoTo = FormFlow.End }] },
            new QuestionDef { Id = "q6", FieldId = "f-email", Kind = QuestionKinds.Email, Title = "Qual e-mail?" }
        ];
        draft.Workflows.AddRange(workflows);
        await AppService.UpdateAsync(app.Id, new AppChanges(app.Name, null, draft, true, false, ["RH"]));
        if (publish) await AppService.PublishAsync(app.Id);
        return app;
    }

    /// <summary>App do RH com tabela "Pedidos" (Título obrigatório, Valor número, Status select, Custo só builders).</summary>
    public async Task<(App App, TableDef Table)> CreateRhAppAsync(bool publish = true, params WorkflowDef[] workflows)
    {
        As(FakeUsers.BuilderRh);
        var app = await AppService.CreateAsync(Rh.Id, "Pedidos", null);
        var table = new TableDef
        {
            Id = "pedidos", Name = "Pedidos",
            Fields =
            [
                new FieldDef { Name = "Título", Required = true },
                new FieldDef { Name = "Valor", Type = FieldType.Number },
                new FieldDef { Name = "Status", Type = FieldType.Select, Options = ["Pendente", "Aprovado", "Rejeitado"], ReadOnly = true },
                new FieldDef { Name = "Aprovador" },
                new FieldDef { Name = "Custo interno", Type = FieldType.Number, BuildersOnly = true }
            ]
        };
        var draft = AppDefinition.Blank();
        draft.Tables.Add(table);
        draft.Workflows.AddRange(workflows);
        await AppService.UpdateAsync(app.Id, new AppChanges("Pedidos", null, draft, true, false, null));
        if (publish) await AppService.PublishAsync(app.Id);
        return (app, table);
    }
}

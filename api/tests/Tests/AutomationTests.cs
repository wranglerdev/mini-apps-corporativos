using Domain;

namespace Tests;

/// <summary>Workflows encadeados (jornada 3: automação que dispara automação).</summary>
public class WorkflowChainTests
{
    private static ActionDef Email(string to, string subject) =>
        new() { Type = Actions.SendEmail, Params = { ["to"] = to, ["subject"] = subject } };

    [Fact]
    public async Task Registro_criado_por_workflow_dispara_workflows_da_tabela()
    {
        var click = new WorkflowDef
        {
            Id = "abrir", Name = "Abrir pedido",
            Actions = [new ActionDef { Type = Actions.CreateRecord, Params = { ["tableId"] = "pedidos" }, Values = { ["Título"] = "{{titulo}}" } }]
        };
        var onCreated = new WorkflowDef
        {
            Name = "Avisar RH", Trigger = new TriggerDef { Type = Triggers.RecordCreated, TableId = "pedidos" },
            Actions = [Email("rh@corp.local", "Novo: {{Título}}")]
        };
        var w = new World();
        var (app, _) = await w.CreateRhAppAsync(true, click, onCreated);

        var result = await w.WorkflowService.RunClickAsync(app.Id, Env.Prod, "abrir", new Dictionary<string, string?> { ["titulo"] = "Cadeira" });

        Assert.Equal("Novo: Cadeira", w.Email.Sent.Single().Subject);
        Assert.Contains(result.Log, l => l.StartsWith("E-mail enviado"));
    }

    [Fact]
    public async Task Acao_executar_outro_workflow_repassa_o_contexto()
    {
        var shared = new WorkflowDef { Id = "notificar", Name = "Notificar", Actions = [Email("{{destino}}", "Olá {{user.name}}")] };
        var click = new WorkflowDef
        {
            Id = "botao", Name = "Botão",
            Actions = [new ActionDef { Type = Actions.RunWorkflow, Params = { ["workflowId"] = "notificar" } }]
        };
        var w = new World();
        var (app, _) = await w.CreateRhAppAsync(true, shared, click);
        w.As(FakeUsers.UserRh);

        await w.WorkflowService.RunClickAsync(app.Id, Env.Prod, "botao", new Dictionary<string, string?> { ["destino"] = "x@corp.local" });

        Assert.Equal(new EmailMessage("x@corp.local", "Olá João", ""), w.Email.Sent.Single());
    }

    [Fact]
    public async Task Ciclo_e_interrompido_no_limite_de_niveis_sem_erro()
    {
        // "registro atualizado" que atualiza o mesmo registro: ciclo infinito sem a proteção
        var loop = new WorkflowDef
        {
            Name = "Contador", Trigger = new TriggerDef { Type = Triggers.RecordUpdated, TableId = "pedidos" },
            Actions = [new ActionDef { Type = Actions.UpdateRecord, Values = { ["Aprovador"] = "{{Aprovador}}x" } }]
        };
        var w = new World();
        var (app, table) = await w.CreateRhAppAsync(true, loop);
        var created = await w.RecordService.CreateAsync(app.Id, Env.Prod, table.Id, new Dictionary<string, string?> { ["Título"] = "A" });

        var result = await w.RecordService.UpdateAsync(app.Id, Env.Prod, table.Id, created.Record.Id, new Dictionary<string, string?> { ["Aprovador"] = "a" });

        Assert.Equal("a" + new string('x', WorkflowEngine.MaxChainDepth + 1), w.Records.Items.Single().Data["Aprovador"]);
        Assert.Contains(result.Workflow.Log, l => l.Contains("cadeia de workflows interrompida"));
        Assert.Contains(w.Audit.Items, a => a.Action == "workflow.chain-limit");
    }

    [Fact]
    public async Task Decisao_de_aprovacao_dispara_registro_atualizado()
    {
        var ask = new WorkflowDef
        {
            Name = "Pedir", Trigger = new TriggerDef { Type = Triggers.RecordCreated, TableId = "pedidos" },
            Actions = [new ActionDef { Type = Actions.RequestApproval, Params = { ["approver"] = "ana@corp.local", ["title"] = "{{Título}}" } }]
        };
        var approved = new WorkflowDef
        {
            Name = "Comprar", Trigger = new TriggerDef { Type = Triggers.RecordUpdated, TableId = "pedidos" },
            Condition = new ConditionDef { Field = "Status", Op = "eq", Value = "Aprovado" },
            Actions = [Email("compras@corp.local", "Comprar: {{Título}}")]
        };
        var w = new World();
        var (app, table) = await w.CreateRhAppAsync(true, ask, approved);
        w.As(FakeUsers.UserRh);
        await w.RecordService.CreateAsync(app.Id, Env.Prod, table.Id, new Dictionary<string, string?> { ["Título"] = "Notebook" });

        w.As(FakeUsers.BuilderRh);
        await w.ApprovalService.DecideAsync(w.ApprovalsRepo.Items.Single().Id, approve: true, null);

        Assert.Contains(w.Email.Sent, e => e is { To: "compras@corp.local", Subject: "Comprar: Notebook" });
    }

    [Fact]
    public async Task Validacao_recusa_executar_a_si_mesmo_ou_workflow_inexistente()
    {
        var w = new World();
        var (app, _) = await w.CreateRhAppAsync(publish: false);
        var draft = JsonUtil.Clone(app.Draft);
        draft.Workflows.Add(new WorkflowDef { Id = "a", Name = "A", Actions = [new ActionDef { Type = Actions.RunWorkflow, Params = { ["workflowId"] = "a" } }] });
        draft.Workflows.Add(new WorkflowDef { Id = "b", Name = "B", Actions = [new ActionDef { Type = Actions.RunWorkflow, Params = { ["workflowId"] = "zzz" } }] });

        var ex = await Assert.ThrowsAsync<ValidationException>(() => w.AppService.UpdateAsync(app.Id, new AppChanges(app.Name, null, draft, false, false, null)));
        Assert.Contains("a si mesmo", ex.Message);
        Assert.Contains("não existe", ex.Message);
    }
}

/// <summary>Workflows agendados.</summary>
public class ScheduleTests
{
    private static TriggerDef T(string frequency, string? time = null, int? day = null) =>
        new() { Type = Triggers.Schedule, Frequency = frequency, Time = time, DayOfWeek = day };

    [Theory]
    [InlineData("hourly", null, null, "2026-11-06 10:15", "2026-11-06 11:00")]
    [InlineData("daily", "08:00", null, "2026-11-06 07:59", "2026-11-06 08:00")]
    [InlineData("daily", "08:00", null, "2026-11-06 08:00", "2026-11-07 08:00")]
    [InlineData("weekly", "09:30", 1, "2026-11-06 12:00", "2026-11-09 09:30")] // sexta → segunda
    [InlineData("weekly", "09:30", 5, "2026-11-06 09:00", "2026-11-06 09:30")] // mesma sexta, mais tarde
    public void Calcula_proxima_execucao(string frequency, string? time, int? day, string after, string expected) =>
        Assert.Equal(DateTime.Parse(expected), Schedule.NextRun(DateTime.Parse(after), T(frequency, time, day)));

    [Theory]
    [InlineData(null, null, null, "frequência")]
    [InlineData("daily", "25:00", null, "horário")]
    [InlineData("weekly", "08:00", 9, "dia da semana")]
    [InlineData("yearly", null, null, "inválida")]
    public void Valida_configuracao(string? frequency, string? time, int? day, string problem) =>
        Assert.Contains(problem, Schedule.Problem(T(frequency!, time, day)));

    private static async Task<(World W, App App)> AppWithDailyAsync(bool publish = true)
    {
        var daily = new WorkflowDef
        {
            Id = "diario", Name = "Lembrete diário", Trigger = T("daily", "08:00"),
            Actions =
            [
                new ActionDef { Type = Actions.CreateRecord, Params = { ["tableId"] = "pedidos" }, Values = { ["Título"] = "Checklist de {{today}}" } },
                new ActionDef { Type = Actions.SendEmail, Params = { ["to"] = "rh@corp.local", ["subject"] = "Lembrete {{today}}" } }
            ]
        };
        var w = new World();
        var (app, _) = await w.CreateRhAppAsync(publish, daily);
        return (w, app);
    }

    [Fact]
    public async Task Roda_so_quando_vence_e_uma_vez_por_ocorrencia()
    {
        var (w, _) = await AppWithDailyAsync();
        var day = new DateTime(2026, 11, 6);

        Assert.Equal(0, await w.Scheduler.RunDueAsync(day.AddHours(7)));                  // primeiro contato: só referência
        Assert.Equal(0, await w.Scheduler.RunDueAsync(day.AddHours(7).AddMinutes(59)));
        Assert.Equal(1, await w.Scheduler.RunDueAsync(day.AddHours(8)));                  // venceu
        Assert.Equal(0, await w.Scheduler.RunDueAsync(day.AddHours(8).AddMinutes(1)));    // não repete
        Assert.Equal(1, await w.Scheduler.RunDueAsync(day.AddDays(1).AddHours(9)));       // dia seguinte

        Assert.Equal(["Lembrete 2026-11-06", "Lembrete 2026-11-07"], w.Email.Sent.Select(e => e.Subject));
        Assert.All(w.Records.Items, r => Assert.Equal("agendador", r.CreatedBy));
        Assert.Contains(w.Records.Items, r => r.Data["Título"] == "Checklist de 2026-11-06");
    }

    [Fact]
    public async Task App_nao_publicado_nao_roda_agendamento()
    {
        var (w, _) = await AppWithDailyAsync(publish: false);
        await w.Scheduler.RunDueAsync(new DateTime(2026, 11, 6, 7, 0, 0));
        Assert.Equal(0, await w.Scheduler.RunDueAsync(new DateTime(2026, 11, 7, 9, 0, 0)));
    }

    [Fact]
    public async Task Gestor_executa_agendado_na_hora_e_usuario_nao()
    {
        var (w, app) = await AppWithDailyAsync();
        await w.WorkflowService.RunClickAsync(app.Id, Env.Draft, "diario", new Dictionary<string, string?>());
        Assert.Equal($"Lembrete {DateTime.Now:yyyy-MM-dd}", w.Email.Sent.Single().Subject); // {{today}} também no manual

        w.As(FakeUsers.UserRh);
        await Assert.ThrowsAsync<ValidationException>(() => w.WorkflowService.RunClickAsync(app.Id, Env.Prod, "diario", new Dictionary<string, string?>()));
    }
}

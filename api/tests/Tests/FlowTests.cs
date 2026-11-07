using System.Text.Json.Nodes;
using Domain;

namespace Tests;

/// <summary>Jornada 7: workflow como projeto (fila, histórico por passo, tentativas, segredos, reexecução). Ver DOCS/PRD-WORKFLOWS.md.</summary>
public class FlowTests
{
    private static ActionDef Api(string id, string url, int retries = 0) =>
        new() { Id = id, Type = Actions.CallApi, Retries = retries, Params = { ["method"] = "GET", ["url"] = url } };

    private static ActionDef Email(string id, string to, string subject) =>
        new() { Id = id, Type = Actions.SendEmail, Params = { ["to"] = to, ["subject"] = subject } };

    /// <summary>Workflow do TI (Bruno gerencia), publicado, com os passos dados.</summary>
    private static async Task<App> CreateFlowAsync(World w, TriggerDef? trigger, params ActionDef[] steps)
    {
        w.As(FakeUsers.BuilderTi);
        var app = await w.AppService.CreateAsync(w.Ti.Id, "Resumo diário de chamados", null, ProjectKinds.Workflow);
        var draft = JsonUtil.Clone(app.Draft);
        draft.Workflows[0].Actions = [.. steps];
        if (trigger is not null) draft.Workflows[0].Trigger = trigger;
        await w.AppService.UpdateAsync(app.Id, new AppChanges(app.Name, null, draft, false, false, null));
        await w.AppService.PublishAsync(app.Id);
        return app;
    }

    private static async Task<WorkflowRun> RunAsync(World w, App app)
    {
        var run = await w.As(FakeUsers.BuilderTi).Flows.RunNowAsync(app.Id, Env.Prod);
        Assert.Equal(RunStatus.Queued, run.Status);
        Assert.True(await w.Runner.ProcessNextAsync());
        return run;
    }

    private static List<RunStep> Steps(World w, WorkflowRun run) => w.RunStore.Steps.Where(s => s.RunId == run.Id).OrderBy(s => s.Order).ToList();

    [Fact]
    public async Task Criar_workflow_nasce_sem_paginas_com_gatilho_manual()
    {
        var w = new World().As(FakeUsers.BuilderTi);
        var app = await w.AppService.CreateAsync(w.Ti.Id, "Sincronizar", null, ProjectKinds.Workflow);

        Assert.Equal(ProjectKinds.Workflow, app.Kind);
        Assert.Empty(app.Draft.Pages);
        Assert.Equal(Triggers.Manual, app.Draft.Workflows.Single().Trigger.Type);
        app.Draft.Validate();
    }

    [Fact]
    public async Task Saida_de_um_passo_alimenta_os_seguintes_com_se_e_para_cada()
    {
        var w = new World();
        w.Http.Responses.Enqueue(new HttpCallResult(200,
            """{"total":2,"itens":[{"numero":4521,"prioridade":"Alta","responsavel":"bruno@corp.local"},{"numero":4519,"prioridade":"Normal","responsavel":"carla@corp.local"}]}"""));
        var app = await CreateFlowAsync(w, null,
            Api("buscar", "https://erp/chamados"),
            new ActionDef
            {
                Id = "temChamados", Type = Actions.If, Condition = new ConditionDef { Field = "{{steps.buscar.body.total}}", Op = "gt", Value = "0" },
                Steps =
                [
                    new ActionDef
                    {
                        Id = "cada", Type = Actions.ForEach, Params = { ["list"] = "{{steps.buscar.body.itens}}" },
                        Steps =
                        [
                            new ActionDef
                            {
                                Id = "alta", Type = Actions.If, Condition = new ConditionDef { Field = "item.prioridade", Op = "eq", Value = "Alta" },
                                Steps = [Email("avisar", "{{item.responsavel}}", "Chamado {{item.numero}} com prioridade alta")]
                            }
                        ]
                    },
                    new ActionDef { Id = "resumo", Type = Actions.Transform, Values = { ["total"] = "{{steps.buscar.body.total}}" } },
                    Email("gestor", "gestor-ti@corp.local", "Resumo: {{steps.resumo.total}} chamados")
                ]
            });

        var run = await RunAsync(w, app);

        Assert.Equal(RunStatus.Succeeded, run.Status);
        Assert.Equal(["Chamado 4521 com prioridade alta", "Resumo: 2 chamados"], w.Email.Sent.Select(e => e.Subject));
        var steps = Steps(w, run);
        Assert.Contains(steps, s => s.Name == "Item 2" && s.Depth == 2);
        Assert.Contains("\"total\":2", steps.Single(s => s.StepId == "buscar").Output);
        Assert.All(steps, s => Assert.Equal(RunStatus.Succeeded, s.Status));
    }

    [Fact]
    public async Task Passo_que_falha_e_repetido_com_espera_crescente()
    {
        var w = new World();
        w.Http.Responses.Enqueue(new HttpCallResult(503, "indisponível"));
        w.Http.Responses.Enqueue(new HttpCallResult(503, "indisponível"));
        var app = await CreateFlowAsync(w, null, Api("buscar", "https://erp/chamados", retries: 3));

        var run = await RunAsync(w, app);

        Assert.Equal(RunStatus.Succeeded, run.Status);
        Assert.Equal(3, w.Http.Calls.Count);
        Assert.Equal([TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(2)], w.Waits);
        var attempts = Steps(w, run).Where(s => s.Type == "attempt").Select(s => s.Status).ToList();
        Assert.Equal([RunStatus.Failed, RunStatus.Failed, RunStatus.Succeeded], attempts);
        Assert.Equal(2, Steps(w, run).Count(s => s.Type == "backoff"));
    }

    [Fact]
    public async Task Esgotadas_as_tentativas_a_execucao_falha_para_e_avisa_quem_gerencia()
    {
        var w = new World();
        for (var i = 0; i < 3; i++) w.Http.Responses.Enqueue(new HttpCallResult(503, "indisponível"));
        var app = await CreateFlowAsync(w, null, Api("buscar", "https://erp/chamados", retries: 2), Email("gestor", "gestor-ti@corp.local", "Resumo"));

        var run = await RunAsync(w, app);

        Assert.Equal(RunStatus.Failed, run.Status);
        Assert.Contains("503", run.Error);
        Assert.Contains("3 tentativas", run.Error);
        var alert = w.Email.Sent.Single(); // o e-mail do passo seguinte não saiu
        Assert.Equal("bruno@corp.local", alert.To);
        Assert.Contains("falhou (#1)", alert.Subject);
        Assert.Contains(w.Audit.Items, a => a.Action == "workflow.fail");
    }

    [Fact]
    public async Task Passo_lento_passa_do_tempo_limite()
    {
        var w = new World();
        w.Http.Latency = TimeSpan.FromSeconds(3);
        var slow = Api("buscar", "https://erp/lento");
        slow.TimeoutSeconds = 1;
        var app = await CreateFlowAsync(w, null, slow);

        var run = await RunAsync(w, app);

        Assert.Equal(RunStatus.Failed, run.Status);
        Assert.Contains("tempo limite de 1 s", run.Error);
    }

    [Fact]
    public async Task Segredo_e_usado_na_execucao_e_mascarado_no_historico()
    {
        var w = new World();
        await w.As(FakeUsers.BuilderTi).Secrets.SetAsync(w.Ti.Id, "ERP_TOKEN", "s3cr3t-valor");
        var call = Api("buscar", "https://erp/chamados?token={{secrets.ERP_TOKEN}}");
        call.Params["headers"] = "Authorization: Bearer {{secrets.ERP_TOKEN}}\nAccept: application/json";
        var app = await CreateFlowAsync(w, null, call);

        var run = await RunAsync(w, app);

        Assert.Equal("https://erp/chamados?token=s3cr3t-valor", w.Http.Calls.Single().Url);
        Assert.Equal("Bearer s3cr3t-valor", w.Http.Headers.Single()!["Authorization"]);
        var input = Steps(w, run).Single(s => s.StepId == "buscar").Input!;
        Assert.DoesNotContain("s3cr3t-valor", input);
        Assert.Contains("••••", input);
        Assert.DoesNotContain(w.Audit.Items, a => (a.Details ?? "").Contains("s3cr3t-valor"));
    }

    [Fact]
    public async Task Reexecutar_a_partir_do_passo_que_falhou_reaproveita_os_anteriores()
    {
        var w = new World();
        w.Http.Responses.Enqueue(new HttpCallResult(200, """{"total":5}"""));
        w.Http.Responses.Enqueue(new HttpCallResult(500, "erro"));
        var app = await CreateFlowAsync(w, null, Api("buscar", "https://erp/chamados"), Api("enviar", "https://bi/carga?n={{steps.buscar.body.total}}"));
        var failed = await RunAsync(w, app);
        Assert.Equal(RunStatus.Failed, failed.Status);

        var rerun = await w.Flows.RerunAsync(app.Id, failed.Id, "enviar");
        await w.Runner.ProcessNextAsync();

        Assert.Equal(RunStatus.Succeeded, rerun.Status);
        Assert.Equal(3, w.Http.Calls.Count); // "buscar" não rodou de novo
        Assert.Equal("https://bi/carga?n=5", w.Http.Calls[^1].Url);
        Assert.Equal(RunStatus.Skipped, Steps(w, rerun).Single(s => s.StepId == "buscar").Status);
        await Assert.ThrowsAsync<ValidationException>(() => w.Flows.RerunAsync(app.Id, failed.Id, "nao-existe"));
    }

    [Fact]
    public async Task Webhook_com_chave_enfileira_e_o_corpo_vira_variavel()
    {
        var w = new World();
        var app = await CreateFlowAsync(w, new TriggerDef { Type = Triggers.Webhook, WebhookKey = "chave-123" },
            Email("avisar", "compras@corp.local", "Pedido {{trigger.body.pedido}} recebido"));

        await Assert.ThrowsAsync<ForbiddenException>(() => w.Flows.ReceiveWebhookAsync(app.Id, "errada", null));
        var run = await w.Flows.ReceiveWebhookAsync(app.Id, "chave-123", JsonNode.Parse("""{"pedido":42}"""));
        await w.Runner.ProcessNextAsync();

        Assert.Equal(Triggers.Webhook, run.Trigger);
        Assert.Equal("Pedido 42 recebido", w.Email.Sent.Single().Subject);
    }

    [Fact]
    public async Task Agendado_por_cron_entra_na_fila_na_hora()
    {
        var w = new World();
        var app = await CreateFlowAsync(w, new TriggerDef { Type = Triggers.Schedule, Frequency = "cron", Cron = "0 8 * * 1-5" },
            Email("gestor", "gestor-ti@corp.local", "Bom dia {{trigger.today}}"));
        var friday = new DateTime(2026, 11, 6, 9, 0, 0);

        await w.Scheduler.RunDueAsync(friday); // 1º contato só marca a referência
        Assert.Equal(0, await w.Scheduler.RunDueAsync(new DateTime(2026, 11, 7, 8, 0, 30))); // sábado
        Assert.Equal(1, await w.Scheduler.RunDueAsync(new DateTime(2026, 11, 9, 8, 0, 30))); // segunda
        await w.Runner.ProcessNextAsync();

        Assert.Equal(Triggers.Schedule, w.RunStore.Runs.Single().Trigger);
        Assert.Equal("Bom dia 2026-11-09", w.Email.Sent.Single().Subject);
    }

    [Theory]
    [InlineData("0 8 * * 1-5", "2026-11-06 09:00", "2026-11-09 08:00")]
    [InlineData("*/15 * * * *", "2026-11-06 10:07", "2026-11-06 10:15")]
    [InlineData("30 18 1 * *", "2026-11-06 10:00", "2026-12-01 18:30")]
    [InlineData("0 0 * * 0", "2026-11-06 10:00", "2026-11-08 00:00")]
    public void Cron_calcula_a_proxima_execucao(string cron, string after, string expected)
    {
        Assert.Equal(DateTime.Parse(expected), Cron.Next(cron, DateTime.Parse(after)));
    }

    [Theory]
    [InlineData("0 8 * *")]
    [InlineData("61 * * * *")]
    [InlineData("0 8 * * seg")]
    [InlineData("*/0 * * * *")]
    public void Cron_invalido_e_explicado(string cron) => Assert.NotNull(Cron.Problem(cron));

    [Fact]
    public async Task Definicao_invalida_e_recusada()
    {
        var w = new World().As(FakeUsers.BuilderTi);
        var app = await w.AppService.CreateAsync(w.Ti.Id, "X", null, ProjectKinds.Workflow);
        async Task Rejects(params ActionDef[] steps)
        {
            var d = JsonUtil.Clone(app.Draft);
            d.Workflows[0].Actions = [.. steps];
            await Assert.ThrowsAsync<ValidationException>(() => w.AppService.UpdateAsync(app.Id, new AppChanges("X", null, d, false, false, null)));
        }

        await Rejects(Email("a", "x@x", "1"), Email("a", "x@x", "2"));                        // id repetido
        await Rejects(Email("9inicio", "x@x", "1"));                                           // id inválido
        await Rejects(new ActionDef { Id = "ir", Type = Actions.Navigate });                   // ação de tela
        await Rejects(new ActionDef { Id = "pausa", Type = Actions.Wait, Params = { ["seconds"] = "99999" } });
        await Rejects(new ActionDef { Id = "lista", Type = Actions.ForEach });                 // sem lista
        await Rejects(new ActionDef { Id = "e", Type = Actions.SendEmail, Steps = [Email("f", "x@x", "1")] }); // filho fora de se/para cada
    }

    [Fact]
    public async Task So_quem_gerencia_executa_ve_execucoes_e_segredos()
    {
        var w = new World();
        var app = await CreateFlowAsync(w, null, Email("a", "x@corp.local", "oi"));
        w.As(FakeUsers.UserRh);

        await Assert.ThrowsAsync<ForbiddenException>(() => w.Flows.RunNowAsync(app.Id, Env.Prod));
        await Assert.ThrowsAsync<ForbiddenException>(() => w.Flows.ListAsync(app.Id, Env.Prod));
        await Assert.ThrowsAsync<ForbiddenException>(() => w.Secrets.ListAsync(w.Ti.Id));
        await Assert.ThrowsAsync<ForbiddenException>(() => w.As(FakeUsers.BuilderRh).Secrets.SetAsync(w.Ti.Id, "X", "y"));
        await Assert.ThrowsAsync<ValidationException>(() => w.As(FakeUsers.BuilderTi).Secrets.SetAsync(w.Ti.Id, "token-erp", "y"));
    }

    [Fact]
    public async Task Teste_roda_o_rascunho_e_historico_antigo_e_apagado()
    {
        var w = new World();
        var app = await CreateFlowAsync(w, null, Email("a", "x@corp.local", "oi"));

        var test = await w.As(FakeUsers.BuilderTi).Flows.RunNowAsync(app.Id, Env.Draft);
        await w.Runner.ProcessNextAsync();
        Assert.Equal(Env.Draft, test.Env);
        Assert.Equal(RunStatus.Succeeded, test.Status);

        test.CreatedAt = DateTime.UtcNow.AddDays(-31);
        Assert.Equal(1, await w.Runner.CleanupAsync(DateTime.UtcNow));
        Assert.Empty(w.RunStore.Steps);
    }
}

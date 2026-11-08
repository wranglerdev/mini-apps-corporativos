using Domain;

namespace Tests;

/// <summary>
/// Jornada 8: projetos que conversam. Mini app abre formulário (com valores), formulário redireciona por regra e
/// dispara workflow com entradas tipadas ("Chamado por outro projeto"). Ver DOCS/PRD.md e ADR 0019.
/// </summary>
public class ProjectLinkTests
{
    private static ActionDef Email(string subject) =>
        new() { Type = Actions.SendEmail, Params = { ["to"] = "rh@corp.local", ["subject"] = subject } };

    /// <summary>Workflow do RH com gatilho "call" e as entradas dadas; publicado.</summary>
    private static async Task<App> CreateCalledFlowAsync(World w, Workspace ws, List<VariableDef> inputs, bool publish = true, string trigger = Triggers.Call)
    {
        w.As(ws == w.Rh ? FakeUsers.BuilderRh : FakeUsers.BuilderTi);
        var app = await w.AppService.CreateAsync(ws.Id, "Tratar resposta", null, ProjectKinds.Workflow);
        var draft = JsonUtil.Clone(app.Draft);
        draft.Workflows[0].Trigger = new TriggerDef { Type = trigger, Inputs = inputs };
        draft.Workflows[0].Actions = [new ActionDef { Id = "avisar", Type = Actions.SendEmail, Params = { ["to"] = "rh@corp.local", ["subject"] = "{{input.nome}} deu {{input.nota}} ({{trigger.source}})" } }];
        await w.AppService.UpdateAsync(app.Id, new AppChanges(app.Name, null, draft, false, false, null));
        if (publish) await w.AppService.PublishAsync(app.Id);
        return app;
    }

    private static readonly List<VariableDef> Inputs = [new() { Name = "nome", Type = Variables.Text }, new() { Name = "nota", Type = Variables.Number, Default = "0" }];

    private static ActionDef Start(App flow, params (string Input, string Value)[] values)
    {
        var a = new ActionDef { Type = Actions.StartFlow, Params = { ["flowId"] = flow.Id.ToString() } };
        foreach (var (k, v) in values) a.Values[k] = v;
        return a;
    }

    [Fact]
    public async Task Resposta_do_formulario_dispara_workflow_com_entradas_tipadas()
    {
        var w = new World();
        var flow = await CreateCalledFlowAsync(w, w.Rh, Inputs);
        var onAnswer = new WorkflowDef
        {
            Name = "Mandar para o workflow", Trigger = new TriggerDef { Type = Triggers.RecordCreated, TableId = "respostas" },
            Actions = [Start(flow, ("nome", "{{Nome}}"), ("nota", "{{Nota}}"))]
        };
        var form = await w.CreateSurveyAsync(true, false, onAnswer);

        await w.As(FakeUsers.UserRh).FormService.SubmitAsync(form.Slug, new Dictionary<string, string?>
            { ["Nome"] = "Marina", ["Área"] = "TI", ["Nota"] = "9", ["Contato"] = "Não" }, null);
        await w.Runner.ProcessNextAsync();

        var run = w.RunStore.Runs.Single();
        Assert.Equal((flow.Id, Triggers.Call, Env.Prod, RunStatus.Succeeded), (run.AppId, run.Trigger, run.Env, run.Status));
        Assert.Equal("Marina deu 9 (Pesquisa de onboarding)", w.Email.Sent.Single().Subject);
    }

    [Fact]
    public async Task Mini_app_inicia_workflow_e_abre_formulario_com_valores()
    {
        var w = new World();
        var flow = await CreateCalledFlowAsync(w, w.Rh, Inputs);
        var form = await w.CreateSurveyAsync();
        var click = new WorkflowDef
        {
            Id = "seguir", Name = "Seguir",
            Actions =
            [
                Start(flow, ("nome", "{{user.name}}")),
                new ActionDef { Type = Actions.OpenLink, Params = { ["projectId"] = form.Id.ToString() }, Values = { ["Nome"] = "{{user.name}} Souza", ["Área"] = "" } }
            ]
        };
        var (app, _) = await w.CreateRhAppAsync(true, click);
        w.As(FakeUsers.UserRh);

        var prod = await w.WorkflowService.RunClickAsync(app.Id, Env.Prod, "seguir", new Dictionary<string, string?>());
        await w.Runner.ProcessNextAsync();
        w.As(FakeUsers.BuilderRh);
        var draft = await w.WorkflowService.RunClickAsync(app.Id, Env.Draft, "seguir", new Dictionary<string, string?>());

        Assert.Equal($"/f/{form.Slug}?Nome=Jo%C3%A3o%20Souza", prod.OpenUrl);
        Assert.Equal($"/f-preview/{form.Id}?Nome=Ana%20Souza", draft.OpenUrl);
        Assert.Contains(prod.Log, l => l.StartsWith("Workflow 'Tratar resposta' iniciado"));
        Assert.Equal("João deu 0 (Pedidos)", w.Email.Sent.First().Subject); // nota vazia = padrão
        Assert.Equal(Env.Draft, w.RunStore.Runs.Last().Env);                 // rascunho chama rascunho
    }

    [Fact]
    public async Task Entrada_fora_do_tipo_falha_o_workflow_com_mensagem_clara()
    {
        var w = new World();
        var flow = await CreateCalledFlowAsync(w, w.Rh, Inputs);
        var (app, _) = await w.CreateRhAppAsync(true, new WorkflowDef { Id = "b", Name = "B", Actions = [Start(flow, ("nota", "{{titulo}}"))] });

        await w.As(FakeUsers.UserRh).WorkflowService.RunClickAsync(app.Id, Env.Prod, "b", new Dictionary<string, string?> { ["titulo"] = "dez" });
        await w.Runner.ProcessNextAsync();

        Assert.Equal("Gatilho: entrada 'nota': 'dez' não é número.", w.RunStore.Runs.Single().Error);
    }

    [Fact]
    public async Task Acoes_entre_projetos_recusam_destino_invalido()
    {
        var w = new World();
        var otherWorkspace = await CreateCalledFlowAsync(w, w.Ti, Inputs);
        var manual = await CreateCalledFlowAsync(w, w.Rh, [], trigger: Triggers.Manual);
        var draftOnly = await CreateCalledFlowAsync(w, w.Rh, Inputs, publish: false);
        var (app, _) = await w.CreateRhAppAsync(true,
            new WorkflowDef { Id = "ti", Name = "1", Actions = [Start(otherWorkspace)] },
            new WorkflowDef { Id = "manual", Name = "2", Actions = [Start(manual)] },
            new WorkflowDef { Id = "rascunho", Name = "3", Actions = [Start(draftOnly)] },
            new WorkflowDef { Id = "js", Name = "4", Actions = [new ActionDef { Type = Actions.OpenLink, Params = { ["url"] = "javascript:alert(1)" } }] },
            new WorkflowDef { Id = "fluxo", Name = "5", Actions = [new ActionDef { Type = Actions.OpenLink, Params = { ["projectId"] = manual.Id.ToString() } }] });
        w.As(FakeUsers.UserRh);

        foreach (var id in new[] { "ti", "manual", "rascunho", "js", "fluxo" })
            await Assert.ThrowsAsync<ValidationException>(() => w.WorkflowService.RunClickAsync(app.Id, Env.Prod, id, new Dictionary<string, string?>()));
        Assert.Empty(w.RunStore.Runs);
    }

    [Fact]
    public async Task Formulario_redireciona_pela_primeira_regra_que_bater_ou_pelo_padrao()
    {
        var w = new World();
        var (app, _) = await w.CreateRhAppAsync();
        var form = await w.CreateSurveyAsync(publish: false);
        var draft = JsonUtil.Clone(form.Draft);
        draft.Form!.RedirectUrl = "https://intranet.corp.local/obrigado?nome={{Nome}}";
        draft.Form.RedirectRules = [new RedirectRule { Condition = new ConditionDef { Field = "Nota", Op = "gt", Value = "8" }, ProjectId = app.Id.ToString() }];
        await w.As(FakeUsers.BuilderRh).AppService.UpdateAsync(form.Id, new AppChanges(form.Name, null, draft, false, false, ["RH"]));
        await w.AppService.PublishAsync(form.Id);
        w.As(FakeUsers.UserRh);

        var happy = await w.FormService.SubmitAsync(form.Slug, new Dictionary<string, string?> { ["Nome"] = "Ana", ["Área"] = "TI", ["Nota"] = "9", ["Contato"] = "Não" }, null);
        var other = await w.FormService.SubmitAsync(form.Slug, new Dictionary<string, string?> { ["Nome"] = "Bia Lima", ["Área"] = "TI", ["Nota"] = "7", ["Contato"] = "Não" }, null);

        Assert.Equal($"/run/{app.Slug}", happy.RedirectUrl);
        Assert.Equal("https://intranet.corp.local/obrigado?nome=Bia%20Lima", other.RedirectUrl);
    }

    [Theory]
    [InlineData("javascript:alert(1)", null)]
    [InlineData("//evil.com", null)]
    [InlineData(null, "")] // regra sem destino
    public async Task Redirecionamento_invalido_e_recusado(string? url, string? ruleUrl)
    {
        var w = new World();
        var form = await w.CreateSurveyAsync(publish: false);
        var draft = JsonUtil.Clone(form.Draft);
        draft.Form!.RedirectUrl = url;
        if (ruleUrl is not null) draft.Form.RedirectRules = [new RedirectRule { Condition = new ConditionDef { Field = "Nota", Op = "gt", Value = "8" }, Url = ruleUrl }];

        await Assert.ThrowsAsync<ValidationException>(() =>
            w.As(FakeUsers.BuilderRh).AppService.UpdateAsync(form.Id, new AppChanges(form.Name, null, draft, false, false, ["RH"])));
    }

    [Fact]
    public async Task Esquema_de_entradas_invalido_e_recusado()
    {
        var w = new World();
        await Assert.ThrowsAsync<ValidationException>(() => CreateCalledFlowAsync(w, w.Rh, [new() { Name = "a b" }]));
        await Assert.ThrowsAsync<ValidationException>(() => CreateCalledFlowAsync(w, w.Rh, [new() { Name = "n", Type = Variables.Number, Default = "x" }]));
        await Assert.ThrowsAsync<ValidationException>(() => CreateCalledFlowAsync(w, w.Rh, [new() { Name = "a" }, new() { Name = "A" }]));
    }
}

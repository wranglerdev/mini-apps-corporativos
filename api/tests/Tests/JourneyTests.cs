using Domain;

namespace Tests;

// Suítes organizadas pela jornada do usuário (ver DOCS/TDD.md).

/// <summary>Jornada 1 — Builder cria, edita, publica, versiona e duplica um app.</summary>
public class BuildAndPublishTests
{
    [Fact]
    public async Task Builder_cria_app_no_workspace_do_seu_departamento()
    {
        var w = new World().As(FakeUsers.BuilderRh);
        var app = await w.AppService.CreateAsync(w.Rh.Id, "Férias", null);

        Assert.Single(await w.AppService.ListManagedAsync());
        Assert.Contains(w.Audit.Items, a => a.Action == "app.create" && a.EntityId == app.Id.ToString());
    }

    [Fact]
    public async Task Builder_nao_cria_app_em_outra_unidade_nem_usuario_acessa_editor()
    {
        var w = new World().As(FakeUsers.BuilderRh);
        await Assert.ThrowsAsync<ForbiddenException>(() => w.AppService.CreateAsync(w.Ti.Id, "X", null));

        var (app, _) = await w.CreateRhAppAsync();
        w.As(FakeUsers.UserRh);
        await Assert.ThrowsAsync<ForbiddenException>(() => w.AppService.GetAsync(app.Id));
    }

    [Fact]
    public async Task Publicar_congela_rascunho_e_usuario_ve_so_a_versao_publicada()
    {
        var w = new World();
        var (app, _) = await w.CreateRhAppAsync();

        var draft = JsonUtil.Clone(app.Draft);
        draft.Pages[0].Name = "Alterada no rascunho";
        await w.AppService.UpdateAsync(app.Id, new AppChanges(app.Name, null, draft, true, false, null));

        w.As(FakeUsers.UserRh);
        var scope = await w.AppService.OpenPublishedAsync(app.Slug);
        Assert.Equal("Início", scope.Definition.Pages[0].Name);
        Assert.Equal(1, app.PublishedVersion);
        await Assert.ThrowsAsync<ForbiddenException>(() => w.AppService.OpenAsync(app.Id, Env.Draft));
    }

    [Fact]
    public async Task Rollback_restaura_versao_anterior_como_nova_versao()
    {
        var w = new World();
        var (app, _) = await w.CreateRhAppAsync();
        var draft = JsonUtil.Clone(app.Draft);
        draft.Pages[0].Name = "V2";
        await w.AppService.UpdateAsync(app.Id, new AppChanges(app.Name, null, draft, true, false, null));
        await w.AppService.PublishAsync(app.Id);

        await w.AppService.RollbackAsync(app.Id, 1);

        Assert.Equal(3, app.PublishedVersion);
        Assert.Equal("Início", app.Published!.Pages[0].Name);
        Assert.Equal("Início", app.Draft.Pages[0].Name);
        Assert.Equal(3, (await w.AppService.VersionsAsync(app.Id)).Count);
    }

    [Fact]
    public async Task Builder_de_outra_unidade_duplica_app_do_catalogo_sem_os_dados()
    {
        var w = new World();
        var (app, table) = await w.CreateRhAppAsync();
        w.As(FakeUsers.UserRh);
        await w.RecordService.CreateAsync(app.Id, Env.Prod, table.Id, new Dictionary<string, string?> { ["Título"] = "A" });

        w.As(FakeUsers.BuilderTi);
        var copy = await w.AppService.DuplicateAsync(app.Id, w.Ti.Id, null);

        Assert.Equal(w.Ti.Id, copy.WorkspaceId);
        Assert.Null(copy.PublishedVersion);
        Assert.Single(copy.Draft.Tables);
        Assert.DoesNotContain(w.Records.Items, r => r.AppId == copy.Id);
    }

    [Fact]
    public async Task Criar_a_partir_de_template_da_biblioteca()
    {
        var w = new World().As(FakeUsers.Admin);
        var template = await w.AppService.CreateAsync(w.Ti.Id, "Template Checklist", null);
        template.IsTemplate = true;

        w.As(FakeUsers.BuilderRh);
        Assert.Single(await w.AppService.ListTemplatesAsync());
        var app = await w.AppService.CreateAsync(w.Rh.Id, "Meu checklist", template.Id);
        Assert.Equal("Meu checklist", app.Name);
        Assert.Equal(w.Rh.Id, app.WorkspaceId);
    }

    [Fact]
    public async Task Catalogo_respeita_departamentos_permitidos()
    {
        var w = new World();
        var (app, _) = await w.CreateRhAppAsync();
        await w.AppService.UpdateAsync(app.Id, new AppChanges(app.Name, null, app.Draft, true, false, ["RH"]));

        w.As(FakeUsers.UserRh);
        Assert.Single(await w.AppService.CatalogAsync());
        w.As(FakeUsers.UserFin);
        Assert.Empty(await w.AppService.CatalogAsync());
        await Assert.ThrowsAsync<ForbiddenException>(() => w.AppService.OpenPublishedAsync(app.Slug));
    }

    [Fact]
    public async Task Definicao_invalida_e_rejeitada()
    {
        var w = new World();
        var (app, _) = await w.CreateRhAppAsync(publish: false);
        var draft = JsonUtil.Clone(app.Draft);
        draft.Tables[0].Fields.Add(new FieldDef { Name = "Tipo", Type = FieldType.Select });

        await Assert.ThrowsAsync<ValidationException>(() =>
            w.AppService.UpdateAsync(app.Id, new AppChanges(app.Name, null, draft, false, false, null)));
    }
}

/// <summary>Jornada 2 — Usuário usa o app: CRUD automático, permissões por tabela/campo, CSV.</summary>
public class RecordTests
{
    private static Dictionary<string, string?> D(params (string K, string? V)[] kv) => kv.ToDictionary(x => x.K, x => x.V);

    [Fact]
    public async Task Cria_registro_valido_normalizando_tipos()
    {
        var w = new World();
        var (app, table) = await w.CreateRhAppAsync(); // como builder (Status é somente leitura para usuários)

        var r = await w.RecordService.CreateAsync(app.Id, Env.Prod, table.Id, D(("Título", "Notebook"), ("Valor", "1500,50"), ("Status", "pendente")));

        Assert.Equal("1500.5", r.Record.Data["Valor"]);
        Assert.Equal("Pendente", r.Record.Data["Status"]);
        Assert.Single(await w.RecordService.ListAsync(app.Id, Env.Prod, table.Id));
    }

    [Fact]
    public async Task Rejeita_obrigatorio_vazio_numero_invalido_e_opcao_inexistente()
    {
        var w = new World();
        var (app, table) = await w.CreateRhAppAsync();

        var ex = await Assert.ThrowsAsync<ValidationException>(() =>
            w.RecordService.CreateAsync(app.Id, Env.Prod, table.Id, D(("Valor", "abc"), ("Status", "Talvez"))));

        Assert.Contains("Título", ex.Message);
        Assert.Contains("Valor", ex.Message);
        Assert.Contains("Status", ex.Message);
    }

    [Fact]
    public async Task Campo_builders_only_e_invisivel_e_ignorado_para_usuario()
    {
        var w = new World();
        var (app, table) = await w.CreateRhAppAsync();
        w.As(FakeUsers.UserRh);
        var r = await w.RecordService.CreateAsync(app.Id, Env.Prod, table.Id, D(("Título", "A"), ("Custo interno", "999")));

        Assert.False(r.Record.Data.ContainsKey("Custo interno"));
        Assert.Null(w.Records.Items.Single().Data.GetValueOrDefault("Custo interno"));

        w.As(FakeUsers.BuilderRh);
        var list = await w.RecordService.ListAsync(app.Id, Env.Prod, table.Id);
        Assert.True(list.Single().Data.ContainsKey("Custo interno"));
    }

    [Fact]
    public async Task Permissao_de_tabela_bloqueia_edicao_e_exclusao_pelo_usuario()
    {
        var w = new World();
        var (app, table) = await w.CreateRhAppAsync();
        w.As(FakeUsers.UserRh);
        var r = await w.RecordService.CreateAsync(app.Id, Env.Prod, table.Id, D(("Título", "A")));

        await Assert.ThrowsAsync<ForbiddenException>(() => w.RecordService.UpdateAsync(app.Id, Env.Prod, table.Id, r.Record.Id, D(("Título", "B"))));
        await Assert.ThrowsAsync<ForbiddenException>(() => w.RecordService.DeleteAsync(app.Id, Env.Prod, table.Id, r.Record.Id));

        w.As(FakeUsers.BuilderRh);
        await w.RecordService.UpdateAsync(app.Id, Env.Prod, table.Id, r.Record.Id, D(("Título", "B")));
        Assert.Equal("B", w.Records.Items.Single().Data["Título"]);
    }

    [Fact]
    public async Task Rascunho_e_producao_tem_dados_separados()
    {
        var w = new World();
        var (app, table) = await w.CreateRhAppAsync();
        await w.RecordService.CreateAsync(app.Id, Env.Draft, table.Id, D(("Título", "teste")));

        Assert.Empty(await w.RecordService.ListAsync(app.Id, Env.Prod, table.Id));
        Assert.Single(await w.RecordService.ListAsync(app.Id, Env.Draft, table.Id));
    }

    [Fact]
    public async Task Exporta_e_importa_csv_reportando_linhas_invalidas()
    {
        var w = new World();
        var (app, table) = await w.CreateRhAppAsync();
        await w.RecordService.CreateAsync(app.Id, Env.Prod, table.Id, D(("Título", "Cadeira; azul"), ("Valor", "10")));

        var export = await w.RecordService.ExportAsync(app.Id, Env.Prod, table.Id, "csv");
        var text = System.Text.Encoding.UTF8.GetString(export.Content).TrimStart('﻿');
        Assert.StartsWith("Título;Valor;Status;Aprovador;Custo interno", text);
        Assert.Contains("\"Cadeira; azul\";10", text);

        var result = await w.RecordService.ImportAsync(app.Id, Env.Prod, table.Id,
            new MemoryStream(System.Text.Encoding.UTF8.GetBytes("Título,Valor\nMesa,20\n,30\n")));
        Assert.Equal(1, result.Imported);
        Assert.Single(result.Errors);
        Assert.Equal(2, (await w.RecordService.ListAsync(app.Id, Env.Prod, table.Id)).Count);
    }
}

/// <summary>Jornada 3 — Workflows: gatilho → condição → ações.</summary>
public class WorkflowTests
{
    [Fact]
    public async Task Clique_cria_registro_com_inputs_envia_email_e_navega()
    {
        var wf = new WorkflowDef
        {
            Id = "wf1", Name = "Enviar",
            Actions =
            [
                new ActionDef { Type = Actions.CreateRecord, Params = { ["tableId"] = "pedidos" }, Values = { ["Título"] = "{{titulo}}" } },
                new ActionDef { Type = Actions.SendEmail, Params = { ["to"] = "{{user.email}}", ["subject"] = "Criado: {{titulo}}" } },
                new ActionDef { Type = Actions.Navigate, Params = { ["pageId"] = "obrigado" } }
            ]
        };
        var w = new World();
        var (app, _) = await w.CreateRhAppAsync(true, wf);
        w.As(FakeUsers.UserRh);

        var result = await w.WorkflowService.RunClickAsync(app.Id, Env.Prod, "wf1", new Dictionary<string, string?> { ["titulo"] = "Cadeira" });

        Assert.Equal("Cadeira", w.Records.Items.Single().Data["Título"]);
        Assert.Equal(new EmailMessage("joao@corp.local", "Criado: Cadeira", ""), w.Email.Sent.Single());
        Assert.Equal("obrigado", result.NavigateTo);
    }

    [Fact]
    public async Task Gatilho_de_registro_com_condicao_falsa_nao_executa_acoes()
    {
        var wf = new WorkflowDef
        {
            Name = "Alerta", Trigger = new TriggerDef { Type = Triggers.RecordCreated, TableId = "pedidos" },
            Condition = new ConditionDef { Field = "Valor", Op = "gt", Value = "1000" },
            Actions = [new ActionDef { Type = Actions.SendEmail, Params = { ["to"] = "fin@corp.local", ["subject"] = "Alto: {{Título}}" } }]
        };
        var w = new World();
        var (app, table) = await w.CreateRhAppAsync(true, wf);
        w.As(FakeUsers.UserRh);

        await w.RecordService.CreateAsync(app.Id, Env.Prod, table.Id, new Dictionary<string, string?> { ["Título"] = "Barato", ["Valor"] = "50" });
        Assert.Empty(w.Email.Sent);

        await w.RecordService.CreateAsync(app.Id, Env.Prod, table.Id, new Dictionary<string, string?> { ["Título"] = "Caro", ["Valor"] = "5000" });
        Assert.Equal("Alto: Caro", w.Email.Sent.Single().Subject);
    }

    [Fact]
    public async Task Acao_callApi_chama_conector_com_template()
    {
        var wf = new WorkflowDef
        {
            Id = "api", Name = "Webhook",
            Actions = [new ActionDef { Type = Actions.CallApi, Params = { ["url"] = "https://erp.local/hook", ["body"] = "{\"t\":\"{{titulo}}\"}" } }]
        };
        var w = new World();
        var (app, _) = await w.CreateRhAppAsync(true, wf);

        await w.WorkflowService.RunClickAsync(app.Id, Env.Prod, "api", new Dictionary<string, string?> { ["titulo"] = "X" });

        Assert.Equal(("POST", "https://erp.local/hook", "{\"t\":\"X\"}"), w.Http.Calls.Single());
    }
}

/// <summary>Jornada 4 — Fluxo de aprovação: solicitação → aprovador → status.</summary>
public class ApprovalTests
{
    private static WorkflowDef ApprovalFlow() => new()
    {
        Name = "Aprovação", Trigger = new TriggerDef { Type = Triggers.RecordCreated, TableId = "pedidos" },
        Actions = [new ActionDef { Type = Actions.RequestApproval, Params = { ["approver"] = "{{Aprovador}}", ["title"] = "{{Título}}" } }]
    };

    [Fact]
    public async Task Solicitacao_vira_pendente_e_aprovador_aprova()
    {
        var w = new World();
        var (app, table) = await w.CreateRhAppAsync(true, ApprovalFlow());
        w.As(FakeUsers.UserRh);
        await w.RecordService.CreateAsync(app.Id, Env.Prod, table.Id,
            new Dictionary<string, string?> { ["Título"] = "Notebook", ["Aprovador"] = "ana@corp.local" });

        var record = w.Records.Items.Single();
        Assert.Equal("Pendente", record.Data["Status"]);
        Assert.Equal("ana@corp.local", w.Email.Sent.Single().To);

        w.As(FakeUsers.BuilderRh);
        var pending = Assert.Single(await w.ApprovalService.ListMineAsync());
        await w.ApprovalService.DecideAsync(pending.Id, approve: true, "ok");

        Assert.Equal("Aprovado", record.Data["Status"]);
        Assert.Equal(ApprovalStatus.Approved, pending.Status);
        Assert.Equal("joao@corp.local", w.Email.Sent.Last().To);
        Assert.Contains(w.Audit.Items, a => a.Action == "approval.decide");
    }

    [Fact]
    public async Task Somente_o_aprovador_decide_e_apenas_uma_vez()
    {
        var w = new World();
        var (app, table) = await w.CreateRhAppAsync(true, ApprovalFlow());
        w.As(FakeUsers.UserRh);
        await w.RecordService.CreateAsync(app.Id, Env.Prod, table.Id,
            new Dictionary<string, string?> { ["Título"] = "X", ["Aprovador"] = "ana@corp.local" });
        var approval = w.ApprovalsRepo.Items.Single();

        await Assert.ThrowsAsync<ForbiddenException>(() => w.ApprovalService.DecideAsync(approval.Id, true, null));

        w.As(FakeUsers.BuilderRh);
        await w.ApprovalService.DecideAsync(approval.Id, false, null);
        await Assert.ThrowsAsync<ValidationException>(() => w.ApprovalService.DecideAsync(approval.Id, true, null));
    }
}

/// <summary>RBAC — matriz de acesso central.</summary>
public class AccessRulesTests
{
    private static readonly Workspace Rh = new() { Department = "RH" };

    [Theory]
    [InlineData(Role.Admin, "Governança", true)]
    [InlineData(Role.Builder, "RH", true)]
    [InlineData(Role.Builder, "TI", false)]
    [InlineData(Role.User, "RH", false)]
    public void CanManage(Role role, string dept, bool expected) =>
        Assert.Equal(expected, AccessRules.CanManage(new CurrentUser("x", "x", role, dept), Rh));

    [Fact]
    public void App_nao_publicado_nao_abre_em_producao()
    {
        var app = new App();
        Assert.False(AccessRules.CanUseEnv(FakeUsers.Admin, app, Rh, Env.Prod));
        app.PublishedVersion = 1;
        Assert.True(AccessRules.CanUseEnv(FakeUsers.UserFin, app, Rh, Env.Prod));
    }
}

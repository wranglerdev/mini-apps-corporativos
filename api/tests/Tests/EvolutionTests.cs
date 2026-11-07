using System.Text;
using Domain;

namespace Tests;

// Evoluções do PRD após o MVP (ver DOCS/TDD.md).

/// <summary>Permissão por campo: somente leitura para usuários.</summary>
public class ReadOnlyFieldTests
{
    [Fact]
    public async Task Usuario_ve_mas_nao_altera_campo_somente_leitura()
    {
        var w = new World();
        var (app, table) = await w.CreateRhAppAsync();
        w.As(FakeUsers.UserRh);

        var created = await w.RecordService.CreateAsync(app.Id, Env.Prod, table.Id,
            new Dictionary<string, string?> { ["Título"] = "A", ["Status"] = "Aprovado" });

        Assert.True(created.Record.Data.ContainsKey("Status"));
        Assert.Null(created.Record.Data["Status"]);
    }
}

/// <summary>Renomear campo não perde dados (rascunho ao salvar, produção ao publicar).</summary>
public class FieldRenameTests
{
    [Fact]
    public async Task Renomear_migra_rascunho_ao_salvar_e_producao_ao_publicar()
    {
        var w = new World();
        var (app, table) = await w.CreateRhAppAsync();
        await w.RecordService.CreateAsync(app.Id, Env.Draft, table.Id, new Dictionary<string, string?> { ["Título"] = "rascunho" });
        await w.RecordService.CreateAsync(app.Id, Env.Prod, table.Id, new Dictionary<string, string?> { ["Título"] = "produção" });

        var draft = JsonUtil.Clone(app.Draft);
        draft.Tables[0].Fields[0].Name = "Assunto";
        await w.AppService.UpdateAsync(app.Id, new AppChanges(app.Name, null, draft, true, false, null));

        Assert.Equal("rascunho", (await w.RecordService.ListAsync(app.Id, Env.Draft, table.Id)).Single().Data["Assunto"]);
        Assert.Equal("produção", (await w.RecordService.ListAsync(app.Id, Env.Prod, table.Id)).Single().Data["Título"]);

        await w.AppService.PublishAsync(app.Id);
        Assert.Equal("produção", (await w.RecordService.ListAsync(app.Id, Env.Prod, table.Id)).Single().Data["Assunto"]);
    }

    [Fact]
    public async Task Rollback_desfaz_o_renome_nos_dados()
    {
        var w = new World();
        var (app, table) = await w.CreateRhAppAsync();
        await w.RecordService.CreateAsync(app.Id, Env.Prod, table.Id, new Dictionary<string, string?> { ["Título"] = "X" });
        var draft = JsonUtil.Clone(app.Draft);
        draft.Tables[0].Fields[0].Name = "Assunto";
        await w.AppService.UpdateAsync(app.Id, new AppChanges(app.Name, null, draft, true, false, null));
        await w.AppService.PublishAsync(app.Id);

        await w.AppService.RollbackAsync(app.Id, 1);

        Assert.Equal("X", (await w.RecordService.ListAsync(app.Id, Env.Prod, table.Id)).Single().Data["Título"]);
    }
}

/// <summary>Anexos isolados por app.</summary>
public class FileTests
{
    [Fact]
    public async Task Quem_acessa_o_app_envia_e_baixa_quem_nao_acessa_e_bloqueado()
    {
        var w = new World();
        var (app, _) = await w.CreateRhAppAsync();
        await w.AppService.UpdateAsync(app.Id, new AppChanges(app.Name, null, app.Draft, true, false, ["RH"]));

        w.As(FakeUsers.UserRh);
        var file = await w.FileService.UploadAsync(app.Id, Env.Prod, "nota.pdf", new MemoryStream(Encoding.UTF8.GetBytes("pdf")));
        var (stored, content) = await w.FileService.OpenAsync(app.Id, Env.Prod, file.Id);
        Assert.Equal("nota.pdf", stored.Name);
        Assert.Equal("pdf", new StreamReader(content).ReadToEnd());

        w.As(FakeUsers.UserFin);
        await Assert.ThrowsAsync<ForbiddenException>(() => w.FileService.OpenAsync(app.Id, Env.Prod, file.Id));
    }

    [Fact]
    public async Task Arquivo_de_um_app_nao_e_encontrado_por_outro()
    {
        var w = new World();
        var (app, _) = await w.CreateRhAppAsync();
        var other = await w.AppService.CreateAsync(w.Rh.Id, "Outro", null);
        var file = await w.FileService.UploadAsync(app.Id, Env.Draft, "a.txt", new MemoryStream([1]));

        await Assert.ThrowsAsync<NotFoundException>(() => w.FileService.OpenAsync(other.Id, Env.Draft, file.Id));
    }
}

/// <summary>Webhook de entrada (conector REST genérico).</summary>
public class WebhookTests
{
    private static async Task<(World W, App App, TableDef Table)> SetupAsync(string? key, params WorkflowDef[] workflows)
    {
        var w = new World();
        var (app, table) = await w.CreateRhAppAsync(false, workflows);
        var draft = JsonUtil.Clone(app.Draft);
        draft.Tables[0].WebhookKey = key;
        await w.AppService.UpdateAsync(app.Id, new AppChanges(app.Name, null, draft, true, false, null));
        await w.AppService.PublishAsync(app.Id);
        return (w, app, table);
    }

    [Fact]
    public async Task Chave_correta_cria_registro_em_producao_e_dispara_workflow()
    {
        var wf = new WorkflowDef
        {
            Name = "Avisar", Trigger = new TriggerDef { Type = Triggers.RecordCreated, TableId = "pedidos" },
            Actions = [new ActionDef { Type = Actions.SendEmail, Params = { ["to"] = "rh@corp.local", ["subject"] = "ERP: {{Título}}" } }]
        };
        var (w, app, table) = await SetupAsync("segredo", wf);

        var r = await w.RecordService.ReceiveWebhookAsync(app.Id, table.Id, "segredo",
            new Dictionary<string, string?> { ["Título"] = "Pedido 42", ["Custo interno"] = "10" });

        Assert.Equal("webhook", r.Record.CreatedBy);
        Assert.Equal(Env.Prod, r.Record.Env);
        Assert.Equal("10", r.Record.Data["Custo interno"]);
        Assert.Equal("ERP: Pedido 42", w.Email.Sent.Single().Subject);
        Assert.Contains(w.Audit.Items, a => a.Action == "record.webhook");
    }

    [Theory]
    [InlineData("segredo", "errado")]
    [InlineData("segredo", null)]
    [InlineData(null, "qualquer")]
    public async Task Chave_errada_ausente_ou_webhook_desligado_e_bloqueado(string? configured, string? sent)
    {
        var (w, app, table) = await SetupAsync(configured);
        await Assert.ThrowsAsync<ForbiddenException>(() =>
            w.RecordService.ReceiveWebhookAsync(app.Id, table.Id, sent, new Dictionary<string, string?> { ["Título"] = "X" }));
        Assert.Empty(w.Records.Items);
    }

    [Fact]
    public async Task App_nao_publicado_nao_recebe_webhook()
    {
        var w = new World();
        var (app, table) = await w.CreateRhAppAsync(publish: false);
        await Assert.ThrowsAsync<ValidationException>(() =>
            w.RecordService.ReceiveWebhookAsync(app.Id, table.Id, "x", new Dictionary<string, string?>()));
    }
}

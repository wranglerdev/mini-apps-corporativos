using System.Text.Json.Nodes;
using Domain;

namespace Tests;

/// <summary>Jornada 7: variáveis do workflow (tipo, padrão, apelido) e operações do "Transformar". Ver DOCS/PRD-WORKFLOWS.md.</summary>
public class VariableTests
{
    private static ActionDef Email(string id, string subject) =>
        new() { Id = id, Type = Actions.SendEmail, Params = { ["to"] = "gestor@corp.local", ["subject"] = subject } };

    private static TransformOp Op(string target, string op, string? input, string? arg = null) => new() { Target = target, Op = op, Input = input, Arg = arg };

    private static async Task<App> CreateAsync(World w, TriggerDef? trigger, List<VariableDef> vars, params ActionDef[] steps)
    {
        w.As(FakeUsers.BuilderTi);
        var app = await w.AppService.CreateAsync(w.Ti.Id, "Pedidos", null, ProjectKinds.Workflow);
        var draft = JsonUtil.Clone(app.Draft);
        draft.Workflows[0].Actions = [.. steps];
        draft.Workflows[0].Variables = vars;
        if (trigger is not null) draft.Workflows[0].Trigger = trigger;
        await w.AppService.UpdateAsync(app.Id, new AppChanges(app.Name, null, draft, false, false, null));
        await w.AppService.PublishAsync(app.Id);
        return app;
    }

    [Fact]
    public async Task Corpo_do_webhook_vira_variavel_tipada_e_o_transformar_calcula_com_operacoes()
    {
        var w = new World();
        var app = await CreateAsync(w, new TriggerDef { Type = Triggers.Webhook, WebhookKey = "k" },
            [
                new() { Name = "pedido", Type = Variables.Object, From = "trigger.body.pedido" },
                new() { Name = "cliente", Type = Variables.Text, From = "trigger.body.cliente" },
                new() { Name = "precos", Type = Variables.List },
                new() { Name = "total", Type = Variables.Number },
                new() { Name = "nome", Type = Variables.Text, Default = "sem nome" },
                new() { Name = "aprovado", Type = Variables.Boolean, Default = "não" },
                new() { Name = "vence", Type = Variables.Date },
            ],
            new ActionDef
            {
                Id = "calc", Type = Actions.Transform,
                Ops =
                [
                    Op("precos", "pluck", "{{pedido.itens}}", "preco"),
                    Op("total", "sum", "{{precos}}"),
                    Op("total", "multiply", "{{total}}", "2"),
                    Op("nome", "upper", "{{cliente}}"),
                    Op("vence", "addDays", "{{pedido.data}}", "30"),
                ]
            },
            Email("avisar", "Pedido {{pedido.numero}} de {{nome}}: {{total}} ({{aprovado}}) vence {{vence}}"));

        await w.Flows.ReceiveWebhookAsync(app.Id, "k", JsonNode.Parse(
            """{"cliente":" ana ","pedido":{"numero":"42","data":"2026-11-01","itens":[{"preco":"10,5"},{"preco":2}]}}"""));
        await w.Runner.ProcessNextAsync();

        Assert.Equal(RunStatus.Succeeded, w.RunStore.Runs.Single().Status);
        Assert.Equal("Pedido 42 de ANA: 25 (false) vence 2026-12-01", w.Email.Sent.Single().Subject);
        Assert.Contains("\"total\":25", w.RunStore.Steps.Single(s => s.StepId == "calc").Output);
    }

    [Fact]
    public async Task Variavel_vazia_usa_o_padrao_e_apelido_so_vale_depois_do_caminho_existir()
    {
        var w = new World();
        w.Http.Responses.Enqueue(new HttpCallResult(200, """{"status":"aberto"}"""));
        var app = await CreateAsync(w, null,
            [
                new() { Name = "situacao", Type = Variables.Text, Default = "desconhecida", From = "steps.api1.body.status" },
                new() { Name = "responsavel", Type = Variables.Text, Default = "fila", From = "steps.api1.body.responsavel" },
                new() { Name = "tentativas", Type = Variables.Number },
            ],
            Email("antes", "{{situacao}}/{{tentativas}}"),
            new ActionDef { Id = "api1", Type = Actions.CallApi, Params = { ["method"] = "GET", ["url"] = "https://erp/x" } },
            Email("depois", "{{situacao}}/{{responsavel}}"));

        await w.As(FakeUsers.BuilderTi).Flows.RunNowAsync(app.Id, Env.Prod);
        await w.Runner.ProcessNextAsync();

        Assert.Equal(["desconhecida/0", "aberto/fila"], w.Email.Sent.Select(e => e.Subject));
    }

    [Fact]
    public async Task Valor_incompativel_com_o_tipo_falha_o_passo_com_mensagem_clara()
    {
        var w = new World();
        var app = await CreateAsync(w, null, [new() { Name = "total", Type = Variables.Number }],
            new ActionDef { Id = "calc", Type = Actions.Transform, Ops = [Op("total", "set", "abc")] });

        await w.As(FakeUsers.BuilderTi).Flows.RunNowAsync(app.Id, Env.Prod);
        await w.Runner.ProcessNextAsync();

        var run = w.RunStore.Runs.Single();
        Assert.Equal(RunStatus.Failed, run.Status);
        Assert.Equal("Passo 'calc': set em 'total': 'abc' não é número.", run.Error);
    }

    [Theory]
    [InlineData("number", "12,5", 12.5)]
    [InlineData("boolean", "Sim", true)]
    [InlineData("date", "05/11/2026", "2026-11-05")]
    [InlineData("text", "  oi ", "oi")]
    public void Converte_para_o_tipo(string type, string input, object expected)
    {
        var node = Variables.Coerce(type, JsonValue.Create(input));
        Assert.Equal(JsonValue.Create(expected)!.ToJsonString(), node!.ToJsonString());
    }

    [Theory]
    [InlineData("list", "[]")]
    [InlineData("object", "{}")]
    [InlineData("number", "0")]
    [InlineData("boolean", "false")]
    public void Vazio_vira_o_vazio_do_tipo(string type, string expected) =>
        Assert.Equal(expected, Variables.Coerce(type, JsonValue.Create(""))!.ToJsonString());

    [Fact]
    public async Task Variaveis_e_operacoes_invalidas_sao_recusadas()
    {
        var w = new World().As(FakeUsers.BuilderTi);
        var app = await w.AppService.CreateAsync(w.Ti.Id, "X", null, ProjectKinds.Workflow);
        async Task Rejects(List<VariableDef> vars, params TransformOp[] ops)
        {
            var d = JsonUtil.Clone(app.Draft);
            d.Workflows[0].Variables = vars;
            d.Workflows[0].Actions = [new ActionDef { Id = "t", Type = Actions.Transform, Ops = [.. ops] }];
            await Assert.ThrowsAsync<ValidationException>(() => w.AppService.UpdateAsync(app.Id, new AppChanges("X", null, d, false, false, null)));
        }

        await Rejects([new() { Name = "steps" }]);                                                   // nome reservado
        await Rejects([new() { Name = "1x" }]);                                                      // nome inválido
        await Rejects([new() { Name = "a" }, new() { Name = "A" }]);                                 // repetida
        await Rejects([new() { Name = "n", Type = Variables.Number, Default = "dez" }]);             // padrão fora do tipo
        await Rejects([new() { Name = "c", From = "{{trigger.body}}" }]);                             // apelido é caminho
        await Rejects([], Op("naoExiste", "set", "1"));                                               // destino inexistente
        await Rejects([new() { Name = "c", From = "trigger.body" }], Op("c", "set", "1"));            // destino é apelido
        await Rejects([new() { Name = "n", Type = Variables.Number }], Op("n", "explodir", "1"));    // operação desconhecida
        await Rejects([new() { Name = "n", Type = Variables.Number }], Op("n", "add", "1", "dois")); // argumento não numérico
    }

    // ---------- Automações de mini app e formulário (WorkflowEngine) ----------

    [Fact]
    public async Task Automacao_de_clique_usa_variaveis_apelido_da_resposta_da_api_e_transformar()
    {
        var w = new World();
        w.Http.Responses.Enqueue(new HttpCallResult(200, """{"itens":[{"v":2},{"v":3}]}"""));
        var click = new WorkflowDef
        {
            Id = "resumo", Name = "Resumo",
            Variables =
            [
                new() { Name = "resposta", Type = Variables.Object, From = "api.response" },
                new() { Name = "total", Type = Variables.Number },
                new() { Name = "nome", Type = Variables.Text, Default = "anônimo" },
            ],
            Actions =
            [
                new ActionDef { Type = Actions.CallApi, Params = { ["method"] = "GET", ["url"] = "https://erp/itens" } },
                new ActionDef { Type = Actions.Transform, Ops = [Op("total", "count", "{{resposta.itens}}"), Op("nome", "upper", "{{titulo}}")] },
                Email("avisar", "{{nome}}: {{total}} itens"),
            ]
        };
        var (app, _) = await w.CreateRhAppAsync(true, click);

        await w.WorkflowService.RunClickAsync(app.Id, Env.Prod, "resumo", new Dictionary<string, string?> { ["titulo"] = "cadeira" });
        // sem título: upper de vazio é vazio, e vazio vale o padrão
        await w.WorkflowService.RunClickAsync(app.Id, Env.Prod, "resumo", new Dictionary<string, string?>());

        Assert.Equal(["CADEIRA: 2 itens", "anônimo: 0 itens"], w.Email.Sent.Select(e => e.Subject));
    }

    [Fact]
    public async Task Automacao_de_registro_criado_le_campos_e_grava_em_variavel_tipada()
    {
        // Mesmo caminho das respostas de formulário: gatilho "registro criado" na tabela.
        var click = new WorkflowDef
        {
            Id = "abrir", Name = "Abrir",
            Actions = [new ActionDef { Type = Actions.CreateRecord, Params = { ["tableId"] = "pedidos" }, Values = { ["Título"] = "Mesa", ["Valor"] = "{{valor}}" } }]
        };
        var onCreated = new WorkflowDef
        {
            Name = "Com frete", Trigger = new TriggerDef { Type = Triggers.RecordCreated, TableId = "pedidos" },
            Variables = [new() { Name = "comFrete", Type = Variables.Number }],
            Actions = [new ActionDef { Type = Actions.Transform, Ops = [Op("comFrete", "add", "{{Valor}}", "15,5")] }, Email("x", "{{Título}}: {{comFrete}}")]
        };
        var w = new World();
        var (app, _) = await w.CreateRhAppAsync(true, click, onCreated);

        await w.WorkflowService.RunClickAsync(app.Id, Env.Prod, "abrir", new Dictionary<string, string?> { ["valor"] = "100" });

        Assert.Equal("Mesa: 115.5", w.Email.Sent.Single().Subject);
    }

    [Fact]
    public async Task Automacao_recusa_variavel_que_esconde_campo_e_passos_so_de_workflow()
    {
        var w = new World();
        async Task Rejects(WorkflowDef wf) =>
            await Assert.ThrowsAsync<ValidationException>(() => w.CreateRhAppAsync(false, wf));

        await Rejects(new WorkflowDef { Name = "a", Variables = [new() { Name = "Valor" }] });                       // esconde o campo
        await Rejects(new WorkflowDef { Name = "b", Actions = [new ActionDef { Type = Actions.Wait, Params = { ["seconds"] = "1" } }] });
        await Rejects(new WorkflowDef { Name = "c", Actions = [new ActionDef { Type = Actions.Transform, Ops = [Op("x", "set", "1")] }] });
    }
}

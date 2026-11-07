using Domain;

namespace Tests;

/// <summary>Jornada 6: formulário (criar, responder seguindo a lógica, link público, resumo). Ver DOCS/PRD-FORMS.md.</summary>
public class FormTests
{
    private static Dictionary<string, string?> Answers(params (string Field, string? Value)[] pairs) =>
        pairs.ToDictionary(p => p.Field, p => p.Value);

    /// <summary>Respostas de quem deu nota alta e aceitou contato (caminho q1, q2, q3, q5, q6).</summary>
    private static Dictionary<string, string?> HighScore() =>
        Answers(("Nome", "Marina"), ("Área", "TI"), ("Nota", "9"), ("Contato", "Sim"), ("E-mail", "marina@corp.local"));

    [Fact]
    public async Task Criar_formulario_nasce_com_tabela_de_respostas_e_uma_pergunta()
    {
        var w = new World().As(FakeUsers.BuilderRh);
        var form = await w.AppService.CreateAsync(w.Rh.Id, "Inscrição", null, ProjectKinds.Form);
        var app = await w.AppService.CreateAsync(w.Rh.Id, "Pedidos", null);

        Assert.Equal(ProjectKinds.Form, form.Kind);
        Assert.Equal(ProjectKinds.App, app.Kind);
        Assert.Empty(form.Draft.Pages);
        var question = form.Draft.Form!.Questions.Single();
        Assert.Contains(form.Draft.Tables.Single().Fields, f => f.Id == question.FieldId);
        form.Draft.Validate(); // válido sem páginas
        await Assert.ThrowsAsync<ValidationException>(() => w.AppService.CreateAsync(w.Rh.Id, "X", null, "planilha"));
    }

    [Fact]
    public async Task Tipo_do_projeto_nao_muda_ao_salvar()
    {
        var w = new World();
        var app = await w.CreateSurveyAsync(publish: false);
        var semFormulario = JsonUtil.Clone(app.Draft);
        semFormulario.Form = null;
        semFormulario.Pages.Add(new PageDef());

        await Assert.ThrowsAsync<ValidationException>(() =>
            w.AppService.UpdateAsync(app.Id, new AppChanges(app.Name, null, semFormulario, false, false, null)));
    }

    [Fact]
    public async Task Caminho_segue_a_logica_de_pulo()
    {
        var w = new World();
        var app = await w.CreateSurveyAsync(publish: false);
        var form = app.Draft.Form!;
        var table = app.Draft.Tables.Single();
        string Path(Dictionary<string, string?> a) => string.Join(",", FormFlow.Path(form, table, a).Select(q => q.Id));

        Assert.Equal("q1,q2,q3,q5,q6", Path(HighScore()));
        Assert.Equal("q1,q2,q3,q4,q5,q6", Path(Answers(("Nota", "6"), ("Contato", "Sim"))));
        Assert.Equal("q1,q2,q3,q5", Path(Answers(("Nota", "8"), ("Contato", "Não"))));
        Assert.Equal("q1,q2,q3,q4,q5,q6", Path([])); // sem respostas: segue em frente
    }

    [Fact]
    public async Task Envio_grava_so_o_caminho_em_producao_e_dispara_automacao()
    {
        var avisar = new WorkflowDef
        {
            Name = "Avisar RH", Trigger = new TriggerDef { Type = Triggers.RecordCreated, TableId = "respostas" },
            Actions = [new ActionDef { Type = Actions.SendEmail, Params = { ["to"] = "rh@corp.local", ["subject"] = "Nota {{Nota}} de {{Nome}}" } }]
        };
        var w = new World();
        var app = await w.CreateSurveyAsync(true, false, avisar);
        w.As(FakeUsers.UserRh);

        var answers = HighScore();
        answers["Melhorias"] = "não deveria entrar (fora do caminho)";
        var result = await w.FormService.SubmitAsync(app.Slug, answers, honeypot: null);

        var record = w.Records.Items.Single();
        Assert.Equal(result.RecordId, record.Id);
        Assert.Equal(Env.Prod, record.Env);
        Assert.Equal("joao@corp.local", record.CreatedBy);
        Assert.Equal("9", record.Data["Nota"]);
        Assert.False(record.Data.ContainsKey("Melhorias"));
        Assert.Equal("Nota 9 de Marina", w.Email.Sent.Single().Subject);
        Assert.Contains(w.Audit.Items, a => a.Action == "form.submit");
    }

    [Fact]
    public async Task Obrigatoria_no_caminho_e_exigida_e_fora_do_caminho_nao()
    {
        var w = new World();
        var app = await w.CreateSurveyAsync();
        w.As(FakeUsers.UserRh);

        // Nota baixa passa pela q4 (Melhorias, obrigatória) sem responder.
        var low = Answers(("Nome", "Pedro"), ("Área", "RH"), ("Nota", "5"), ("Contato", "Não"));
        var ex = await Assert.ThrowsAsync<ValidationException>(() => w.FormService.SubmitAsync(app.Slug, low, null));
        Assert.Contains("O que melhorar?", ex.Message);

        // "Não" no contato encerra: E-mail (obrigatório) não é exigido.
        await w.FormService.SubmitAsync(app.Slug, Answers(("Nome", "Ana"), ("Área", "RH"), ("Nota", "10"), ("Contato", "Não")), null);
        Assert.Single(w.Records.Items);
    }

    [Fact]
    public async Task Email_e_escala_invalidos_sao_recusados()
    {
        var w = new World();
        var app = await w.CreateSurveyAsync();
        w.As(FakeUsers.UserRh);

        var badEmail = HighScore();
        badEmail["E-mail"] = "marina";
        await Assert.ThrowsAsync<ValidationException>(() => w.FormService.SubmitAsync(app.Slug, badEmail, null));

        var badScore = HighScore();
        badScore["Nota"] = "11";
        await Assert.ThrowsAsync<ValidationException>(() => w.FormService.SubmitAsync(app.Slug, badScore, null));
        Assert.Empty(w.Records.Items);
    }

    [Fact]
    public async Task Sem_link_publico_so_quem_tem_acesso_responde()
    {
        var w = new World();
        var app = await w.CreateSurveyAsync(isPublic: false);

        await Assert.ThrowsAsync<ForbiddenException>(() => w.As(FakeUsers.UserFin).FormService.OpenAsync(app.Slug));
        await Assert.ThrowsAsync<UnauthorizedException>(() => w.As(null).FormService.SubmitAsync(app.Slug, HighScore(), null));
        Assert.Empty(w.Records.Items);
    }

    [Fact]
    public async Task Link_publico_aceita_sem_login_como_anonimo_e_governanca_pode_desligar()
    {
        var w = new World();
        var app = await w.CreateSurveyAsync(isPublic: true);
        w.As(null);

        var view = await w.FormService.OpenAsync(app.Slug);
        Assert.Equal(6, view.Fields.Count);
        await w.FormService.SubmitAsync(app.Slug, HighScore(), null);
        Assert.Equal("anonimo", w.Records.Items.Single().CreatedBy);

        // Outro departamento logado também responde pelo link público.
        await w.As(FakeUsers.UserFin).FormService.SubmitAsync(app.Slug, HighScore(), null);
        Assert.Equal(2, w.Records.Items.Count);

        w.FormSettings = new FormSettings(AllowPublic: false);
        await Assert.ThrowsAsync<UnauthorizedException>(() => w.As(null).FormService.OpenAsync(app.Slug));
    }

    [Fact]
    public async Task Robo_que_preenche_campo_escondido_nao_grava()
    {
        var w = new World();
        var app = await w.CreateSurveyAsync(isPublic: true);
        w.As(null);

        var result = await w.FormService.SubmitAsync(app.Slug, HighScore(), honeypot: "http://spam");

        Assert.Null(result.RecordId);
        Assert.Empty(w.Records.Items);
    }

    [Fact]
    public async Task Rascunho_testa_sem_publicar_e_so_quem_gerencia()
    {
        var w = new World();
        var app = await w.CreateSurveyAsync(publish: false);

        await Assert.ThrowsAsync<NotFoundException>(() => w.As(FakeUsers.UserRh).FormService.OpenAsync(app.Slug));
        await Assert.ThrowsAsync<ForbiddenException>(() => w.FormService.OpenDraftAsync(app.Id));

        w.As(FakeUsers.BuilderRh);
        Assert.Equal(Env.Draft, (await w.FormService.OpenDraftAsync(app.Id)).Env);
        await w.FormService.SubmitDraftAsync(app.Id, HighScore());
        Assert.Equal(Env.Draft, w.Records.Items.Single().Env);
    }

    [Fact]
    public async Task Definicao_invalida_e_recusada()
    {
        var w = new World();
        var app = await w.CreateSurveyAsync(publish: false);
        var draft = JsonUtil.Clone(app.Draft);

        draft.Form!.Questions[3].Jumps = [new JumpDef { Op = "eq", Value = "x", GoTo = "q2" }]; // para trás
        var back = await Assert.ThrowsAsync<ValidationException>(() => w.AppService.UpdateAsync(app.Id, new AppChanges(app.Name, null, draft, false, false, null)));
        Assert.Contains("seguinte", back.Message);

        draft.Form.Questions[3].Jumps = [new JumpDef { Op = "eq", Value = "x", GoTo = "nao-existe" }];
        await Assert.ThrowsAsync<ValidationException>(() => w.AppService.UpdateAsync(app.Id, new AppChanges(app.Name, null, draft, false, false, null)));

        draft.Form.Questions[3].Jumps = [];
        draft.Form.Questions[2].Kind = QuestionKinds.Email; // campo Nota é número
        await Assert.ThrowsAsync<ValidationException>(() => w.AppService.UpdateAsync(app.Id, new AppChanges(app.Name, null, draft, false, false, null)));
    }

    [Fact]
    public async Task Resumo_conta_aberturas_perguntas_e_envios()
    {
        var w = new World();
        var app = await w.CreateSurveyAsync();
        w.As(FakeUsers.UserRh);
        var forms = w.FormService;

        await forms.TrackAsync(app.Slug, FormService.OpenKey);
        await forms.TrackAsync(app.Slug, FormService.OpenKey);
        await forms.TrackAsync(app.Slug, FormService.QuestionKey("q1"));
        await forms.SubmitAsync(app.Slug, HighScore(), null);
        await Assert.ThrowsAsync<ValidationException>(() => forms.TrackAsync(app.Slug, "qualquer"));

        await Assert.ThrowsAsync<ForbiddenException>(() => forms.StatsAsync(app.Id)); // usuário não vê o resumo
        var stats = await w.As(FakeUsers.BuilderRh).FormService.StatsAsync(app.Id);
        Assert.Equal(2, stats.Opens);
        Assert.Equal(1, stats.Submissions);
        Assert.Equal(1, stats.Reached.Single(r => r.QuestionId == "q1").Count);
        Assert.Equal(0, stats.Reached.Single(r => r.QuestionId == "q2").Count);
    }
}

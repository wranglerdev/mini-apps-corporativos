using System.Net.Mail;

namespace Domain;

/// <summary>O que o respondente recebe: o formulário e só os campos das perguntas (nada além do necessário).</summary>
public record FormView(Guid AppId, string Name, string Slug, string Env, int? Version, FormDef Form, List<FieldDef> Fields);

public record FormSubmitResult(Guid? RecordId, string EndTitle, string EndText, string? RedirectUrl);

public record QuestionReach(string QuestionId, int Count);

/// <summary>Resumo da versão publicada: quantos abriram, quantos chegaram a cada pergunta e quantos enviaram.</summary>
public record FormStats(int Opens, int Submissions, List<QuestionReach> Reached);

/// <summary>Configuração da empresa. AllowPublic=false desliga todos os links públicos (governança).</summary>
public record FormSettings(bool AllowPublic);

/// <summary>
/// Jornada do formulário: abrir pelo link, responder seguindo a lógica de pulo, enviar (vira registro na tabela de
/// respostas e dispara automações) e acompanhar o resumo. Com link público, responde sem login como "anonimo".
/// </summary>
public class FormService(
    IAppRepository apps, IWorkspaceRepository workspaces, AppService appService, RecordService recordService,
    IRecordRepository records, IFormCounters counters, IUserProvider users, FormSettings settings)
{
    public const string OpenKey = "open";
    public static string QuestionKey(string questionId) => $"q:{questionId}";

    /// <summary>Versão publicada pelo link /f/{slug}.</summary>
    public async Task<FormView> OpenAsync(string slug) => View((await OpenPublishedAsync(slug)).Scope);

    /// <summary>Rascunho, para quem gerencia testar antes de publicar.</summary>
    public async Task<FormView> OpenDraftAsync(Guid appId) => View(await OpenDraftScopeAsync(appId));

    public async Task<FormSubmitResult> SubmitAsync(string slug, IDictionary<string, string?> answers, string? honeypot)
    {
        var (scope, who) = await OpenPublishedAsync(slug);
        var form = scope.Definition.Form!;
        // Campo escondido preenchido = robô: finge sucesso e não grava nada.
        if (!string.IsNullOrEmpty(honeypot)) return End(form, null, null);
        return await SaveAsync(scope, answers, who);
    }

    public async Task<FormSubmitResult> SubmitDraftAsync(Guid appId, IDictionary<string, string?> answers) =>
        await SaveAsync(await OpenDraftScopeAsync(appId), answers, users.GetCurrentUser());

    /// <summary>Conta "abriu" ou "chegou à pergunta" na versão publicada (só chaves conhecidas).</summary>
    public async Task TrackAsync(string slug, string key)
    {
        var (scope, _) = await OpenPublishedAsync(slug);
        var form = scope.Definition.Form!;
        if (key != OpenKey && form.Questions.All(q => QuestionKey(q.Id) != key)) throw new ValidationException("Evento desconhecido.");
        await counters.IncrementAsync(scope.App.Id, key);
    }

    public async Task<FormStats> StatsAsync(Guid appId)
    {
        var app = await appService.GetAsync(appId); // exige gerenciar o app
        var form = (app.Published ?? app.Draft).Form ?? throw new ValidationException("Este projeto não é um formulário.");
        var counts = await counters.GetAsync(app.Id);
        var submissions = app.Published is null ? 0
            : (await records.QueryAsync(new RecordQuery(app.Id, Env.Prod, form.TableId, null, [], 0, 1))).Total;
        return new FormStats(
            counts.GetValueOrDefault(OpenKey), submissions,
            form.Questions.Select(q => new QuestionReach(q.Id, counts.GetValueOrDefault(QuestionKey(q.Id)))).ToList());
    }

    private async Task<FormSubmitResult> SaveAsync(AppScope scope, IDictionary<string, string?> answers, CurrentUser who)
    {
        var form = scope.Definition.Form!;
        var table = scope.Definition.Table(form.TableId);
        var given = answers.ToDictionary(kv => kv.Key, kv => string.IsNullOrWhiteSpace(kv.Value) ? null : kv.Value.Trim());

        var data = new Dictionary<string, string?>();
        var errors = new List<string>();
        foreach (var q in FormFlow.Path(form, table, given))
        {
            var field = table.Fields.First(f => f.Id == q.FieldId);
            var value = given.GetValueOrDefault(field.Name);
            if (value is null && field.Required) errors.Add($"Responda: {q.Title}");
            else if (value is not null && q.Kind == QuestionKinds.Email && !IsEmail(value)) errors.Add($"E-mail inválido em: {q.Title}");
            else if (value is not null && q.Kind == QuestionKinds.Scale && !(int.TryParse(value, out var n) && n is >= 0 and <= 10))
                errors.Add($"Escolha uma nota de 0 a 10 em: {q.Title}");
            data[field.Name] = value; // só as perguntas do caminho entram no registro
        }
        if (errors.Count > 0) throw new ValidationException(string.Join(" ", errors));

        var result = await recordService.InsertFormResponseAsync(scope, table, data, who);
        return End(form, result.Record.Id, await RedirectAsync(scope, data, who));
    }

    /// <summary>Acesso: quem pode usar o app publicado (login + departamento) ou qualquer um, se o link for público e a empresa permitir.</summary>
    private async Task<(AppScope Scope, CurrentUser Who)> OpenPublishedAsync(string slug)
    {
        var app = await apps.GetBySlugAsync(slug);
        if (app?.Published?.Form is null) throw new NotFoundException("Formulário");
        var ws = await workspaces.GetAsync(app.WorkspaceId) ?? throw new NotFoundException("Workspace");
        var user = TryCurrentUser();

        CurrentUser who;
        if (user is not null && AccessRules.CanUseEnv(user, app, ws, Env.Prod)) who = user;
        else if (app.Published.Form.Public && settings.AllowPublic) who = user ?? SystemUsers.Anonymous;
        else if (user is null) throw new UnauthorizedException();
        else throw new ForbiddenException();

        // Grava com privilégio do formulário: o que entra é só o que as perguntas do caminho pedem.
        return (new AppScope(app, ws, Env.Prod, app.Published, CanManage: true), who);
    }

    private async Task<AppScope> OpenDraftScopeAsync(Guid appId)
    {
        var scope = await appService.OpenAsync(appId, Env.Draft); // rascunho = só quem gerencia
        if (scope.Definition.Form is null) throw new ValidationException("Este projeto não é um formulário.");
        return scope with { CanManage = true };
    }

    private CurrentUser? TryCurrentUser()
    {
        try { return users.GetCurrentUser(); }
        catch (UnauthorizedException) { return null; }
    }

    private static FormView View(AppScope scope)
    {
        var form = scope.Definition.Form!;
        var table = scope.Definition.Table(form.TableId);
        var ids = form.Questions.Select(q => q.FieldId).ToHashSet();
        var version = scope.Env == Env.Prod ? scope.App.PublishedVersion : null;
        return new FormView(scope.App.Id, scope.App.Name, scope.App.Slug, scope.Env, version, form, table.Fields.Where(f => ids.Contains(f.Id)).ToList());
    }

    private static FormSubmitResult End(FormDef form, Guid? recordId, string? redirect) => new(recordId, form.EndTitle, form.EndText, redirect);

    /// <summary>
    /// Para onde ir depois de enviar: a primeira regra que bater (condição sobre as respostas do caminho) ou o padrão.
    /// Projeto vira o endereço dele (mesmo ambiente); link aceita {{respostas}} e é conferido depois de montado.
    /// </summary>
    private async Task<string?> RedirectAsync(AppScope scope, Dictionary<string, string?> answers, CurrentUser who)
    {
        var form = scope.Definition.Form!;
        var ctx = new Dictionary<string, string?>(answers, StringComparer.OrdinalIgnoreCase) { ["user.email"] = who.Email, ["user.name"] = who.Name };
        var rule = form.RedirectRules.FirstOrDefault(r => Conditions.Evaluate(r.Condition, ctx));
        var (projectId, url) = rule is not null ? (rule.ProjectId, rule.Url) : (form.RedirectProjectId, form.RedirectUrl);
        if (!string.IsNullOrWhiteSpace(projectId))
        {
            var target = Guid.TryParse(projectId, out var id) ? await apps.GetAsync(id) : null;
            if (target is null || target.WorkspaceId != scope.App.WorkspaceId) return null; // projeto removido: fica na tela final
            try { return Links.ProjectPath(target, scope.Env); }
            catch (ValidationException) { return null; } // ainda não publicado
        }
        if (string.IsNullOrWhiteSpace(url)) return null;
        var rendered = Links.RenderUrl(url, ctx);
        return Links.IsSafe(rendered) ? rendered : null;
    }

    private static bool IsEmail(string value) => MailAddress.TryCreate(value, out var a) && a.Address == value && value.Contains('.');
}

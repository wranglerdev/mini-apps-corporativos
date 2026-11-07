namespace Domain;

/// <summary>Contexto resolvido de um app num ambiente, já com a checagem de acesso feita.</summary>
public record AppScope(App App, Workspace Workspace, string Env, AppDefinition Definition, bool CanManage);

public record AppChanges(
    string Name,
    string? Description,
    AppDefinition Draft,
    bool InCatalog,
    bool IsTemplate,
    List<string>? AllowedDepartments);

public class AppService(IAppRepository apps, IWorkspaceRepository workspaces, IRecordRepository records, IUserProvider users, IAuditLog audit)
{
    private CurrentUser Me => users.GetCurrentUser();

    public async Task<List<App>> ListManagedAsync()
    {
        var me = Me;
        var managed = (await workspaces.ListAsync()).Where(w => AccessRules.CanManage(me, w)).Select(w => w.Id).ToHashSet();
        return (await apps.ListAsync()).Where(a => managed.Contains(a.WorkspaceId)).OrderBy(a => a.Name).ToList();
    }

    public async Task<List<App>> ListTemplatesAsync()
    {
        if (!AccessRules.CanBuild(Me)) throw new ForbiddenException();
        return (await apps.ListAsync()).Where(a => a.IsTemplate).OrderBy(a => a.Name).ToList();
    }

    public async Task<List<App>> CatalogAsync()
    {
        var me = Me;
        var ws = (await workspaces.ListAsync()).ToDictionary(w => w.Id);
        return (await apps.ListAsync())
            .Where(a => a.InCatalog && ws.TryGetValue(a.WorkspaceId, out var w) && AccessRules.CanUseEnv(me, a, w, Env.Prod))
            .OrderBy(a => a.Name).ToList();
    }

    public async Task<App> GetAsync(Guid id) => (await LoadManagedAsync(id)).App;

    /// <param name="kind">"app" (padrão), "form" ou "workflow" (ProjectKinds). Template define o tipo pela própria definição.</param>
    public async Task<App> CreateAsync(Guid workspaceId, string name, Guid? templateId, string? kind = null)
    {
        if (templateId is { } tid) return await DuplicateAsync(tid, workspaceId, name);

        var me = Me;
        var ws = await RequireManagedWorkspaceAsync(workspaceId, me);
        var draft = (kind ?? ProjectKinds.App) switch
        {
            ProjectKinds.App => AppDefinition.Blank(),
            ProjectKinds.Form => AppDefinition.BlankForm(),
            ProjectKinds.Workflow => AppDefinition.BlankWorkflow(),
            _ => throw new ValidationException($"Tipo de projeto inválido: {kind}.")
        };
        var app = new App { WorkspaceId = ws.Id, Name = RequireName(name), Slug = Slug.From(name), Draft = draft, CreatedBy = me.Email };
        await apps.AddAsync(app);
        await audit.WriteAsync(me, "app.create", "app", app.Id.ToString(), app.Name);
        return app;
    }

    public async Task<App> UpdateAsync(Guid id, AppChanges changes)
    {
        var (app, _, me) = await LoadManagedAsync(id);
        if (ProjectKinds.Of(changes.Draft) != app.Kind) throw new ValidationException("O tipo do projeto não pode mudar.");
        changes.Draft.Validate();
        await MigrateRenamesAsync(app.Id, Env.Draft, app.Draft, changes.Draft);
        app.Name = RequireName(changes.Name);
        app.Description = changes.Description ?? "";
        app.Draft = changes.Draft;
        app.InCatalog = changes.InCatalog;
        app.IsTemplate = changes.IsTemplate;
        app.AllowedDepartments = changes.AllowedDepartments ?? [];
        app.UpdatedAt = DateTime.UtcNow;
        await apps.UpdateAsync(app);
        await audit.WriteAsync(me, "app.update", "app", app.Id.ToString(), app.Name);
        return app;
    }

    /// <summary>Publicação em um clique: congela o rascunho como nova versão de produção.</summary>
    public async Task<AppVersion> PublishAsync(Guid id)
    {
        var (app, _, me) = await LoadManagedAsync(id);
        app.Draft.Validate();
        var number = (app.PublishedVersion ?? 0) + 1;
        var version = new AppVersion { AppId = app.Id, Number = number, Definition = JsonUtil.Clone(app.Draft), PublishedBy = me.Email };
        await apps.AddVersionAsync(version);
        await MigrateRenamesAsync(app.Id, Env.Prod, app.Published, app.Draft);
        app.Published = JsonUtil.Clone(app.Draft);
        app.PublishedVersion = number;
        app.UpdatedAt = DateTime.UtcNow;
        await apps.UpdateAsync(app);
        await audit.WriteAsync(me, "app.publish", "app", app.Id.ToString(), $"v{number}");
        return version;
    }

    public async Task<List<AppVersion>> VersionsAsync(Guid id)
    {
        await LoadManagedAsync(id);
        return (await apps.ListVersionsAsync(id)).OrderByDescending(v => v.Number).ToList();
    }

    /// <summary>Rollback: publica uma nova versão com o conteúdo da versão escolhida (histórico preservado) e reseta o rascunho para ela.</summary>
    public async Task<App> RollbackAsync(Guid id, int number)
    {
        var (app, _, me) = await LoadManagedAsync(id);
        var versions = await apps.ListVersionsAsync(id);
        var version = versions.FirstOrDefault(v => v.Number == number) ?? throw new NotFoundException("Versão");
        var rollback = new AppVersion { AppId = app.Id, Number = versions.Max(v => v.Number) + 1, Definition = JsonUtil.Clone(version.Definition), PublishedBy = me.Email };
        await apps.AddVersionAsync(rollback);
        await MigrateRenamesAsync(app.Id, Env.Prod, app.Published, version.Definition);
        await MigrateRenamesAsync(app.Id, Env.Draft, app.Draft, version.Definition);
        app.Published = JsonUtil.Clone(version.Definition);
        app.Draft = JsonUtil.Clone(version.Definition);
        app.PublishedVersion = rollback.Number;
        app.UpdatedAt = DateTime.UtcNow;
        await apps.UpdateAsync(app);
        await audit.WriteAsync(me, "app.rollback", "app", app.Id.ToString(), $"v{number} -> v{rollback.Number}");
        return app;
    }

    /// <summary>Duplica um app (próprio, template da biblioteca ou do catálogo de outra unidade) para um workspace gerenciado. Copia só a definição, não os dados.</summary>
    public async Task<App> DuplicateAsync(Guid sourceId, Guid workspaceId, string? name)
    {
        var me = Me;
        var source = await apps.GetAsync(sourceId) ?? throw new NotFoundException("App");
        var sourceWs = await workspaces.GetAsync(source.WorkspaceId) ?? throw new NotFoundException("Workspace");
        var target = await RequireManagedWorkspaceAsync(workspaceId, me);

        AppDefinition definition;
        if (AccessRules.CanManage(me, sourceWs) || source.IsTemplate) definition = source.Draft;
        else if (source.InCatalog && AccessRules.CanUseEnv(me, source, sourceWs, Env.Prod)) definition = source.Published!;
        else throw new ForbiddenException();

        var newName = string.IsNullOrWhiteSpace(name) ? $"{source.Name} (cópia)" : name;
        var copy = new App
        {
            WorkspaceId = target.Id, Name = newName, Slug = Slug.From(newName), Description = source.Description,
            Draft = JsonUtil.Clone(definition), CreatedBy = me.Email
        };
        await apps.AddAsync(copy);
        await audit.WriteAsync(me, "app.duplicate", "app", copy.Id.ToString(), $"de {source.Id}");
        return copy;
    }

    public async Task DeleteAsync(Guid id)
    {
        var (app, _, me) = await LoadManagedAsync(id);
        await apps.DeleteAsync(app.Id);
        await audit.WriteAsync(me, "app.delete", "app", app.Id.ToString(), app.Name);
    }

    public async Task<AppScope> OpenAsync(Guid id, string env)
    {
        Env.Validate(env);
        var app = await apps.GetAsync(id) ?? throw new NotFoundException("App");
        return await ScopeAsync(app, env);
    }

    /// <summary>Modo usuário: abre a versão publicada pelo slug (URL interna) e registra o acesso.</summary>
    public async Task<AppScope> OpenPublishedAsync(string slug)
    {
        var app = await apps.GetBySlugAsync(slug) ?? throw new NotFoundException("App");
        var scope = await ScopeAsync(app, Env.Prod);
        await audit.WriteAsync(Me, "app.access", "app", app.Id.ToString(), app.Name);
        return scope;
    }

    /// <summary>
    /// Abre a versão publicada SEM usuário (integrações como webhook). Quem chama é responsável por autenticar
    /// a integração (ex.: chave do webhook). Escreve com privilégio de gestor (todos os campos).
    /// </summary>
    public async Task<AppScope> OpenForIntegrationAsync(Guid id, string env = Env.Prod)
    {
        Env.Validate(env);
        var app = await apps.GetAsync(id) ?? throw new NotFoundException("App");
        if (env == Env.Prod && app.Published is null) throw new ValidationException("O app ainda não foi publicado.");
        var ws = await workspaces.GetAsync(app.WorkspaceId) ?? throw new NotFoundException("Workspace");
        return new AppScope(app, ws, env, env == Env.Prod ? app.Published! : app.Draft, CanManage: true);
    }

    /// <summary>Renomear campo não perde dados: as chaves dos registros acompanham o novo nome.</summary>
    private async Task MigrateRenamesAsync(Guid appId, string env, AppDefinition? from, AppDefinition to)
    {
        foreach (var (tableId, renames) in AppDefinition.FieldRenames(from, to))
            await records.RenameFieldsAsync(appId, env, tableId, renames);
    }

    private async Task<AppScope> ScopeAsync(App app, string env)
    {
        var me = Me;
        var ws = await workspaces.GetAsync(app.WorkspaceId) ?? throw new NotFoundException("Workspace");
        if (!AccessRules.CanUseEnv(me, app, ws, env)) throw new ForbiddenException();
        var definition = env == Env.Draft ? app.Draft : app.Published!;
        return new AppScope(app, ws, env, definition, AccessRules.CanManage(me, ws));
    }

    private async Task<(App App, Workspace Workspace, CurrentUser Me)> LoadManagedAsync(Guid id)
    {
        var me = Me;
        var app = await apps.GetAsync(id) ?? throw new NotFoundException("App");
        var ws = await workspaces.GetAsync(app.WorkspaceId) ?? throw new NotFoundException("Workspace");
        if (!AccessRules.CanManage(me, ws)) throw new ForbiddenException();
        return (app, ws, me);
    }

    private async Task<Workspace> RequireManagedWorkspaceAsync(Guid workspaceId, CurrentUser me)
    {
        var ws = await workspaces.GetAsync(workspaceId) ?? throw new NotFoundException("Workspace");
        if (!AccessRules.CanManage(me, ws)) throw new ForbiddenException("Você não gerencia este workspace.");
        return ws;
    }

    private static string RequireName(string name) =>
        string.IsNullOrWhiteSpace(name) ? throw new ValidationException("Informe o nome do app.") : name.Trim();
}

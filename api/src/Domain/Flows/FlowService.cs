using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Domain;

public record RunDetail(WorkflowRun Run, List<RunStep> Steps);

/// <summary>
/// Jornada do builder com workflows: executar agora, ver execuções e cada passo, reexecutar (do início ou de um passo).
/// Também enfileira os disparos externos (webhook) e os do agendador. Quem executa é o FlowRunner.
/// </summary>
public class FlowService(IAppRepository apps, AppService appService, IRunStore runs, IUserProvider users)
{
    public const int ListSize = 50;

    /// <summary>"Executar agora" (produção) ou "Testar" (rascunho).</summary>
    public async Task<WorkflowRun> RunNowAsync(Guid appId, string env)
    {
        var (app, def) = await LoadAsync(appId, env);
        var me = users.GetCurrentUser();
        return await EnqueueAsync(app, env, def.Workflows[0], Triggers.Manual,
            new JsonObject { ["trigger"] = Triggers.Manual, ["user"] = me.Email, ["now"] = ScheduleVars.Now(DateTime.Now), ["today"] = ScheduleVars.Today(DateTime.Now) },
            me.Email);
    }

    public async Task<List<WorkflowRun>> ListAsync(Guid appId, string env)
    {
        await LoadAsync(appId, env);
        return await runs.ListAsync(appId, env, ListSize);
    }

    public async Task<RunDetail> GetAsync(Guid appId, Guid runId)
    {
        var run = await runs.GetAsync(runId);
        if (run is null || run.AppId != appId) throw new NotFoundException("Execução");
        await LoadAsync(appId, run.Env);
        return new RunDetail(run, (await runs.StepsAsync(run.Id)).OrderBy(s => s.Order).ToList());
    }

    /// <summary>Reexecuta com o mesmo disparo. Com `fromStepId` (passo de 1º nível), os anteriores reaproveitam a saída.</summary>
    public async Task<WorkflowRun> RerunAsync(Guid appId, Guid runId, string? fromStepId)
    {
        var (source, _) = await GetAsync(appId, runId);
        var (app, def) = await LoadAsync(appId, source.Env);
        var wf = def.Workflows[0];
        if (fromStepId is not null && wf.Actions.All(a => !string.Equals(a.Id, fromStepId, StringComparison.OrdinalIgnoreCase)))
            throw new ValidationException("Só dá para reexecutar a partir de um passo de primeiro nível que ainda existe.");
        var run = await EnqueueAsync(app, source.Env, wf, source.Trigger, JsonVars.Parse(source.TriggerData) as JsonObject ?? new JsonObject(), users.GetCurrentUser().Email);
        if (fromStepId is not null)
        {
            run.SourceRunId = source.Id;
            run.StartFromStepId = fromStepId;
            await runs.UpdateAsync(run);
        }
        return run;
    }

    /// <summary>POST /api/hooks/wf/{app}: chave do gatilho webhook; o corpo JSON vira {{trigger.body.*}}. Só na versão publicada.</summary>
    public async Task<WorkflowRun> ReceiveWebhookAsync(Guid appId, string? key, JsonNode? body)
    {
        var app = await apps.GetAsync(appId) ?? throw new NotFoundException("Workflow");
        var wf = app.Published is { Automation: true } p ? p.Workflows[0] : throw new NotFoundException("Workflow");
        var expected = wf.Trigger.Type == Triggers.Webhook ? wf.Trigger.WebhookKey : null;
        if (string.IsNullOrEmpty(expected) || key is null || !System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                System.Text.Encoding.UTF8.GetBytes(key), System.Text.Encoding.UTF8.GetBytes(expected)))
            throw new ForbiddenException("Chave de webhook inválida.");
        return await EnqueueAsync(app, Env.Prod, wf, Triggers.Webhook,
            new JsonObject { ["trigger"] = Triggers.Webhook, ["body"] = body?.DeepClone(), ["now"] = ScheduleVars.Now(DateTime.Now) }, SystemUsers.Webhook.Email);
    }

    /// <summary>Coloca na fila. Usado aqui, pelo agendador e pelo webhook.</summary>
    public async Task<WorkflowRun> EnqueueAsync(App app, string env, WorkflowDef wf, string trigger, JsonObject data, string requestedBy)
    {
        var run = new WorkflowRun
        {
            AppId = app.Id, Env = env, WorkflowId = wf.Id, Number = await runs.NextNumberAsync(app.Id),
            Version = env == Env.Prod ? app.PublishedVersion : null, Trigger = trigger, TriggerData = data.ToJsonString(), RequestedBy = requestedBy
        };
        await runs.AddAsync(run);
        return run;
    }

    /// <summary>Só quem gerencia o projeto; só projetos de workflow; produção exige publicação.</summary>
    private async Task<(App App, AppDefinition Def)> LoadAsync(Guid appId, string env)
    {
        Env.Validate(env);
        var app = await appService.GetAsync(appId); // exige gerenciar
        var def = env == Env.Prod ? app.Published : app.Draft;
        if (def is null) throw new ValidationException("Publique o workflow antes de executar em produção.");
        if (!def.Automation) throw new ValidationException("Este projeto não é um workflow.");
        return (app, def);
    }
}

/// <summary>Segredos do workspace: só quem gerencia o workspace vê os nomes e troca valores; o valor nunca volta.</summary>
public partial class SecretService(ISecretStore store, IWorkspaceRepository workspaces, IUserProvider users, IAuditLog audit)
{
    [GeneratedRegex("^[A-Z][A-Z0-9_]{0,63}$")]
    private static partial Regex Name();

    public async Task<List<SecretInfo>> ListAsync(Guid workspaceId)
    {
        await RequireAsync(workspaceId);
        return (await store.ListAsync(workspaceId)).OrderBy(s => s.Name).ToList();
    }

    public async Task SetAsync(Guid workspaceId, string name, string value)
    {
        var me = await RequireAsync(workspaceId);
        name = (name ?? "").Trim();
        if (!Name().IsMatch(name)) throw new ValidationException("Nome do segredo: letras maiúsculas, números e _ (começa com letra).");
        if (string.IsNullOrEmpty(value)) throw new ValidationException("Informe o valor do segredo.");
        await store.SetAsync(workspaceId, name, value, me.Email);
        await audit.WriteAsync(me, "secret.update", "workspace", workspaceId.ToString(), name); // nunca o valor
    }

    public async Task DeleteAsync(Guid workspaceId, string name)
    {
        var me = await RequireAsync(workspaceId);
        await store.DeleteAsync(workspaceId, name);
        await audit.WriteAsync(me, "secret.delete", "workspace", workspaceId.ToString(), name);
    }

    private async Task<CurrentUser> RequireAsync(Guid workspaceId)
    {
        var me = users.GetCurrentUser();
        var ws = await workspaces.GetAsync(workspaceId) ?? throw new NotFoundException("Workspace");
        if (!AccessRules.CanManage(me, ws)) throw new ForbiddenException();
        return me;
    }
}

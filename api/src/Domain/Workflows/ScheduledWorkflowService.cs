namespace Domain;

/// <summary>Variáveis de data dos workflows agendados ({{now}}, {{today}}), iguais no agendador e no "Executar agora".</summary>
public static class ScheduleVars
{
    public static string Now(DateTime at) => at.ToString("yyyy-MM-dd HH:mm");
    public static string Today(DateTime at) => at.ToString("yyyy-MM-dd");
}

/// <summary>
/// Dispara workflows agendados da versão PUBLICADA de cada app. Chamado periodicamente (ver Api/ScheduledWorkflowsHostedService).
/// Regras: o primeiro contato só marca a referência (não roda na hora da publicação); depois roda quando a próxima
/// ocorrência já passou. Execuções perdidas com o servidor parado viram uma única execução.
/// Contexto disponível nas ações: {{now}} (yyyy-MM-dd HH:mm) e {{today}} (yyyy-MM-dd).
/// </summary>
public class ScheduledWorkflowService(IAppRepository apps, AppService appService, WorkflowEngine engine, IScheduleStore store, IAuditLog audit, FlowService flows)
{
    public async Task<int> RunDueAsync(DateTime now)
    {
        var ran = 0;
        foreach (var app in (await apps.ListAsync()).Where(a => a.Published is not null))
        foreach (var wf in app.Published!.Workflows.Where(w => w.Trigger.Type == Triggers.Schedule && Schedule.Problem(w.Trigger) is null))
        {
            var last = await store.GetLastRunAsync(app.Id, wf.Id);
            if (last is null)
            {
                await store.SetLastRunAsync(app.Id, wf.Id, now);
                continue;
            }
            if (Schedule.NextRun(last.Value, wf.Trigger) > now) continue;

            await store.SetLastRunAsync(app.Id, wf.Id, now); // marca antes: uma falha não vira repetição a cada minuto
            if (app.Published.Automation)
            {
                // Projeto de workflow: só enfileira; o FlowRunner executa com histórico e tentativas.
                await flows.EnqueueAsync(app, Env.Prod, wf, Triggers.Schedule, new System.Text.Json.Nodes.JsonObject
                {
                    ["trigger"] = Triggers.Schedule, ["now"] = ScheduleVars.Now(now), ["today"] = ScheduleVars.Today(now)
                }, SystemUsers.Scheduler.Email);
                ran++;
                continue;
            }
            try
            {
                var scope = await appService.OpenForIntegrationAsync(app.Id);
                await engine.RunAsync(scope, wf, new Dictionary<string, string?>
                {
                    ["now"] = ScheduleVars.Now(now),
                    ["today"] = ScheduleVars.Today(now)
                }, SystemUsers.Scheduler);
                ran++;
            }
            catch (DomainException ex)
            {
                await audit.WriteAsync(SystemUsers.Scheduler, "workflow.error", "workflow", wf.Id, $"{wf.Name}: {ex.Message}");
            }
        }
        return ran;
    }
}

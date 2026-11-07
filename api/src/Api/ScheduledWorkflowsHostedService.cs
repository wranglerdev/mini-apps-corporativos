using Domain;

namespace Api;

/// <summary>
/// Relógio do agendador: a cada minuto pede ao domínio para rodar os workflows agendados que venceram.
/// Horários são do servidor (DateTime.Now).
/// [TROCA] No corporativo, pode virar um job da plataforma interna (Hangfire, Quartz, cron do Kubernetes...) chamando
/// ScheduledWorkflowService.RunDueAsync; com várias instâncias da API, garanta que só uma execute (lock/leader).
/// </summary>
public class ScheduledWorkflowsHostedService(IServiceScopeFactory scopes, ILogger<ScheduledWorkflowsHostedService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                var ran = await scope.ServiceProvider.GetRequiredService<ScheduledWorkflowService>().RunDueAsync(DateTime.Now);
                if (ran > 0) logger.LogInformation("[AGENDADOR] {Count} workflow(s) executado(s).", ran);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "[AGENDADOR] Falha ao executar workflows agendados.");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}

using Domain;

namespace Api;

/// <summary>
/// Worker da fila de workflows: a cada segundo processa o que estiver na fila (uma execução por vez) e, de hora em hora,
/// apaga o histórico com mais de 30 dias.
/// [TROCA] No corporativo, vira um worker separado consumindo uma fila real (Service Bus, RabbitMQ...) via IRunStore;
/// com várias instâncias, garanta que cada execução seja pega por um só worker.
/// </summary>
public class FlowWorkerHostedService(IServiceScopeFactory scopes, ILogger<FlowWorkerHostedService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        var nextCleanup = DateTime.UtcNow;
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                var runner = scope.ServiceProvider.GetRequiredService<FlowRunner>();
                while (await runner.ProcessNextAsync(stoppingToken)) { } // esvazia a fila
                if (DateTime.UtcNow >= nextCleanup)
                {
                    var removed = await runner.CleanupAsync(DateTime.UtcNow);
                    if (removed > 0) logger.LogInformation("[WORKFLOWS] {Count} execução(ões) antiga(s) apagada(s).", removed);
                    nextCleanup = DateTime.UtcNow.AddHours(1);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "[WORKFLOWS] Falha no worker.");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}

using System.Text.Json.Nodes;

namespace Domain;

/// <summary>
/// Executa as execuções da fila (projetos de workflow), uma por vez, gravando cada passo no histórico:
/// passos aninhados ("se", "para cada"), limite de passos por execução, saída de cada passo em {{steps.&lt;id&gt;.*}}, segredos em {{secrets.*}}
/// (mascarados no histórico), tentativas com espera crescente (1 s, 2 s, 4 s...), tempo limite por passo e por execução,
/// reexecução a partir de um passo e alerta por e-mail quando falha em produção.
/// Quem chama: Api/FlowWorkerHostedService (a cada segundo). As ações em si são as do WorkflowEngine.
/// </summary>
public class FlowRunner(IRunStore runs, IAppRepository apps, AppService appService, WorkflowEngine engine, ISecretStore secrets, IEmailSender email, IAuditLog audit)
{
    public const int MaxStoredChars = 16 * 1024;
    public static readonly TimeSpan Retention = TimeSpan.FromDays(30);

    /// <summary>Espera usada entre tentativas e no passo "esperar" (os testes trocam por uma que não espera).</summary>
    public Func<TimeSpan, CancellationToken, Task> Delay { get; set; } = Task.Delay;
    public TimeSpan RunTimeout { get; set; } = TimeSpan.FromMinutes(15);

    private sealed class StepFailed(string message) : Exception(message);

    private sealed class Execution(WorkflowRun run, AppScope scope, Dictionary<string, string?> ctx, List<string> secretValues, DateTime deadline, CancellationToken ct)
    {
        public WorkflowRun Run { get; } = run;
        public AppScope Scope { get; } = scope;
        public Dictionary<string, string?> Ctx { get; } = ctx;
        public List<string> SecretValues { get; } = secretValues;
        public DateTime Deadline { get; } = deadline;
        public CancellationToken Ct { get; } = ct;
        public int Order { get; set; }
        public int Executed { get; set; }
        public string? SkipUntil { get; set; }
        public Dictionary<string, RunStep> Reused { get; } = new(StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>Processa a próxima execução da fila. false = fila vazia.</summary>
    public async Task<bool> ProcessNextAsync(CancellationToken ct = default)
    {
        var run = await runs.NextQueuedAsync();
        if (run is null) return false;

        run.Status = RunStatus.Running;
        run.StartedAt = DateTime.UtcNow;
        await runs.UpdateAsync(run);
        AppScope? scope = null;
        try
        {
            scope = await appService.OpenForIntegrationAsync(run.AppId, run.Env);
            var wf = scope.Definition.Workflow(run.WorkflowId);
            var values = await secrets.ValuesAsync(scope.Workspace.Id);
            var ctx = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
            JsonVars.Put(ctx, "trigger", JsonVars.Parse(run.TriggerData));
            foreach (var (name, value) in values) ctx[$"secrets.{name}"] = value;
            var exec = new Execution(run, scope, ctx, [.. values.Values.Where(v => v.Length >= 4)], DateTime.UtcNow + RunTimeout, ct);

            if (run.SourceRunId is { } source && run.StartFromStepId is { } from)
            {
                exec.SkipUntil = from;
                foreach (var s in (await runs.StepsAsync(source)).Where(s => s.Depth == 0 && s.StepId is not null && s.Status == RunStatus.Succeeded))
                    exec.Reused[s.StepId!] = s;
            }

            await RunListAsync(exec, wf.Actions, null, 0, topLevel: true);
            run.Status = RunStatus.Succeeded;
            await audit.WriteAsync(SystemUsers.Workflow, "workflow.run", "workflow", run.AppId.ToString(), $"#{run.Number} ({run.Env})");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            run.Status = RunStatus.Failed;
            run.Error = ex is StepFailed or DomainException ? ex.Message : $"Erro inesperado: {ex.Message}";
            await audit.WriteAsync(SystemUsers.Workflow, "workflow.fail", "workflow", run.AppId.ToString(), $"#{run.Number}: {ex.Message}");
            if (run.Env == Env.Prod && scope is not null)
                await email.SendAsync(new EmailMessage(scope.App.CreatedBy, $"Workflow '{scope.App.Name}' falhou (#{run.Number})",
                    $"{run.Error}\nVeja a execução em Execuções e reexecute a partir do passo que falhou."));
        }
        finally
        {
            run.FinishedAt = DateTime.UtcNow;
            await runs.UpdateAsync(run);
        }
        return true;
    }

    /// <summary>Retenção do histórico (padrão 30 dias).</summary>
    public Task<int> CleanupAsync(DateTime now) => runs.DeleteOlderThanAsync(now - Retention);

    private async Task RunListAsync(Execution x, List<ActionDef> steps, Guid? parent, int depth, bool topLevel)
    {
        foreach (var step in steps)
        {
            if (topLevel && x.SkipUntil is not null)
            {
                if (string.Equals(step.Id, x.SkipUntil, StringComparison.OrdinalIgnoreCase)) x.SkipUntil = null;
                else
                {
                    await ReuseAsync(x, step);
                    continue;
                }
            }
            await RunStepAsync(x, step, parent, depth);
        }
    }

    /// <summary>"Reexecutar a partir daqui": o passo anterior não roda de novo; a saída vem da execução de origem.</summary>
    private async Task ReuseAsync(Execution x, ActionDef step)
    {
        var span = await BeginAsync(x, null, 0, step.Id, Label(step), step.Type);
        if (step.Id is not null && x.Reused.TryGetValue(step.Id, out var previous))
        {
            JsonVars.Put(x.Ctx, $"steps.{step.Id}", JsonVars.Parse(previous.Output));
            span.Output = previous.Output;
        }
        await EndAsync(span, RunStatus.Skipped, error: null, note: "reaproveitado da execução anterior");
    }

    private async Task RunStepAsync(Execution x, ActionDef step, Guid? parent, int depth)
    {
        if (DateTime.UtcNow > x.Deadline) throw new StepFailed($"Execução passou do tempo limite de {RunTimeout.TotalMinutes:0} min.");
        x.Ct.ThrowIfCancellationRequested();
        if (++x.Executed > FlowRules.MaxStepsPerRun) throw new StepFailed($"Execução passou do limite de {FlowRules.MaxStepsPerRun} passos.");
        var span = await BeginAsync(x, parent, depth, step.Id, Label(step), step.Type);
        try
        {
            JsonNode output = step.Type switch
            {
                Actions.If => await IfAsync(x, step, span, depth),
                Actions.ForEach => await ForEachAsync(x, step, span, depth),
                Actions.Wait => await WaitAsync(x, step, span),
                Actions.Transform => Transform(x, step, span),
                _ => await ActionAsync(x, step, span, depth)
            };
            if (!string.IsNullOrWhiteSpace(step.Id)) JsonVars.Put(x.Ctx, $"steps.{step.Id}", output);
            span.Output = Store(x, output.ToJsonString());
            await EndAsync(span, RunStatus.Succeeded);
        }
        catch (StepFailed ex)
        {
            await EndAsync(span, RunStatus.Failed, ex.Message);
            throw;
        }
        catch (Exception ex) when (ex is DomainException or TimeoutException or HttpRequestException or System.Text.Json.JsonException)
        {
            var message = $"Passo '{step.Id}': {ex.Message}";
            await EndAsync(span, RunStatus.Failed, message);
            throw new StepFailed(message);
        }
    }

    private async Task<JsonNode> IfAsync(Execution x, ActionDef step, RunStep span, int depth)
    {
        var c = step.Condition ?? new ConditionDef();
        var condition = new ConditionDef
        {
            Field = Unbrace(c.Field), Op = c.Op, Value = c.Value, Join = c.Join,
            More = [.. c.More.Select(r => new ConditionRule { Field = Unbrace(r.Field), Op = r.Op, Value = r.Value })]
        };
        var ok = Conditions.Evaluate(condition, x.Ctx);
        var rules = condition.ActiveRules().Select(r => (JsonNode)new JsonObject
        {
            ["valor"] = x.Ctx.GetValueOrDefault(r.Field), ["operador"] = r.Op, ["comparar"] = Template.Render(r.Value, x.Ctx)
        }).ToList();
        span.Input = Store(x, (rules.Count == 1 ? rules[0]
            : new JsonObject { ["juntar"] = condition.Join == ConditionDef.Or ? "ou" : "e", ["regras"] = new JsonArray([.. rules]) }).ToJsonString());
        await RunListAsync(x, ok ? step.Steps : step.Else, span.Id, depth + 1, topLevel: false);
        return new JsonObject { ["result"] = ok };
    }

    private async Task<JsonNode> ForEachAsync(Execution x, ActionDef step, RunStep span, int depth)
    {
        var raw = Template.Render(step.Params.GetValueOrDefault("list"), x.Ctx);
        if (JsonVars.Parse(raw) is not JsonArray list) throw new StepFailed($"Passo '{step.Id}': a lista não é uma lista JSON.");
        if (list.Count > FlowRules.MaxForEachItems) throw new StepFailed($"Passo '{step.Id}': {list.Count} itens passam do limite de {FlowRules.MaxForEachItems}.");
        var name = step.Params.GetValueOrDefault("as") is { Length: > 0 } a ? a : "item";
        span.Input = $"{list.Count} itens";

        for (var i = 0; i < list.Count; i++)
        {
            var item = await BeginAsync(x, span.Id, depth + 1, null, $"Item {i + 1}", "item");
            JsonVars.Put(x.Ctx, name, list[i]?.DeepClone());
            x.Ctx[$"{name}.index"] = i.ToString();
            item.Input = Store(x, list[i]?.ToJsonString() ?? "null");
            try { await RunListAsync(x, step.Steps, item.Id, depth + 2, topLevel: false); }
            catch (StepFailed ex) { await EndAsync(item, RunStatus.Failed, ex.Message); throw; }
            await EndAsync(item, RunStatus.Succeeded);
        }
        return new JsonObject { ["count"] = list.Count };
    }

    private async Task<JsonNode> WaitAsync(Execution x, ActionDef step, RunStep span)
    {
        var seconds = int.TryParse(step.Params.GetValueOrDefault("seconds"), out var s) ? Math.Clamp(s, 1, FlowRules.MaxWaitSeconds) : 1;
        span.Input = $"{seconds} s";
        await Delay(TimeSpan.FromSeconds(seconds), x.Ct);
        return new JsonObject { ["seconds"] = seconds };
    }

    private JsonNode Transform(Execution x, ActionDef step, RunStep span)
    {
        var result = new JsonObject();
        foreach (var (key, template) in step.Values) result[key] = JsonVars.Parse(Template.Render(template, x.Ctx));
        span.Input = Store(x, new JsonObject(step.Values.Select(kv => KeyValuePair.Create(kv.Key, (JsonNode?)kv.Value))).ToJsonString());
        return result;
    }

    /// <summary>Ação comum (API, e-mail, registro, aprovação) com tentativas e tempo limite.</summary>
    private async Task<JsonNode> ActionAsync(Execution x, ActionDef step, RunStep span, int depth)
    {
        var timeout = TimeSpan.FromSeconds(step.TimeoutSeconds ?? FlowRules.DefaultTimeoutSeconds);
        span.Input = Store(x, RenderedInput(x, step));
        for (var attempt = 1; ; attempt++)
        {
            var tracked = step.Retries > 0 ? await BeginAsync(x, span.Id, depth + 1, null, $"Tentativa {attempt}", "attempt") : null;
            try
            {
                var output = await engine.ExecuteActionAsync(x.Scope, step, x.Ctx, SystemUsers.Workflow, new WorkflowResult()).WaitAsync(timeout, x.Ct);
                if (step.Type == Actions.CallApi && output["status"]?.GetValue<int>() is >= 400 and var status)
                    throw new StepFailed($"a API respondeu {status}");
                if (tracked is not null) { tracked.Output = Store(x, output.ToJsonString()); await EndAsync(tracked, RunStatus.Succeeded); }
                return output;
            }
            catch (Exception ex) when (ex is StepFailed or DomainException or TimeoutException or HttpRequestException)
            {
                var message = ex is TimeoutException ? $"passou do tempo limite de {timeout.TotalSeconds:0} s" : ex.Message;
                if (tracked is not null) await EndAsync(tracked, RunStatus.Failed, message);
                if (attempt > step.Retries) throw new StepFailed($"Passo '{step.Id}': {message}" + (step.Retries > 0 ? $" ({attempt} tentativas)" : ""));
                var wait = TimeSpan.FromSeconds(Math.Pow(2, attempt - 1));
                var backoff = await BeginAsync(x, span.Id, depth + 1, null, "Espera antes de repetir", "backoff");
                backoff.Input = $"{wait.TotalSeconds:0} s";
                await Delay(wait, x.Ct);
                await EndAsync(backoff, RunStatus.Succeeded);
            }
        }
    }

    private string RenderedInput(Execution x, ActionDef step)
    {
        var o = new JsonObject();
        foreach (var (k, v) in step.Params) o[k] = Template.Render(v, x.Ctx);
        if (step.Values.Count > 0)
            o["values"] = new JsonObject(step.Values.Select(kv => KeyValuePair.Create(kv.Key, (JsonNode?)Template.Render(kv.Value, x.Ctx))));
        return o.ToJsonString();
    }

    private async Task<RunStep> BeginAsync(Execution x, Guid? parent, int depth, string? stepId, string name, string type)
    {
        var step = new RunStep { RunId = x.Run.Id, ParentId = parent, Order = x.Order++, Depth = depth, StepId = stepId, Name = name, Type = type };
        await runs.AddStepAsync(step);
        return step;
    }

    private async Task EndAsync(RunStep step, string status, string? error = null, string? note = null)
    {
        step.Status = status;
        step.Error = error ?? note;
        step.FinishedAt = DateTime.UtcNow;
        await runs.UpdateStepAsync(step);
    }

    /// <summary>Texto guardado no histórico: segredos viram •••• e o tamanho é limitado.</summary>
    private static string Store(Execution x, string text)
    {
        foreach (var secret in x.SecretValues) text = text.Replace(secret, "••••", StringComparison.Ordinal);
        return text.Length <= MaxStoredChars ? text : text[..MaxStoredChars] + "…(cortado)";
    }

    private static string Unbrace(string field) => field.Trim().TrimStart('{').TrimEnd('}').Trim();

    public static readonly Dictionary<string, string> Labels = new()
    {
        [Actions.CallApi] = "Chamar API", [Actions.SendEmail] = "Enviar e-mail", [Actions.CreateRecord] = "Criar registro",
        [Actions.UpdateRecord] = "Atualizar registro", [Actions.RequestApproval] = "Solicitar aprovação",
        [Actions.If] = "Se / senão", [Actions.ForEach] = "Para cada", [Actions.Wait] = "Esperar", [Actions.Transform] = "Transformar"
    };

    private static string Label(ActionDef step) => $"{Labels.GetValueOrDefault(step.Type, step.Type)} · {step.Id}";
}

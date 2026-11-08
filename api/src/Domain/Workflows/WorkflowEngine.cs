using System.Text.Json.Nodes;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Domain;

public class WorkflowResult
{
    /// <summary>Id da página para onde o cliente deve navegar (ação "navigate").</summary>
    public string? NavigateTo { get; set; }
    /// <summary>Endereço a abrir (ação "openLink"): caminho do site ou http(s).</summary>
    public string? OpenUrl { get; set; }
    public bool OpenInNewTab { get; set; }
    public List<string> Log { get; set; } = [];

    public void Merge(WorkflowResult other)
    {
        NavigateTo = other.NavigateTo ?? NavigateTo;
        if (other.OpenUrl is not null) (OpenUrl, OpenInNewTab) = (other.OpenUrl, other.OpenInNewTab);
        Log.AddRange(other.Log);
    }
}

/// <summary>Substitui {{variavel}} pelos valores do contexto (case-insensitive). Variável ausente vira vazio.</summary>
public static partial class Template
{
    [GeneratedRegex(@"\{\{\s*([^}]+?)\s*\}\}")]
    private static partial Regex Placeholder();

    public static string Render(string? text, IReadOnlyDictionary<string, string?> ctx) =>
        text is null ? "" : Placeholder().Replace(text, m => ctx.TryGetValue(m.Groups[1].Value, out var v) ? v ?? "" : "");
}

public static class Conditions
{
    /// <summary>Espelhada em web/src/app/features/runtime/visibility.ts (evaluate): mudou aqui, mude lá e nos dois testes.</summary>
    public static bool Evaluate(ConditionDef? c, IReadOnlyDictionary<string, string?> ctx)
    {
        var rules = c?.ActiveRules() ?? [];
        if (rules.Count == 0) return true;
        return c!.Join == ConditionDef.Or ? rules.Any(r => Matches(r, ctx)) : rules.All(r => Matches(r, ctx));
    }

    private static bool Matches(ConditionRule c, IReadOnlyDictionary<string, string?> ctx)
    {
        var actual = ctx.GetValueOrDefault(c.Field) ?? "";
        var expected = Template.Render(c.Value, ctx);
        var numeric = double.TryParse(actual, NumberStyles.Float, CultureInfo.InvariantCulture, out var a) &
                      double.TryParse(expected, NumberStyles.Float, CultureInfo.InvariantCulture, out var b);

        return c.Op switch
        {
            "eq" => string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase),
            "neq" => !string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase),
            "gt" => numeric ? a > b : string.Compare(actual, expected, StringComparison.Ordinal) > 0,
            "lt" => numeric ? a < b : string.Compare(actual, expected, StringComparison.Ordinal) < 0,
            "contains" => actual.Contains(expected, StringComparison.OrdinalIgnoreCase),
            "empty" => actual.Length == 0,
            "notEmpty" => actual.Length > 0,
            _ => throw new ValidationException($"Operador inválido: {c.Op}.")
        };
    }
}

/// <summary>
/// Executa workflows (gatilho → condição → ações). Ações rodam com privilégio do sistema.
/// Encadeamento: createRecord/updateRecord disparam os workflows de registro da tabela afetada e runWorkflow executa
/// outro workflow. Cada passo da cadeia aumenta `depth`; acima de MaxChainDepth a cadeia para (protege contra ciclos).
/// </summary>
public class WorkflowEngine(IRecordRepository records, IApprovalRepository approvals, IEmailSender email, IHttpConnector http, IAuditLog audit,
    IAppRepository apps, IRunStore runs)
{
    public const int MaxChainDepth = 5;

    public async Task<WorkflowResult> RunTriggersAsync(AppScope scope, string trigger, string tableId, Dictionary<string, string?> ctx, CurrentUser user, int depth = 0)
    {
        var result = new WorkflowResult();
        foreach (var wf in scope.Definition.Workflows.Where(w => w.Trigger.Type == trigger && w.Trigger.TableId == tableId))
            result.Merge(await RunAsync(scope, wf, ctx, user, depth));
        return result;
    }

    public async Task<WorkflowResult> RunAsync(AppScope scope, WorkflowDef wf, IDictionary<string, string?> input, CurrentUser user, int depth = 0)
    {
        if (depth > MaxChainDepth)
        {
            await audit.WriteAsync(user, "workflow.chain-limit", "workflow", wf.Id, wf.Name);
            return new WorkflowResult { Log = [$"{wf.Name}: cadeia de workflows interrompida (limite de {MaxChainDepth} níveis)."] };
        }

        var ctx = new Dictionary<string, string?>(input, StringComparer.OrdinalIgnoreCase)
        {
            ["user.email"] = user.Email,
            ["user.name"] = user.Name,
            ["user.department"] = user.Department
        };
        Variables.Init(ctx, wf.Variables);
        var result = new WorkflowResult();
        if (!Conditions.Evaluate(wf.Condition, ctx))
        {
            result.Log.Add($"{wf.Name}: condição não atendida.");
            return result;
        }

        foreach (var action in wf.Actions)
        {
            // Transformar grava nas variáveis da automação; o resto são as ações comuns.
            if (action.Type == Actions.Transform)
            {
                try { Variables.ApplyOps(ctx, wf.Variables, action.Ops); }
                catch (VariableException ex) { throw new ValidationException($"{wf.Name}: Transformar: {ex.Message}."); }
            }
            else await ExecuteActionAsync(scope, action, ctx, user, result, depth);
            Variables.RefreshAliases(ctx, wf.Variables);
        }
        await audit.WriteAsync(user, "workflow.run", "workflow", wf.Id, wf.Name);
        return result;
    }

    /// <summary>
    /// Executa UMA ação e devolve a saída dela (vira {{steps.&lt;id&gt;.*}} e o histórico nos projetos de workflow).
    /// Usado pelas automações de mini app (em sequência) e pelo FlowRunner (com tentativas, tempo limite e histórico).
    /// </summary>
    public async Task<JsonObject> ExecuteActionAsync(AppScope scope, ActionDef action, Dictionary<string, string?> ctx, CurrentUser user, WorkflowResult result, int depth = 0)
    {
        var output = new JsonObject();
        string P(string key, string? fallback = null) => Template.Render(action.Params.GetValueOrDefault(key) ?? fallback, ctx);
        Dictionary<string, string?> Values() => action.Values.ToDictionary(kv => kv.Key, kv => (string?)Template.Render(kv.Value, ctx));

        switch (action.Type)
        {
            case Actions.CreateRecord:
            {
                var table = scope.Definition.Table(P("tableId"));
                var record = new DataRecord
                {
                    AppId = scope.App.Id, Env = scope.Env, TableId = table.Id, CreatedBy = user.Email,
                    Data = RecordValidator.Normalize(Values(), table.Fields, partial: false)
                };
                await records.AddAsync(record);
                ctx["createdId"] = record.Id.ToString();
                output["id"] = record.Id.ToString();
                result.Log.Add($"Registro criado em {table.Name}.");
                result.Merge(await RunTriggersAsync(scope, Triggers.RecordCreated, table.Id, record.ToContext(), user, depth + 1));
                break;
            }
            case Actions.UpdateRecord:
            {
                var table = scope.Definition.Table(P("tableId", ctx.GetValueOrDefault("tableId")));
                var record = await LoadRecordAsync(scope, table.Id, P("recordId", "{{id}}"));
                foreach (var (k, v) in RecordValidator.Normalize(Values(), table.Fields, partial: true)) record.Data[k] = v;
                record.UpdatedBy = user.Email;
                record.UpdatedAt = DateTime.UtcNow;
                await records.UpdateAsync(record);
                output["id"] = record.Id.ToString();
                result.Log.Add($"Registro atualizado em {table.Name}.");
                result.Merge(await RunTriggersAsync(scope, Triggers.RecordUpdated, table.Id, record.ToContext(), user, depth + 1));
                break;
            }
            case Actions.SendEmail:
                await email.SendAsync(new EmailMessage(P("to"), P("subject"), P("body")));
                output["to"] = P("to");
                output["subject"] = P("subject");
                result.Log.Add($"E-mail enviado para {P("to")}.");
                break;
            case Actions.CallApi:
            {
                // Params.headers: uma linha por cabeçalho, "Nome: valor" (aceita {{secrets.*}}).
                var headers = P("headers").Split('\n', StringSplitOptions.RemoveEmptyEntries)
                    .Select(line => line.Split(':', 2)).Where(p => p.Length == 2 && p[0].Trim().Length > 0)
                    .ToDictionary(p => p[0].Trim(), p => p[1].Trim(), StringComparer.OrdinalIgnoreCase);
                var response = await http.SendAsync(P("method", "POST"), P("url"), action.Params.ContainsKey("body") ? P("body") : null, headers);
                ctx["api.status"] = response.Status.ToString();
                ctx["api.response"] = response.Body;
                output["status"] = response.Status;
                output["body"] = JsonVars.Parse(response.Body);
                result.Log.Add($"API chamada ({response.Status}).");
                break;
            }
            case Actions.Navigate:
                result.NavigateTo = P("pageId");
                break;
            case Actions.RequestApproval:
            {
                var approver = P("approver");
                if (string.IsNullOrWhiteSpace(approver)) throw new ValidationException("Aprovador não informado.");
                var tableId = P("tableId", ctx.GetValueOrDefault("tableId"));
                var record = await LoadRecordAsync(scope, tableId, P("recordId", "{{id}}"));
                var statusField = P("statusField", "Status");
                record.Data[statusField] = Approval.Text(ApprovalStatus.Pending);
                await records.UpdateAsync(record);

                var approval = new Approval
                {
                    AppId = scope.App.Id, Env = scope.Env, TableId = tableId, RecordId = record.Id,
                    Title = P("title", "Solicitação"), StatusField = statusField, Approver = approver, RequestedBy = user.Email
                };
                await approvals.AddAsync(approval);
                await email.SendAsync(new EmailMessage(approver, $"Aprovação pendente: {approval.Title}",
                    $"{user.Name} solicitou sua aprovação em '{scope.App.Name}'."));
                output["approvalId"] = approval.Id.ToString();
                output["approver"] = approver;
                result.Log.Add($"Aprovação solicitada a {approver}.");
                break;
            }
            case Actions.StartFlow:
            {
                var target = await ProjectAsync(scope, P("flowId"));
                var flowDef = (scope.Env == Env.Prod ? target.Published : target.Draft)
                    ?? throw new ValidationException($"Publique o workflow '{target.Name}' antes de usar em produção.");
                var flow = flowDef.Automation ? flowDef.Workflows[0] : throw new ValidationException($"'{target.Name}' não é um workflow.");
                if (flow.Trigger.Type != Triggers.Call) throw new ValidationException($"O workflow '{target.Name}' precisa do gatilho \"Chamado por outro projeto\".");
                var input = new JsonObject(action.Values.Select(kv => KeyValuePair.Create(kv.Key, JsonVars.Parse(Template.Render(kv.Value, ctx)))));
                var data = new JsonObject
                {
                    ["trigger"] = Triggers.Call, ["source"] = scope.App.Name, ["sourceId"] = scope.App.Id.ToString(), ["user"] = user.Email,
                    ["now"] = ScheduleVars.Now(DateTime.Now), ["today"] = ScheduleVars.Today(DateTime.Now), ["input"] = input
                };
                var run = await FlowQueue.EnqueueAsync(runs, target, scope.Env, flow, Triggers.Call, data, user.Email);
                output["runId"] = run.Id.ToString();
                output["number"] = run.Number;
                result.Log.Add($"Workflow '{target.Name}' iniciado (#{run.Number}).");
                break;
            }
            case Actions.OpenLink:
            {
                var projectId = P("projectId");
                var url = projectId.Length > 0 ? Links.ProjectPath(await ProjectAsync(scope, projectId), scope.Env) : Links.RenderUrl(action.Params.GetValueOrDefault("url"), ctx);
                if (!Links.IsSafe(url)) throw new ValidationException("Link inválido: use http(s) ou um caminho do site (/...).");
                result.OpenUrl = Links.WithQuery(url, Values());
                result.OpenInNewTab = P("newTab") == "true";
                output["url"] = result.OpenUrl;
                break;
            }
            case Actions.RunWorkflow:
                result.Merge(await RunAsync(scope, scope.Definition.Workflow(P("workflowId")), ctx, user, depth + 1));
                break;
            default:
                throw new ValidationException($"Ação desconhecida: {action.Type}.");
        }
        return output;
    }

    /// <summary>Outro projeto do mesmo workspace (as ações entre projetos não atravessam workspaces).</summary>
    private async Task<App> ProjectAsync(AppScope scope, string id)
    {
        var target = Guid.TryParse(id, out var g) ? await apps.GetAsync(g) : null;
        if (target is null || target.WorkspaceId != scope.App.WorkspaceId) throw new ValidationException("Projeto não encontrado neste workspace.");
        return target;
    }

    private async Task<DataRecord> LoadRecordAsync(AppScope scope, string tableId, string recordId)
    {
        var record = Guid.TryParse(recordId, out var id) ? await records.GetAsync(id) : null;
        if (record is null || record.AppId != scope.App.Id || record.Env != scope.Env || record.TableId != tableId)
            throw new NotFoundException("Registro");
        return record;
    }
}

/// <summary>Execução de workflows com gatilho "click" (botões).</summary>
public class WorkflowService(AppService apps, WorkflowEngine engine, IUserProvider users)
{
    public async Task<WorkflowResult> RunClickAsync(Guid appId, string env, string workflowId, IDictionary<string, string?> ctx)
    {
        var scope = await apps.OpenAsync(appId, env);
        var wf = scope.Definition.Workflow(workflowId);
        // Agendados podem ser executados na hora por quem gerencia o app (botão "Executar agora" do editor).
        var allowed = wf.Trigger.Type == Triggers.Click || (wf.Trigger.Type == Triggers.Schedule && scope.CanManage);
        if (!allowed) throw new ValidationException("Este workflow não pode ser executado manualmente.");
        if (wf.Trigger.Type == Triggers.Schedule) ctx = new Dictionary<string, string?>(ctx) { ["now"] = ScheduleVars.Now(DateTime.Now), ["today"] = ScheduleVars.Today(DateTime.Now) };
        return await engine.RunAsync(scope, wf, ctx, users.GetCurrentUser());
    }
}

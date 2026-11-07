using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Domain;

/// <summary>
/// Expressão cron de 5 campos: minuto hora dia-do-mês mês dia-da-semana (0 ou 7 = domingo).
/// Aceita *, número, lista (1,3), intervalo (1-5) e passo (*/15, 8-18/2). Horário do servidor.
/// </summary>
public static class Cron
{
    private static readonly (int Min, int Max)[] Ranges = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 7)];
    private static readonly string[] Names = ["minuto", "hora", "dia do mês", "mês", "dia da semana"];

    public static string? Problem(string expression)
    {
        var parts = expression.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 5) return "a expressão cron precisa de 5 campos (minuto hora dia mês dia-da-semana)";
        for (var i = 0; i < 5; i++)
            if (Parse(parts[i], Ranges[i]) is null) return $"cron: {Names[i]} inválido ({parts[i]})";
        return null;
    }

    /// <summary>Primeira ocorrência estritamente depois de `after` (procura até 1 ano à frente).</summary>
    public static DateTime Next(string expression, DateTime after)
    {
        if (Problem(expression) is { } p) throw new ValidationException(p);
        var f = expression.Split(' ', StringSplitOptions.RemoveEmptyEntries).Select((x, i) => Parse(x, Ranges[i])!).ToArray();
        var dow = f[4].Select(d => d % 7).ToHashSet();
        var t = new DateTime(after.Year, after.Month, after.Day, after.Hour, after.Minute, 0, after.Kind).AddMinutes(1);
        var limit = t.AddYears(1);
        while (t < limit)
        {
            if (!f[3].Contains(t.Month)) { t = new DateTime(t.Year, t.Month, 1, 0, 0, 0, t.Kind).AddMonths(1); continue; }
            if (!f[2].Contains(t.Day) || !dow.Contains((int)t.DayOfWeek)) { t = t.Date.AddDays(1); continue; }
            if (!f[1].Contains(t.Hour)) { t = t.Date.AddHours(t.Hour + 1); continue; }
            if (f[0].Contains(t.Minute)) return t;
            t = t.AddMinutes(1);
        }
        throw new ValidationException("cron: nenhuma ocorrência no próximo ano.");
    }

    private static HashSet<int>? Parse(string field, (int Min, int Max) range)
    {
        var result = new HashSet<int>();
        foreach (var part in field.Split(','))
        {
            var (body, step) = part.Split('/') switch
            {
                [var b] => (b, 1),
                [var b, var s] when int.TryParse(s, out var n) && n > 0 => (b, n),
                _ => ("", 0)
            };
            if (step == 0) return null;
            int from, to;
            if (body == "*") (from, to) = range;
            else if (body.Split('-') is [var a, var b] && int.TryParse(a, out from) && int.TryParse(b, out to)) { }
            else if (int.TryParse(body, out from)) to = step > 1 ? range.Max : from;
            else return null;
            if (from < range.Min || to > range.Max || from > to) return null;
            for (var v = from; v <= to; v += step) result.Add(v);
        }
        return result;
    }
}

/// <summary>Regras de definição dos projetos de workflow.</summary>
public static partial class FlowRules
{
    public const int MaxForEachItems = 1000;
    public const int MaxWaitSeconds = 3600;
    public const int MaxRetries = 5;
    public const int DefaultTimeoutSeconds = 30;
    /// <summary>Passos executados por execução (cada item do "para cada" conta os passos de dentro).</summary>
    public const int MaxStepsPerRun = 500;

    [GeneratedRegex("^[A-Za-z_][A-Za-z0-9_]*$")]
    private static partial Regex StepId();

    public static List<string> Problems(AppDefinition def)
    {
        var errors = new List<string>();
        if (def.Workflows.Count != 1) return ["O projeto de workflow tem exatamente um workflow."];
        var wf = def.Workflows[0];
        if (wf.Trigger.Type is not (Triggers.Manual or Triggers.Webhook or Triggers.Schedule))
            errors.Add("Gatilho de workflow: manual, agendado ou webhook.");
        if (wf.Trigger.Type == Triggers.Webhook && string.IsNullOrWhiteSpace(wf.Trigger.WebhookKey))
            errors.Add("Gatilho webhook: gere a chave.");

        var steps = ActionDef.Flatten(wf.Actions).ToList();
        foreach (var s in steps)
        {
            var label = s.Id is { Length: > 0 } ? $"Passo '{s.Id}'" : "Passo";
            if (string.IsNullOrWhiteSpace(s.Id) || !StepId().IsMatch(s.Id)) errors.Add($"{label}: id inválido (letras, números e _; começa com letra).");
            if (s.Type is Actions.Navigate or Actions.RunWorkflow) errors.Add($"{label}: ação não disponível em workflows.");
            if (s.Type == Actions.If && (s.Condition is null || s.Condition.ActiveRules().Count == 0)) errors.Add($"{label}: informe a condição.");
            if (s.Type == Actions.ForEach && string.IsNullOrWhiteSpace(s.Params.GetValueOrDefault("list"))) errors.Add($"{label}: informe a lista.");
            if (s.Type == Actions.Wait && !(int.TryParse(s.Params.GetValueOrDefault("seconds"), out var w) && w is > 0 and <= MaxWaitSeconds))
                errors.Add($"{label}: espera entre 1 e {MaxWaitSeconds} segundos.");
            if (s.Retries is < 0 or > MaxRetries) errors.Add($"{label}: tentativas extras entre 0 e {MaxRetries}.");
            if (s.TimeoutSeconds is < 1 or > 600) errors.Add($"{label}: tempo limite entre 1 e 600 segundos.");
            if ((s.Steps.Count > 0 || s.Else.Count > 0) && s.Type is not (Actions.If or Actions.ForEach)) errors.Add($"{label}: só \"se\" e \"para cada\" têm passos dentro.");
        }
        foreach (var dup in steps.Where(s => !string.IsNullOrWhiteSpace(s.Id)).GroupBy(s => s.Id!, StringComparer.OrdinalIgnoreCase).Where(g => g.Count() > 1))
            errors.Add($"Id de passo repetido: {dup.Key}.");
        return errors;
    }
}

/// <summary>JSON → variáveis planas ({{prefixo.campo.sub}}). Listas/objetos também ficam inteiros (JSON) no próprio caminho.</summary>
public static class JsonVars
{
    private const int MaxDepth = 6;

    public static void Put(IDictionary<string, string?> ctx, string prefix, JsonNode? node, int depth = 0)
    {
        switch (node)
        {
            case JsonObject obj:
                ctx[prefix] = obj.ToJsonString();
                if (depth < MaxDepth) foreach (var (k, v) in obj) Put(ctx, $"{prefix}.{k}", v, depth + 1);
                break;
            case JsonArray arr:
                ctx[prefix] = arr.ToJsonString();
                ctx[$"{prefix}.count"] = arr.Count.ToString(CultureInfo.InvariantCulture);
                break;
            case JsonValue v:
                ctx[prefix] = v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : v.ToJsonString();
                break;
            default:
                ctx[prefix] = null;
                break;
        }
    }

    /// <summary>Texto que pode ser JSON (corpo de API) vira nó; senão, texto puro.</summary>
    public static JsonNode? Parse(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        try { return JsonNode.Parse(text); }
        catch (JsonException) { return JsonValue.Create(text); }
    }
}

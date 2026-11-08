using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Domain;

/// <summary>
/// Variáveis dos projetos de workflow: tipo primitivo, padrão quando vazia e apelido de um caminho ({{nome}} no lugar de
/// {{steps.api1.body.cliente}}). O passo "Transformar" grava nelas com operações pequenas (ver <see cref="TransformOps"/>).
/// Espelho só para UI em web/src/app/features/flows/flow-ops.ts (VARIABLE_TYPES, TRANSFORM_OPS, variableProblem).
/// </summary>
public static partial class Variables
{
    public const string Text = "text";
    public const string Number = "number";
    public const string Boolean = "boolean";
    public const string Date = "date";
    public const string List = "list";
    public const string Object = "object";
    public static readonly string[] Types = [Text, Number, Boolean, Date, List, Object];

    /// <summary>Raízes do contexto que uma variável não pode ocupar.</summary>
    public static readonly string[] Reserved = ["trigger", "steps", "secrets", "user", "now", "today", "id"];

    [GeneratedRegex("^[A-Za-z_][A-Za-z0-9_]*$")]
    public static partial Regex Name();

    private static readonly CultureInfo PtBr = CultureInfo.GetCultureInfo("pt-BR");
    private static readonly string[] DateFormats = ["yyyy-MM-dd", "yyyy-MM-ddTHH:mm", "yyyy-MM-ddTHH:mm:ss", "yyyy-MM-dd HH:mm", "yyyy-MM-dd HH:mm:ss", "dd/MM/yyyy", "dd/MM/yyyy HH:mm"];

    /// <summary>Valor de uma variável vazia: "", 0, false, "" (data), [], {}.</summary>
    public static JsonNode? Empty(string type) => type switch
    {
        Number => JsonValue.Create(0m),
        Boolean => JsonValue.Create(false),
        List => new JsonArray(),
        Object => new JsonObject(),
        _ => JsonValue.Create("")
    };

    /// <summary>Converte para o tipo; vazio (nulo ou "") vira o vazio do tipo. Valor incompatível lança <see cref="VariableException"/>.</summary>
    public static JsonNode? Coerce(string type, JsonNode? node)
    {
        if (IsEmpty(node)) return Empty(type);
        var text = node is JsonValue v && v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>().Trim() : node!.ToJsonString();
        switch (type)
        {
            case Number:
                return ParseNumber(text) is { } n ? JsonValue.Create(n) : throw new VariableException($"'{Short(text)}' não é número");
            case Boolean:
                return text.ToLowerInvariant() switch
                {
                    "true" or "sim" or "1" => JsonValue.Create(true),
                    "false" or "não" or "nao" or "0" => JsonValue.Create(false),
                    _ => throw new VariableException($"'{Short(text)}' não é sim/não")
                };
            case Date:
                return ParseDate(text) is { } d ? JsonValue.Create(FormatDate(d)) : throw new VariableException($"'{Short(text)}' não é data (use AAAA-MM-DD)");
            case List:
                return (node as JsonArray ?? JsonVars.Parse(text) as JsonArray)?.DeepClone() ?? throw new VariableException($"'{Short(text)}' não é lista JSON");
            case Object:
                return (node as JsonObject ?? JsonVars.Parse(text) as JsonObject)?.DeepClone() ?? throw new VariableException($"'{Short(text)}' não é objeto JSON");
            default:
                return JsonValue.Create(text);
        }
    }

    /// <summary>Problema do padrão digitado (null = ok).</summary>
    public static string? DefaultProblem(VariableDef v)
    {
        if (string.IsNullOrWhiteSpace(v.Default)) return null;
        try { Coerce(v.Type, JsonVars.Parse(v.Default)); return null; }
        catch (VariableException ex) { return ex.Message; }
    }

    /// <summary>Início da execução: toda variável existe com o padrão (ou o vazio do tipo); apelidos já resolvidos.</summary>
    public static void Init(IDictionary<string, string?> ctx, IEnumerable<VariableDef> vars)
    {
        foreach (var v in vars) Set(ctx, v, JsonVars.Parse(v.Default));
        RefreshAliases(ctx, vars);
    }

    /// <summary>Apelido acompanha o caminho: reaplicado depois de cada passo. Caminho ainda inexistente mantém o padrão.</summary>
    public static void RefreshAliases(IDictionary<string, string?> ctx, IEnumerable<VariableDef> vars)
    {
        foreach (var v in vars.Where(v => !string.IsNullOrWhiteSpace(v.From)))
            if (ctx.TryGetValue(v.From!.Trim(), out var raw))
                Set(ctx, v, string.IsNullOrEmpty(raw) ? JsonVars.Parse(v.Default) : JsonVars.Parse(raw));
    }

    /// <summary>Grava a variável já convertida ao tipo (vazio cai no padrão) e devolve o valor gravado.</summary>
    public static JsonNode? Set(IDictionary<string, string?> ctx, VariableDef v, JsonNode? value)
    {
        var typed = Coerce(v.Type, IsEmpty(value) ? JsonVars.Parse(v.Default) : value);
        foreach (var key in ctx.Keys.Where(k => k.StartsWith(v.Name + ".", StringComparison.OrdinalIgnoreCase)).ToList()) ctx.Remove(key);
        JsonVars.Put(ctx, v.Name, typed);
        return typed;
    }

    /// <summary>
    /// Problemas das variáveis e das operações do Transformar de um workflow (projeto ou automação).
    /// `taken`: nomes do contexto que a variável não pode esconder (item do "para cada", campos, inputs), descritos em `takenBy`.
    /// </summary>
    public static IEnumerable<string> Problems(WorkflowDef wf, IEnumerable<string> taken, string takenBy)
    {
        var used = new HashSet<string>(taken, StringComparer.OrdinalIgnoreCase);
        var reserved = new HashSet<string>(Reserved, StringComparer.OrdinalIgnoreCase);
        foreach (var v in wf.Variables)
        {
            var label = $"Variável '{v.Name}'";
            if (!Name().IsMatch(v.Name)) yield return $"{label}: nome inválido (letras, números e _; começa com letra).";
            else if (reserved.Contains(v.Name)) yield return $"{label}: nome reservado.";
            else if (used.Contains(v.Name)) yield return $"{label}: nome já usado por {takenBy}.";
            if (!Types.Contains(v.Type)) yield return $"{label}: tipo inválido ({v.Type}).";
            else if (DefaultProblem(v) is { } p) yield return $"{label}: padrão inválido, {p}.";
            if (v.From is { } from && (from.Contains("{{") || from.Contains(' '))) yield return $"{label}: apelido é um caminho, sem {{{{ }}}} (ex.: steps.api1.body).";
        }
        foreach (var dup in wf.Variables.GroupBy(v => v.Name, StringComparer.OrdinalIgnoreCase).Where(g => g.Count() > 1))
            yield return $"Variável repetida: {dup.Key}.";

        var byName = wf.Variables.GroupBy(v => v.Name, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        foreach (var s in ActionDef.Flatten(wf.Actions).Where(s => s.Type == Actions.Transform))
            foreach (var op in s.Ops)
            {
                var label = s.Id is { Length: > 0 } id ? $"Passo '{id}'" : $"Transformar em '{wf.Name}'";
                if (!byName.TryGetValue(op.Target, out var target)) yield return $"{label}: escolha a variável de destino{(op.Target is { Length: > 0 } t ? $" ('{t}' não existe)" : "")}.";
                else if (!string.IsNullOrWhiteSpace(target.From)) yield return $"{label}: '{target.Name}' é apelido de {target.From}; grave em outra variável.";
                if (!TransformOps.Exists(op.Op)) yield return $"{label}: operação desconhecida ({op.Op}).";
                else if (TransformOps.NumericArg.Contains(op.Op) && op.Arg is { Length: > 0 } arg && !arg.Contains("{{") && ParseNumber(arg) is null)
                    yield return $"{label}: o argumento de {op.Op} precisa ser número.";
            }
    }

    /// <summary>
    /// Roda as operações do Transformar em ordem (uma lê o que a anterior gravou) e devolve {variável: valor} gravado.
    /// `input` recebe o que foi usado em cada operação (histórico). Falha → <see cref="VariableException"/> com a operação e a variável.
    /// </summary>
    public static JsonObject ApplyOps(IDictionary<string, string?> ctx, IReadOnlyList<VariableDef> vars, IEnumerable<TransformOp> ops, JsonArray? input = null)
    {
        var result = new JsonObject();
        foreach (var op in ops)
        {
            var ro = ctx as IReadOnlyDictionary<string, string?> ?? new Dictionary<string, string?>(ctx, StringComparer.OrdinalIgnoreCase);
            var (value, arg) = (Template.Render(op.Input, ro), Template.Render(op.Arg, ro));
            input?.Add(new JsonObject { ["variavel"] = op.Target, ["operacao"] = op.Op, ["entrada"] = value, ["argumento"] = arg });
            var target = vars.FirstOrDefault(v => string.Equals(v.Name, op.Target, StringComparison.OrdinalIgnoreCase))
                ?? throw new VariableException($"variável '{op.Target}' não existe");
            try { result[target.Name] = Set(ctx, target, TransformOps.Apply(op.Op, value, arg))?.DeepClone(); }
            catch (VariableException ex) { throw new VariableException($"{op.Op} em '{target.Name}': {ex.Message}"); }
        }
        return result;
    }

    public static bool IsEmpty(JsonNode? node) =>
        node is null || (node is JsonValue v && v.GetValueKind() == JsonValueKind.String && string.IsNullOrWhiteSpace(v.GetValue<string>()));

    public static decimal? ParseNumber(string text)
    {
        var t = text.Trim();
        if (t.Contains(',') && !t.Contains('.')) t = t.Replace(',', '.');
        return decimal.TryParse(t, NumberStyles.Float, CultureInfo.InvariantCulture, out var n) ? n / 1.0000000000000000000000000000m : null;
    }

    public static DateTime? ParseDate(string text) =>
        DateTime.TryParseExact(text.Trim(), DateFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d
        : DateTime.TryParse(text.Trim(), CultureInfo.InvariantCulture, DateTimeStyles.None, out d) ? d : null;

    public static string FormatDate(DateTime d) => d.TimeOfDay == TimeSpan.Zero ? d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : d.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);

    public static string FormatDate(DateTime d, string pattern) => d.ToString(pattern, PtBr);

    private static string Short(string text) => text.Length > 40 ? text[..40] + "…" : text;
}

public sealed class VariableException(string message) : Exception(message);

/// <summary>
/// Operações do passo "Transformar": cada uma recebe a entrada (texto já com {{variáveis}} trocadas) e um argumento opcional.
/// Para adicionar uma, basta uma linha aqui e outra em TRANSFORM_OPS (flow-ops.ts).
/// </summary>
public static class TransformOps
{
    private static readonly Dictionary<string, Func<string, string, JsonNode?>> Ops = new(StringComparer.OrdinalIgnoreCase)
    {
        // Geral
        ["set"] = (input, _) => JsonVars.Parse(input),
        ["default"] = (input, arg) => JsonVars.Parse(string.IsNullOrWhiteSpace(input) ? arg : input),
        // Texto
        ["upper"] = (input, _) => input.ToUpperInvariant(),
        ["lower"] = (input, _) => input.ToLowerInvariant(),
        ["trim"] = (input, _) => input.Trim(),
        ["append"] = (input, arg) => input + arg,
        ["split"] = (input, arg) => new JsonArray([.. input.Split(string.IsNullOrEmpty(arg) ? "," : arg).Select(p => (JsonNode?)JsonValue.Create(p.Trim()))]),
        // Número
        ["add"] = (input, arg) => Num(input) + Num(arg),
        ["subtract"] = (input, arg) => Num(input) - Num(arg),
        ["multiply"] = (input, arg) => Num(input) * Num(arg),
        ["divide"] = (input, arg) => Num(arg) == 0 ? throw new VariableException("divisão por zero") : Num(input) / Num(arg),
        ["round"] = (input, arg) => Math.Round(Num(input), string.IsNullOrWhiteSpace(arg) ? 0 : (int)Math.Clamp(Num(arg), 0, 10), MidpointRounding.AwayFromZero),
        // Lista
        ["count"] = (input, _) => ListOf(input).Count,
        ["first"] = (input, _) => ListOf(input).FirstOrDefault()?.DeepClone(),
        ["last"] = (input, _) => ListOf(input).LastOrDefault()?.DeepClone(),
        ["join"] = (input, arg) => string.Join(string.IsNullOrEmpty(arg) ? ", " : arg, ListOf(input).Select(Plain)),
        ["pluck"] = (input, arg) => new JsonArray([.. ListOf(input).Select(i => Get(i, arg)?.DeepClone())]),
        ["sum"] = (input, _) => ListOf(input).Sum(i => Num(Plain(i))),
        // Objeto
        ["get"] = (input, arg) => Get(JsonVars.Parse(input), arg)?.DeepClone(),
        // Data
        ["addDays"] = (input, arg) => Variables.FormatDate(DateOf(input).AddDays((double)Num(arg))),
        ["formatDate"] = (input, arg) => Variables.FormatDate(DateOf(input), string.IsNullOrWhiteSpace(arg) ? "dd/MM/yyyy" : arg),
    };

    public static IReadOnlyCollection<string> Names => Ops.Keys;

    /// <summary>Operações cujo argumento tem de ser número (validado ao salvar quando não usa {{variável}}).</summary>
    public static readonly string[] NumericArg = ["add", "subtract", "multiply", "divide", "round", "addDays"];

    public static bool Exists(string op) => Ops.ContainsKey(op);

    public static JsonNode? Apply(string op, string input, string arg) =>
        Ops.TryGetValue(op, out var fn) ? fn(input, arg) : throw new VariableException($"operação desconhecida: {op}");

    private static decimal Num(string text) =>
        Variables.ParseNumber(string.IsNullOrWhiteSpace(text) ? "0" : text) ?? throw new VariableException($"'{text}' não é número");

    private static DateTime DateOf(string text) => Variables.ParseDate(text) ?? throw new VariableException($"'{text}' não é data");

    private static JsonArray ListOf(string text) => JsonVars.Parse(text) as JsonArray ?? (string.IsNullOrWhiteSpace(text) ? [] : throw new VariableException("a entrada não é lista JSON"));

    private static string Plain(JsonNode? n) => n is JsonValue v && v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : n?.ToJsonString() ?? "";

    /// <summary>Caminho com pontos ("cliente.nome", "itens.0.id").</summary>
    private static JsonNode? Get(JsonNode? node, string path)
    {
        foreach (var part in path.Split('.', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            node = node switch
            {
                JsonObject o => o.FirstOrDefault(kv => string.Equals(kv.Key, part, StringComparison.OrdinalIgnoreCase)).Value,
                JsonArray a when int.TryParse(part, out var i) && i >= 0 && i < a.Count => a[i],
                _ => null
            };
        return node;
    }
}

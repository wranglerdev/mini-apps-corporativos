namespace Domain;

/// <summary>
/// Definição completa de um mini app (páginas, tabelas e workflows) guardada como um único documento JSON.
/// Rascunho, versão publicada, templates e clones são cópias deste documento.
/// </summary>
public class AppDefinition
{
    public List<PageDef> Pages { get; set; } = [];
    public List<TableDef> Tables { get; set; } = [];
    public List<WorkflowDef> Workflows { get; set; } = [];
    /// <summary>Preenchido só em projetos do tipo formulário (sem páginas). Ver FormDef.</summary>
    public FormDef? Form { get; set; }
    /// <summary>Projeto do tipo workflow: sem páginas, um workflow que roda em segundo plano (fila + histórico). Ver FlowRunner.</summary>
    public bool Automation { get; set; }

    public TableDef Table(string id) =>
        Tables.FirstOrDefault(t => t.Id == id) ?? throw new NotFoundException("Tabela");

    public WorkflowDef Workflow(string id) =>
        Workflows.FirstOrDefault(w => w.Id == id) ?? throw new NotFoundException("Workflow");

    public static AppDefinition Blank() => new()
    {
        Pages =
        [
            new PageDef
            {
                Id = "home", Name = "Início",
                Components = [new ComponentDef { Id = Ids.New(), Type = "text", Props = { ["text"] = "Meu novo app", ["variant"] = "title" } }]
            }
        ]
    };

    /// <summary>Formulário novo: tabela "Respostas" + uma pergunta de texto curto.</summary>
    public static AppDefinition BlankForm()
    {
        var field = new FieldDef { Name = "Pergunta 1", Type = FieldType.Text, Required = true };
        var table = new TableDef { Id = "respostas", Name = "Respostas", Fields = [field] };
        return new AppDefinition
        {
            Tables = [table],
            Form = new FormDef
            {
                TableId = table.Id, WelcomeTitle = "", WelcomeText = "",
                Questions = [new QuestionDef { FieldId = field.Id, Kind = QuestionKinds.Short, Title = "Qual é a sua pergunta?" }]
            }
        };
    }

    /// <summary>Workflow novo: um gatilho manual e nenhum passo.</summary>
    public static AppDefinition BlankWorkflow() => new()
    {
        Automation = true,
        Workflows = [new WorkflowDef { Name = "Workflow", Trigger = new TriggerDef { Type = Triggers.Manual } }]
    };

    /// <summary>Campos renomeados entre duas definições (mesmo Id, nome diferente), por tabela: nome antigo → novo.</summary>
    public static List<(string TableId, Dictionary<string, string> Renames)> FieldRenames(AppDefinition? from, AppDefinition to)
    {
        var result = new List<(string, Dictionary<string, string>)>();
        if (from is null) return result;
        foreach (var newTable in to.Tables)
        {
            var old = from.Tables.FirstOrDefault(t => t.Id == newTable.Id);
            if (old is null) continue;
            var map = newTable.Fields
                .Select(f => (Old: old.Fields.FirstOrDefault(o => o.Id == f.Id)?.Name, New: f.Name))
                .Where(x => x.Old is not null && x.Old != x.New)
                .ToDictionary(x => x.Old!, x => x.New);
            if (map.Count > 0) result.Add((newTable.Id, map));
        }
        return result;
    }

    public void Validate()
    {
        var errors = new List<string>();
        if (Form is null && !Automation && Pages.Count == 0) errors.Add("O app precisa de ao menos uma página.");
        if (Automation) errors.AddRange(FlowRules.Problems(this));
        if (Form is not null) errors.AddRange(FormFlow.Problems(Form, Tables));
        if (Tables.GroupBy(t => t.Name.Trim().ToLowerInvariant()).Any(g => g.Count() > 1)) errors.Add("Nomes de tabela repetidos.");

        foreach (var wf in Workflows)
        {
            if (wf.Trigger.Type == Triggers.Schedule && Schedule.Problem(wf.Trigger) is { } problem)
                errors.Add($"Workflow '{wf.Name}': {problem}.");
            foreach (var a in ActionDef.Flatten(wf.Actions).Where(a => a.Type == Actions.RunWorkflow))
            {
                var target = a.Params.GetValueOrDefault("workflowId");
                if (target == wf.Id) errors.Add($"Workflow '{wf.Name}': não pode executar a si mesmo.");
                else if (Workflows.All(w => w.Id != target)) errors.Add($"Workflow '{wf.Name}': workflow a executar não existe.");
            }
        }

        foreach (var page in Pages)
        {
            var all = page.Components.SelectMany(c => c.Flatten()).ToList();
            if (all.Any(x => x.Component.Children.Count > 0 && x.Component.Type != ComponentDef.Container))
                errors.Add($"Página '{page.Name}': só containers podem ter componentes dentro.");
            if (all.Any(x => x.Depth > ComponentDef.MaxDepth))
                errors.Add($"Página '{page.Name}': containers aninhados em mais de {ComponentDef.MaxDepth} níveis.");
            if (all.GroupBy(x => x.Component.Id).Any(g => g.Count() > 1))
                errors.Add($"Página '{page.Name}': componentes com id repetido.");
        }

        foreach (var t in Tables)
        {
            if (string.IsNullOrWhiteSpace(t.Name)) errors.Add("Tabela sem nome.");
            if (t.Fields.GroupBy(f => f.Name.Trim().ToLowerInvariant()).Any(g => g.Count() > 1)) errors.Add($"Campos repetidos em '{t.Name}'.");
            foreach (var f in t.Fields)
            {
                if (string.IsNullOrWhiteSpace(f.Name)) errors.Add($"Campo sem nome em '{t.Name}'.");
                if (f.Type == FieldType.Select && f.Options.Count == 0) errors.Add($"Campo '{f.Name}' precisa de opções.");
                if (f.Type == FieldType.Relation && Tables.All(x => x.Id != f.RelationTableId)) errors.Add($"Campo '{f.Name}' aponta para tabela inexistente.");
            }
        }
        if (errors.Count > 0) throw new ValidationException(string.Join(" ", errors));
    }
}

public class PageDef
{
    public string Id { get; set; } = Ids.New();
    public string Name { get; set; } = "Página";
    public List<ComponentDef> Components { get; set; } = [];
}

/// <summary>
/// Componente visual. Type: text | button | input | table | list | card | form | chart | container. Span: colunas de 12.
/// Só "container" tem Children (grade própria de 12 colunas). VisibleWhen é avaliado no navegador: é apresentação,
/// não segurança (dados são protegidos pelas permissões de tabela/campo).
/// </summary>
public class ComponentDef
{
    public const string Container = "container";
    public const int MaxDepth = 4;

    public string Id { get; set; } = Ids.New();
    public string Type { get; set; } = "text";
    public int Span { get; set; } = 12;
    public Dictionary<string, string?> Props { get; set; } = [];
    public List<ComponentDef> Children { get; set; } = [];
    /// <summary>Mostrar só quando a condição for verdadeira (variáveis: inputs da página, user.role, user.department, user.email, user.canManage).</summary>
    public ConditionDef? VisibleWhen { get; set; }

    /// <summary>Este componente e todos os descendentes, com a profundidade (raiz = 1).</summary>
    public IEnumerable<(ComponentDef Component, int Depth)> Flatten(int depth = 1) =>
        Children.SelectMany(c => c.Flatten(depth + 1)).Prepend((this, depth));
}

public enum FieldType { Text, Number, Date, Select, Relation, File }

public class FieldDef
{
    public string Id { get; set; } = Ids.New();
    public string Name { get; set; } = "";
    public FieldType Type { get; set; } = FieldType.Text;
    public bool Required { get; set; }
    /// <summary>Permissão por campo: visível só para quem gerencia o app.</summary>
    public bool BuildersOnly { get; set; }
    /// <summary>Permissão por campo: usuários veem mas não editam (ex.: status de aprovação).</summary>
    public bool ReadOnly { get; set; }
    public List<string> Options { get; set; } = [];
    public string? RelationTableId { get; set; }
}

/// <summary>Permissões por tabela para usuários finais (quem gerencia o app pode tudo). Leitura é liberada a quem acessa o app.</summary>
public class TablePermissions
{
    public bool UserCanCreate { get; set; } = true;
    public bool UserCanEdit { get; set; }
    public bool UserCanDelete { get; set; }
}

public class TableDef
{
    public string Id { get; set; } = Ids.New();
    public string Name { get; set; } = "";
    public List<FieldDef> Fields { get; set; } = [];
    public TablePermissions Permissions { get; set; } = new();
    /// <summary>Chave do webhook de entrada (POST /api/hooks/{app}/{tabela}). Nula = desligado. Nunca enviada ao modo usuário.</summary>
    public string? WebhookKey { get; set; }
}

public static class Triggers
{
    public const string Click = "click";
    public const string RecordCreated = "recordCreated";
    public const string RecordUpdated = "recordUpdated";
    /// <summary>Agendado (Frequency/Time/DayOfWeek). Roda só na versão publicada, pelo ScheduledWorkflowService.</summary>
    public const string Schedule = "schedule";
    /// <summary>Só em projetos de workflow: "Executar agora" (ou o botão Testar).</summary>
    public const string Manual = "manual";
    /// <summary>Só em projetos de workflow: POST /api/hooks/wf/{app} com X-Webhook-Key; o corpo JSON vira {{trigger.*}}.</summary>
    public const string Webhook = "webhook";
}

public static class Actions
{
    public const string CreateRecord = "createRecord";
    public const string UpdateRecord = "updateRecord";
    public const string SendEmail = "sendEmail";
    public const string CallApi = "callApi";
    public const string Navigate = "navigate";
    public const string RequestApproval = "requestApproval";
    /// <summary>Executa outro workflow (Params.workflowId) com o contexto atual.</summary>
    public const string RunWorkflow = "runWorkflow";

    // Passos de controle (projetos de workflow; ver FlowRunner)
    /// <summary>Se/senão: Condition; Steps (então) e Else (senão).</summary>
    public const string If = "if";
    /// <summary>Para cada: Params.list (JSON de lista, ex.: {{steps.buscar.body.itens}}), Params.as (padrão item); Steps por item.</summary>
    public const string ForEach = "forEach";
    /// <summary>Esperar: Params.seconds.</summary>
    public const string Wait = "wait";
    /// <summary>Transformar: Values (nome → {{}}) viram a saída do passo.</summary>
    public const string Transform = "transform";

    public static readonly string[] Control = [If, ForEach, Wait, Transform];
}

public class TriggerDef
{
    public string Type { get; set; } = Triggers.Click;
    /// <summary>Obrigatório para gatilhos de registro.</summary>
    public string? TableId { get; set; }
    /// <summary>Gatilho agendado: hourly | daily | weekly.</summary>
    public string? Frequency { get; set; }
    /// <summary>Gatilho agendado diário/semanal: "HH:mm" (horário do servidor).</summary>
    public string? Time { get; set; }
    /// <summary>Gatilho agendado semanal: 0 = domingo ... 6 = sábado.</summary>
    public int? DayOfWeek { get; set; }
    /// <summary>Gatilho agendado com Frequency = "cron": expressão de 5 campos (min hora dia mês dia-da-semana).</summary>
    public string? Cron { get; set; }
    /// <summary>Gatilho webhook: chave exigida em X-Webhook-Key. Nunca enviada a quem não gerencia.</summary>
    public string? WebhookKey { get; set; }
}

/// <summary>Cálculo da próxima execução de um gatilho agendado.</summary>
public static class Schedule
{
    public static readonly string[] Frequencies = ["hourly", "daily", "weekly", "cron"];

    /// <summary>Primeira ocorrência estritamente depois de `after`.</summary>
    public static DateTime NextRun(DateTime after, TriggerDef trigger)
    {
        if (trigger.Frequency == "hourly")
            return new DateTime(after.Year, after.Month, after.Day, after.Hour, 0, 0, after.Kind).AddHours(1);
        if (trigger.Frequency == "cron") return Domain.Cron.Next(trigger.Cron ?? "", after);

        var time = TimeOnly.ParseExact(trigger.Time ?? "", "HH:mm");
        var next = after.Date.Add(time.ToTimeSpan());
        if (trigger.Frequency == "weekly")
        {
            while ((int)next.DayOfWeek != trigger.DayOfWeek || next <= after) next = next.AddDays(1);
            return next;
        }
        return next > after ? next : next.AddDays(1);
    }

    public static string? Problem(TriggerDef t) => t.Frequency switch
    {
        null or "" => "informe a frequência",
        "hourly" => null,
        "cron" => Domain.Cron.Problem(t.Cron ?? ""),
        "daily" or "weekly" when !TimeOnly.TryParseExact(t.Time ?? "", "HH:mm", out _) => "informe o horário (HH:mm)",
        "weekly" when t.DayOfWeek is not (>= 0 and <= 6) => "informe o dia da semana",
        "daily" or "weekly" => null,
        _ => $"frequência inválida: {t.Frequency}"
    };
}

/// <summary>Op: eq | neq | gt | lt | contains | empty | notEmpty. Value aceita {{variáveis}}.</summary>
public class ConditionDef
{
    public string Field { get; set; } = "";
    public string Op { get; set; } = "eq";
    public string? Value { get; set; }
}

/// <summary>Params e Values aceitam {{variáveis}} do contexto (campos do registro, inputs da página, user.email...).</summary>
public class ActionDef
{
    public string Type { get; set; } = Actions.SendEmail;
    public Dictionary<string, string?> Params { get; set; } = [];
    /// <summary>Valores de campos para createRecord/updateRecord.</summary>
    public Dictionary<string, string?> Values { get; set; } = [];

    // ---- Projetos de workflow (FlowRunner). Ignorados nas automações de mini app/formulário. ----
    /// <summary>Id do passo: a saída fica em {{steps.&lt;id&gt;.*}}.</summary>
    public string? Id { get; set; }
    /// <summary>Passo "if".</summary>
    public ConditionDef? Condition { get; set; }
    /// <summary>"if": passos do "então"; "forEach": passos de cada item.</summary>
    public List<ActionDef> Steps { get; set; } = [];
    /// <summary>"if": passos do "senão".</summary>
    public List<ActionDef> Else { get; set; } = [];
    /// <summary>Tentativas extras se o passo falhar (espera 1 s, 2 s, 4 s...). Só para passos seguros de repetir.</summary>
    public int Retries { get; set; }
    /// <summary>Tempo limite do passo (padrão 30 s).</summary>
    public int? TimeoutSeconds { get; set; }

    /// <summary>Todos os passos da árvore (inclui os de dentro de "if" e "forEach").</summary>
    public static IEnumerable<ActionDef> Flatten(IEnumerable<ActionDef> steps) =>
        steps.SelectMany(s => Flatten(s.Steps).Concat(Flatten(s.Else)).Prepend(s));
}

public class WorkflowDef
{
    public string Id { get; set; } = Ids.New();
    public string Name { get; set; } = "Workflow";
    public TriggerDef Trigger { get; set; } = new();
    public ConditionDef? Condition { get; set; }
    public List<ActionDef> Actions { get; set; } = [];
}

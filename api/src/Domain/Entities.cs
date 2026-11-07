namespace Domain;

/// <summary>Workspace = unidade/departamento. Admin governa todos; builder gerencia os do seu departamento.</summary>
public class Workspace
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string Department { get; set; } = "";
}

public class App
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkspaceId { get; set; }
    public string Name { get; set; } = "";
    public string Slug { get; set; } = "";
    public string Description { get; set; } = "";
    public AppDefinition Draft { get; set; } = AppDefinition.Blank();
    /// <summary>Tipo do projeto, derivado da definição: "form" (tem formulário), "workflow" (Automation) ou "app".</summary>
    public string Kind => ProjectKinds.Of(Draft);
    public AppDefinition? Published { get; set; }
    public int? PublishedVersion { get; set; }
    /// <summary>Aparece na biblioteca de templates compartilháveis entre departamentos.</summary>
    public bool IsTemplate { get; set; }
    /// <summary>Aparece no catálogo interno (loja de apps) quando publicado.</summary>
    public bool InCatalog { get; set; }
    /// <summary>Departamentos que podem usar o app publicado. Vazio = todos.</summary>
    public List<string> AllowedDepartments { get; set; } = [];
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class AppVersion
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid AppId { get; set; }
    public int Number { get; set; }
    public AppDefinition Definition { get; set; } = new();
    public string PublishedBy { get; set; } = "";
    public DateTime PublishedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Registro de uma tabela do banco embutido. Valores sempre em string normalizada (ver RecordValidator).</summary>
public class DataRecord
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid AppId { get; set; }
    public string Env { get; set; } = Domain.Env.Draft;
    public string TableId { get; set; } = "";
    public Dictionary<string, string?> Data { get; set; } = [];
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string? UpdatedBy { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public DataRecord Project(IEnumerable<FieldDef> fields) => new()
    {
        Id = Id, AppId = AppId, Env = Env, TableId = TableId,
        Data = fields.ToDictionary(f => f.Name, f => Data.GetValueOrDefault(f.Name)),
        CreatedBy = CreatedBy, CreatedAt = CreatedAt, UpdatedBy = UpdatedBy, UpdatedAt = UpdatedAt
    };

    public Dictionary<string, string?> ToContext() => new(Data)
    {
        ["id"] = Id.ToString(),
        ["tableId"] = TableId,
        ["createdBy"] = CreatedBy
    };
}

public enum ApprovalStatus { Pending, Approved, Rejected }

public class Approval
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid AppId { get; set; }
    public string Env { get; set; } = Domain.Env.Draft;
    public string TableId { get; set; } = "";
    public Guid RecordId { get; set; }
    public string Title { get; set; } = "";
    public string StatusField { get; set; } = "Status";
    public string Approver { get; set; } = "";
    public string RequestedBy { get; set; } = "";
    public ApprovalStatus Status { get; set; } = ApprovalStatus.Pending;
    public string? Comment { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DecidedAt { get; set; }

    public static string Text(ApprovalStatus s) => s switch
    {
        ApprovalStatus.Approved => "Aprovado",
        ApprovalStatus.Rejected => "Rejeitado",
        _ => "Pendente"
    };
}

public class AuditEntry
{
    public long Id { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
    public string User { get; set; } = "";
    public string Action { get; set; } = "";
    public string Entity { get; set; } = "";
    public string? EntityId { get; set; }
    public string? Details { get; set; }
}

public static class AuditLogExtensions
{
    public static Task WriteAsync(this IAuditLog log, CurrentUser user, string action, string entity, string? entityId, string? details = null) =>
        log.WriteAsync(new AuditEntry { User = user.Email, Action = action, Entity = entity, EntityId = entityId, Details = details });
}

public static class ProjectKinds
{
    public const string App = "app";
    public const string Form = "form";
    public const string Workflow = "workflow";

    public static string Of(AppDefinition d) => d.Form is not null ? Form : d.Automation ? Workflow : App;
}

/// <summary>Uma execução de workflow (projeto de workflow). Entra na fila como "queued"; o FlowRunner executa.</summary>
public class WorkflowRun
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid AppId { get; set; }
    public string Env { get; set; } = Domain.Env.Prod;
    public string WorkflowId { get; set; } = "";
    /// <summary>Sequencial por app (#1842).</summary>
    public int Number { get; set; }
    public int? Version { get; set; }
    public string Status { get; set; } = RunStatus.Queued;
    /// <summary>manual | schedule | webhook | recordCreated | recordUpdated | rerun</summary>
    public string Trigger { get; set; } = Triggers.Manual;
    /// <summary>Variáveis do gatilho (JSON de objeto plano).</summary>
    public string TriggerData { get; set; } = "{}";
    public string RequestedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
    public string? Error { get; set; }
    /// <summary>Reexecução a partir de um passo de 1º nível: os anteriores reaproveitam a saída de SourceRunId.</summary>
    public string? StartFromStepId { get; set; }
    public Guid? SourceRunId { get; set; }
}

/// <summary>Um trecho da linha do tempo de uma execução: passo, tentativa, espera ou item de "para cada".</summary>
public class RunStep
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RunId { get; set; }
    public Guid? ParentId { get; set; }
    /// <summary>Ordem de criação na execução (a linha do tempo segue esta ordem).</summary>
    public int Order { get; set; }
    public int Depth { get; set; }
    /// <summary>Id do passo na definição (null para tentativas, esperas e itens).</summary>
    public string? StepId { get; set; }
    public string Name { get; set; } = "";
    /// <summary>Tipo da ação, ou "attempt" | "backoff" | "item".</summary>
    public string Type { get; set; } = "";
    public string Status { get; set; } = RunStatus.Running;
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? FinishedAt { get; set; }
    /// <summary>Entrada e saída em texto (JSON), truncadas e com segredos mascarados.</summary>
    public string? Input { get; set; }
    public string? Output { get; set; }
    public string? Error { get; set; }
}

public static class RunStatus
{
    public const string Queued = "queued";
    public const string Running = "running";
    public const string Succeeded = "succeeded";
    public const string Failed = "failed";
    /// <summary>Passo: reaproveitado de outra execução ("reexecutar a partir daqui") ou ramo não seguido.</summary>
    public const string Skipped = "skipped";
}

/// <summary>Segredo do workspace sem o valor (o valor só existe dentro da execução).</summary>
public record SecretInfo(string Name, string UpdatedBy, DateTime UpdatedAt);

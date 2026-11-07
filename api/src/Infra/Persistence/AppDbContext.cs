using Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Infra;

/// <summary>
/// EF Core + SQLite. Para trocar de banco (ex.: SQL Server/PostgreSQL) basta trocar o provider em
/// InfraServiceCollection.AddSqlitePersistence; os documentos JSON (definições e dados) viram colunas texto.
/// </summary>
public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Workspace> Workspaces => Set<Workspace>();
    public DbSet<App> Apps => Set<App>();
    public DbSet<AppVersion> AppVersions => Set<AppVersion>();
    public DbSet<DataRecord> Records => Set<DataRecord>();
    public DbSet<Approval> Approvals => Set<Approval>();
    public DbSet<AuditEntry> AuditEntries => Set<AuditEntry>();
    public DbSet<ScheduleState> ScheduleStates => Set<ScheduleState>();
    public DbSet<FormCounter> FormCounters => Set<FormCounter>();
    public DbSet<WorkflowRun> WorkflowRuns => Set<WorkflowRun>();
    public DbSet<RunStep> RunSteps => Set<RunStep>();
    public DbSet<SecretRow> Secrets => Set<SecretRow>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<App>(e =>
        {
            e.HasIndex(a => a.Slug).IsUnique();
            e.Ignore(a => a.Kind); // derivado da definição
            e.Property(a => a.Draft).HasConversion(JsonConverter<AppDefinition>());
            e.Property(a => a.Published).HasConversion(JsonConverter<AppDefinition?>());
        });
        b.Entity<AppVersion>(e =>
        {
            e.HasIndex(v => new { v.AppId, v.Number }).IsUnique();
            e.Property(v => v.Definition).HasConversion(JsonConverter<AppDefinition>());
        });
        b.Entity<DataRecord>(e =>
        {
            e.ToTable("Records");
            e.HasIndex(r => new { r.AppId, r.Env, r.TableId });
            e.Property(r => r.Data).HasConversion(JsonConverter<Dictionary<string, string?>>());
        });
        b.HasDbFunction(typeof(Json).GetMethod(nameof(Json.Extract))!).HasName("json_extract");
        b.Entity<Approval>(e => e.HasIndex(a => a.Approver));
        b.Entity<AuditEntry>(e => e.HasIndex(a => a.At));
        b.Entity<ScheduleState>(e => e.HasKey(s => new { s.AppId, s.WorkflowId }));
        b.Entity<FormCounter>(e => e.HasKey(c => new { c.AppId, c.Key }));
        b.Entity<WorkflowRun>(e => { e.HasIndex(r => new { r.AppId, r.Env }); e.HasIndex(r => r.Status); });
        b.Entity<RunStep>(e => e.HasIndex(s => s.RunId));
        b.Entity<SecretRow>(e => e.HasKey(s => new { s.WorkspaceId, s.Name }));
    }

    private static ValueConverter<T, string> JsonConverter<T>() =>
        new(v => JsonUtil.Serialize(v), s => JsonUtil.Deserialize<T>(s));
}

/// <summary>Funções SQL do SQLite expostas ao LINQ (só valem dentro de consultas EF).</summary>
public static class Json
{
    public static string? Extract(string json, string path) => throw new NotSupportedException("Somente em consultas EF.");
}

/// <summary>Linha de controle do agendador (infra; o domínio só conhece IScheduleStore).</summary>
public class ScheduleState
{
    public Guid AppId { get; set; }
    public string WorkflowId { get; set; } = "";
    public DateTime LastRunAt { get; set; }
}

/// <summary>Contador do formulário publicado (infra; o domínio só conhece IFormCounters).</summary>
public class FormCounter
{
    public Guid AppId { get; set; }
    public string Key { get; set; } = "";
    public int Count { get; set; }
}

/// <summary>Segredo do workspace com o valor cifrado (infra; o domínio só conhece ISecretStore).</summary>
public class SecretRow
{
    public Guid WorkspaceId { get; set; }
    public string Name { get; set; } = "";
    public string Cipher { get; set; } = "";
    public string UpdatedBy { get; set; } = "";
    public DateTime UpdatedAt { get; set; }
}

using Domain;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Infra;

public static class InfraServiceCollection
{
    /// <summary>PERSISTÊNCIA: DbContext SQLite + repositórios + log de auditoria.</summary>
    public static IServiceCollection AddSqlitePersistence(this IServiceCollection services, string connectionString)
    {
        var dataSource = new SqliteConnectionStringBuilder(connectionString).DataSource;
        var dir = Path.GetDirectoryName(Path.GetFullPath(dataSource));
        if (dir is not null) Directory.CreateDirectory(dir);

        services.AddDbContext<AppDbContext>(o => o.UseSqlite(connectionString).AddInterceptors(new SqliteFunctions()));
        services.AddScoped<IWorkspaceRepository, WorkspaceRepository>();
        services.AddScoped<IAppRepository, AppRepository>();
        services.AddScoped<IRecordRepository, RecordRepository>();
        services.AddScoped<IApprovalRepository, ApprovalRepository>();
        services.AddScoped<IAuditLog, AuditLog>();
        services.AddScoped<IScheduleStore, ScheduleStore>();
        services.AddScoped<IFormCounters, FormCounters>();
        services.AddScoped<IRunStore, RunStore>();
        services.AddScoped<ISecretStore, SecretStore>();
        return services;
    }

    /// <summary>
    /// SEGREDOS: chave AES de 256 bits num arquivo (criado na 1ª vez). [TROCA] No corporativo, troque o ISecretStore por
    /// um adaptador de cofre (Key Vault...) e esta chave some.
    /// </summary>
    public static IServiceCollection AddSecretCipher(this IServiceCollection services, string keyFile) =>
        services.AddSingleton(SecretCipher.FromFile(keyFile));

    /// <summary>Cria o schema (sem migrations, KISS) e popula dados de exemplo na primeira execução.</summary>
    public static void InitDatabase(this IServiceProvider provider)
    {
        using var scope = provider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Database.EnsureCreated();
        // Bancos criados antes dos formulários (EnsureCreated não altera schema existente). Sem migrations, KISS.
        db.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS "FormCounters" (
                "AppId" TEXT NOT NULL, "Key" TEXT NOT NULL, "Count" INTEGER NOT NULL,
                CONSTRAINT "PK_FormCounters" PRIMARY KEY ("AppId", "Key"));
            CREATE TABLE IF NOT EXISTS "WorkflowRuns" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_WorkflowRuns" PRIMARY KEY, "AppId" TEXT NOT NULL, "Env" TEXT NOT NULL,
                "WorkflowId" TEXT NOT NULL, "Number" INTEGER NOT NULL, "Version" INTEGER NULL, "Status" TEXT NOT NULL,
                "Trigger" TEXT NOT NULL, "TriggerData" TEXT NOT NULL, "RequestedBy" TEXT NOT NULL, "CreatedAt" TEXT NOT NULL,
                "StartedAt" TEXT NULL, "FinishedAt" TEXT NULL, "Error" TEXT NULL, "StartFromStepId" TEXT NULL, "SourceRunId" TEXT NULL);
            CREATE INDEX IF NOT EXISTS "IX_WorkflowRuns_AppId_Env" ON "WorkflowRuns" ("AppId", "Env");
            CREATE INDEX IF NOT EXISTS "IX_WorkflowRuns_Status" ON "WorkflowRuns" ("Status");
            CREATE TABLE IF NOT EXISTS "RunSteps" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_RunSteps" PRIMARY KEY, "RunId" TEXT NOT NULL, "ParentId" TEXT NULL,
                "Order" INTEGER NOT NULL, "Depth" INTEGER NOT NULL, "StepId" TEXT NULL, "Name" TEXT NOT NULL, "Type" TEXT NOT NULL,
                "Status" TEXT NOT NULL, "StartedAt" TEXT NOT NULL, "FinishedAt" TEXT NULL, "Input" TEXT NULL, "Output" TEXT NULL, "Error" TEXT NULL);
            CREATE INDEX IF NOT EXISTS "IX_RunSteps_RunId" ON "RunSteps" ("RunId");
            CREATE TABLE IF NOT EXISTS "Secrets" (
                "WorkspaceId" TEXT NOT NULL, "Name" TEXT NOT NULL, "Cipher" TEXT NOT NULL, "UpdatedBy" TEXT NOT NULL, "UpdatedAt" TEXT NOT NULL,
                CONSTRAINT "PK_Secrets" PRIMARY KEY ("WorkspaceId", "Name"))
            """);
        Seed.Run(db);
    }
}

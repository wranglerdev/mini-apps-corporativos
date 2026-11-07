using System.Text.Json;
using Domain;
using Microsoft.EntityFrameworkCore;

namespace Infra;

public class WorkspaceRepository(AppDbContext db) : IWorkspaceRepository
{
    public Task<List<Workspace>> ListAsync() => db.Workspaces.ToListAsync();
    public async Task<Workspace?> GetAsync(Guid id) => await db.Workspaces.FindAsync(id);

    public async Task AddAsync(Workspace workspace)
    {
        db.Workspaces.Add(workspace);
        await db.SaveChangesAsync();
    }
}

public class AppRepository(AppDbContext db) : IAppRepository
{
    public Task<List<App>> ListAsync() => db.Apps.ToListAsync();
    public async Task<App?> GetAsync(Guid id) => await db.Apps.FindAsync(id);
    public Task<App?> GetBySlugAsync(string slug) => db.Apps.FirstOrDefaultAsync(a => a.Slug == slug);

    public async Task AddAsync(App app)
    {
        db.Apps.Add(app);
        await db.SaveChangesAsync();
    }

    public async Task UpdateAsync(App app)
    {
        db.Apps.Update(app);
        await db.SaveChangesAsync();
    }

    public async Task DeleteAsync(Guid id)
    {
        await db.Records.Where(r => r.AppId == id).ExecuteDeleteAsync();
        await db.Approvals.Where(a => a.AppId == id).ExecuteDeleteAsync();
        await db.AppVersions.Where(v => v.AppId == id).ExecuteDeleteAsync();
        await db.FormCounters.Where(c => c.AppId == id).ExecuteDeleteAsync();
        var runIds = db.WorkflowRuns.Where(r => r.AppId == id).Select(r => r.Id);
        await db.RunSteps.Where(s => runIds.Contains(s.RunId)).ExecuteDeleteAsync();
        await db.WorkflowRuns.Where(r => r.AppId == id).ExecuteDeleteAsync();
        await db.Apps.Where(a => a.Id == id).ExecuteDeleteAsync();
    }

    public async Task AddVersionAsync(AppVersion version)
    {
        db.AppVersions.Add(version);
        await db.SaveChangesAsync();
    }

    public Task<List<AppVersion>> ListVersionsAsync(Guid appId) => db.AppVersions.Where(v => v.AppId == appId).ToListAsync();
}

public class RecordRepository(AppDbContext db) : IRecordRepository
{
    public Task<List<DataRecord>> ListAsync(Guid appId, string env, string tableId) =>
        db.Records.Where(r => r.AppId == appId && r.Env == env && r.TableId == tableId).ToListAsync();

    public async Task<DataRecord?> GetAsync(Guid id) => await db.Records.FindAsync(id);

    /// <summary>
    /// Filtro e paginação no banco. A busca usa json_each sobre a coluna JSON "Data" (só nas chaves pedidas)
    /// e a função norm() (ver SqliteFunctions). O resto do filtro é LINQ, para o EF cuidar dos tipos (Guid etc.).
    /// </summary>
    public async Task<(List<DataRecord> Items, int Total)> QueryAsync(RecordQuery query)
    {
        IQueryable<DataRecord> source = db.Records;
        if (!string.IsNullOrWhiteSpace(query.Search) && query.SearchFields.Count > 0)
        {
            var pattern = "%" + EscapeLike(TextSearch.Normalize(query.Search.Trim())) + "%";
            var fields = JsonSerializer.Serialize(query.SearchFields);
            source = db.Records.FromSql($"""
                SELECT * FROM "Records" AS r
                WHERE EXISTS (
                    SELECT 1 FROM json_each(r."Data") AS j
                    WHERE j.key IN (SELECT value FROM json_each({fields}))
                      AND norm(j.value) LIKE {pattern} ESCAPE '!')
                """);
        }

        var filtered = source.Where(r => r.AppId == query.AppId && r.Env == query.Env && r.TableId == query.TableId);
        var total = await filtered.CountAsync();
        var items = await filtered.OrderByDescending(r => r.CreatedAt).ThenBy(r => r.Id).Skip(query.Skip).Take(query.Take).ToListAsync();
        return (items, total);
    }

    public async Task<List<GroupCount>> CountByAsync(Guid appId, string env, string tableId, string field)
    {
        var path = "$.\"" + field.Replace("\"", "") + "\"";
        var rows = await db.Records
            .Where(r => r.AppId == appId && r.Env == env && r.TableId == tableId)
            .Select(r => Json.Extract(EF.Property<string>(r, "Data"), path))
            .GroupBy(v => v)
            .Select(g => new { Label = g.Key, Value = g.Count() })
            .ToListAsync();
        return rows.Select(r => new GroupCount(r.Label, r.Value)).ToList();
    }

    /// <summary>"!" é o caractere de escape do LIKE: %, _ e ! digitados pelo usuário viram texto literal.</summary>
    private static string EscapeLike(string s) => s.Replace("!", "!!").Replace("%", "!%").Replace("_", "!_");

    public async Task AddAsync(DataRecord record)
    {
        db.Records.Add(record);
        await db.SaveChangesAsync();
    }

    public async Task UpdateAsync(DataRecord record)
    {
        db.Records.Update(record);
        await db.SaveChangesAsync();
    }

    public Task DeleteAsync(Guid id) => db.Records.Where(r => r.Id == id).ExecuteDeleteAsync();

    public async Task RenameFieldsAsync(Guid appId, string env, string tableId, IReadOnlyDictionary<string, string> renames)
    {
        var records = await ListAsync(appId, env, tableId);
        foreach (var r in records)
        {
            r.Data = r.Data.ToDictionary(kv => renames.GetValueOrDefault(kv.Key, kv.Key), kv => kv.Value);
            db.Records.Update(r);
        }
        await db.SaveChangesAsync();
    }
}

public class ApprovalRepository(AppDbContext db) : IApprovalRepository
{
    public Task<List<Approval>> ListForUserAsync(string email)
    {
        var e = email.ToLower();
        return db.Approvals.Where(a => a.Approver.ToLower() == e || a.RequestedBy.ToLower() == e).ToListAsync();
    }

    public async Task<Approval?> GetAsync(Guid id) => await db.Approvals.FindAsync(id);

    public async Task AddAsync(Approval approval)
    {
        db.Approvals.Add(approval);
        await db.SaveChangesAsync();
    }

    public async Task UpdateAsync(Approval approval)
    {
        db.Approvals.Update(approval);
        await db.SaveChangesAsync();
    }
}

public class AuditLog(AppDbContext db) : IAuditLog
{
    public async Task WriteAsync(AuditEntry entry)
    {
        db.AuditEntries.Add(entry);
        await db.SaveChangesAsync();
    }

    public Task<List<AuditEntry>> ListAsync(int take) =>
        db.AuditEntries.OrderByDescending(a => a.Id).Take(take).ToListAsync();
}

public class ScheduleStore(AppDbContext db) : IScheduleStore
{
    public async Task<DateTime?> GetLastRunAsync(Guid appId, string workflowId) =>
        (await db.ScheduleStates.FindAsync(appId, workflowId))?.LastRunAt;

    public async Task SetLastRunAsync(Guid appId, string workflowId, DateTime at)
    {
        var state = await db.ScheduleStates.FindAsync(appId, workflowId);
        if (state is null) db.ScheduleStates.Add(new ScheduleState { AppId = appId, WorkflowId = workflowId, LastRunAt = at });
        else state.LastRunAt = at;
        await db.SaveChangesAsync();
    }
}

public class FormCounters(AppDbContext db) : IFormCounters
{
    public async Task IncrementAsync(Guid appId, string key)
    {
        var row = await db.FormCounters.FindAsync(appId, key);
        if (row is null) db.FormCounters.Add(new FormCounter { AppId = appId, Key = key, Count = 1 });
        else row.Count++;
        await db.SaveChangesAsync();
    }

    public Task<Dictionary<string, int>> GetAsync(Guid appId) =>
        db.FormCounters.Where(c => c.AppId == appId).ToDictionaryAsync(c => c.Key, c => c.Count);
}

public class RunStore(AppDbContext db) : IRunStore
{
    public async Task AddAsync(WorkflowRun run) { db.WorkflowRuns.Add(run); await db.SaveChangesAsync(); }
    public async Task UpdateAsync(WorkflowRun run) { db.WorkflowRuns.Update(run); await db.SaveChangesAsync(); }
    public Task<WorkflowRun?> GetAsync(Guid id) => db.WorkflowRuns.FirstOrDefaultAsync(r => r.Id == id);

    public Task<List<WorkflowRun>> ListAsync(Guid appId, string env, int take) =>
        db.WorkflowRuns.Where(r => r.AppId == appId && r.Env == env).OrderByDescending(r => r.Number).Take(take).ToListAsync();

    public async Task<int> NextNumberAsync(Guid appId) =>
        (await db.WorkflowRuns.Where(r => r.AppId == appId).MaxAsync(r => (int?)r.Number) ?? 0) + 1;

    public Task<WorkflowRun?> NextQueuedAsync() =>
        db.WorkflowRuns.Where(r => r.Status == RunStatus.Queued).OrderBy(r => r.CreatedAt).FirstOrDefaultAsync();

    public async Task AddStepAsync(RunStep step) { db.RunSteps.Add(step); await db.SaveChangesAsync(); }
    public async Task UpdateStepAsync(RunStep step) { db.RunSteps.Update(step); await db.SaveChangesAsync(); }
    public Task<List<RunStep>> StepsAsync(Guid runId) => db.RunSteps.Where(s => s.RunId == runId).OrderBy(s => s.Order).ToListAsync();

    public async Task<int> DeleteOlderThanAsync(DateTime before)
    {
        var old = db.WorkflowRuns.Where(r => r.CreatedAt < before).Select(r => r.Id);
        await db.RunSteps.Where(s => old.Contains(s.RunId)).ExecuteDeleteAsync();
        return await db.WorkflowRuns.Where(r => r.CreatedAt < before).ExecuteDeleteAsync();
    }
}

/// <summary>AES-GCM (BCL). Formato guardado: base64(nonce 12 | tag 16 | cifra).</summary>
public class SecretCipher(byte[] key)
{
    public static SecretCipher FromFile(string path)
    {
        var full = Path.GetFullPath(path);
        if (!File.Exists(full))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllText(full, Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)));
        }
        return new SecretCipher(Convert.FromBase64String(File.ReadAllText(full).Trim()));
    }

    public string Encrypt(string plain)
    {
        var data = System.Text.Encoding.UTF8.GetBytes(plain);
        var nonce = System.Security.Cryptography.RandomNumberGenerator.GetBytes(12);
        var tag = new byte[16];
        var cipher = new byte[data.Length];
        using var aes = new System.Security.Cryptography.AesGcm(key, 16);
        aes.Encrypt(nonce, data, cipher, tag);
        return Convert.ToBase64String([.. nonce, .. tag, .. cipher]);
    }

    public string Decrypt(string stored)
    {
        var all = Convert.FromBase64String(stored);
        var plain = new byte[all.Length - 28];
        using var aes = new System.Security.Cryptography.AesGcm(key, 16);
        aes.Decrypt(all[..12], all[28..], all[12..28], plain);
        return System.Text.Encoding.UTF8.GetString(plain);
    }
}

public class SecretStore(AppDbContext db, SecretCipher cipher) : ISecretStore
{
    public Task<List<SecretInfo>> ListAsync(Guid workspaceId) =>
        db.Secrets.Where(s => s.WorkspaceId == workspaceId).Select(s => new SecretInfo(s.Name, s.UpdatedBy, s.UpdatedAt)).ToListAsync();

    public async Task SetAsync(Guid workspaceId, string name, string value, string updatedBy)
    {
        var row = await db.Secrets.FindAsync(workspaceId, name);
        if (row is null) db.Secrets.Add(row = new SecretRow { WorkspaceId = workspaceId, Name = name });
        row.Cipher = cipher.Encrypt(value);
        row.UpdatedBy = updatedBy;
        row.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
    }

    public Task DeleteAsync(Guid workspaceId, string name) =>
        db.Secrets.Where(s => s.WorkspaceId == workspaceId && s.Name == name).ExecuteDeleteAsync();

    public async Task<Dictionary<string, string>> ValuesAsync(Guid workspaceId) =>
        (await db.Secrets.Where(s => s.WorkspaceId == workspaceId).ToListAsync()).ToDictionary(s => s.Name, s => cipher.Decrypt(s.Cipher));
}

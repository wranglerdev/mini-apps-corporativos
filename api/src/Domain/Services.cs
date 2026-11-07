namespace Domain;

/// <summary>Fluxo de aprovação: solicitação (ação requestApproval) → aprovador decide → status no registro + e-mail ao solicitante.</summary>
public class ApprovalService(IApprovalRepository approvals, IRecordRepository records, AppService apps, WorkflowEngine engine,
    IEmailSender email, IUserProvider users, IAuditLog audit)
{
    public async Task<List<Approval>> ListMineAsync() =>
        (await approvals.ListForUserAsync(users.GetCurrentUser().Email)).OrderByDescending(a => a.CreatedAt).ToList();

    public async Task<Approval> DecideAsync(Guid id, bool approve, string? comment)
    {
        var me = users.GetCurrentUser();
        var approval = await approvals.GetAsync(id) ?? throw new NotFoundException("Aprovação");
        if (!approval.Approver.Equals(me.Email, StringComparison.OrdinalIgnoreCase) && !AccessRules.IsAdmin(me))
            throw new ForbiddenException("Somente o aprovador pode decidir.");
        if (approval.Status != ApprovalStatus.Pending) throw new ValidationException("Esta aprovação já foi decidida.");

        approval.Status = approve ? ApprovalStatus.Approved : ApprovalStatus.Rejected;
        approval.Comment = comment;
        approval.DecidedAt = DateTime.UtcNow;
        await approvals.UpdateAsync(approval);

        var status = Approval.Text(approval.Status);
        if (await records.GetAsync(approval.RecordId) is { } record)
        {
            record.Data[approval.StatusField] = status;
            record.UpdatedBy = me.Email;
            record.UpdatedAt = DateTime.UtcNow;
            await records.UpdateAsync(record);
            // A decisão muda o registro: dispara os workflows de "registro atualizado" (ex.: aprovado → avisar compras).
            var scope = await apps.OpenForIntegrationAsync(approval.AppId, approval.Env);
            await engine.RunTriggersAsync(scope, Triggers.RecordUpdated, record.TableId, record.ToContext(), me);
        }

        await email.SendAsync(new EmailMessage(approval.RequestedBy, $"{approval.Title}: {status}",
            $"{me.Name} marcou sua solicitação como {status.ToLowerInvariant()}. {comment}".Trim()));
        await audit.WriteAsync(me, "approval.decide", "approval", approval.Id.ToString(), status);
        return approval;
    }
}

public class WorkspaceService(IWorkspaceRepository workspaces, IUserProvider users, IAuditLog audit)
{
    public async Task<List<Workspace>> ListManagedAsync()
    {
        var me = users.GetCurrentUser();
        return (await workspaces.ListAsync()).Where(w => AccessRules.CanManage(me, w)).OrderBy(w => w.Name).ToList();
    }

    public async Task<Workspace> CreateAsync(string name, string department)
    {
        var me = users.GetCurrentUser();
        if (!AccessRules.IsAdmin(me)) throw new ForbiddenException();
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(department)) throw new ValidationException("Informe nome e departamento.");
        var ws = new Workspace { Name = name.Trim(), Department = department.Trim() };
        await workspaces.AddAsync(ws);
        await audit.WriteAsync(me, "workspace.create", "workspace", ws.Id.ToString(), ws.Name);
        return ws;
    }
}

public class AuditService(IAuditLog log, IUserProvider users)
{
    public Task<List<AuditEntry>> ListAsync(int take = 200) =>
        AccessRules.IsAdmin(users.GetCurrentUser()) ? log.ListAsync(take) : throw new ForbiddenException();
}

/// <summary>Anexos, isolados por app: só quem acessa o app (no ambiente) envia ou baixa. Valor no campo File: "{id}/{nome}".</summary>
public class FileService(IFileStorage storage, AppService apps, IUserProvider users, IAuditLog audit)
{
    public async Task<StoredFile> UploadAsync(Guid appId, string env, string fileName, Stream content)
    {
        var scope = await apps.OpenAsync(appId, env);
        var file = await storage.SaveAsync(scope.App.Id.ToString("N"), Path.GetFileName(fileName), content);
        await audit.WriteAsync(users.GetCurrentUser(), "file.upload", "file", file.Id, file.Name);
        return file;
    }

    public async Task<(StoredFile File, Stream Content)> OpenAsync(Guid appId, string env, string id)
    {
        var scope = await apps.OpenAsync(appId, env);
        return await storage.OpenAsync(scope.App.Id.ToString("N"), id) ?? throw new NotFoundException("Arquivo");
    }
}

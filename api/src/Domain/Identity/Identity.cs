namespace Domain;

public enum Role { User, Builder, Admin }

public record CurrentUser(string Email, string Name, Role Role, string Department);

/// <summary>
/// PORTA DE AUTENTICAÇÃO. Hoje: MockUserProvider (Api/Auth). No corporativo: adaptador sobre a lib interna
/// (equivalente ao "obterUsuario"). Ver DOCS/TROCA-DE-ADAPTADORES.md.
/// </summary>
public interface IUserProvider
{
    CurrentUser GetCurrentUser();
}

public enum TableOp { Create, Edit, Delete }

/// <summary>RBAC central. Toda regra de acesso do produto mora aqui.</summary>
public static class AccessRules
{
    public static bool IsAdmin(CurrentUser u) => u.Role == Role.Admin;

    public static bool CanBuild(CurrentUser u) => u.Role is Role.Builder or Role.Admin;

    /// <summary>Admin gerencia tudo (governança central); builder gerencia os workspaces do seu departamento.</summary>
    public static bool CanManage(CurrentUser u, Workspace w) =>
        IsAdmin(u) || (u.Role == Role.Builder && w.Department == u.Department);

    public static bool CanUseEnv(CurrentUser u, App app, Workspace w, string env) => env switch
    {
        Env.Draft => CanManage(u, w),
        Env.Prod => app.PublishedVersion is not null &&
                    (CanManage(u, w) || app.AllowedDepartments.Count == 0 || app.AllowedDepartments.Contains(u.Department)),
        _ => false
    };

    public static bool CanWrite(bool canManage, TableDef table, TableOp op) => canManage || op switch
    {
        TableOp.Create => table.Permissions.UserCanCreate,
        TableOp.Edit => table.Permissions.UserCanEdit,
        TableOp.Delete => table.Permissions.UserCanDelete,
        _ => false
    };

    /// <summary>Campos marcados BuildersOnly ficam invisíveis (leitura e escrita) para usuários finais.</summary>
    public static List<FieldDef> VisibleFields(bool canManage, TableDef table) =>
        canManage ? table.Fields : table.Fields.Where(f => !f.BuildersOnly).ToList();

    /// <summary>Campos que o usuário pode preencher: visíveis e não somente leitura.</summary>
    public static List<FieldDef> WritableFields(bool canManage, TableDef table) =>
        canManage ? table.Fields : table.Fields.Where(f => !f.BuildersOnly && !f.ReadOnly).ToList();
}

/// <summary>Identidades técnicas usadas por integrações (aparecem na auditoria e em CreatedBy).</summary>
public static class SystemUsers
{
    public static readonly CurrentUser Webhook = new("webhook", "Webhook", Role.User, "");
    public static readonly CurrentUser Scheduler = new("agendador", "Agendador", Role.User, "");
    /// <summary>Execuções de projetos de workflow (fila).</summary>
    public static readonly CurrentUser Workflow = new("workflow", "Workflow", Role.User, "");
    /// <summary>Respondente de formulário com link público, sem login.</summary>
    public static readonly CurrentUser Anonymous = new("anonimo", "Anônimo", Role.User, "");
}

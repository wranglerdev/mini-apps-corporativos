using Domain;

namespace Infra;

/// <summary>
/// Dados iniciais: workspaces por unidade, biblioteca de templates e os projetos de demonstração (ver Showcase),
/// com dados de produção, versões, aprovações, auditoria e execuções de workflow na fila (o worker roda ao subir a API).
/// </summary>
public static class Seed
{
    public static void Run(AppDbContext db)
    {
        if (db.Workspaces.Any()) return;

        var library = new Workspace { Name = "Biblioteca Central", Department = "Governança" };
        var areas = new[]
        {
            new Workspace { Name = "Recursos Humanos", Department = "RH" },
            new Workspace { Name = "Tecnologia", Department = "TI" },
            new Workspace { Name = "Financeiro", Department = "Financeiro" }
        };
        db.Workspaces.Add(library);
        db.Workspaces.AddRange(areas);

        db.Apps.AddRange(Templates.All().Select(t => new App
        {
            WorkspaceId = library.Id, Name = t.Name, Slug = Slug.From(t.Name), Description = t.Description,
            Draft = t.Definition, IsTemplate = true, CreatedBy = "seed", CreatedAt = DateTime.UtcNow.AddDays(-60), UpdatedAt = DateTime.UtcNow.AddDays(-60)
        }));

        var now = DateTime.UtcNow;
        var hour = 0;
        foreach (var p in Showcase.Projects(DateTime.Today))
        {
            var ws = areas.First(w => w.Department == p.Department);
            p.Definition.Validate();
            var created = now.AddDays(-p.CreatedDaysAgo);
            var app = new App
            {
                Id = p.Id, WorkspaceId = ws.Id, Name = p.Name, Slug = Slug.From(p.Name), Description = p.Description,
                Draft = JsonUtil.Clone(p.Definition), Published = JsonUtil.Clone(p.Definition), PublishedVersion = p.Versions,
                InCatalog = !p.Definition.Automation, AllowedDepartments = p.AllowedDepartments, CreatedBy = p.Owner,
                CreatedAt = created, UpdatedAt = now.AddHours(-hour++ * 5)
            };
            db.Apps.Add(app);
            Audit(db, created, p.Owner, "app.create", app.Id, p.Name);
            for (var v = 1; v <= p.Versions; v++)
            {
                var at = created.AddDays((double)p.CreatedDaysAgo * v / (p.Versions + 1));
                db.AppVersions.Add(new AppVersion { AppId = app.Id, Number = v, Definition = JsonUtil.Clone(p.Definition), PublishedBy = p.Owner, PublishedAt = at });
                Audit(db, at, p.Owner, "app.publish", app.Id, $"v{v}");
            }

            foreach (var r in p.Records) AddRecord(db, app, p.Definition, r, now);
            foreach (var (key, count) in p.FormCounters) db.FormCounters.Add(new FormCounter { AppId = app.Id, Key = key, Count = count });

            var number = 0;
            foreach (var (trigger, data, by) in p.Runs)
                db.WorkflowRuns.Add(new WorkflowRun
                {
                    AppId = app.Id, Env = Env.Prod, WorkflowId = p.Definition.Workflows[0].Id, Number = ++number, Version = p.Versions,
                    Trigger = trigger, TriggerData = data, RequestedBy = by, CreatedAt = now.AddSeconds(number)
                });
        }
        db.SaveChanges();
    }

    /// <summary>Registro em produção (e uma cópia no rascunho, para o editor ter dados de teste) + aprovação, se houver.</summary>
    private static void AddRecord(AppDbContext db, App app, AppDefinition def, ShowcaseRecord r, DateTime now)
    {
        var table = def.Table(r.TableId);
        var data = RecordValidator.Normalize(r.Data, table.Fields, partial: false);
        var at = now.AddDays(-r.DaysAgo).AddMinutes(-(r.Data.GetHashCode() & 0x1FF));
        var record = new DataRecord { AppId = app.Id, Env = Env.Prod, TableId = table.Id, Data = data, CreatedBy = r.CreatedBy, CreatedAt = at };
        db.Records.Add(record);
        db.Records.Add(new DataRecord { AppId = app.Id, Env = Env.Draft, TableId = table.Id, Data = new(data), CreatedBy = r.CreatedBy, CreatedAt = at });
        Audit(db, at, r.CreatedBy, "record.create", app.Id, table.Name);
        if (r.Approver is null) return;

        var status = data.GetValueOrDefault("Status") switch
        {
            "Aprovado" => ApprovalStatus.Approved,
            "Rejeitado" => ApprovalStatus.Rejected,
            _ => ApprovalStatus.Pending
        };
        var decided = status == ApprovalStatus.Pending ? (DateTime?)null : at.AddHours(6);
        db.Approvals.Add(new Approval
        {
            AppId = app.Id, Env = Env.Prod, TableId = table.Id, RecordId = record.Id, Title = r.ApprovalTitle ?? table.Name,
            Approver = r.Approver, RequestedBy = r.CreatedBy, Status = status, Comment = r.Comment, CreatedAt = at, DecidedAt = decided
        });
        if (decided is { } d) Audit(db, d, r.Approver, "approval.decide", app.Id, Approval.Text(status));
    }

    private static void Audit(AppDbContext db, DateTime at, string user, string action, Guid appId, string details) =>
        db.AuditEntries.Add(new AuditEntry { At = at, User = user, Action = action, Entity = "app", EntityId = appId.ToString(), Details = details });
}

public record TemplateSpec(string Name, string Description, AppDefinition Definition);

public static class Templates
{
    public static IEnumerable<TemplateSpec> All()
    {
        var statusOptions = new[] { "Pendente", "Aprovado", "Rejeitado" };

        var solicitacoes = Table("Solicitações",
            F("Título", FieldType.Text, true), F("Descrição"), F("Valor", FieldType.Number),
            F("Aprovador", FieldType.Text, true), F("Status", FieldType.Select, false, statusOptions));
        solicitacoes.Fields[^1].ReadOnly = true;
        yield return Build("Solicitações com aprovação", "Pedidos que passam por um aprovador.", solicitacoes,
            new WorkflowDef
            {
                Name = "Pedir aprovação", Trigger = new TriggerDef { Type = Triggers.RecordCreated, TableId = solicitacoes.Id },
                Actions = [new ActionDef { Type = Actions.RequestApproval, Params = { ["approver"] = "{{Aprovador}}", ["statusField"] = "Status", ["title"] = "{{Título}}" } }]
            });

        yield return Build("Checklist", "Tarefas com responsável e prazo.", Table("Tarefas",
            F("Tarefa", FieldType.Text, true), F("Responsável"), F("Prazo", FieldType.Date), F("Situação", FieldType.Select, false, "A fazer", "Feito")));

        yield return Build("Inventário", "Controle de itens e patrimônio.", Table("Itens",
            F("Item", FieldType.Text, true), F("Patrimônio"), F("Quantidade", FieldType.Number),
            F("Local", FieldType.Select, false, "Matriz", "Filial"), F("Nota fiscal", FieldType.File)));

        var chamados = Table("Chamados",
            F("Assunto", FieldType.Text, true), F("Descrição"), F("Prioridade", FieldType.Select, true, "Baixa", "Média", "Alta"),
            F("Status", FieldType.Select, false, "Aberto", "Em andamento", "Fechado"));
        chamados.Fields[^1].ReadOnly = true;
        yield return Build("Controle de chamados", "Abertura e acompanhamento de chamados.", chamados,
            new WorkflowDef
            {
                Name = "Alerta de prioridade alta", Trigger = new TriggerDef { Type = Triggers.RecordCreated, TableId = chamados.Id },
                Condition = new ConditionDef { Field = "Prioridade", Op = "eq", Value = "Alta" },
                Actions = [new ActionDef { Type = Actions.SendEmail, Params = { ["to"] = "suporte@corp.local", ["subject"] = "Chamado urgente: {{Assunto}}", ["body"] = "Aberto por {{user.name}}." } }]
            });

        yield return Build("Onboarding", "Etapas de entrada de novos colaboradores.", Table("Colaboradores",
            F("Colaborador", FieldType.Text, true), F("Data de início", FieldType.Date, true), F("Gestor"),
            F("Etapa", FieldType.Select, false, "Documentos", "Equipamentos", "Acessos", "Concluído")));

        yield return Build("Reservas", "Reserva de salas e recursos.", Table("Reservas",
            F("Sala", FieldType.Select, true, "Sala 1", "Sala 2", "Auditório"), F("Data", FieldType.Date, true), F("Responsável"), F("Motivo")));

        yield return Build("CRM simples", "Funil de oportunidades.", Table("Oportunidades",
            F("Empresa", FieldType.Text, true), F("Contato"), F("E-mail"), F("Valor", FieldType.Number),
            F("Estágio", FieldType.Select, false, "Lead", "Proposta", "Ganho", "Perdido")));

        yield return Build("Cadastros", "Cadastro de clientes, fornecedores e parceiros.", Table("Cadastros",
            F("Nome", FieldType.Text, true), F("Documento"), F("Telefone"), F("Categoria", FieldType.Select, false, "Cliente", "Fornecedor", "Parceiro")));
    }

    private static TemplateSpec Build(string name, string description, TableDef table, params WorkflowDef[] workflows)
    {
        var components = new List<ComponentDef>
        {
            C("text", 12, ("text", name), ("variant", "title")),
            C("text", 12, ("text", description), ("variant", "body")),
            C("form", 5, ("tableId", table.Id), ("label", "Salvar")),
            C("table", 7, ("tableId", table.Id))
        };
        if (table.Fields.FirstOrDefault(f => f.Type == FieldType.Select) is { } select)
            components.Add(C("chart", 6, ("tableId", table.Id), ("groupBy", select.Name), ("title", $"Por {select.Name}")));

        return new TemplateSpec(name, description, new AppDefinition
        {
            Tables = [table],
            Workflows = [.. workflows],
            Pages = [new PageDef { Id = "home", Name = "Início", Components = components }]
        });
    }

    private static TableDef Table(string name, params FieldDef[] fields) => new() { Name = name, Fields = [.. fields] };

    private static FieldDef F(string name, FieldType type = FieldType.Text, bool required = false, params string[] options) =>
        new() { Name = name, Type = type, Required = required, Options = [.. options] };

    private static ComponentDef C(string type, int span, params (string Key, string Value)[] props) =>
        new() { Type = type, Span = span, Props = props.ToDictionary(p => p.Key, p => (string?)p.Value) };
}

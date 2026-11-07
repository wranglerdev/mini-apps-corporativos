using Domain;

namespace Infra;

/// <summary>Dados iniciais: workspaces por unidade, biblioteca de templates e dois apps publicados no catálogo.</summary>
public static class Seed
{
    public static void Run(AppDbContext db)
    {
        if (db.Workspaces.Any()) return;

        var library = new Workspace { Name = "Biblioteca Central", Department = "Governança" };
        var rh = new Workspace { Name = "Recursos Humanos", Department = "RH" };
        var ti = new Workspace { Name = "Tecnologia", Department = "TI" };
        var fin = new Workspace { Name = "Financeiro", Department = "Financeiro" };
        db.Workspaces.AddRange(library, rh, ti, fin);

        var templates = Templates.All().Select(t => new App
        {
            WorkspaceId = library.Id, Name = t.Name, Slug = Slug.From(t.Name), Description = t.Description,
            Draft = t.Definition, IsTemplate = true, CreatedBy = "seed"
        }).ToList();
        db.Apps.AddRange(templates);

        Publish(db, rh.Id, "Solicitações RH", templates.First(t => t.Name.StartsWith("Solicitações")));
        Publish(db, ti.Id, "Chamados TI", templates.First(t => t.Name.StartsWith("Controle de chamados")));
        db.SaveChanges();
    }

    private static void Publish(AppDbContext db, Guid workspaceId, string name, App template)
    {
        var app = new App
        {
            WorkspaceId = workspaceId, Name = name, Slug = Slug.From(name), Description = template.Description,
            Draft = JsonUtil.Clone(template.Draft), Published = JsonUtil.Clone(template.Draft), PublishedVersion = 1,
            InCatalog = true, CreatedBy = "seed"
        };
        db.Apps.Add(app);
        db.AppVersions.Add(new AppVersion { AppId = app.Id, Number = 1, Definition = JsonUtil.Clone(template.Draft), PublishedBy = "seed" });
    }
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

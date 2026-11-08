using System.Globalization;
using System.Text.Json.Nodes;
using Domain;

namespace Infra;

/// <summary>Projeto de demonstração do seed: definição publicada, dados de produção, aprovações e execuções na fila.</summary>
public class ShowcaseProject
{
    public Guid Id { get; } = Guid.NewGuid();
    public string Department { get; init; } = "";
    public string Name { get; init; } = "";
    public string Description { get; init; } = "";
    public string Owner { get; init; } = "";
    public AppDefinition Definition { get; init; } = new();
    public int Versions { get; init; } = 1;
    public int CreatedDaysAgo { get; init; }
    public List<string> AllowedDepartments { get; init; } = [];
    public List<ShowcaseRecord> Records { get; } = [];
    public Dictionary<string, int> FormCounters { get; } = [];
    /// <summary>Dados do gatilho de cada execução (vão para a fila em produção; o worker executa ao subir a API).</summary>
    public List<(string Trigger, string Data, string RequestedBy)> Runs { get; } = [];
}

/// <summary>Registro de produção. Approver preenchido = cria a aprovação (pendente ou decidida conforme o Status).</summary>
public record ShowcaseRecord(string TableId, Dictionary<string, string?> Data, string CreatedBy, int DaysAgo,
    string? Approver = null, string? ApprovalTitle = null, string? Comment = null);

/// <summary>
/// Projetos de demonstração do seed: um cenário corporativo coerente (RH, TI e Financeiro) para apresentar o produto.
/// Cada área tem mini apps, um formulário e um workflow que conversam entre si. Ver DOCS/ADR/0023.
/// </summary>
public static class Showcase
{
    private static readonly string[] Areas = ["Comercial", "Financeiro", "Operações", "RH", "TI"];
    private static readonly string[] ApprovalStatus = ["Pendente", "Aprovado", "Rejeitado"];

    public static List<ShowcaseProject> Projects(DateTime today)
    {
        var welcome = WelcomeFlow();
        var payment = PaymentFlow();
        return
        [
            Vacation(today), Onboarding(today, welcome), welcome, ClimateSurvey(),
            ServiceDesk(), Inventory(), AccessRequest(), MonitoringFlow(),
            Reimbursement(today, payment), payment, Suppliers()
        ];
    }

    // ---------------------------------------------------------------- RH

    private static ShowcaseProject Vacation(DateTime today)
    {
        var t = Table("pedidos", "Pedidos de férias",
            F("Colaborador", FieldType.Text, true), F("Início", FieldType.Date, true), F("Fim", FieldType.Date, true),
            F("Dias", FieldType.Number), F("Gestor", FieldType.Text, true), F("Observação"), Status(ApprovalStatus));
        var def = new AppDefinition
        {
            Tables = [t],
            Workflows =
            [
                new WorkflowDef
                {
                    Name = "Pedir aprovação do gestor", Trigger = new TriggerDef { Type = Triggers.RecordCreated, TableId = t.Id },
                    Actions = [new ActionDef { Type = Actions.RequestApproval, Params = { ["approver"] = "{{Gestor}}", ["statusField"] = "Status", ["title"] = "Férias de {{Colaborador}} ({{Dias}} dias)" } }]
                }
            ],
            Pages =
            [
                Page("Início",
                    Text("Olá, {{user.name}}. Peça suas férias aqui e acompanhe a resposta do seu gestor sem trocar e-mail.", "body"),
                    Form(t, 4, "Novo pedido", "Enviar para o gestor"),
                    Grid(t, 8),
                    Chart(t, 6, "Status", "Pedidos por status"),
                    Card(6, "Política de férias", "30 dias por período aquisitivo, em até 3 partes (uma com 14 dias ou mais). Peça com 30 dias de antecedência."))
            ]
        };
        var p = new ShowcaseProject
        {
            Department = "RH", Name = "Portal de Férias", Owner = "ana@corp.local", Versions = 3, CreatedDaysAgo = 40,
            Description = "Pedido de férias com aprovação do gestor e histórico do time.", Definition = def
        };
        void Add(string who, string email, int startIn, int days, string status, int ago, string? comment = null)
        {
            var start = today.AddDays(startIn);
            p.Records.Add(new ShowcaseRecord(t.Id, new()
            {
                ["Colaborador"] = who, ["Início"] = D(start), ["Fim"] = D(start.AddDays(days - 1)), ["Dias"] = N(days),
                ["Gestor"] = "ana@corp.local", ["Status"] = status,
                ["Observação"] = null
            }, email, ago, "ana@corp.local", $"Férias de {who} ({days} dias)", comment));
        }
        Add("João Pereira", "joao@corp.local", 45, 15, "Pendente", 1);
        Add("Juliana Alves", "juliana.alves@corp.local", 32, 10, "Pendente", 2);
        Add("Rafael Martins", "rafael.martins@corp.local", 60, 20, "Pendente", 3);
        Add("Patrícia Gomes", "patricia.gomes@corp.local", 20, 14, "Aprovado", 9, "Boas férias!");
        Add("Lucas Ferreira", "lucas.ferreira@corp.local", 12, 5, "Rejeitado", 11, "Coincide com o fechamento do trimestre. Pode mover uma semana?");
        Add("Beatriz Rocha", "beatriz.rocha@corp.local", 38, 15, "Aprovado", 14, "Aprovado.");
        Add("Thiago Ribeiro", "thiago.ribeiro@corp.local", 75, 30, "Aprovado", 18, "Ok, alinhar a cobertura com o time.");
        Add("Camila Duarte", "camila.duarte@corp.local", 5, 7, "Aprovado", 22, "Aprovado.");
        Add("Gustavo Nunes", "gustavo.nunes@corp.local", 90, 15, "Pendente", 0);
        Add("Fernanda Castro", "fernanda.castro@corp.local", 28, 10, "Aprovado", 25, "Aprovado.");
        return p;
    }

    private static ShowcaseProject Onboarding(DateTime today, ShowcaseProject welcome)
    {
        var t = Table("contratacoes", "Contratações",
            F("Colaborador", FieldType.Text, true), F("E-mail corporativo"), F("Cargo"), F("Área", FieldType.Select, true, Areas),
            F("Data de início", FieldType.Date, true), F("Gestor"),
            F("Etapa", FieldType.Select, false, "Documentos", "Equipamentos", "Acessos", "Integração", "Concluído"));
        t.Permissions.UserCanEdit = true;
        var def = new AppDefinition
        {
            Tables = [t],
            Workflows =
            [
                new WorkflowDef
                {
                    Name = "Iniciar boas-vindas", Trigger = new TriggerDef { Type = Triggers.RecordCreated, TableId = t.Id },
                    Actions =
                    [
                        new ActionDef
                        {
                            Type = Actions.StartFlow, Params = { ["flowId"] = welcome.Id.ToString() },
                            Values = { ["nome"] = "{{Colaborador}}", ["email"] = "{{E-mail corporativo}}", ["gestor"] = "{{Gestor}}", ["inicio"] = "{{Data de início}}", ["area"] = "{{Área}}" }
                        }
                    ]
                }
            ],
            Pages =
            [
                Page("Início",
                    Text("Cada contratação nova dispara as boas-vindas, o pedido de equipamento para a TI e o aviso ao gestor.", "body"),
                    Form(t, 4, "Nova contratação", "Cadastrar"),
                    Grid(t, 8),
                    Chart(t, 6, "Etapa", "Contratações por etapa"),
                    Chart(t, 6, "Área", "Contratações por área"))
            ]
        };
        var p = new ShowcaseProject
        {
            Department = "RH", Name = "Onboarding de contratações", Owner = "ana@corp.local", Versions = 2, CreatedDaysAgo = 30,
            Description = "Entrada de novos colaboradores, do documento ao primeiro dia.", Definition = def
        };
        void Add(string who, string role, string area, int startIn, string? manager, string stage, int ago)
        {
            var email = Email(who);
            var data = new Dictionary<string, string?>
            {
                ["Colaborador"] = who, ["E-mail corporativo"] = email, ["Cargo"] = role, ["Área"] = area,
                ["Data de início"] = D(today.AddDays(startIn)), ["Gestor"] = manager, ["Etapa"] = stage
            };
            p.Records.Add(new ShowcaseRecord(t.Id, data, "ana@corp.local", ago));
            if (ago <= 6) // as mais recentes já passaram pelo workflow de boas-vindas
                welcome.Runs.Add((Triggers.Call, CallData(p.Name, "ana@corp.local", today, new JsonObject
                {
                    ["nome"] = who, ["email"] = email, ["gestor"] = manager ?? "", ["inicio"] = D(today.AddDays(startIn)), ["area"] = area
                }), "ana@corp.local"));
        }
        Add("Marcos Vieira", "Analista de dados", "TI", 21, "bruno@corp.local", "Documentos", 1);
        Add("Larissa Monteiro", "Executiva de contas", "Comercial", 14, "paulo.souza@corp.local", "Equipamentos", 3);
        Add("Diego Carvalho", "Analista fiscal", "Financeiro", 10, null, "Equipamentos", 5);
        Add("Renata Lopes", "Coordenadora de logística", "Operações", 7, "sergio.dias@corp.local", "Acessos", 6);
        Add("André Barbosa", "Desenvolvedor", "TI", 3, "bruno@corp.local", "Integração", 12);
        Add("Vanessa Pinto", "Analista de RH", "RH", -4, "ana@corp.local", "Concluído", 20);
        Add("Felipe Araújo", "Vendedor interno", "Comercial", -10, "paulo.souza@corp.local", "Concluído", 26);
        Add("Aline Teixeira", "Assistente financeira", "Financeiro", -15, "marina@corp.local", "Concluído", 29);
        return p;
    }

    private static ShowcaseProject WelcomeFlow()
    {
        var wf = new WorkflowDef
        {
            Name = "Boas-vindas",
            Trigger = new TriggerDef
            {
                Type = Triggers.Call,
                Inputs = [V("nome"), V("email"), V("gestor"), V("inicio", Variables.Date), V("area")]
            },
            Variables = [V("primeiroDia"), V("checkin")],
            Actions =
            [
                new ActionDef
                {
                    Id = "datas", Type = Actions.Transform,
                    Ops =
                    [
                        Op("primeiroDia", "formatDate", "{{input.inicio}}", "dd/MM/yyyy"),
                        Op("checkin", "addDays", "{{input.inicio}}", "30"),
                        Op("checkin", "formatDate", "{{checkin}}", "dd/MM/yyyy")
                    ]
                },
                Mail("email_colaborador", "{{input.email}}", "Bem-vindo(a), {{input.nome}}!",
                    "Seu primeiro dia é {{primeiroDia}}. No dia, procure o RH às 9h. Seu gestor marca uma conversa de acompanhamento em {{checkin}}."),
                Mail("pedir_equipamento", "ti@corp.local", "Preparar notebook e acessos: {{input.nome}} ({{input.area}})",
                    "Entrada em {{primeiroDia}}. Abrir os acessos padrão da área {{input.area}}."),
                new ActionDef
                {
                    Id = "tem_gestor", Type = Actions.If,
                    Condition = new ConditionDef { Field = "input.gestor", Op = "notEmpty" },
                    Steps = [Mail("avisar_gestor", "{{input.gestor}}", "{{input.nome}} começa em {{primeiroDia}}", "Combine a agenda da primeira semana e a conversa de 30 dias ({{checkin}}).")],
                    Else = [Mail("avisar_rh", "rh@corp.local", "Contratação sem gestor: {{input.nome}}", "Defina o gestor antes de {{primeiroDia}}.")]
                },
                new ActionDef { Id = "aguardar_ti", Type = Actions.Wait, Params = { ["seconds"] = "2" } },
                Mail("confirmar_rh", "rh@corp.local", "Onboarding iniciado: {{input.nome}}", "Colaborador, TI e gestor avisados.")
            ]
        };
        return new ShowcaseProject
        {
            Department = "RH", Name = "Boas-vindas ao novo colaborador", Owner = "ana@corp.local", CreatedDaysAgo = 30,
            Description = "Chamado pelo Onboarding: avisa colaborador, TI e gestor.",
            Definition = new AppDefinition { Automation = true, Workflows = [wf] }
        };
    }

    private static ShowcaseProject ClimateSurvey()
    {
        var area = F("Área", FieldType.Select, true, Areas);
        var nps = F("Recomendaria", FieldType.Number, true);
        var leader = F("Liderança", FieldType.Number, true);
        var tools = F("Tem as ferramentas", FieldType.Select, true, QuestionKinds.YesNoOptions);
        var missing = F("O que falta", FieldType.Text);
        var comment = F("Comentário", FieldType.Text);
        var t = new TableDef { Id = "respostas", Name = "Respostas", Fields = [area, nps, leader, tools, missing, comment] };
        var qComment = Q(comment, QuestionKinds.Long, "Quer deixar algum comentário para o RH?", "Opcional.");
        var def = new AppDefinition
        {
            Tables = [t],
            Form = new FormDef
            {
                TableId = t.Id, Public = true,
                WelcomeTitle = "Pesquisa de clima 2026", WelcomeText = "Leva 2 minutos e é anônima. O resultado por área sai em dezembro.",
                EndTitle = "Obrigado, sua resposta conta!", EndText = "O RH apresenta o resultado consolidado na reunião geral.",
                Questions =
                [
                    Q(area, QuestionKinds.Choice, "Em qual área você trabalha?"),
                    Q(nps, QuestionKinds.Scale, "De 0 a 10, quanto você recomendaria a empresa como lugar para trabalhar?"),
                    Q(leader, QuestionKinds.Scale, "E como você avalia sua liderança direta?"),
                    Q(tools, QuestionKinds.YesNo, "Você tem as ferramentas de que precisa para trabalhar bem?", jumps: [new JumpDef { Op = "eq", Value = "Sim", GoTo = qComment.Id }]),
                    Q(missing, QuestionKinds.Long, "O que está faltando?"),
                    qComment
                ]
            }
        };
        var p = new ShowcaseProject
        {
            Department = "RH", Name = "Pesquisa de clima 2026", Owner = "ana@corp.local", CreatedDaysAgo = 15,
            Description = "Pesquisa anônima com eNPS e avaliação da liderança.", Definition = def
        };
        string[] missingTexts = ["Monitor extra.", "Licença do Power BI.", "Notebook mais novo, o atual trava em reunião.", "Treinamento no ERP novo."];
        string[] comments = ["Gosto muito do time.", "A comunicação entre áreas melhorou.", "Mais flexibilidade no home office.", "", "Feedback mais frequente.", ""];
        var rnd = new Random(2026);
        for (var i = 0; i < 34; i++)
        {
            var hasTools = rnd.Next(10) < 7;
            p.Records.Add(new ShowcaseRecord(t.Id, new()
            {
                ["Área"] = Areas[i % Areas.Length], ["Recomendaria"] = N(new[] { 10, 9, 9, 8, 7, 10, 6, 9, 8, 4 }[rnd.Next(10)]),
                ["Liderança"] = N(rnd.Next(6, 11)), ["Tem as ferramentas"] = hasTools ? "Sim" : "Não",
                ["O que falta"] = hasTools ? null : missingTexts[rnd.Next(missingTexts.Length)],
                ["Comentário"] = comments[rnd.Next(comments.Length)]
            }, SystemUsers.Anonymous.Email, rnd.Next(0, 12)));
        }
        p.FormCounters[FormService.OpenKey] = 61;
        int[] reach = [52, 47, 45, 44, 12, 36];
        for (var i = 0; i < def.Form.Questions.Count; i++) p.FormCounters[FormService.QuestionKey(def.Form.Questions[i].Id)] = reach[i];
        return p;
    }

    // ---------------------------------------------------------------- TI

    private static ShowcaseProject ServiceDesk()
    {
        var status = Status("Aberto", "Em andamento", "Resolvido");
        var t = Table("chamados", "Chamados",
            F("Assunto", FieldType.Text, true),
            F("Categoria", FieldType.Select, true, "Acesso", "Hardware", "Software", "Rede", "Telefonia"),
            F("Prioridade", FieldType.Select, true, "Baixa", "Média", "Alta"), F("Solicitante"), F("Responsável"), status);
        var def = new AppDefinition
        {
            Tables = [t],
            Workflows =
            [
                new WorkflowDef
                {
                    Name = "Alerta de prioridade alta", Trigger = new TriggerDef { Type = Triggers.RecordCreated, TableId = t.Id },
                    Condition = new ConditionDef { Field = "Prioridade", Op = "eq", Value = "Alta" },
                    Actions = [new ActionDef { Type = Actions.SendEmail, Params = { ["to"] = "plantao@corp.local", ["subject"] = "Chamado urgente: {{Assunto}}", ["body"] = "Aberto por {{user.name}} ({{Categoria}})." } }]
                },
                new WorkflowDef
                {
                    Name = "Avisar o solicitante", Trigger = new TriggerDef { Type = Triggers.RecordUpdated, TableId = t.Id },
                    Condition = new ConditionDef { Field = "Status", Op = "eq", Value = "Resolvido" },
                    Actions = [new ActionDef { Type = Actions.SendEmail, Params = { ["to"] = "{{Solicitante}}", ["subject"] = "Chamado resolvido: {{Assunto}}", ["body"] = "Se o problema voltar, responda este e-mail." } }]
                }
            ],
            Pages =
            [
                Page("Início",
                    Text("Abra um chamado e acompanhe por aqui. Prioridade alta avisa o plantão na hora.", "body"),
                    Chart(t, 4, "Status", "Por status"),
                    Chart(t, 4, "Categoria", "Por categoria"),
                    Chart(t, 4, "Prioridade", "Por prioridade"),
                    Form(t, 4, "Abrir chamado", "Abrir chamado"),
                    Grid(t, 8),
                    ForManagers(Card(12, "Só para o time de suporte", "Meta do mês: 90% resolvidos em até 8 horas úteis. Chamados de rede vão para o fornecedor de link.")))
            ]
        };
        var p = new ShowcaseProject
        {
            Department = "TI", Name = "Central de Chamados", Owner = "bruno@corp.local", Versions = 4, CreatedDaysAgo = 45,
            Description = "Abertura e acompanhamento de chamados com alerta de urgência.", Definition = def
        };
        void Add(string subject, string category, string priority, string state, string who, int ago, string? owner = "bruno@corp.local") =>
            p.Records.Add(new ShowcaseRecord(t.Id, new()
            {
                ["Assunto"] = subject, ["Categoria"] = category, ["Prioridade"] = priority, ["Status"] = state,
                ["Solicitante"] = who, ["Responsável"] = state == "Aberto" ? null : owner
            }, who, ago));
        Add("VPN não conecta fora do escritório", "Rede", "Alta", "Em andamento", "carla@corp.local", 0);
        Add("Acesso ao Power BI de vendas", "Acesso", "Média", "Aberto", "larissa.monteiro@corp.local", 0);
        Add("Impressora do 3º andar sem toner", "Hardware", "Baixa", "Aberto", "joao@corp.local", 1);
        Add("ERP lento no fechamento", "Software", "Alta", "Em andamento", "marina@corp.local", 1);
        Add("Ramal da recepção mudo", "Telefonia", "Média", "Resolvido", "recepcao@corp.local", 2);
        Add("Troca de senha do e-mail", "Acesso", "Baixa", "Resolvido", "juliana.alves@corp.local", 2);
        Add("Notebook não liga", "Hardware", "Alta", "Resolvido", "rafael.martins@corp.local", 3, "andre.barbosa@corp.local");
        Add("Licença do Office expirada", "Software", "Média", "Resolvido", "camila.duarte@corp.local", 4);
        Add("Wi-Fi da sala de reunião caindo", "Rede", "Média", "Em andamento", "paulo.souza@corp.local", 4, "andre.barbosa@corp.local");
        Add("Instalar Python e VS Code", "Software", "Baixa", "Resolvido", "marcos.vieira@corp.local", 5);
        Add("Acesso à pasta do Financeiro", "Acesso", "Média", "Resolvido", "diego.carvalho@corp.local", 6);
        Add("Monitor piscando", "Hardware", "Baixa", "Resolvido", "beatriz.rocha@corp.local", 8, "andre.barbosa@corp.local");
        Add("Certificado digital vencido", "Software", "Alta", "Resolvido", "marina@corp.local", 9);
        Add("Celular corporativo novo", "Telefonia", "Baixa", "Em andamento", "larissa.monteiro@corp.local", 10);
        Add("Liberar site do fornecedor no proxy", "Rede", "Média", "Resolvido", "sergio.dias@corp.local", 12);
        Add("Headset com chiado", "Hardware", "Baixa", "Resolvido", "felipe.araujo@corp.local", 15, "andre.barbosa@corp.local");
        return p;
    }

    private static ShowcaseProject Inventory()
    {
        var value = F("Valor", FieldType.Number);
        value.BuildersOnly = true;
        var t = Table("equipamentos", "Equipamentos",
            F("Equipamento", FieldType.Text, true), F("Patrimônio", FieldType.Text, true),
            F("Tipo", FieldType.Select, true, "Notebook", "Monitor", "Celular", "Headset", "Dock"),
            F("Responsável"), F("Área", FieldType.Select, false, Areas),
            F("Situação", FieldType.Select, true, "Em uso", "Em estoque", "Em manutenção", "Baixado"), value, F("Nota fiscal", FieldType.File));
        t.Permissions.UserCanCreate = false;
        var def = new AppDefinition
        {
            Tables = [t],
            Pages =
            [
                Page("Início",
                    Text("Quem está com qual equipamento, o que está em estoque e o que foi para a manutenção. O valor só aparece para a TI.", "body"),
                    Grid(t, 12),
                    Chart(t, 6, "Tipo", "Equipamentos por tipo"),
                    Chart(t, 6, "Situação", "Por situação"))
            ]
        };
        var p = new ShowcaseProject
        {
            Department = "TI", Name = "Inventário de equipamentos", Owner = "bruno@corp.local", Versions = 2, CreatedDaysAgo = 60,
            Description = "Patrimônio de TI: notebooks, monitores e celulares por pessoa.", Definition = def, AllowedDepartments = ["TI", "Financeiro"]
        };
        var n = 1040;
        void Add(string item, string type, string? who, string? area, string state, decimal price, int ago) =>
            p.Records.Add(new ShowcaseRecord(t.Id, new()
            {
                ["Equipamento"] = item, ["Patrimônio"] = $"TI-{n++}", ["Tipo"] = type, ["Responsável"] = who, ["Área"] = area,
                ["Situação"] = state, ["Valor"] = price.ToString(CultureInfo.InvariantCulture)
            }, "bruno@corp.local", ago));
        Add("Dell Latitude 5440", "Notebook", "Marcos Vieira", "TI", "Em uso", 7890, 1);
        Add("Dell Latitude 5440", "Notebook", "Larissa Monteiro", "Comercial", "Em uso", 7890, 3);
        Add("Dell Latitude 5440", "Notebook", null, null, "Em estoque", 7890, 5);
        Add("MacBook Air M3", "Notebook", "André Barbosa", "TI", "Em uso", 11499, 12);
        Add("Lenovo ThinkPad E14", "Notebook", "Rafael Martins", "Comercial", "Em manutenção", 6290, 3);
        Add("Lenovo ThinkPad E14", "Notebook", "Juliana Alves", "Financeiro", "Em uso", 6290, 40);
        Add("Dell P2423 24\"", "Monitor", "Marcos Vieira", "TI", "Em uso", 1390, 1);
        Add("Dell P2423 24\"", "Monitor", "Vanessa Pinto", "RH", "Em uso", 1390, 20);
        Add("LG 27\" 4K", "Monitor", null, null, "Em estoque", 2190, 18);
        Add("Samsung Galaxy A55", "Celular", "Larissa Monteiro", "Comercial", "Em uso", 2299, 3);
        Add("Samsung Galaxy A55", "Celular", "Felipe Araújo", "Comercial", "Em uso", 2299, 26);
        Add("iPhone 12", "Celular", null, null, "Baixado", 0, 50);
        Add("Jabra Evolve2 40", "Headset", "Felipe Araújo", "Comercial", "Em uso", 690, 15);
        Add("Jabra Evolve2 40", "Headset", null, null, "Em estoque", 690, 15);
        Add("Dell WD19S", "Dock", "André Barbosa", "TI", "Em uso", 1590, 12);
        return p;
    }

    private static ShowcaseProject AccessRequest()
    {
        var name = F("Nome", FieldType.Text, true);
        var email = F("E-mail", FieldType.Text, true);
        var system = F("Sistema", FieldType.Select, true, "ERP", "CRM", "Power BI", "VPN", "SharePoint");
        var profile = F("Perfil no ERP", FieldType.Select, false, "Consulta", "Lançamento", "Aprovação");
        var reason = F("Justificativa", FieldType.Text, true);
        var manager = F("Gestor", FieldType.Text, true);
        var status = Status(ApprovalStatus);
        var t = new TableDef { Id = "acessos", Name = "Solicitações de acesso", Fields = [name, email, system, profile, reason, manager, status] };
        var qReason = Q(reason, QuestionKinds.Long, "Para que você precisa desse acesso?", "Ex.: vou assumir o fechamento das notas de entrada.");
        var def = new AppDefinition
        {
            Tables = [t],
            Workflows =
            [
                new WorkflowDef
                {
                    Name = "Aprovação do gestor", Trigger = new TriggerDef { Type = Triggers.RecordCreated, TableId = t.Id },
                    Actions = [new ActionDef { Type = Actions.RequestApproval, Params = { ["approver"] = "{{Gestor}}", ["statusField"] = "Status", ["title"] = "Acesso ao {{Sistema}} para {{Nome}}" } }]
                }
            ],
            Form = new FormDef
            {
                TableId = t.Id,
                WelcomeTitle = "Solicitação de acesso a sistemas", WelcomeText = "Seu gestor aprova e a TI libera em até 1 dia útil.",
                EndTitle = "Pedido enviado para {{Gestor}}", EndText = "Você recebe um e-mail quando o acesso for liberado.",
                Questions =
                [
                    Q(name, QuestionKinds.Short, "Qual é o seu nome?"),
                    Q(email, QuestionKinds.Email, "E o seu e-mail corporativo?"),
                    Q(system, QuestionKinds.Choice, "Qual sistema você precisa acessar?", jumps: [new JumpDef { Op = "neq", Value = "ERP", GoTo = qReason.Id }]),
                    Q(profile, QuestionKinds.Choice, "Qual perfil no ERP?", "Na dúvida, peça Consulta."),
                    qReason,
                    Q(manager, QuestionKinds.Email, "Qual é o e-mail do seu gestor?", "Ele recebe o pedido para aprovar.")
                ]
            }
        };
        var p = new ShowcaseProject
        {
            Department = "TI", Name = "Solicitação de acesso a sistemas", Owner = "bruno@corp.local", Versions = 2, CreatedDaysAgo = 25,
            Description = "Pedido de acesso com aprovação do gestor antes da TI liberar.", Definition = def
        };
        void Add(string who, string sys, string? prof, string why, string mgr, string state, int ago, string? comment = null)
        {
            var mail = Email(who);
            p.Records.Add(new ShowcaseRecord(t.Id, new()
            {
                ["Nome"] = who, ["E-mail"] = mail, ["Sistema"] = sys, ["Perfil no ERP"] = prof, ["Justificativa"] = why, ["Gestor"] = mgr, ["Status"] = state
            }, mail, ago, mgr, $"Acesso ao {sys} para {who}", comment));
        }
        Add("Marcos Vieira", "Power BI", null, "Vou montar os painéis de chamados.", "bruno@corp.local", "Pendente", 0);
        Add("André Barbosa", "VPN", null, "Plantão de fim de semana.", "bruno@corp.local", "Pendente", 1);
        Add("Diego Carvalho", "ERP", "Lançamento", "Vou assumir as notas de entrada.", "marina@corp.local", "Pendente", 1);
        Add("Larissa Monteiro", "CRM", null, "Carteira de clientes do Sul.", "paulo.souza@corp.local", "Aprovado", 4, "Liberado.");
        Add("Juliana Alves", "ERP", "Aprovação", "Cobrir as férias da coordenação.", "marina@corp.local", "Rejeitado", 7, "Aprovação só para coordenação. Peça Lançamento.");
        Add("Vanessa Pinto", "SharePoint", null, "Pasta de admissões.", "ana@corp.local", "Aprovado", 15, "Ok.");
        Add("Renata Lopes", "ERP", "Consulta", "Acompanhar pedidos de compra.", "sergio.dias@corp.local", "Aprovado", 6, "Aprovado.");
        p.FormCounters[FormService.OpenKey] = 11;
        for (var i = 0; i < def.Form.Questions.Count; i++) p.FormCounters[FormService.QuestionKey(def.Form.Questions[i].Id)] = i == 3 ? 3 : 8 - Math.Min(i, 1);
        return p;
    }

    private static ShowcaseProject MonitoringFlow()
    {
        var wf = new WorkflowDef
        {
            Name = "Alerta de monitoramento",
            Trigger = new TriggerDef { Type = Triggers.Webhook, WebhookKey = "demo-" + Guid.NewGuid().ToString("N")[..20] },
            Variables = [V("servico"), V("severidade")],
            Actions =
            [
                new ActionDef
                {
                    Id = "normalizar", Type = Actions.Transform,
                    Ops = [Op("servico", "trim", "{{trigger.body.servico}}"), Op("severidade", "lower", "{{trigger.body.severidade}}")]
                },
                new ActionDef
                {
                    Id = "critico", Type = Actions.If,
                    Condition = new ConditionDef { Field = "severidade", Op = "eq", Value = "critica" },
                    Steps =
                    [
                        Mail("acionar_plantao", "plantao@corp.local", "[CRÍTICO] {{servico}} fora do ar", "{{trigger.body.mensagem}}"),
                        new ActionDef
                        {
                            Id = "avisar_areas", Type = Actions.ForEach, Params = { ["list"] = "{{trigger.body.areas}}", ["as"] = "area" },
                            Steps = [Mail("aviso_area", "{{area}}", "{{servico}} indisponível", "A TI já está atuando. Próxima atualização em 30 minutos.")]
                        }
                    ],
                    Else = [Mail("fila_suporte", "suporte@corp.local", "[{{severidade}}] {{servico}}", "{{trigger.body.mensagem}}")]
                }
            ]
        };
        var p = new ShowcaseProject
        {
            Department = "TI", Name = "Alertas de monitoramento", Owner = "bruno@corp.local", CreatedDaysAgo = 20,
            Description = "Recebe alertas por webhook e aciona o plantão e as áreas afetadas.",
            Definition = new AppDefinition { Automation = true, Workflows = [wf] }
        };
        void Hook(string service, string severity, string message, JsonNode? areas) =>
            p.Runs.Add((Triggers.Webhook, new JsonObject
            {
                ["trigger"] = Triggers.Webhook, ["now"] = DateTime.Now.ToString("yyyy-MM-dd HH:mm"),
                ["body"] = new JsonObject { ["servico"] = service, ["severidade"] = severity, ["mensagem"] = message, ["areas"] = areas }
            }.ToJsonString(), SystemUsers.Webhook.Email));
        Hook("Backup noturno", "Aviso", "Backup terminou com 2 arquivos ignorados.", null);
        Hook("ERP", "Critica", "ERP sem resposta há 5 minutos.", new JsonArray("financeiro@corp.local", "compras@corp.local", "comercial@corp.local"));
        Hook("Disco do servidor de arquivos", "Aviso", "Uso em 85%.", null);
        Hook("Portal do cliente", "Critica", "Erro 502 em 40% das requisições.", JsonValue.Create("todas as áreas"));
        Hook("Link de internet da filial", "Critica", "Filial Campinas sem link principal.", new JsonArray("operacoes@corp.local"));
        return p;
    }

    // ---------------------------------------------------------------- Financeiro

    private static ShowcaseProject Reimbursement(DateTime today, ShowcaseProject payment)
    {
        var receipt = F("Comprovante", FieldType.File);
        var t = Table("despesas", "Despesas",
            F("Descrição", FieldType.Text, true), F("Categoria", FieldType.Select, true, "Viagem", "Hospedagem", "Alimentação", "Transporte", "Software"),
            F("Valor", FieldType.Number, true), F("Data", FieldType.Date, true), receipt, F("Colaborador", FieldType.Text, true),
            F("Aprovador", FieldType.Text, true), Status(ApprovalStatus));
        var def = new AppDefinition
        {
            Tables = [t],
            Workflows =
            [
                new WorkflowDef
                {
                    Name = "Pedir aprovação", Trigger = new TriggerDef { Type = Triggers.RecordCreated, TableId = t.Id },
                    Actions = [new ActionDef { Type = Actions.RequestApproval, Params = { ["approver"] = "{{Aprovador}}", ["statusField"] = "Status", ["title"] = "{{Descrição}} (R$ {{Valor}})" } }]
                },
                new WorkflowDef
                {
                    Name = "Programar pagamento", Trigger = new TriggerDef { Type = Triggers.RecordUpdated, TableId = t.Id },
                    Condition = new ConditionDef { Field = "Status", Op = "eq", Value = "Aprovado" },
                    Actions =
                    [
                        new ActionDef
                        {
                            Type = Actions.StartFlow, Params = { ["flowId"] = payment.Id.ToString() },
                            Values = { ["colaborador"] = "{{Colaborador}}", ["email"] = "{{createdBy}}", ["valor"] = "{{Valor}}", ["descricao"] = "{{Descrição}}" }
                        }
                    ]
                }
            ],
            Pages =
            [
                Page("Início",
                    Text("Lance a despesa com o comprovante. O aprovador recebe na hora e, aprovado, o pagamento entra na próxima janela.", "body"),
                    Form(t, 4, "Nova despesa", "Enviar para aprovação"),
                    Grid(t, 8),
                    Chart(t, 6, "Status", "Despesas por status"),
                    Chart(t, 6, "Categoria", "Despesas por categoria"))
            ]
        };
        var p = new ShowcaseProject
        {
            Department = "Financeiro", Name = "Reembolso de despesas", Owner = "marina@corp.local", Versions = 2, CreatedDaysAgo = 35,
            Description = "Despesa com comprovante, aprovação e pagamento programado.", Definition = def
        };
        void Add(string what, string category, decimal value, string who, string email, string state, int ago, string? comment = null)
        {
            p.Records.Add(new ShowcaseRecord(t.Id, new()
            {
                ["Descrição"] = what, ["Categoria"] = category, ["Valor"] = value.ToString(CultureInfo.InvariantCulture),
                ["Data"] = D(today.AddDays(-ago - 2)), ["Colaborador"] = who, ["Aprovador"] = "marina@corp.local", ["Status"] = state
            }, email, ago, "marina@corp.local", $"{what} (R$ {value.ToString("N2", CultureInfo.GetCultureInfo("pt-BR"))})", comment));
            if (state == "Aprovado" && ago <= 8)
                payment.Runs.Add((Triggers.Call, CallData(p.Name, "marina@corp.local", today, new JsonObject
                {
                    ["colaborador"] = who, ["email"] = email, ["valor"] = value, ["descricao"] = what
                }), "marina@corp.local"));
        }
        Add("Passagem SP–Recife (visita a cliente)", "Viagem", 1840.90m, "Carla Mendes", "carla@corp.local", "Pendente", 0);
        Add("Hotel em Recife, 2 diárias", "Hospedagem", 760m, "Carla Mendes", "carla@corp.local", "Pendente", 0);
        Add("Uber aeroporto", "Transporte", 89.40m, "Carla Mendes", "carla@corp.local", "Pendente", 1);
        Add("Almoço com cliente Grupo Atlas", "Alimentação", 312.50m, "Larissa Monteiro", "larissa.monteiro@corp.local", "Aprovado", 3, "Ok.");
        Add("Licença anual do Figma", "Software", 1290m, "André Barbosa", "andre.barbosa@corp.local", "Aprovado", 5, "Aprovado. Próximo ano vai pelo contrato da TI.");
        Add("Estacionamento na feira", "Transporte", 120m, "Felipe Araújo", "felipe.araujo@corp.local", "Aprovado", 6, "Ok.");
        Add("Jantar da equipe comercial", "Alimentação", 980m, "Paulo Souza", "paulo.souza@corp.local", "Rejeitado", 7, "Confraternização vai pela verba de endomarketing.");
        Add("Passagem Rio–Campinas", "Viagem", 640.30m, "Renata Lopes", "renata.lopes@corp.local", "Aprovado", 8, "Ok.");
        Add("Curso de Excel avançado", "Software", 450m, "Diego Carvalho", "diego.carvalho@corp.local", "Aprovado", 12, "Ok, bom investimento.");
        Add("Táxi para o cartório", "Transporte", 54m, "Aline Teixeira", "aline.teixeira@corp.local", "Aprovado", 15, "Ok.");
        Add("Hotel em Porto Alegre", "Hospedagem", 1120m, "Larissa Monteiro", "larissa.monteiro@corp.local", "Aprovado", 18, "Ok.");
        Add("Café com fornecedor", "Alimentação", 46.80m, "Juliana Alves", "juliana.alves@corp.local", "Aprovado", 21, "Ok.");
        return p;
    }

    private static ShowcaseProject PaymentFlow()
    {
        var wf = new WorkflowDef
        {
            Name = "Pagamento de reembolso",
            Trigger = new TriggerDef
            {
                Type = Triggers.Call,
                Inputs = [V("colaborador"), V("email"), V("valor", Variables.Number), V("descricao")]
            },
            Variables = [V("dataPagamento")],
            Actions =
            [
                new ActionDef
                {
                    Id = "agendar", Type = Actions.Transform,
                    Ops = [Op("dataPagamento", "addDays", "{{trigger.today}}", "5"), Op("dataPagamento", "formatDate", "{{dataPagamento}}", "dd/MM/yyyy")]
                },
                new ActionDef
                {
                    Id = "alto_valor", Type = Actions.If,
                    Condition = new ConditionDef { Field = "input.valor", Op = "gt", Value = "1000" },
                    Steps = [Mail("avisar_controladoria", "controladoria@corp.local", "Reembolso acima de R$ 1.000: {{input.colaborador}}", "{{input.descricao}}: R$ {{input.valor}}. Pagamento em {{dataPagamento}}.")]
                },
                Mail("avisar_colaborador", "{{input.email}}", "Reembolso aprovado: pagamento em {{dataPagamento}}",
                    "{{input.descricao}} (R$ {{input.valor}}) foi aprovado e entra no pagamento de {{dataPagamento}}.")
            ]
        };
        return new ShowcaseProject
        {
            Department = "Financeiro", Name = "Pagamento de reembolso", Owner = "marina@corp.local", CreatedDaysAgo = 35,
            Description = "Chamado pelo Reembolso: agenda o pagamento e avisa o colaborador.",
            Definition = new AppDefinition { Automation = true, Workflows = [wf] }
        };
    }

    private static ShowcaseProject Suppliers()
    {
        var company = F("Razão social", FieldType.Text, true);
        var cnpj = F("CNPJ", FieldType.Text, true);
        var email = F("E-mail", FieldType.Text, true);
        var category = F("Categoria", FieldType.Select, true, "Serviços", "Materiais", "Tecnologia", "Logística");
        var iso = F("Certificação ISO", FieldType.Select, true, QuestionKinds.YesNoOptions);
        var revenue = F("Faturamento anual", FieldType.Number);
        var contract = F("Contrato social", FieldType.File);
        var t = new TableDef { Id = "fornecedores", Name = "Fornecedores", Fields = [company, cnpj, email, category, iso, revenue, contract] };
        var def = new AppDefinition
        {
            Tables = [t],
            Workflows =
            [
                new WorkflowDef
                {
                    Name = "Avisar compras", Trigger = new TriggerDef { Type = Triggers.RecordCreated, TableId = t.Id },
                    Actions = [new ActionDef { Type = Actions.SendEmail, Params = { ["to"] = "compras@corp.local", ["subject"] = "Novo fornecedor: {{Razão social}}", ["body"] = "Categoria {{Categoria}}. Conferir documentos." } }]
                }
            ],
            Form = new FormDef
            {
                TableId = t.Id, Public = true,
                WelcomeTitle = "Cadastro de fornecedores", WelcomeText = "Preencha uma vez e entre na base de compras da empresa.",
                EndTitle = "Cadastro recebido", EndText = "Compras confere os documentos em até 5 dias úteis.",
                Questions =
                [
                    Q(company, QuestionKinds.Short, "Qual é a razão social da empresa?"),
                    Q(cnpj, QuestionKinds.Short, "CNPJ", "Só números ou no formato 00.000.000/0000-00."),
                    Q(email, QuestionKinds.Email, "E-mail para pedidos e cobranças"),
                    Q(category, QuestionKinds.Choice, "O que vocês fornecem?"),
                    Q(iso, QuestionKinds.YesNo, "A empresa tem certificação ISO?"),
                    Q(revenue, QuestionKinds.Number, "Faturamento anual aproximado (R$)", "Opcional."),
                    Q(contract, QuestionKinds.File, "Envie o contrato social", "PDF de até 10 MB.")
                ]
            }
        };
        var p = new ShowcaseProject
        {
            Department = "Financeiro", Name = "Cadastro de fornecedores", Owner = "marina@corp.local", CreatedDaysAgo = 22,
            Description = "Formulário com link público para fornecedores se cadastrarem.", Definition = def
        };
        void Add(string name, string doc, string category, string iso, decimal revenue, int ago) =>
            p.Records.Add(new ShowcaseRecord(t.Id, new()
            {
                ["Razão social"] = name, ["CNPJ"] = doc, ["E-mail"] = $"comercial@{Slugify(name)}.com.br", ["Categoria"] = category,
                ["Certificação ISO"] = iso, ["Faturamento anual"] = revenue.ToString(CultureInfo.InvariantCulture)
            }, SystemUsers.Anonymous.Email, ago));
        Add("Atlas Logística Ltda", "12.345.678/0001-90", "Logística", "Sim", 48_000_000m, 1);
        Add("Papelaria Central ME", "23.456.789/0001-01", "Materiais", "Não", 1_200_000m, 2);
        Add("Nuvem Forte Tecnologia", "34.567.890/0001-12", "Tecnologia", "Sim", 15_500_000m, 4);
        Add("Limpa Bem Serviços", "45.678.901/0001-23", "Serviços", "Não", 3_800_000m, 6);
        Add("TransRápido Cargas", "56.789.012/0001-34", "Logística", "Sim", 22_000_000m, 9);
        Add("Código Certo Software", "67.890.123/0001-45", "Tecnologia", "Não", 6_400_000m, 13);
        Add("Gráfica Ponto Final", "78.901.234/0001-56", "Materiais", "Não", 950_000m, 17);
        p.FormCounters[FormService.OpenKey] = 19;
        int[] reach = [14, 12, 11, 10, 9, 8, 7];
        for (var i = 0; i < def.Form.Questions.Count; i++) p.FormCounters[FormService.QuestionKey(def.Form.Questions[i].Id)] = reach[i];
        return p;
    }

    // ---------------------------------------------------------------- helpers

    private static string CallData(string source, string user, DateTime today, JsonObject input) => new JsonObject
    {
        ["trigger"] = Triggers.Call, ["source"] = source, ["user"] = user,
        ["now"] = DateTime.Now.ToString("yyyy-MM-dd HH:mm"), ["today"] = D(today), ["input"] = input
    }.ToJsonString();

    private static string D(DateTime d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    private static string N(int n) => n.ToString(CultureInfo.InvariantCulture);

    private static string Email(string name) =>
        string.Join('.', TextSearch.Normalize(name).Split(' ').Take(2)) + "@corp.local";

    private static string Slugify(string name) => TextSearch.Normalize(name).Split(' ')[0];

    private static TableDef Table(string id, string name, params FieldDef[] fields) => new() { Id = id, Name = name, Fields = [.. fields] };

    private static FieldDef F(string name, FieldType type = FieldType.Text, bool required = false, params string[] options) =>
        new() { Name = name, Type = type, Required = required, Options = [.. options] };

    private static FieldDef Status(params string[] options) => new() { Name = "Status", Type = FieldType.Select, ReadOnly = true, Options = [.. options] };

    private static VariableDef V(string name, string type = Variables.Text) => new() { Name = name, Type = type };

    private static TransformOp Op(string target, string op, string input, string? arg = null) => new() { Target = target, Op = op, Input = input, Arg = arg };

    private static ActionDef Mail(string id, string to, string subject, string body) =>
        new() { Id = id, Type = Actions.SendEmail, Params = { ["to"] = to, ["subject"] = subject, ["body"] = body } };

    private static QuestionDef Q(FieldDef field, string kind, string title, string description = "", List<JumpDef>? jumps = null) =>
        new() { FieldId = field.Id, Kind = kind, Title = title, Description = description, Jumps = jumps ?? [] };

    private static PageDef Page(string name, params ComponentDef[] components) => new() { Id = "home", Name = name, Components = [.. components] };

    private static ComponentDef C(string type, int span, params (string Key, string? Value)[] props) =>
        new() { Type = type, Span = span, Props = props.ToDictionary(p => p.Key, p => p.Value) };

    private static ComponentDef Text(string text, string variant) => C("text", 12, ("text", text), ("variant", variant));
    private static ComponentDef Card(int span, string title, string text) => C("card", span, ("title", title), ("text", text));
    private static ComponentDef Form(TableDef t, int span, string title, string label) => C("form", span, ("tableId", t.Id), ("title", title), ("label", label));
    private static ComponentDef Grid(TableDef t, int span) => C("table", span, ("tableId", t.Id));
    private static ComponentDef Chart(TableDef t, int span, string groupBy, string title) => C("chart", span, ("tableId", t.Id), ("groupBy", groupBy), ("title", title));

    private static ComponentDef ForManagers(ComponentDef c)
    {
        c.VisibleWhen = new ConditionDef { Field = "user.canManage", Op = "eq", Value = "true" };
        return c;
    }
}

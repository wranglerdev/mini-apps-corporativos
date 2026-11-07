using Api.Auth;
using Domain;
using Infra;

namespace Api;

/// <summary>
/// ÚNICO lugar onde adaptadores são ligados às portas do domínio.
/// Na migração para o ambiente corporativo, troque as linhas marcadas com [TROCA] (ver DOCS/TROCA-DE-ADAPTADORES.md).
/// </summary>
public static class CompositionRoot
{
    public static IServiceCollection Addapp(this IServiceCollection services, IConfiguration config)
    {
        // [TROCA] AUTH: lib interna de autenticação (SSO Entra/Google/SAML) no lugar do mock (mock-auth.json).
        services.AddScoped<IUserProvider, MockUserProvider>();

        // [TROCA] E-MAIL: API interna de e-mail no lugar do log.
        services.AddScoped<IEmailSender, LogEmailSender>();

        // [TROCA] PERSISTÊNCIA: outro provider EF Core ou outra implementação dos repositórios.
        services.AddSqlitePersistence(config.GetConnectionString("Default") ?? "Data Source=data/app.db");

        // [TROCA] ARQUIVOS: storage corporativo (blob, SharePoint...).
        services.AddSingleton<IFileStorage>(new LocalFileStorage(config["Storage:UploadsPath"] ?? "data/uploads"));

        // [TROCA] DOCUMENTOS: .xlsx e PDF escritos com a BCL; trocáveis por ClosedXML/QuestPDF etc.
        services.AddSingleton<ISpreadsheet, XlsxSpreadsheet>();
        services.AddSingleton<IPdfReport, PdfReportWriter>();

        // Conector REST/webhook genérico.
        services.AddHttpClient<IHttpConnector, HttpConnector>(c => c.Timeout = TimeSpan.FromSeconds(15));

        // Domínio (não muda na migração).
        services.AddScoped<AppService>();
        services.AddScoped<RecordService>();
        services.AddScoped<WorkflowEngine>();
        services.AddScoped<WorkflowService>();
        services.AddScoped<ApprovalService>();
        services.AddScoped<WorkspaceService>();
        services.AddScoped<AuditService>();
        services.AddScoped<FileService>();
        services.AddScoped<ScheduledWorkflowService>();
        services.AddScoped<FormService>();
        services.AddScoped<FlowService>();
        services.AddScoped<FlowRunner>();
        services.AddScoped<SecretService>();

        // [TROCA] SEGREDOS: hoje no banco, cifrados com uma chave local; no corporativo, adaptador do cofre de senhas.
        services.AddSecretCipher(config["Secrets:KeyFile"] ?? "data/secrets.key");

        // [TROCA] FILA DE WORKFLOWS: worker em processo; no corporativo, worker separado + fila real.
        services.AddHostedService<FlowWorkerHostedService>();
        // Governança: Forms:AllowPublic=false desliga todos os links públicos de formulário.
        services.AddSingleton(new FormSettings(config.GetValue("Forms:AllowPublic", true)));

        // [TROCA] AGENDADOR: relógio em processo; no corporativo pode virar job externo (ver ScheduledWorkflowsHostedService).
        services.AddHostedService<ScheduledWorkflowsHostedService>();
        return services;
    }
}

namespace Domain;

// Portas (interfaces) que o domínio exige da infraestrutura.
// Implementações atuais em Infra e Api/Auth. Ver DOCS/TROCA-DE-ADAPTADORES.md.

// ---------- Persistência ----------
public interface IWorkspaceRepository
{
    Task<List<Workspace>> ListAsync();
    Task<Workspace?> GetAsync(Guid id);
    Task AddAsync(Workspace workspace);
}

public interface IAppRepository
{
    Task<List<App>> ListAsync();
    Task<App?> GetAsync(Guid id);
    Task<App?> GetBySlugAsync(string slug);
    Task AddAsync(App app);
    Task UpdateAsync(App app);
    /// <summary>Remove o app, suas versões e seus registros.</summary>
    Task DeleteAsync(Guid id);
    Task AddVersionAsync(AppVersion version);
    Task<List<AppVersion>> ListVersionsAsync(Guid appId);
}

/// <summary>Consulta paginada. Search busca (sem acento/maiúscula, "contém") apenas nos campos de SearchFields.</summary>
public record RecordQuery(Guid AppId, string Env, string TableId, string? Search, IReadOnlyList<string> SearchFields, int Skip, int Take);

public record GroupCount(string? Label, int Value);

public interface IRecordRepository
{
    Task<List<DataRecord>> ListAsync(Guid appId, string env, string tableId);
    /// <summary>Página de registros (mais recentes primeiro) + total que atende ao filtro. Filtra e pagina NO BANCO.</summary>
    Task<(List<DataRecord> Items, int Total)> QueryAsync(RecordQuery query);
    /// <summary>Contagem de registros agrupada pelo valor de um campo (null = vazio). Agrega NO BANCO.</summary>
    Task<List<GroupCount>> CountByAsync(Guid appId, string env, string tableId, string field);
    Task<DataRecord?> GetAsync(Guid id);
    Task AddAsync(DataRecord record);
    Task UpdateAsync(DataRecord record);
    Task DeleteAsync(Guid id);
    /// <summary>Renomeia chaves de Data (nome antigo → novo) em todos os registros da tabela no ambiente.</summary>
    Task RenameFieldsAsync(Guid appId, string env, string tableId, IReadOnlyDictionary<string, string> renames);
}

public interface IApprovalRepository
{
    /// <summary>Aprovações em que o e-mail é aprovador ou solicitante.</summary>
    Task<List<Approval>> ListForUserAsync(string email);
    Task<Approval?> GetAsync(Guid id);
    Task AddAsync(Approval approval);
    Task UpdateAsync(Approval approval);
}

/// <summary>AGENDADOR: última execução de cada workflow agendado (para não repetir após reinício).</summary>
public interface IScheduleStore
{
    Task<DateTime?> GetLastRunAsync(Guid appId, string workflowId);
    Task SetLastRunAsync(Guid appId, string workflowId, DateTime at);
}

/// <summary>Contadores do formulário publicado: "open" (abriu o link) e "q:{id}" (chegou à pergunta). Base do resumo.</summary>
public interface IFormCounters
{
    Task IncrementAsync(Guid appId, string key);
    Task<Dictionary<string, int>> GetAsync(Guid appId);
}

/// <summary>FILA + HISTÓRICO de execuções de workflow. Hoje: tabelas no banco (fila = runs "queued"). No corporativo: fila real.</summary>
public interface IRunStore
{
    Task AddAsync(WorkflowRun run);
    Task UpdateAsync(WorkflowRun run);
    Task<WorkflowRun?> GetAsync(Guid id);
    /// <summary>Execuções do app no ambiente, mais recentes primeiro.</summary>
    Task<List<WorkflowRun>> ListAsync(Guid appId, string env, int take);
    Task<int> NextNumberAsync(Guid appId);
    /// <summary>Próxima da fila (mais antiga "queued"), ou null.</summary>
    Task<WorkflowRun?> NextQueuedAsync();
    Task AddStepAsync(RunStep step);
    Task UpdateStepAsync(RunStep step);
    Task<List<RunStep>> StepsAsync(Guid runId);
    /// <summary>Retenção: apaga execuções (e passos) criadas antes de `before`.</summary>
    Task<int> DeleteOlderThanAsync(DateTime before);
}

/// <summary>SEGREDOS por workspace ({{secrets.NOME}}). Hoje: banco, cifrado com AES (Infra). No corporativo: cofre (Key Vault...).</summary>
public interface ISecretStore
{
    Task<List<SecretInfo>> ListAsync(Guid workspaceId);
    Task SetAsync(Guid workspaceId, string name, string value, string updatedBy);
    Task DeleteAsync(Guid workspaceId, string name);
    /// <summary>Nome → valor em claro. Só o FlowRunner usa, durante a execução.</summary>
    Task<Dictionary<string, string>> ValuesAsync(Guid workspaceId);
}

public interface IAuditLog
{
    Task WriteAsync(AuditEntry entry);
    Task<List<AuditEntry>> ListAsync(int take);
}

// ---------- Documentos (exportação/importação) ----------
public record ReportBar(string Label, int Value);

/// <summary>Gráfico de barras horizontais do relatório (contagem por valor de um campo).</summary>
public record ReportChart(string Title, IReadOnlyList<ReportBar> Bars);

public record ReportDocument(
    string Title,
    string Subtitle,
    IReadOnlyList<ReportChart> Charts,
    IReadOnlyList<string> Headers,
    IReadOnlyList<IReadOnlyList<string?>> Rows,
    string Footer);

/// <summary>PORTA DE PLANILHA (.xlsx). Hoje: OpenXML escrito com a BCL (Infra/Documents). Alternativa: ClosedXML.</summary>
public interface ISpreadsheet
{
    /// <param name="numericColumns">Índices das colunas gravadas como número (o resto vira texto).</param>
    byte[] Write(string sheetName, IReadOnlyList<string> headers, IReadOnlyList<IReadOnlyList<string?>> rows, IReadOnlySet<int> numericColumns);

    /// <summary>Lê a primeira aba. Linha 0 = cabeçalho. Datas do Excel chegam como número serial.</summary>
    List<string[]> Read(Stream content);
}

/// <summary>PORTA DE PDF (relatório de tabela). Hoje: PDF 1.4 escrito à mão (Infra/Documents). Alternativa: QuestPDF.</summary>
public interface IPdfReport
{
    byte[] Render(ReportDocument document);
}

// ---------- Integrações ----------
public record EmailMessage(string To, string Subject, string Body);

/// <summary>PORTA DE E-MAIL. Hoje: LogEmailSender (só log). No corporativo: API interna de e-mail.</summary>
public interface IEmailSender
{
    Task SendAsync(EmailMessage message);
}

public record HttpCallResult(int Status, string Body);

/// <summary>PORTA DE CONECTOR REST/WEBHOOK (ação "callApi" dos workflows).</summary>
public interface IHttpConnector
{
    /// <param name="headers">Cabeçalhos extras (ex.: Authorization com {{secrets.*}} já resolvido).</param>
    Task<HttpCallResult> SendAsync(string method, string url, string? body, IReadOnlyDictionary<string, string>? headers = null);
}

public record StoredFile(string Id, string Name);

/// <summary>
/// PORTA DE ARQUIVOS (anexos). Hoje: disco local. No corporativo: blob/SharePoint/etc.
/// `scope` isola os arquivos por app (id do app em formato N); o acesso é checado no FileService.
/// </summary>
public interface IFileStorage
{
    Task<StoredFile> SaveAsync(string scope, string fileName, Stream content);
    Task<(StoredFile File, Stream Content)?> OpenAsync(string scope, string id);
}

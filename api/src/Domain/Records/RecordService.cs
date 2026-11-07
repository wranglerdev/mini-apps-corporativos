using System.Globalization;
using System.Text;

namespace Domain;

public record RecordWriteResult(DataRecord Record, WorkflowResult Workflow);
public record ImportResult(int Imported, List<string> Errors);
public record PagedRecords(List<DataRecord> Items, int Total, int Page, int Size)
{
    public int Pages => Math.Max(1, (Total + Size - 1) / Size);
}

public record RecordLabel(Guid Id, string Label);

public record FileExport(string FileName, string ContentType, byte[] Content);

/// <summary>CRUD automático das tabelas do app, com permissões por tabela/campo e disparo de workflows.</summary>
public class RecordService(IRecordRepository records, AppService apps, WorkflowEngine engine, ISpreadsheet spreadsheet, IPdfReport pdf, IUserProvider users, IAuditLog audit)
{
    public async Task<List<DataRecord>> ListAsync(Guid appId, string env, string tableId)
    {
        var (scope, table) = await OpenAsync(appId, env, tableId);
        var visible = AccessRules.VisibleFields(scope.CanManage, table);
        return (await records.ListAsync(appId, env, tableId)).OrderByDescending(r => r.CreatedAt).Select(r => r.Project(visible)).ToList();
    }

    public const int MaxPageSize = 100;

    /// <summary>
    /// Busca + paginação no servidor. A busca só considera os campos visíveis para quem consulta
    /// (um usuário não consegue "descobrir" valor de campo oculto buscando por ele).
    /// </summary>
    public async Task<PagedRecords> QueryAsync(Guid appId, string env, string tableId, string? search, int page, int size)
    {
        var (scope, table) = await OpenAsync(appId, env, tableId);
        var visible = AccessRules.VisibleFields(scope.CanManage, table);
        size = Math.Clamp(size, 1, MaxPageSize);
        page = Math.Max(1, page);
        var names = visible.Select(f => f.Name).ToList();

        var (items, total) = await records.QueryAsync(new RecordQuery(appId, env, tableId, search, names, (page - 1) * size, size));
        var pages = Math.Max(1, (total + size - 1) / size);
        if (page > pages) // pediu além da última página (ex.: registros excluídos): devolve a última
        {
            page = pages;
            (items, total) = await records.QueryAsync(new RecordQuery(appId, env, tableId, search, names, (page - 1) * size, size));
        }
        return new PagedRecords(items.Select(r => r.Project(visible)).ToList(), total, page, size);
    }

    /// <summary>Contagem por valor de um campo visível (gráficos/dashboards), calculada no banco.</summary>
    public async Task<List<GroupCount>> SummaryAsync(Guid appId, string env, string tableId, string field)
    {
        var (scope, table) = await OpenAsync(appId, env, tableId);
        if (AccessRules.VisibleFields(scope.CanManage, table).All(f => f.Name != field))
            throw new ValidationException($"Campo '{field}' não existe nesta tabela.");
        return (await records.CountByAsync(appId, env, tableId, field)).OrderByDescending(g => g.Value).ThenBy(g => g.Label).ToList();
    }

    /// <summary>Id → rótulo (primeiro campo visível) para campos de relação. Tabelas de apoio costumam ser pequenas.</summary>
    public async Task<List<RecordLabel>> LabelsAsync(Guid appId, string env, string tableId)
    {
        var (scope, table) = await OpenAsync(appId, env, tableId);
        var first = AccessRules.VisibleFields(scope.CanManage, table).FirstOrDefault()?.Name;
        return (await records.ListAsync(appId, env, tableId))
            .Select(r => new RecordLabel(r.Id, first is null ? r.Id.ToString() : r.Data.GetValueOrDefault(first) ?? ""))
            .OrderBy(l => l.Label).ToList();
    }

    public async Task<RecordWriteResult> CreateAsync(Guid appId, string env, string tableId, IDictionary<string, string?> input)
    {
        var (scope, table) = await OpenAsync(appId, env, tableId);
        var me = users.GetCurrentUser();
        Require(scope, table, TableOp.Create);

        var record = await InsertAsync(scope, table, input, me);
        await audit.WriteAsync(me, "record.create", table.Name, record.Id.ToString());
        var wf = await engine.RunTriggersAsync(scope, Triggers.RecordCreated, table.Id, record.ToContext(), me);
        return new(record.Project(AccessRules.VisibleFields(scope.CanManage, table)), wf);
    }

    public async Task<RecordWriteResult> UpdateAsync(Guid appId, string env, string tableId, Guid recordId, IDictionary<string, string?> input)
    {
        var (scope, table) = await OpenAsync(appId, env, tableId);
        var me = users.GetCurrentUser();
        Require(scope, table, TableOp.Edit);

        var record = await LoadAsync(scope, table, recordId);
        var visible = AccessRules.VisibleFields(scope.CanManage, table);
        var changes = RecordValidator.Normalize(input, AccessRules.WritableFields(scope.CanManage, table), partial: true);
        await CheckRelationsAsync(scope, table, changes);
        foreach (var (k, v) in changes) record.Data[k] = v;
        record.UpdatedBy = me.Email;
        record.UpdatedAt = DateTime.UtcNow;
        await records.UpdateAsync(record);

        await audit.WriteAsync(me, "record.update", table.Name, record.Id.ToString(), string.Join(", ", changes.Keys));
        var wf = await engine.RunTriggersAsync(scope, Triggers.RecordUpdated, table.Id, record.ToContext(), me);
        return new(record.Project(visible), wf);
    }

    public async Task DeleteAsync(Guid appId, string env, string tableId, Guid recordId)
    {
        var (scope, table) = await OpenAsync(appId, env, tableId);
        Require(scope, table, TableOp.Delete);
        var record = await LoadAsync(scope, table, recordId);
        await records.DeleteAsync(record.Id);
        await audit.WriteAsync(users.GetCurrentUser(), "record.delete", table.Name, record.Id.ToString());
    }

    /// <summary>Exporta a tabela (campos visíveis ao usuário) em csv, xlsx ou pdf.</summary>
    public async Task<FileExport> ExportAsync(Guid appId, string env, string tableId, string format)
    {
        var (scope, table) = await OpenAsync(appId, env, tableId);
        var me = users.GetCurrentUser();
        var fields = AccessRules.VisibleFields(scope.CanManage, table);
        var list = (await records.ListAsync(appId, env, tableId)).OrderBy(r => r.CreatedAt).ToList();
        var headers = fields.Select(f => f.Name).ToList();
        // csv/xlsx levam valores crus (reimportáveis); o PDF é para leitura humana.
        List<IReadOnlyList<string?>> Raw() =>
            list.Select(r => (IReadOnlyList<string?>)fields.Select(f => r.Data.GetValueOrDefault(f.Name)).ToList()).ToList();

        var export = format.ToLowerInvariant() switch
        {
            "csv" => new FileExport($"{table.Name}.csv", "text/csv",
                [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(Csv.Write(headers, Raw()))]),
            "xlsx" => new FileExport($"{table.Name}.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                spreadsheet.Write(table.Name, headers, Raw(),
                    fields.Select((f, i) => (f, i)).Where(x => x.f.Type == FieldType.Number).Select(x => x.i).ToHashSet())),
            "pdf" => new FileExport($"{table.Name}.pdf", "application/pdf",
                pdf.Render(await ReportAsync(scope, table, fields, list, me))),
            _ => throw new ValidationException($"Formato não suportado: {format}. Use csv, xlsx ou pdf.")
        };
        await audit.WriteAsync(me, "record.export", table.Name, null, format.ToLowerInvariant());
        return export;
    }

    /// <summary>Importa .xlsx (primeira aba) ou CSV. Linhas válidas entram; inválidas voltam como erro. Não dispara workflows.</summary>
    public async Task<ImportResult> ImportAsync(Guid appId, string env, string tableId, Stream content)
    {
        var (scope, table) = await OpenAsync(appId, env, tableId);
        var me = users.GetCurrentUser();
        Require(scope, table, TableOp.Create);

        using var buffer = new MemoryStream();
        await content.CopyToAsync(buffer);
        var bytes = buffer.ToArray();
        var isZip = bytes.Length > 3 && bytes[0] == 'P' && bytes[1] == 'K'; // .xlsx é um zip
        var rows = isZip ? spreadsheet.Read(new MemoryStream(bytes)) : Csv.Parse(Encoding.UTF8.GetString(bytes));
        if (rows.Count == 0) throw new ValidationException("Arquivo vazio.");

        var headers = rows[0].Select(h => h.Trim()).ToArray();
        var errors = new List<string>();
        var imported = 0;
        for (var i = 1; i < rows.Count; i++)
        {
            var input = headers.Select((h, idx) => (h, v: idx < rows[i].Length ? rows[i][idx] : null))
                .ToDictionary(x => x.h, x => (string?)x.v);
            try { await InsertAsync(scope, table, input, me); imported++; }
            catch (DomainException ex) { errors.Add($"Linha {i + 1}: {ex.Message}"); }
        }

        await audit.WriteAsync(me, "record.import", table.Name, null, $"{(isZip ? "xlsx" : "csv")}: {imported} importados, {errors.Count} erros");
        return new(imported, errors);
    }

    private static readonly CultureInfo PtBr = CultureInfo.GetCultureInfo("pt-BR");

    private static List<(string Title, FieldDef Field)> ChartSources(AppDefinition def, TableDef table, List<FieldDef> visible)
    {
        var fromPages = def.Pages.SelectMany(p => p.Components.SelectMany(c => c.Flatten()).Select(x => x.Component))
            .Where(c => c.Type == "chart" && c.Props.GetValueOrDefault("tableId") == table.Id)
            .Select(c => (Title: c.Props.GetValueOrDefault("title"), Field: visible.FirstOrDefault(f => f.Name == c.Props.GetValueOrDefault("groupBy"))))
            .Where(x => x.Field is not null)
            .Select(x => (string.IsNullOrWhiteSpace(x.Title) ? $"Por {x.Field!.Name}" : x.Title!, x.Field!))
            .DistinctBy(x => x.Item2.Name)
            .ToList();
        return fromPages.Count > 0 ? fromPages : visible.Where(f => f.Type == FieldType.Select).Select(f => ($"Por {f.Name}", f)).ToList();
    }

    /// <summary>Contagem por valor; acima de MaxChartBars valores, o resto vira "Outros".</summary>
    private static List<ReportBar> Bars(IEnumerable<string> values)
    {
        var groups = values.GroupBy(v => string.IsNullOrEmpty(v) ? "(vazio)" : v)
            .Select(g => new ReportBar(g.Key, g.Count())).OrderByDescending(b => b.Value).ThenBy(b => b.Label).ToList();
        if (groups.Count <= MaxChartBars) return groups;
        return [.. groups.Take(MaxChartBars - 1), new ReportBar("Outros", groups.Skip(MaxChartBars - 1).Sum(b => b.Value))];
    }

    public const int MaxChartBars = 8;

    /// <summary>
    /// Relatório legível: números/datas em pt-BR, relações pelo rótulo, arquivos pelo nome. Gráficos: os mesmos dos
    /// componentes "Gráfico" do app para esta tabela; sem nenhum, um por campo de seleção.
    /// </summary>
    private async Task<ReportDocument> ReportAsync(AppScope scope, TableDef table, List<FieldDef> fields, List<DataRecord> list, CurrentUser me)
    {
        var labels = new Dictionary<string, Dictionary<string, string>>();
        foreach (var f in fields.Where(f => f.Type == FieldType.Relation && f.RelationTableId is not null))
        {
            var first = scope.Definition.Tables.FirstOrDefault(t => t.Id == f.RelationTableId)?.Fields.FirstOrDefault()?.Name ?? "";
            labels[f.Name] = (await records.ListAsync(scope.App.Id, scope.Env, f.RelationTableId!))
                .ToDictionary(r => r.Id.ToString(), r => r.Data.GetValueOrDefault(first) ?? "");
        }

        string Display(FieldDef f, string? v) => v is null ? "" : f.Type switch
        {
            FieldType.Number when double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n.ToString("#,##0.##", PtBr),
            FieldType.Date when DateTime.TryParse(v, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) => d.ToString("dd/MM/yyyy"),
            FieldType.Relation => labels.GetValueOrDefault(f.Name)?.GetValueOrDefault(v) ?? v,
            FieldType.File => v[(v.IndexOf('/') + 1)..],
            _ => v
        };

        var charts = list.Count == 0 ? [] : ChartSources(scope.Definition, table, fields)
            .Select(c => new ReportChart(c.Title, Bars(list.Select(r => Display(c.Field, r.Data.GetValueOrDefault(c.Field.Name))))))
            .ToList();

        var version = scope.Env == Env.Draft ? "rascunho" : $"versão {scope.App.PublishedVersion}";
        return new ReportDocument(
            $"{scope.App.Name}: {table.Name}",
            $"{list.Count} registro(s), {version}. Gerado em {DateTime.Now:dd/MM/yyyy HH:mm} por {me.Name}.",
            charts,
            fields.Select(f => f.Name).ToList(),
            list.Select(r => (IReadOnlyList<string?>)fields.Select(f => (string?)Display(f, r.Data.GetValueOrDefault(f.Name))).ToList()).ToList(),
            $"{scope.App.Name}, {version}");
    }

    /// <summary>
    /// Webhook de entrada: sistemas externos criam registros na versão publicada, autenticados pela chave da tabela.
    /// Dispara os workflows de "registro criado" como o usuário técnico "webhook".
    /// </summary>
    public async Task<RecordWriteResult> ReceiveWebhookAsync(Guid appId, string tableId, string? key, IDictionary<string, string?> input)
    {
        var scope = await apps.OpenForIntegrationAsync(appId);
        var table = scope.Definition.Table(tableId);
        if (string.IsNullOrEmpty(table.WebhookKey) || !KeysMatch(key, table.WebhookKey))
            throw new ForbiddenException("Chave de webhook inválida.");

        var user = SystemUsers.Webhook;
        var record = await InsertAsync(scope, table, input, user);
        await audit.WriteAsync(user, "record.webhook", table.Name, record.Id.ToString());
        var wf = await engine.RunTriggersAsync(scope, Triggers.RecordCreated, table.Id, record.ToContext(), user);
        return new(record, wf);
    }

    /// <summary>
    /// Grava a resposta de um formulário (já validada pelo FormService: só as perguntas do caminho percorrido) e dispara
    /// as automações de "registro criado". Campos fora do caminho não são exigidos.
    /// </summary>
    public async Task<RecordWriteResult> InsertFormResponseAsync(AppScope scope, TableDef table, IDictionary<string, string?> answers, CurrentUser who)
    {
        var record = await InsertAsync(scope, table, answers, who, partial: true);
        await audit.WriteAsync(who, "form.submit", table.Name, record.Id.ToString(), scope.Env);
        var wf = await engine.RunTriggersAsync(scope, Triggers.RecordCreated, table.Id, record.ToContext(), who);
        return new(record, wf);
    }

    private static bool KeysMatch(string? given, string expected) =>
        given is not null && System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.UTF8.GetBytes(given), System.Text.Encoding.UTF8.GetBytes(expected));

    private async Task<DataRecord> InsertAsync(AppScope scope, TableDef table, IDictionary<string, string?> input, CurrentUser me, bool partial = false)
    {
        var data = RecordValidator.Normalize(input, AccessRules.WritableFields(scope.CanManage, table), partial);
        await CheckRelationsAsync(scope, table, data);
        var record = new DataRecord { AppId = scope.App.Id, Env = scope.Env, TableId = table.Id, Data = data, CreatedBy = me.Email };
        await records.AddAsync(record);
        return record;
    }

    private async Task CheckRelationsAsync(AppScope scope, TableDef table, Dictionary<string, string?> data)
    {
        foreach (var f in table.Fields.Where(f => f.Type == FieldType.Relation))
        {
            if (data.GetValueOrDefault(f.Name) is not { } value) continue;
            var target = Guid.TryParse(value, out var id) ? await records.GetAsync(id) : null;
            if (target is null || target.AppId != scope.App.Id || target.Env != scope.Env || target.TableId != f.RelationTableId)
                throw new ValidationException($"'{f.Name}' aponta para um registro inexistente.");
        }
    }

    private async Task<DataRecord> LoadAsync(AppScope scope, TableDef table, Guid recordId)
    {
        var record = await records.GetAsync(recordId);
        if (record is null || record.AppId != scope.App.Id || record.Env != scope.Env || record.TableId != table.Id)
            throw new NotFoundException("Registro");
        return record;
    }

    private async Task<(AppScope, TableDef)> OpenAsync(Guid appId, string env, string tableId)
    {
        var scope = await apps.OpenAsync(appId, env);
        return (scope, scope.Definition.Table(tableId));
    }

    private static void Require(AppScope scope, TableDef table, TableOp op)
    {
        if (!AccessRules.CanWrite(scope.CanManage, table, op)) throw new ForbiddenException($"Sem permissão para esta operação em '{table.Name}'.");
    }
}

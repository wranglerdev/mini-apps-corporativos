using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using Domain;
using Infra;

namespace Tests;

/// <summary>Exportação/importação Excel e relatório PDF (jornada 2: usuário extrai dados do app).</summary>
public class SpreadsheetTests
{
    private readonly XlsxSpreadsheet xlsx = new();

    [Fact]
    public void Escreve_e_le_de_volta_com_acentos_numeros_vazios_e_caracteres_especiais()
    {
        IReadOnlyList<IReadOnlyList<string?>> rows =
        [
            ["Solicitação <urgente> & \"já\"", "1500.5", null],
            ["Linha 2", "abc", "Aprovado"]
        ];
        var bytes = xlsx.Write("Pedidos: 2026/11", ["Título", "Valor", "Status"], rows, new HashSet<int> { 1 });

        var read = xlsx.Read(new MemoryStream(bytes));

        Assert.Equal(["Título", "Valor", "Status"], read[0]);
        Assert.Equal(["Solicitação <urgente> & \"já\"", "1500.5"], read[1]); // célula vazia no fim não vira coluna
        Assert.Equal(["Linha 2", "abc", "Aprovado"], read[2]); // "abc" em coluna numérica cai para texto
    }

    [Fact]
    public void Arquivo_gerado_tem_as_partes_que_o_excel_exige_e_numero_como_numero()
    {
        var bytes = xlsx.Write("Dados", ["Valor"], [["42"]], new HashSet<int> { 0 });
        using var zip = new ZipArchive(new MemoryStream(bytes));

        Assert.All(new[] { "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml" },
            p => Assert.NotNull(zip.GetEntry(p)));
        var sheet = new StreamReader(zip.GetEntry("xl/worksheets/sheet1.xml")!.Open()).ReadToEnd();
        Assert.Contains("<c r=\"A2\"><v>42</v></c>", sheet);
    }

    [Fact]
    public void Le_arquivo_no_formato_do_excel_com_strings_compartilhadas_e_colunas_puladas()
    {
        var bytes = ExcelLikeFile(
            sharedStrings: ["Título", "Data", "Mesa"],
            sheetRows: """
                <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
                <row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>46000</v></c></row>
                """);

        var read = xlsx.Read(new MemoryStream(bytes));

        Assert.Equal(["Título", "", "Data"], read[0]);
        Assert.Equal(["Mesa", "", "46000"], read[1]);
    }

    [Fact]
    public void Arquivo_invalido_vira_erro_de_validacao()
    {
        Assert.Throws<ValidationException>(() => xlsx.Read(new MemoryStream("PK isso não é zip"u8.ToArray())));
    }

    /// <summary>Monta um .xlsx como o Excel grava: sharedStrings + referência absoluta na relação da aba.</summary>
    private static byte[] ExcelLikeFile(string[] sharedStrings, string sheetRows)
    {
        const string ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, true))
        {
            void Put(string path, string xml)
            {
                using var w = new StreamWriter(zip.CreateEntry(path).Open(), new UTF8Encoding(false));
                w.Write(xml);
            }
            Put("xl/workbook.xml", $"""<workbook xmlns="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Plan1" sheetId="1" r:id="rId7"/></sheets></workbook>""");
            Put("xl/_rels/workbook.xml.rels", """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="x" Target="/xl/worksheets/planilha.xml"/></Relationships>""");
            Put("xl/sharedStrings.xml", $"""<sst xmlns="{ns}">{string.Concat(sharedStrings.Select(s => $"<si><t>{s}</t></si>"))}</sst>""");
            Put("xl/worksheets/planilha.xml", $"""<worksheet xmlns="{ns}"><sheetData>{sheetRows}</sheetData></worksheet>""");
        }
        return ms.ToArray();
    }
}

public class PdfReportTests
{
    private readonly PdfReportWriter writer = new();

    private static ReportDocument Doc(int rows) => new(
        "Solicitações RH: Pedidos", "3 registros",
        [new ReportChart("Por Status", [new ReportBar("Pendente", 2), new ReportBar("Aprovado", 1)])],
        ["Título", "Valor (R$)"],
        Enumerable.Range(1, rows).Select(i => (IReadOnlyList<string?>)[$"Pedido {i} — ação", $"{i},50"]).ToList(),
        "Rodapé");

    [Fact]
    public void Gera_pdf_valido_com_xref_coerente()
    {
        var pdf = Encoding.ASCII.GetString(writer.Render(Doc(3)));

        Assert.StartsWith("%PDF-1.4", pdf);
        Assert.EndsWith("%%EOF\n", pdf);
        var startXref = int.Parse(Regex.Match(pdf, @"startxref\n(\d+)").Groups[1].Value);
        Assert.Equal("xref", pdf.Substring(startXref, 4));
        // cada offset da tabela xref aponta para o início de "N 0 obj"
        var offsets = Regex.Matches(pdf, @"(\d{10}) 00000 n").Select(m => int.Parse(m.Groups[1].Value)).ToList();
        for (var i = 0; i < offsets.Count; i++) Assert.StartsWith($"{i + 1} 0 obj", pdf[offsets[i]..]);
    }

    [Fact]
    public void Acentos_viram_winansi_e_parenteses_sao_escapados()
    {
        var pdf = Encoding.ASCII.GetString(writer.Render(Doc(1)));

        Assert.Contains(@"(Solicita\347\365es RH: Pedidos)", pdf); // ç = \347, õ = \365
        Assert.Contains(@"Valor \(R$\)", pdf);
        Assert.Contains(@"Pedido 1 \227 a\347\343o", pdf); // travessão = \227
    }

    [Fact]
    public void Desenha_grafico_com_titulo_barras_e_cores_de_status()
    {
        var pdf = Encoding.ASCII.GetString(writer.Render(Doc(1)));

        Assert.Contains("(Por Status)", pdf);
        Assert.Contains("0.604 0.384 0 rg", pdf);         // barra "Pendente" na cor do carimbo
        Assert.Contains("0.118 0.478 0.298 rg", pdf);     // barra "Aprovado"
    }

    [Fact]
    public void Texto_longo_quebra_em_varias_linhas_em_vez_de_cortar()
    {
        var longText = string.Join(' ', Enumerable.Repeat("descrição detalhada do pedido", 6));
        var doc = new ReportDocument("T", "s", [], ["Título", "Descrição", "Valor"],
            [["Pedido", longText, "10"]], "r");

        var pdf = Encoding.ASCII.GetString(writer.Render(doc));
        var descriptionLines = Regex.Matches(pdf, @"\(([^()]*?descri[^()]*)\) Tj").Count;

        Assert.True(descriptionLines >= 2, $"esperava várias linhas, veio {descriptionLines}");
        Assert.DoesNotContain("...", pdf);
    }

    [Fact]
    public void Quebra_tem_limite_de_linhas_e_palavra_gigante_e_partida()
    {
        var lines = PdfReportWriter.Wrap(string.Join(' ', Enumerable.Repeat("palavra", 200)), 120, 8.5f);
        Assert.Equal(PdfReportWriter.MaxCellLines, lines.Count);
        Assert.EndsWith("...", lines[^1]);

        var giant = PdfReportWriter.Wrap(new string('x', 120), 60, 8.5f);
        Assert.True(giant.Count > 1);
    }

    [Fact]
    public void Muitas_linhas_quebram_em_paginas_com_numeracao()
    {
        var pdf = Encoding.ASCII.GetString(writer.Render(Doc(80)));

        var pages = int.Parse(Regex.Match(pdf, @"/Count (\d+)").Groups[1].Value);
        Assert.True(pages >= 3);
        Assert.Contains($"(P\\341gina {pages} de {pages})", pdf);
    }
}

public class ExportImportJourneyTests
{
    [Fact]
    public async Task Exporta_xlsx_e_reimporta_o_mesmo_arquivo()
    {
        var w = new World();
        var (app, table) = await w.CreateRhAppAsync();
        await w.RecordService.CreateAsync(app.Id, Env.Prod, table.Id, new Dictionary<string, string?> { ["Título"] = "Cadeira", ["Valor"] = "350,90" });

        var export = await w.RecordService.ExportAsync(app.Id, Env.Prod, table.Id, "xlsx");
        Assert.Equal("Pedidos.xlsx", export.FileName);

        var result = await w.RecordService.ImportAsync(app.Id, Env.Prod, table.Id, new MemoryStream(export.Content));
        Assert.Equal((1, 0), (result.Imported, result.Errors.Count));
        Assert.All(await w.RecordService.ListAsync(app.Id, Env.Prod, table.Id), r => Assert.Equal("350.9", r.Data["Valor"]));
    }

    [Fact]
    public async Task Data_serial_do_excel_vira_data()
    {
        var w = new World();
        var (app, _) = await w.CreateRhAppAsync(publish: false);
        var draft = JsonUtil.Clone(app.Draft);
        draft.Tables[0].Fields.Add(new FieldDef { Name = "Entrega", Type = FieldType.Date });
        await w.AppService.UpdateAsync(app.Id, new AppChanges(app.Name, null, draft, false, false, null));

        var file = new XlsxSpreadsheet().Write("x", ["Título", "Entrega"], [["Mesa", "46000"]], new HashSet<int> { 1 });
        await w.RecordService.ImportAsync(app.Id, Env.Draft, "pedidos", new MemoryStream(file));

        Assert.Equal("2025-12-09", w.Records.Items.Single().Data["Entrega"]);
    }

    [Fact]
    public async Task Pdf_respeita_campos_ocultos_e_formata_em_portugues()
    {
        var w = new World();
        var (app, table) = await w.CreateRhAppAsync();
        await w.RecordService.CreateAsync(app.Id, Env.Prod, table.Id,
            new Dictionary<string, string?> { ["Título"] = "Notebook", ["Valor"] = "4890.5", ["Custo interno"] = "999" });
        w.As(FakeUsers.UserRh);

        var export = await w.RecordService.ExportAsync(app.Id, Env.Prod, table.Id, "pdf");
        var pdf = Encoding.ASCII.GetString(export.Content);

        Assert.Equal("application/pdf", export.ContentType);
        Assert.Contains("(4.890,5)", pdf);
        Assert.DoesNotContain("Custo interno", pdf);
        Assert.Contains(w.Audit.Items, a => a.Action == "record.export" && a.Details == "pdf");
    }

    [Fact]
    public async Task Formato_desconhecido_e_recusado()
    {
        var w = new World();
        var (app, table) = await w.CreateRhAppAsync();
        await Assert.ThrowsAsync<ValidationException>(() => w.RecordService.ExportAsync(app.Id, Env.Prod, table.Id, "docx"));
    }
}

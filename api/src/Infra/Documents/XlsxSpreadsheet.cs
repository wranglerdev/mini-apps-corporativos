using System.Globalization;
using System.IO.Compression;
using System.Xml;
using System.Xml.Linq;
using Domain;

namespace Infra;

/// <summary>
/// ADAPTADOR .xlsx sem dependências: um .xlsx é um zip de XMLs (OpenXML/SpreadsheetML).
/// Escreve uma aba com cabeçalho em negrito e congelado; lê a primeira aba (strings compartilhadas, inline e números).
/// </summary>
public class XlsxSpreadsheet : ISpreadsheet
{
    private static readonly XNamespace S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private static readonly XNamespace R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private static readonly XNamespace Pkg = "http://schemas.openxmlformats.org/package/2006/relationships";
    private static readonly XNamespace Ct = "http://schemas.openxmlformats.org/package/2006/content-types";
    private const string RelBase = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";

    public byte[] Write(string sheetName, IReadOnlyList<string> headers, IReadOnlyList<IReadOnlyList<string?>> rows, IReadOnlySet<int> numericColumns)
    {
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            Add(zip, "[Content_Types].xml", new XElement(Ct + "Types",
                new XElement(Ct + "Default", new XAttribute("Extension", "rels"), new XAttribute("ContentType", "application/vnd.openxmlformats-package.relationships+xml")),
                new XElement(Ct + "Default", new XAttribute("Extension", "xml"), new XAttribute("ContentType", "application/xml")),
                Override("/xl/workbook.xml", "sheet.main"),
                Override("/xl/worksheets/sheet1.xml", "worksheet"),
                Override("/xl/styles.xml", "styles")));
            Add(zip, "_rels/.rels", Rels(("rId1", "officeDocument", "xl/workbook.xml")));
            Add(zip, "xl/workbook.xml", new XElement(S + "workbook", new XAttribute(XNamespace.Xmlns + "r", R),
                new XElement(S + "sheets", new XElement(S + "sheet",
                    new XAttribute("name", SheetName(sheetName)), new XAttribute("sheetId", 1), new XAttribute(R + "id", "rId1")))));
            Add(zip, "xl/_rels/workbook.xml.rels", Rels(("rId1", "worksheet", "worksheets/sheet1.xml"), ("rId2", "styles", "styles.xml")));
            Add(zip, "xl/styles.xml", Styles());
            Add(zip, "xl/worksheets/sheet1.xml", Sheet(headers, rows, numericColumns));
        }
        return ms.ToArray();
    }

    public List<string[]> Read(Stream content)
    {
        try
        {
            using var zip = new ZipArchive(content, ZipArchiveMode.Read);
            var shared = zip.GetEntry("xl/sharedStrings.xml") is { } ss
                ? Load(ss).Root!.Elements(S + "si").Select(si => string.Concat(si.Descendants(S + "t").Select(t => t.Value))).ToList()
                : [];
            var sheet = Load(zip.GetEntry(FirstSheetPath(zip)) ?? throw new ValidationException("Planilha sem abas."));

            var rows = new List<string[]>();
            foreach (var row in sheet.Descendants(S + "row"))
            {
                var cells = new List<string>();
                foreach (var c in row.Elements(S + "c"))
                {
                    var index = c.Attribute("r") is { } r ? ColumnIndex(r.Value) : cells.Count;
                    while (cells.Count < index) cells.Add("");
                    cells.Add(CellText(c, shared));
                }
                if (cells.Any(v => v.Length > 0)) rows.Add([.. cells]);
            }
            return rows;
        }
        catch (Exception e) when (e is InvalidDataException or XmlException or NullReferenceException or InvalidOperationException)
        {
            throw new ValidationException("Arquivo .xlsx inválido ou corrompido.");
        }
    }

    // ---------- escrita ----------

    private static XElement Sheet(IReadOnlyList<string> headers, IReadOnlyList<IReadOnlyList<string?>> rows, IReadOnlySet<int> numeric)
    {
        var widths = headers.Select((h, i) => Math.Clamp(
            Math.Max(h.Length, rows.Take(200).Select(r => i < r.Count ? r[i]?.Length ?? 0 : 0).DefaultIfEmpty(0).Max()) + 2, 8, 60)).ToList();

        var sheetData = new XElement(S + "sheetData",
            Row(1, headers.Select((h, i) => InlineCell(i, 1, h, style: 1))));
        for (var r = 0; r < rows.Count; r++)
        {
            var rowNumber = r + 2;
            sheetData.Add(Row(rowNumber, rows[r].Select((v, i) => v is null ? null
                : numeric.Contains(i) && double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out _)
                    ? new XElement(S + "c", new XAttribute("r", Ref(i, rowNumber)), new XElement(S + "v", v))
                    : InlineCell(i, rowNumber, v, style: 0))));
        }

        return new XElement(S + "worksheet",
            new XElement(S + "sheetViews", new XElement(S + "sheetView", new XAttribute("workbookViewId", 0),
                new XElement(S + "pane", new XAttribute("ySplit", 1), new XAttribute("topLeftCell", "A2"),
                    new XAttribute("activePane", "bottomLeft"), new XAttribute("state", "frozen")))),
            new XElement(S + "cols", widths.Select((w, i) => new XElement(S + "col",
                new XAttribute("min", i + 1), new XAttribute("max", i + 1), new XAttribute("width", w), new XAttribute("customWidth", 1)))),
            sheetData);
    }

    private static XElement Row(int number, IEnumerable<XElement?> cells) =>
        new(S + "row", new XAttribute("r", number), cells.Where(c => c is not null));

    private static XElement InlineCell(int col, int row, string value, int style)
    {
        var cell = new XElement(S + "c", new XAttribute("r", Ref(col, row)), new XAttribute("t", "inlineStr"),
            new XElement(S + "is", new XElement(S + "t", new XAttribute(XNamespace.Xml + "space", "preserve"), Clean(value))));
        if (style > 0) cell.Add(new XAttribute("s", style));
        return cell;
    }

    private static XElement Styles() => new(S + "styleSheet",
        new XElement(S + "fonts", new XAttribute("count", 2),
            new XElement(S + "font", new XElement(S + "sz", new XAttribute("val", 11)), new XElement(S + "name", new XAttribute("val", "Calibri"))),
            new XElement(S + "font", new XElement(S + "b"), new XElement(S + "sz", new XAttribute("val", 11)), new XElement(S + "name", new XAttribute("val", "Calibri")))),
        new XElement(S + "fills", new XAttribute("count", 2),
            new XElement(S + "fill", new XElement(S + "patternFill", new XAttribute("patternType", "none"))),
            new XElement(S + "fill", new XElement(S + "patternFill", new XAttribute("patternType", "gray125")))),
        new XElement(S + "borders", new XAttribute("count", 1),
            new XElement(S + "border", new XElement(S + "left"), new XElement(S + "right"), new XElement(S + "top"), new XElement(S + "bottom"), new XElement(S + "diagonal"))),
        new XElement(S + "cellStyleXfs", new XAttribute("count", 1), Xf(0, null)),
        new XElement(S + "cellXfs", new XAttribute("count", 2), Xf(0, 0), Xf(1, 0)),
        new XElement(S + "cellStyles", new XAttribute("count", 1),
            new XElement(S + "cellStyle", new XAttribute("name", "Normal"), new XAttribute("xfId", 0), new XAttribute("builtinId", 0))));

    private static XElement Xf(int fontId, int? xfId)
    {
        var xf = new XElement(S + "xf", new XAttribute("numFmtId", 0), new XAttribute("fontId", fontId), new XAttribute("fillId", 0), new XAttribute("borderId", 0));
        if (xfId is { } id) xf.Add(new XAttribute("xfId", id));
        if (fontId > 0) xf.Add(new XAttribute("applyFont", 1));
        return xf;
    }

    private static XElement Override(string part, string kind) => new(Ct + "Override",
        new XAttribute("PartName", part), new XAttribute("ContentType", $"application/vnd.openxmlformats-officedocument.spreadsheetml.{kind}+xml"));

    private static XElement Rels(params (string Id, string Type, string Target)[] items) => new(Pkg + "Relationships",
        items.Select(i => new XElement(Pkg + "Relationship", new XAttribute("Id", i.Id), new XAttribute("Type", RelBase + i.Type), new XAttribute("Target", i.Target))));

    private static void Add(ZipArchive zip, string path, XElement root)
    {
        using var stream = zip.CreateEntry(path, CompressionLevel.Optimal).Open();
        new XDocument(new XDeclaration("1.0", "UTF-8", "yes"), root).Save(stream, SaveOptions.DisableFormatting);
    }

    /// <summary>Nome de aba: até 31 caracteres, sem []:*?/\.</summary>
    private static string SheetName(string name)
    {
        var clean = new string(name.Where(c => !"[]:*?/\\".Contains(c)).ToArray()).Trim();
        return clean.Length == 0 ? "Dados" : clean[..Math.Min(31, clean.Length)];
    }

    private static string Clean(string value) => new(value.Where(XmlConvert.IsXmlChar).ToArray());

    private static string Ref(int col, int row) => ColumnName(col) + row;

    private static string ColumnName(int index)
    {
        var name = "";
        for (index++; index > 0; index = (index - 1) / 26) name = (char)('A' + (index - 1) % 26) + name;
        return name;
    }

    // ---------- leitura ----------

    private static int ColumnIndex(string cellRef)
    {
        var index = 0;
        foreach (var ch in cellRef.TakeWhile(char.IsLetter)) index = index * 26 + (char.ToUpperInvariant(ch) - 'A' + 1);
        return index - 1;
    }

    private static string CellText(XElement c, List<string> shared)
    {
        var v = c.Element(S + "v")?.Value ?? "";
        return (string?)c.Attribute("t") switch
        {
            "s" => int.TryParse(v, out var i) && i < shared.Count ? shared[i] : "",
            "inlineStr" => string.Concat(c.Descendants(S + "t").Select(t => t.Value)),
            "b" => v == "1" ? "true" : "false",
            _ => v
        };
    }

    private static string FirstSheetPath(ZipArchive zip)
    {
        var workbook = Load(zip.GetEntry("xl/workbook.xml")!);
        var rid = workbook.Descendants(S + "sheet").First().Attribute(R + "id")!.Value;
        var rels = Load(zip.GetEntry("xl/_rels/workbook.xml.rels")!);
        var target = rels.Root!.Elements(Pkg + "Relationship").First(e => (string?)e.Attribute("Id") == rid).Attribute("Target")!.Value;
        return target.StartsWith('/') ? target.TrimStart('/') : "xl/" + target;
    }

    private static XDocument Load(ZipArchiveEntry entry)
    {
        using var stream = entry.Open();
        return XDocument.Load(stream);
    }
}

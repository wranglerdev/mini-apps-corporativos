using System.Globalization;
using System.Text;
using Domain;

namespace Infra;

/// <summary>
/// ADAPTADOR DE PDF sem dependências: escreve um PDF 1.4 com as fontes padrão Helvetica (WinAnsi, cobre acentos do
/// português). Relatório em A4 paisagem: título, subtítulo, gráficos de barras (dois por linha), tabela com cabeçalho
/// repetido em cada página, células com quebra de linha (até MaxCellLines; além disso, "...") e "Página X de N".
/// </summary>
public class PdfReportWriter : IPdfReport
{
    public const int MaxCellLines = 6;
    private const float PageW = 842, PageH = 595, Margin = 36, HeadH = 20, Body = 8.5f, LineH = 10.5f, CellPad = 6.5f;
    private const float ChartGap = 24, BarH = 9, BarStep = 15, ChartLabelW = 130, ChartValueW = 34;
    private static readonly string Ink = "0.094 0.133 0.227", Muted = "0.29 0.337 0.447", Pen = "0.165 0.278 0.788";
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    /// <summary>Mesmas cores dos carimbos de status da UI (ui.css).</summary>
    private static readonly Dictionary<string, string> Tones = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Aprovado"] = "0.118 0.478 0.298", ["Fechado"] = "0.118 0.478 0.298", ["Feito"] = "0.118 0.478 0.298",
        ["Concluído"] = "0.118 0.478 0.298", ["Ganho"] = "0.118 0.478 0.298",
        ["Rejeitado"] = "0.702 0.149 0.118", ["Perdido"] = "0.702 0.149 0.118",
        ["Pendente"] = "0.604 0.384 0"
    };

    public byte[] Render(ReportDocument doc)
    {
        var widths = ColumnWidths(doc);
        var pages = new List<StringBuilder>();
        var page = new StringBuilder();
        float y = 0;
        const float bottom = Margin + 14;

        void TableHeader()
        {
            page.Append($"0.902 0.922 0.984 rg {F(Margin)} {F(y - HeadH)} {F(PageW - 2 * Margin)} {F(HeadH)} re f\n");
            var x = Margin;
            for (var i = 0; i < doc.Headers.Count; i++)
            {
                Text(page, x + 5, y - 13.5f, Body, true, Fit(doc.Headers[i], widths[i] - 10, Body, true), Ink);
                x += widths[i];
            }
            y -= HeadH;
            Line(page, y, Ink, 0.8f);
        }

        void NewPage()
        {
            page = new StringBuilder();
            pages.Add(page);
            y = PageH - Margin;
        }

        // ---- capa: título, subtítulo e gráficos
        NewPage();
        Text(page, Margin, y - 14, 17, true, Fit(doc.Title, PageW - 2 * Margin, 17, true), Ink);
        y -= 34;
        Text(page, Margin, y, 9, false, Fit(doc.Subtitle, PageW - 2 * Margin, 9, false), Muted);
        y -= 22;
        var chartW = (PageW - 2 * Margin - ChartGap) / 2;
        for (var i = 0; i < doc.Charts.Count; i += 2)
        {
            var pair = doc.Charts.Skip(i).Take(2).ToList();
            var height = pair.Max(ChartHeight);
            if (y - height < bottom + 60) NewPage();
            for (var j = 0; j < pair.Count; j++) DrawChart(page, pair[j], Margin + j * (chartW + ChartGap), y, chartW);
            y -= height + 12;
        }

        // ---- tabela
        if (y - HeadH - 40 < bottom) NewPage();
        TableHeader();
        if (doc.Rows.Count == 0) Text(page, Margin + 5, y - 14, 9, false, "Nenhum registro.", Muted);

        foreach (var row in doc.Rows)
        {
            var cells = doc.Headers.Select((_, i) => Wrap(i < row.Count ? row[i] ?? "" : "", widths[i] - 10, Body)).ToList();
            var rowH = cells.Max(c => c.Count) * LineH + CellPad;
            if (y - rowH < bottom)
            {
                NewPage();
                TableHeader();
            }
            var x = Margin;
            for (var i = 0; i < cells.Count; i++)
            {
                for (var l = 0; l < cells[i].Count; l++) Text(page, x + 5, y - 11.5f - l * LineH, Body, false, cells[i][l], Ink);
                x += widths[i];
            }
            y -= rowH;
            Line(page, y, "0.89 0.91 0.937", 0.5f);
        }

        for (var i = 0; i < pages.Count; i++)
        {
            Text(pages[i], Margin, 20, 8, false, Fit(doc.Footer, PageW / 2, 8, false), Muted);
            var label = $"Página {i + 1} de {pages.Count}";
            Text(pages[i], PageW - Margin - Width(label, 8, false), 20, 8, false, label, Muted);
            pages[i].Append($"{Pen} RG 2 w {F(Margin)} {F(PageH - 14)} m {F(Margin + 60)} {F(PageH - 14)} l S\n");
        }

        return Assemble(pages, doc.Title);
    }

    // ---------- gráficos ----------

    private static float ChartHeight(ReportChart chart) => 20 + Math.Max(1, chart.Bars.Count) * BarStep;

    private static void DrawChart(StringBuilder sb, ReportChart chart, float x, float top, float width)
    {
        Text(sb, x, top - 10, 10, true, Fit(chart.Title, width, 10, true), Ink);
        var max = Math.Max(1, chart.Bars.Select(b => b.Value).DefaultIfEmpty(0).Max());
        var trackW = width - ChartLabelW - ChartValueW;
        var y = top - 20;
        foreach (var bar in chart.Bars)
        {
            Text(sb, x, y - 8, 8.5f, false, Fit(bar.Label, ChartLabelW - 8, 8.5f, false), Ink);
            var barX = x + ChartLabelW;
            sb.Append($"0.89 0.91 0.937 rg {F(barX)} {F(y - BarH - 1)} {F(trackW)} {F(BarH)} re f\n");
            sb.Append($"{Tones.GetValueOrDefault(bar.Label, Pen)} rg {F(barX)} {F(y - BarH - 1)} {F(Math.Max(1.5f, trackW * bar.Value / max))} {F(BarH)} re f\n");
            var value = bar.Value.ToString(Inv);
            Text(sb, x + width - Width(value, 8.5f, true), y - 8, 8.5f, true, value, Ink);
            y -= BarStep;
        }
    }

    // ---------- layout ----------

    private static float[] ColumnWidths(ReportDocument doc)
    {
        var weights = doc.Headers.Select((h, i) => (float)Math.Clamp(
            Math.Max(h.Length, doc.Rows.Take(300).Select(r => i < r.Count ? r[i]?.Length ?? 0 : 0).DefaultIfEmpty(0).Max()), 5, 40)).ToArray();
        var total = weights.Sum();
        return weights.Select(w => (PageW - 2 * Margin) * w / Math.Max(1, total)).ToArray();
    }

    /// <summary>Largura aproximada em Helvetica (suficiente para cortar sem estourar a coluna).</summary>
    private static float Width(string s, float size, bool bold) =>
        s.Sum(c => c == ' ' ? 0.28f : char.IsUpper(c) || char.IsDigit(c) ? 0.64f : "ijlt.,;:'|!".Contains(c) ? 0.3f : "mwMW".Contains(c) ? 0.85f : 0.53f)
        * size * (bold ? 1.06f : 1f);

    private static string Fit(string s, float max, float size, bool bold)
    {
        s = s.Replace('\n', ' ').Replace('\r', ' ');
        if (Width(s, size, bold) <= max) return s;
        while (s.Length > 0 && Width(s + "...", size, bold) > max) s = s[..^1];
        return s.TrimEnd() + "...";
    }

    /// <summary>
    /// Quebra o texto em linhas que cabem em `max` (por palavra; palavra maior que a coluna é partida).
    /// Acima de MaxCellLines, a última linha termina em "...".
    /// </summary>
    internal static List<string> Wrap(string text, float max, float size)
    {
        var lines = new List<string>();
        foreach (var paragraph in text.Replace("\r", "").Split('\n'))
        {
            var line = "";
            foreach (var word in paragraph.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            {
                var candidate = line.Length == 0 ? word : line + " " + word;
                if (Width(candidate, size, false) <= max) { line = candidate; continue; }
                if (line.Length > 0) lines.Add(line);
                line = word;
                while (Width(line, size, false) > max && line.Length > 1) // palavra longa: parte em pedaços
                {
                    var cut = line.Length - 1;
                    while (cut > 1 && Width(line[..cut], size, false) > max) cut--;
                    lines.Add(line[..cut]);
                    line = line[cut..];
                }
            }
            lines.Add(line);
        }
        while (lines.Count > 1 && lines[^1].Length == 0) lines.RemoveAt(lines.Count - 1);
        if (lines.Count <= MaxCellLines) return lines;
        var kept = lines.Take(MaxCellLines).ToList();
        kept[^1] = Fit(kept[^1] + " " + lines[MaxCellLines], max, size, false).TrimEnd('.').TrimEnd() + "...";
        return kept;
    }

    private static void Text(StringBuilder sb, float x, float y, float size, bool bold, string text, string color) =>
        sb.Append($"BT /{(bold ? "F2" : "F1")} {F(size)} Tf {color} rg {F(x)} {F(y)} Td ({Escape(text)}) Tj ET\n");

    private static void Line(StringBuilder sb, float y, string color, float width) =>
        sb.Append($"{color} RG {F(width)} w {F(Margin)} {F(y)} m {F(PageW - Margin)} {F(y)} l S\n");

    private static string F(float v) => v.ToString("0.##", Inv);

    // ---------- arquivo ----------

    private static byte[] Assemble(List<StringBuilder> pages, string title)
    {
        var objects = new List<string>
        {
            "<< /Type /Catalog /Pages 2 0 R >>",
            $"<< /Type /Pages /Kids [{string.Join(' ', pages.Select((_, i) => $"{5 + 2 * i} 0 R"))}] /Count {pages.Count} >>",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
        };
        foreach (var content in pages.Select(p => p.ToString()))
        {
            objects.Add($"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {F(PageW)} {F(PageH)}] " +
                        $"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {objects.Count + 2} 0 R >>");
            objects.Add($"<< /Length {content.Length} >>\nstream\n{content}endstream");
        }
        objects.Add($"<< /Title ({Escape(title)}) /Producer (Mini apps) /CreationDate (D:{DateTime.Now:yyyyMMddHHmmss}) >>");
        var infoId = objects.Count;

        var sb = new StringBuilder("%PDF-1.4\n");
        var offsets = new List<int>();
        for (var i = 0; i < objects.Count; i++)
        {
            offsets.Add(sb.Length); // todo o conteúdo é ASCII: posição do char == posição do byte
            sb.Append($"{i + 1} 0 obj\n{objects[i]}\nendobj\n");
        }
        var xref = sb.Length;
        sb.Append($"xref\n0 {objects.Count + 1}\n0000000000 65535 f \n");
        foreach (var o in offsets) sb.Append($"{o:D10} 00000 n \n");
        sb.Append($"trailer\n<< /Size {objects.Count + 1} /Root 1 0 R /Info {infoId} 0 R >>\nstartxref\n{xref}\n%%EOF\n");
        return Encoding.ASCII.GetBytes(sb.ToString());
    }

    /// <summary>Texto → string literal PDF em WinAnsi, com bytes não ASCII em octal (o arquivo fica 100% ASCII).</summary>
    private static string Escape(string text)
    {
        var sb = new StringBuilder();
        foreach (var ch in text)
        {
            var b = WinAnsi(ch);
            if (b is (byte)'(' or (byte)')' or (byte)'\\') sb.Append('\\').Append((char)b);
            else if (b is < 32 or > 126) sb.Append('\\').Append(Convert.ToString(b, 8).PadLeft(3, '0'));
            else sb.Append((char)b);
        }
        return sb.ToString();
    }

    private static byte WinAnsi(char c) => c switch
    {
        < (char)0x80 => (byte)c,
        >= (char)0xA0 and <= (char)0xFF => (byte)c,
        '€' => 0x80, '…' => 0x85, '‘' => 0x91, '’' => 0x92, '“' => 0x93, '”' => 0x94, '•' => 0x95, '–' => 0x96, '—' => 0x97,
        _ => (byte)'?'
    };
}

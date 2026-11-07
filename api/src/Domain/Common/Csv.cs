using System.Text;

namespace Domain;

/// <summary>CSV mínimo (RFC 4180). Exporta com ';' para abrir direto no Excel pt-BR; importa ',' ou ';'.</summary>
public static class Csv
{
    public const char ExportSeparator = ';';

    public static string Write(IReadOnlyList<string> headers, IEnumerable<IReadOnlyList<string?>> rows)
    {
        var sb = new StringBuilder();
        sb.AppendLine(string.Join(ExportSeparator, headers.Select(Escape)));
        foreach (var row in rows) sb.AppendLine(string.Join(ExportSeparator, row.Select(Escape)));
        return sb.ToString();
    }

    public static List<string[]> Parse(string text)
    {
        text = text.TrimStart('﻿');
        var firstLine = text.Split('\n')[0];
        var sep = firstLine.Contains(';') ? ';' : ',';
        var rows = new List<string[]>();
        var row = new List<string>();
        var cell = new StringBuilder();
        var quoted = false;

        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (quoted)
            {
                if (c == '"' && i + 1 < text.Length && text[i + 1] == '"') { cell.Append('"'); i++; }
                else if (c == '"') quoted = false;
                else cell.Append(c);
            }
            else if (c == '"') quoted = true;
            else if (c == sep) { row.Add(cell.ToString()); cell.Clear(); }
            else if (c == '\n')
            {
                row.Add(cell.ToString().TrimEnd('\r')); cell.Clear();
                if (row.Any(v => v.Length > 0)) rows.Add([.. row]);
                row = [];
            }
            else cell.Append(c);
        }
        row.Add(cell.ToString().TrimEnd('\r'));
        if (row.Any(v => v.Length > 0)) rows.Add([.. row]);
        return rows;
    }

    private static string Escape(string? value)
    {
        value ??= "";
        return value.IndexOfAny([ExportSeparator, ',', '"', '\n', '\r']) >= 0
            ? $"\"{value.Replace("\"", "\"\"")}\""
            : value;
    }
}

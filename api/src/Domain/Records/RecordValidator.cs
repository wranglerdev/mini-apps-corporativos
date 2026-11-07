using System.Globalization;

namespace Domain;

/// <summary>Valida e normaliza valores de entrada conforme o tipo do campo. Campos desconhecidos são descartados.</summary>
public static class RecordValidator
{
    private static readonly CultureInfo PtBr = CultureInfo.GetCultureInfo("pt-BR");

    /// <param name="partial">true em updates: só valida os campos enviados.</param>
    public static Dictionary<string, string?> Normalize(IDictionary<string, string?> input, IEnumerable<FieldDef> writable, bool partial)
    {
        var errors = new List<string>();
        var output = new Dictionary<string, string?>();

        foreach (var f in writable)
        {
            var present = input.TryGetValue(f.Name, out var raw);
            if (partial && !present) continue;

            var value = string.IsNullOrWhiteSpace(raw) ? null : raw.Trim();
            if (value is null)
            {
                if (f.Required) errors.Add($"'{f.Name}' é obrigatório.");
                output[f.Name] = null;
                continue;
            }

            switch (f.Type)
            {
                case FieldType.Number:
                    if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var n) ||
                        double.TryParse(value, NumberStyles.Float, PtBr, out n))
                        output[f.Name] = n.ToString(CultureInfo.InvariantCulture);
                    else errors.Add($"'{f.Name}' deve ser um número.");
                    break;
                case FieldType.Date:
                    if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var serial) && serial is > 0 and < 2958466)
                        output[f.Name] = DateTime.FromOADate(serial).ToString("yyyy-MM-dd"); // data vinda do Excel
                    else if (DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ||
                        DateTime.TryParse(value, PtBr, DateTimeStyles.None, out d))
                        output[f.Name] = d.ToString("yyyy-MM-dd");
                    else errors.Add($"'{f.Name}' deve ser uma data.");
                    break;
                case FieldType.Select:
                    var option = f.Options.FirstOrDefault(o => o.Equals(value, StringComparison.OrdinalIgnoreCase));
                    if (option is null) errors.Add($"'{f.Name}' deve ser uma das opções: {string.Join(", ", f.Options)}.");
                    else output[f.Name] = option;
                    break;
                default: // Text, Relation (id do registro), File (id/nome do arquivo)
                    output[f.Name] = value;
                    break;
            }
        }

        if (errors.Count > 0) throw new ValidationException(string.Join(" ", errors));
        return output;
    }
}

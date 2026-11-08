namespace Domain;

/// <summary>
/// Navegação entre projetos e links (ação "Abrir projeto ou link" e redirecionamento do formulário).
/// Só endereços http(s) ou caminhos do próprio site ("/..."); valores pré-preenchidos vão na query string.
/// </summary>
public static class Links
{
    /// <summary>Endereço de um formulário ou mini app: publicado (/f, /run) ou rascunho para quem testa (/f-preview, /preview).</summary>
    public static string ProjectPath(App target, string env)
    {
        var form = (env == Env.Prod ? target.Published : target.Draft)?.Form is not null;
        if (target.Kind == ProjectKinds.Workflow) throw new ValidationException($"'{target.Name}' é um workflow: use \"Iniciar workflow\".");
        if (env == Env.Prod && target.Published is null) throw new ValidationException($"Publique '{target.Name}' antes de abrir em produção.");
        return env == Env.Prod ? (form ? $"/f/{target.Slug}" : $"/run/{target.Slug}") : (form ? $"/f-preview/{target.Id}" : $"/preview/{target.Id}");
    }

    /// <summary>http(s) absoluto ou caminho do site ("/x", nunca "//x" nem javascript:).</summary>
    public static bool IsSafe(string? url)
    {
        var u = url?.Trim() ?? "";
        if (u.StartsWith('/')) return !u.StartsWith("//") && !u.StartsWith("/\\");
        return Uri.TryCreate(u, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
    }

    /// <summary>Validação ao salvar: o endereço pode ter {{variáveis}}, mas o começo (esquema ou "/") é fixo.</summary>
    public static bool IsSafeTemplate(string? url)
    {
        var u = url?.Trim() ?? "";
        if (u.StartsWith("//") || u.StartsWith("/\\")) return false;
        return u.StartsWith('/') || u.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || u.StartsWith("https://", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Troca {{variáveis}} de um link escapando cada valor (uma resposta não muda o endereço).</summary>
    public static string RenderUrl(string? template, IReadOnlyDictionary<string, string?> ctx) =>
        Template.Render(template, ctx.ToDictionary(kv => kv.Key, kv => kv.Value is null ? null : Uri.EscapeDataString(kv.Value), StringComparer.OrdinalIgnoreCase)).Trim();

    /// <summary>Acrescenta os valores não vazios na query string (escapados).</summary>
    public static string WithQuery(string url, IEnumerable<KeyValuePair<string, string?>> values)
    {
        var query = string.Join("&", values.Where(kv => !string.IsNullOrEmpty(kv.Value))
            .Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value!)}"));
        return query.Length == 0 ? url : url + (url.Contains('?') ? "&" : "?") + query;
    }
}

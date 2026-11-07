using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Domain;

public class DomainException(string message) : Exception(message);
public class NotFoundException(string what) : DomainException($"{what} não encontrado(a).");
public class ForbiddenException(string message = "Acesso negado.") : DomainException(message);
public class UnauthorizedException(string message = "Usuário não autenticado.") : DomainException(message);
public class ValidationException(string message) : DomainException(message);

/// <summary>Ambientes de um app: rascunho (editor/preview) e produção (publicado).</summary>
public static class Env
{
    public const string Draft = "draft";
    public const string Prod = "prod";

    public static void Validate(string env)
    {
        if (env is not (Draft or Prod)) throw new ValidationException($"Ambiente inválido: {env}.");
    }
}

public static class JsonUtil
{
    public static readonly JsonSerializerOptions Options = Create();

    public static JsonSerializerOptions Create()
    {
        var o = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        o.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        return o;
    }

    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);
    public static T Deserialize<T>(string json) => JsonSerializer.Deserialize<T>(json, Options)!;
    public static T Clone<T>(T value) => Deserialize<T>(Serialize(value));
}

/// <summary>Regra única de comparação de busca: sem acentos e em minúsculas.</summary>
public static class TextSearch
{
    public static string Normalize(string text)
    {
        var sb = new StringBuilder(text.Length);
        foreach (var c in text.Normalize(NormalizationForm.FormD))
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) sb.Append(char.ToLowerInvariant(c));
        return sb.ToString().Normalize(NormalizationForm.FormC);
    }
}

public static class Ids
{
    public static string New() => Guid.NewGuid().ToString("N")[..8];
}

public static class Slug
{
    public static string From(string name)
    {
        var normalized = name.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder();
        foreach (var c in normalized)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark) continue;
            sb.Append(char.IsLetterOrDigit(c) ? char.ToLowerInvariant(c) : '-');
        }
        var slug = string.Join('-', sb.ToString().Split('-', StringSplitOptions.RemoveEmptyEntries));
        return $"{(slug.Length == 0 ? "app" : slug)}-{Ids.New()[..5]}";
    }
}

using System.Text;
using Domain;
using Microsoft.Extensions.Logging;

namespace Infra;

/// <summary>ADAPTADOR DE E-MAIL (mock): só registra no log. Trocar pela API interna de e-mail.</summary>
public class LogEmailSender(ILogger<LogEmailSender> logger) : IEmailSender
{
    public Task SendAsync(EmailMessage message)
    {
        logger.LogInformation("[EMAIL] Para: {To} | Assunto: {Subject} | Corpo: {Body}", message.To, message.Subject, message.Body);
        return Task.CompletedTask;
    }
}

/// <summary>ADAPTADOR REST/WEBHOOK genérico (ação callApi). Corpo enviado como JSON.</summary>
public class HttpConnector(HttpClient http) : IHttpConnector
{
    public async Task<HttpCallResult> SendAsync(string method, string url, string? body, IReadOnlyDictionary<string, string>? headers = null)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            throw new ValidationException("URL inválida para chamada de API.");

        using var request = new HttpRequestMessage(new HttpMethod(method.ToUpperInvariant()), uri);
        if (body is not null) request.Content = new StringContent(body, Encoding.UTF8, "application/json");
        foreach (var (name, value) in headers ?? new Dictionary<string, string>())
            if (!request.Headers.TryAddWithoutValidation(name, value)) request.Content?.Headers.TryAddWithoutValidation(name, value);
        using var response = await http.SendAsync(request);
        return new HttpCallResult((int)response.StatusCode, await response.Content.ReadAsStringAsync());
    }
}

/// <summary>ADAPTADOR DE ARQUIVOS em disco local: {root}/{scope}/{id}/{nome}. scope e id são Guids (formato N).</summary>
public class LocalFileStorage(string root) : IFileStorage
{
    public async Task<StoredFile> SaveAsync(string scope, string fileName, Stream content)
    {
        RequireGuid(scope);
        var id = Guid.NewGuid().ToString("N");
        var dir = Directory.CreateDirectory(Path.Combine(root, scope, id));
        var name = Path.GetFileName(fileName);
        await using var output = File.Create(Path.Combine(dir.FullName, name));
        await content.CopyToAsync(output);
        return new StoredFile(id, name);
    }

    public Task<(StoredFile File, Stream Content)?> OpenAsync(string scope, string id)
    {
        RequireGuid(scope);
        var dir = Path.Combine(root, scope, id);
        var path = Guid.TryParseExact(id, "N", out _) && Directory.Exists(dir) ? Directory.GetFiles(dir).FirstOrDefault() : null;
        return Task.FromResult<(StoredFile, Stream)?>(path is null ? null : (new StoredFile(id, Path.GetFileName(path)), File.OpenRead(path)));
    }

    private static void RequireGuid(string value)
    {
        if (!Guid.TryParseExact(value, "N", out _)) throw new ValidationException("Escopo de arquivo inválido.");
    }
}

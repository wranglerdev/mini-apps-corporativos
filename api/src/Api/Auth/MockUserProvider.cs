using Domain;

namespace Api.Auth;

// ============================================================================================
// MOCK DE AUTENTICAÇÃO — esta pasta (Api/Auth) é descartada na migração.
// O usuário logado é o "currentUser" de mock-auth.json (raiz do repositório). O arquivo é relido a
// cada request: edite, salve e recarregue a página. Ver DOCS/TROCA-DE-ADAPTADORES.md.
// ============================================================================================

public class MockAuthFile
{
    public string CurrentUser { get; set; } = "";
    public List<CurrentUser> Users { get; set; } = [];
}

public class MockUserProvider(IConfiguration config, IWebHostEnvironment env) : IUserProvider
{
    private CurrentUser? _cached; // scoped: lido uma vez por request

    public CurrentUser GetCurrentUser() => _cached ??= Load();

    private CurrentUser Load()
    {
        var path = Path.GetFullPath(Path.Combine(env.ContentRootPath, config["MockAuth:File"] ?? "../../../mock-auth.json"));
        if (!File.Exists(path)) throw new UnauthorizedException($"Arquivo de mock não encontrado: {path}");

        var file = JsonUtil.Deserialize<MockAuthFile>(File.ReadAllText(path));
        return file.Users.FirstOrDefault(u => u.Email.Equals(file.CurrentUser, StringComparison.OrdinalIgnoreCase))
               ?? throw new UnauthorizedException($"currentUser '{file.CurrentUser}' não existe em mock-auth.json.");
    }
}

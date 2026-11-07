using Domain;
using Infra;
using Microsoft.EntityFrameworkCore;

namespace Tests;

/// <summary>Busca, paginação e agregação no servidor (jornada 2: usuário encontra registros em tabelas grandes).</summary>
public class ServerQueryTests
{
    private static async Task<(World W, App App, TableDef Table)> WithRecordsAsync(int count)
    {
        var w = new World();
        var (app, table) = await w.CreateRhAppAsync();
        for (var i = 1; i <= count; i++)
            await w.RecordService.CreateAsync(app.Id, Env.Prod, table.Id, new Dictionary<string, string?>
            {
                ["Título"] = i % 3 == 0 ? $"Solicitação {i}" : $"Pedido {i}",
                ["Custo interno"] = i == 1 ? "987654" : null
            });
        return (w, app, table);
    }

    [Fact]
    public async Task Pagina_os_mais_recentes_primeiro_e_informa_total()
    {
        var (w, app, table) = await WithRecordsAsync(45);

        var p3 = await w.RecordService.QueryAsync(app.Id, Env.Prod, table.Id, null, 3, 20);

        Assert.Equal((45, 3, 3, 5), (p3.Total, p3.Pages, p3.Page, p3.Items.Count));
    }

    [Fact]
    public async Task Busca_ignora_acentos_e_maiusculas()
    {
        var (w, app, table) = await WithRecordsAsync(45);

        var r = await w.RecordService.QueryAsync(app.Id, Env.Prod, table.Id, "SOLICITACAO", 1, 100);

        Assert.Equal(15, r.Total);
        Assert.All(r.Items, i => Assert.StartsWith("Solicitação", i.Data["Título"]));
    }

    [Fact]
    public async Task Usuario_nao_encontra_registro_buscando_valor_de_campo_oculto()
    {
        var (w, app, table) = await WithRecordsAsync(3);

        Assert.Equal(1, (await w.RecordService.QueryAsync(app.Id, Env.Prod, table.Id, "987654", 1, 20)).Total); // builder
        w.As(FakeUsers.UserRh);
        Assert.Equal(0, (await w.RecordService.QueryAsync(app.Id, Env.Prod, table.Id, "987654", 1, 20)).Total);
    }

    [Fact]
    public async Task Pagina_alem_do_fim_volta_para_a_ultima_e_tamanho_e_limitado()
    {
        var (w, app, table) = await WithRecordsAsync(25);

        var r = await w.RecordService.QueryAsync(app.Id, Env.Prod, table.Id, null, 99, 10);
        Assert.Equal((3, 5), (r.Page, r.Items.Count));

        var big = await w.RecordService.QueryAsync(app.Id, Env.Prod, table.Id, null, 1, 10_000);
        Assert.Equal(RecordService.MaxPageSize, big.Size);
    }

    [Fact]
    public async Task Resumo_conta_por_valor_e_recusa_campo_oculto_para_usuario()
    {
        var (w, app, table) = await WithRecordsAsync(4);
        var first = w.Records.Items.First();
        first.Data["Status"] = "Aprovado";

        var summary = await w.RecordService.SummaryAsync(app.Id, Env.Prod, table.Id, "Status");
        Assert.Equal([new GroupCount(null, 3), new GroupCount("Aprovado", 1)], summary);

        w.As(FakeUsers.UserRh);
        await Assert.ThrowsAsync<ValidationException>(() => w.RecordService.SummaryAsync(app.Id, Env.Prod, table.Id, "Custo interno"));
    }
}

/// <summary>
/// Contrato do repositório SQLite REAL (arquivo temporário): o SQL de busca/agregação precisa se comportar como o fake.
/// Ao trocar o banco, reescreva esta suíte para o novo repositório.
/// </summary>
public class SqliteRecordRepositoryTests : IAsyncLifetime
{
    private readonly string path = Path.Combine(Path.GetTempPath(), $"records-{Guid.NewGuid():N}.db");
    private AppDbContext db = null!;
    private RecordRepository repo = null!;
    private readonly Guid appId = Guid.NewGuid();

    public async Task InitializeAsync()
    {
        db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite($"Data Source={path}").AddInterceptors(new SqliteFunctions()).Options);
        await db.Database.EnsureCreatedAsync();
        repo = new RecordRepository(db);

        var t0 = new DateTime(2026, 1, 1);
        var rows = new (string Titulo, string? Status, string? Oculto)[]
        {
            ("Solicitação de férias", "Aprovado", null),
            ("SOLICITACAO de notebook", "Pendente", "chave-x"),
            ("Compra 100% urgente", "Pendente", null),
            ("Compra comum", null, null),
            ("Reunião_geral", "Aprovado", null)
        };
        for (var i = 0; i < rows.Length; i++)
            await repo.AddAsync(new DataRecord
            {
                AppId = appId, Env = Env.Prod, TableId = "t", CreatedAt = t0.AddMinutes(i),
                Data = new() { ["Título"] = rows[i].Titulo, ["Status"] = rows[i].Status, ["Oculto"] = rows[i].Oculto }
            });
        await repo.AddAsync(new DataRecord { AppId = appId, Env = Env.Draft, TableId = "t", Data = new() { ["Título"] = "Solicitação rascunho" } });
    }

    public async Task DisposeAsync()
    {
        await db.DisposeAsync();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        File.Delete(path);
    }

    private Task<(List<DataRecord> Items, int Total)> Query(string? search, int skip = 0, int take = 10, params string[] fields) =>
        repo.QueryAsync(new RecordQuery(appId, Env.Prod, "t", search, fields.Length > 0 ? fields : ["Título", "Status"], skip, take));

    [Fact]
    public async Task Busca_sem_acento_e_sem_maiuscula_no_banco()
    {
        var (items, total) = await Query("solicitação");
        Assert.Equal(2, total);
        Assert.All(items, r => Assert.Contains("olicita", r.Data["Título"], StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Busca_respeita_os_campos_informados()
    {
        Assert.Equal(0, (await Query("chave-x")).Total);
        Assert.Equal(1, (await Query("chave-x", fields: ["Oculto"])).Total);
    }

    [Fact]
    public async Task Curingas_do_like_sao_tratados_como_texto()
    {
        Assert.Equal(1, (await Query("100%")).Total);
        Assert.Equal(1, (await Query("_geral")).Total);
    }

    [Fact]
    public async Task Pagina_em_ordem_de_criacao_decrescente_e_isola_ambiente()
    {
        var (page1, total) = await Query(null, 0, 2);
        var (page3, _) = await Query(null, 4, 2);

        Assert.Equal(5, total); // o registro do rascunho não entra
        Assert.Equal(["Reunião_geral", "Compra comum"], page1.Select(r => r.Data["Título"]));
        Assert.Equal(["Solicitação de férias"], page3.Select(r => r.Data["Título"]));
    }

    [Fact]
    public async Task Agrega_por_campo_no_banco_incluindo_vazios()
    {
        var counts = (await repo.CountByAsync(appId, Env.Prod, "t", "Status")).OrderBy(c => c.Label).ToList();
        Assert.Equal([new GroupCount(null, 1), new GroupCount("Aprovado", 2), new GroupCount("Pendente", 2)], counts);
    }
}

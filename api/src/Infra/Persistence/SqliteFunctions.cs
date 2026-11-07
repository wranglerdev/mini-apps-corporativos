using System.Data.Common;
using Domain;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Infra;

/// <summary>
/// Registra funções usadas nas consultas SQL do repositório a cada conexão aberta pelo EF.
/// norm(texto) = TextSearch.Normalize (sem acento, minúsculas) — a mesma regra do domínio.
/// [TROCA] Em outro banco: COLLATE accent-insensitive (SQL Server), unaccent (PostgreSQL) etc.
/// </summary>
public class SqliteFunctions : DbConnectionInterceptor
{
    public override void ConnectionOpened(DbConnection connection, ConnectionEndEventData eventData) => Register(connection);

    public override Task ConnectionOpenedAsync(DbConnection connection, ConnectionEndEventData eventData, CancellationToken ct = default)
    {
        Register(connection);
        return Task.CompletedTask;
    }

    private static void Register(DbConnection connection) =>
        ((SqliteConnection)connection).CreateFunction("norm", (string? s) => s is null ? null : TextSearch.Normalize(s), isDeterministic: true);
}

using Domain;

namespace Tests;

/// <summary>Containers aninhados e visibilidade condicional (jornada 1: builder monta layouts).</summary>
public class LayoutTests
{
    private static ComponentDef Box(params ComponentDef[] children) => new() { Type = ComponentDef.Container, Children = [.. children] };
    private static ComponentDef Text() => new() { Type = "text" };

    private static async Task<(World W, App App)> AppAsync()
    {
        var w = new World().As(FakeUsers.BuilderRh);
        return (w, await w.AppService.CreateAsync(w.Rh.Id, "Layout", null));
    }

    private static Task Save(World w, App app, params ComponentDef[] components)
    {
        var draft = AppDefinition.Blank();
        draft.Pages[0].Components = [.. components];
        return w.AppService.UpdateAsync(app.Id, new AppChanges(app.Name, null, draft, false, false, null));
    }

    [Fact]
    public async Task Container_aninhado_com_visibilidade_e_salvo_e_publicado_intacto()
    {
        var (w, app) = await AppAsync();
        var gerente = new ComponentDef
        {
            Type = "text", Props = { ["text"] = "Só gestores" },
            VisibleWhen = new ConditionDef { Field = "user.canManage", Op = "eq", Value = "true" }
        };
        await Save(w, app, Box(Text(), Box(gerente)));
        await w.AppService.PublishAsync(app.Id);

        var inner = app.Published!.Pages[0].Components[0].Children[1].Children[0];
        Assert.Equal("Só gestores", inner.Props["text"]);
        Assert.Equal("user.canManage", inner.VisibleWhen!.Field);
    }

    [Fact]
    public async Task Somente_container_pode_ter_filhos()
    {
        var (w, app) = await AppAsync();
        var invalid = new ComponentDef { Type = "card", Children = [Text()] };
        var ex = await Assert.ThrowsAsync<ValidationException>(() => Save(w, app, invalid));
        Assert.Contains("só containers", ex.Message);
    }

    [Fact]
    public async Task Limita_profundidade_de_containers()
    {
        var (w, app) = await AppAsync();
        await Save(w, app, Box(Box(Box(Text())))); // 4 níveis: ok
        await Assert.ThrowsAsync<ValidationException>(() => Save(w, app, Box(Box(Box(Box(Text())))))); // 5
    }

    [Fact]
    public async Task Ids_de_componentes_nao_podem_repetir_em_niveis_diferentes()
    {
        var (w, app) = await AppAsync();
        var a = Text();
        var dup = new ComponentDef { Id = a.Id, Type = "text" };
        await Assert.ThrowsAsync<ValidationException>(() => Save(w, app, a, Box(dup)));
    }
}

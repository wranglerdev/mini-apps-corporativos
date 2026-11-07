using System.Text.Json;
using Domain;

namespace Tests;

/// <summary>
/// Condições com várias regras (E/OU). Mesmos casos de web/src/app/features/runtime/visibility.spec.ts:
/// Conditions.Evaluate (workflows) e evaluate (visibilidade) precisam se comportar igual.
/// </summary>
public class ConditionTests
{
    private static readonly Dictionary<string, string?> Vars = new(StringComparer.OrdinalIgnoreCase)
    {
        ["tipo"] = "Compra", ["valor"] = "1500", ["limite"] = "1000", ["user.department"] = "RH"
    };

    private static ConditionDef When(string join, params (string Field, string Op, string? Value)[] rules) => new()
    {
        Field = rules[0].Field, Op = rules[0].Op, Value = rules[0].Value, Join = join,
        More = [.. rules.Skip(1).Select(r => new ConditionRule { Field = r.Field, Op = r.Op, Value = r.Value })]
    };

    [Fact]
    public void E_exige_todas_as_regras_e_OU_basta_uma()
    {
        Assert.True(Conditions.Evaluate(When("and", ("tipo", "eq", "compra"), ("valor", "gt", "{{limite}}")), Vars));
        Assert.False(Conditions.Evaluate(When("and", ("tipo", "eq", "compra"), ("valor", "lt", "200")), Vars));
        Assert.True(Conditions.Evaluate(When("or", ("tipo", "eq", "Viagem"), ("user.department", "eq", "rh")), Vars));
        Assert.False(Conditions.Evaluate(When("or", ("tipo", "eq", "Viagem"), ("valor", "empty", null)), Vars));
    }

    [Fact]
    public void Regras_sem_campo_sao_ignoradas_e_condicao_vazia_sempre_vale()
    {
        Assert.True(Conditions.Evaluate(When("and", ("", "eq", "x"), ("tipo", "eq", "Compra")), Vars));
        Assert.False(Conditions.Evaluate(When("or", ("", "eq", "x"), ("tipo", "eq", "Viagem")), Vars));
        Assert.True(Conditions.Evaluate(When("or", ("", "eq", "x"), ("", "eq", "y")), Vars));
    }

    [Fact]
    public void Definicao_antiga_com_uma_regra_continua_valendo()
    {
        var old = JsonSerializer.Deserialize<ConditionDef>("""{"field":"tipo","op":"eq","value":"Compra"}""", JsonUtil.Options)!;

        Assert.Equal(ConditionDef.And, old.Join);
        Assert.Empty(old.More);
        Assert.True(Conditions.Evaluate(old, Vars));
    }
}

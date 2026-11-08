using System.Text.Json.Nodes;
using Domain;
using Infra;

namespace Tests;

/// <summary>Projetos de demonstração do seed: precisam subir válidos, senão a API não sobe com o banco limpo.</summary>
public class SeedTests
{
    private static readonly List<ShowcaseProject> Projects = Showcase.Projects(new DateTime(2026, 11, 9));

    [Fact]
    public void Todos_os_projetos_sao_validos_e_os_registros_passam_na_validacao()
    {
        foreach (var p in Projects)
        {
            p.Definition.Validate();
            foreach (var r in p.Records) RecordValidator.Normalize(r.Data, p.Definition.Table(r.TableId).Fields, partial: false);
        }
    }

    [Fact]
    public void Tem_mini_app_formulario_e_workflow_em_cada_area()
    {
        foreach (var dept in new[] { "RH", "TI", "Financeiro" })
        {
            var kinds = Projects.Where(p => p.Department == dept).Select(p => ProjectKinds.Of(p.Definition)).ToHashSet();
            Assert.Equal([ProjectKinds.App, ProjectKinds.Form, ProjectKinds.Workflow], kinds.Order());
        }
    }

    [Fact]
    public void Iniciar_workflow_aponta_para_workflow_chamado_da_mesma_area_com_as_entradas_certas()
    {
        var starts = Projects.SelectMany(p => p.Definition.Workflows.SelectMany(w => ActionDef.Flatten(w.Actions))
            .Where(a => a.Type == Actions.StartFlow).Select(a => (Source: p, Action: a))).ToList();
        Assert.Equal(2, starts.Count);
        foreach (var (source, action) in starts)
        {
            var target = Projects.Single(p => p.Id.ToString() == action.Params["flowId"]);
            Assert.Equal(source.Department, target.Department);
            var trigger = target.Definition.Workflows[0].Trigger;
            Assert.Equal(Triggers.Call, trigger.Type);
            Assert.Equal(trigger.Inputs.Select(i => i.Name).Order(), action.Values.Keys.Order());
        }
    }

    [Fact]
    public void Execucoes_na_fila_tem_entradas_do_tipo_certo()
    {
        foreach (var p in Projects.Where(p => p.Runs.Count > 0))
        {
            var trigger = p.Definition.Workflows[0].Trigger;
            foreach (var (kind, data, _) in p.Runs)
            {
                Assert.Equal(trigger.Type, kind);
                if (kind == Triggers.Call)
                    Variables.InitInputs(new Dictionary<string, string?>(), trigger.Inputs, JsonNode.Parse(data)!["input"] as JsonObject);
            }
        }
    }
}

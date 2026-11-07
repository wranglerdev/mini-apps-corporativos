namespace Domain;

/// <summary>
/// Formulário (projeto do tipo "form", ver DOCS/PRD-FORMS.md). Vive dentro do AppDefinition: as respostas são uma
/// tabela comum (TableId) e cada pergunta aponta para um campo dela. Assim publicação, versões, permissões,
/// exportação e automações são as mesmas dos mini apps.
/// </summary>
public class FormDef
{
    public string TableId { get; set; } = "";
    public List<QuestionDef> Questions { get; set; } = [];
    public string WelcomeTitle { get; set; } = "";
    public string WelcomeText { get; set; } = "";
    public string EndTitle { get; set; } = "Resposta enviada";
    public string EndText { get; set; } = "Obrigado!";
    /// <summary>Opcional: para onde ir depois de enviar.</summary>
    public string? RedirectUrl { get; set; }
    /// <summary>Link público: qualquer pessoa com o link responde, sem login. Vale para a versão publicada.</summary>
    public bool Public { get; set; }
}

public class QuestionDef
{
    public string Id { get; set; } = Ids.New();
    public string FieldId { get; set; } = "";
    /// <summary>Ver QuestionKinds. Define o campo (tipo) e a forma de responder (ex.: escala).</summary>
    public string Kind { get; set; } = QuestionKinds.Short;
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    /// <summary>Lógica de pulo: a primeira regra que bater decide para onde ir. Sem regra = próxima pergunta.</summary>
    public List<JumpDef> Jumps { get; set; } = [];
}

/// <summary>"Se a resposta desta pergunta [Op] [Value], ir para [GoTo]" (id de pergunta seguinte ou "end").</summary>
public class JumpDef
{
    public string Op { get; set; } = "eq";
    public string? Value { get; set; }
    public string GoTo { get; set; } = FormFlow.End;
}

public static class QuestionKinds
{
    public const string Short = "short";
    public const string Long = "long";
    public const string Email = "email";
    public const string Number = "number";
    public const string Date = "date";
    public const string Choice = "choice";
    public const string YesNo = "yesno";
    public const string Scale = "scale";
    public const string File = "file";

    public static readonly string[] All = [Short, Long, Email, Number, Date, Choice, YesNo, Scale, File];
    public static readonly string[] YesNoOptions = ["Sim", "Não"];

    /// <summary>Tipo do campo da tabela de respostas que cada tipo de pergunta usa.</summary>
    public static FieldType FieldTypeOf(string kind) => kind switch
    {
        Number or Scale => FieldType.Number,
        Date => FieldType.Date,
        Choice or YesNo => FieldType.Select,
        File => FieldType.File,
        _ => FieldType.Text
    };
}

/// <summary>
/// Caminho do respondente pelas perguntas. MESMA regra de web/src/app/features/forms/form-flow.ts
/// (mudou uma, mude a outra e os dois testes). Pulos só vão para frente, então o caminho sempre termina.
/// </summary>
public static class FormFlow
{
    public const string End = "end";

    /// <summary>Perguntas que o respondente vê, na ordem, dadas as respostas (por nome de campo).</summary>
    public static List<QuestionDef> Path(FormDef form, TableDef table, IReadOnlyDictionary<string, string?> answers)
    {
        var path = new List<QuestionDef>();
        var i = 0;
        while (i >= 0 && i < form.Questions.Count)
        {
            var q = form.Questions[i];
            path.Add(q);
            i = NextIndex(form, table, i, answers);
        }
        return path;
    }

    /// <summary>Índice da próxima pergunta depois de `index` (-1 = fim).</summary>
    public static int NextIndex(FormDef form, TableDef table, int index, IReadOnlyDictionary<string, string?> answers)
    {
        var q = form.Questions[index];
        var field = table.Fields.FirstOrDefault(f => f.Id == q.FieldId);
        foreach (var jump in q.Jumps)
        {
            var condition = new ConditionDef { Field = field?.Name ?? "", Op = jump.Op, Value = jump.Value };
            if (field is null || !Conditions.Evaluate(condition, answers)) continue;
            if (jump.GoTo == End) return -1;
            var target = form.Questions.FindIndex(x => x.Id == jump.GoTo);
            return target > index ? target : index + 1;
        }
        return index + 1 < form.Questions.Count ? index + 1 : -1;
    }

    /// <summary>Problemas de definição do formulário (vazio = válido).</summary>
    public static List<string> Problems(FormDef form, IReadOnlyList<TableDef> tables)
    {
        var errors = new List<string>();
        var table = tables.FirstOrDefault(t => t.Id == form.TableId);
        if (table is null) return ["O formulário precisa da tabela de respostas."];
        if (form.Questions.Count == 0) errors.Add("O formulário precisa de ao menos uma pergunta.");
        if (form.Questions.GroupBy(q => q.Id).Any(g => g.Count() > 1)) errors.Add("Perguntas com id repetido.");
        if (form.Questions.GroupBy(q => q.FieldId).Any(g => g.Count() > 1)) errors.Add("Duas perguntas gravam no mesmo campo.");

        for (var i = 0; i < form.Questions.Count; i++)
        {
            var q = form.Questions[i];
            var label = $"Pergunta {i + 1}";
            if (string.IsNullOrWhiteSpace(q.Title)) errors.Add($"{label}: escreva a pergunta.");
            if (!QuestionKinds.All.Contains(q.Kind)) errors.Add($"{label}: tipo inválido.");
            var field = table.Fields.FirstOrDefault(f => f.Id == q.FieldId);
            if (field is null) { errors.Add($"{label}: campo da resposta não existe."); continue; }
            if (field.Type != QuestionKinds.FieldTypeOf(q.Kind)) errors.Add($"{label}: o campo '{field.Name}' não combina com o tipo da pergunta.");
            foreach (var jump in q.Jumps)
            {
                if (jump.GoTo == End) continue;
                var target = form.Questions.FindIndex(x => x.Id == jump.GoTo);
                if (target < 0) errors.Add($"{label}: a lógica aponta para uma pergunta que não existe.");
                else if (target <= i) errors.Add($"{label}: a lógica só pode pular para uma pergunta seguinte.");
            }
        }
        return errors;
    }
}

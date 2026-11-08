# 0017. Variáveis tipadas no workflow, com apelido e Transformar por operações

- **Data:** 2026-11-08
- **Status:** Aceito
- **Tipo:** feature

## Contexto
Nos workflows, tudo era texto `{{caminho}}`: sem tipo, sem padrão e sem nome curto. Era preciso repetir caminhos
longos (`{{steps.api1.body.cliente.nome}}`) sem ajuda para descobri-los. O "Transformar" era um mapa livre nome → texto.

## Decisão
- `WorkflowDef.Variables`: `VariableDef { Name, Type, Default, From }`. Tipos primitivos: texto, número, sim/não, data,
  lista, objeto. Usa-se como `{{nome}}`. Vazia vale o padrão; sem padrão, o vazio do tipo (`""`, `0`, `false`, `[]`, `{}`).
- **Apelido** (`From`): nome curto para um caminho (`steps.api1.body`, `trigger.body`). O valor é reaplicado depois de
  cada passo e só aparece no editor onde o caminho já existe; antes disso vale o padrão. Não é destino do Transformar.
- **Transformar** ganha `ActionDef.Ops` (`TransformOp { Target, Op, Input, Arg }`): operações pequenas em ordem (geral,
  texto, número, lista, objeto, data), cada uma grava numa variável convertendo para o tipo dela. Valor incompatível
  falha o passo com mensagem clara. Uma operação nova = uma linha em `TransformOps` (back) e em `TRANSFORM_OPS` (front).
  O formato antigo (`Values`) continua valendo.
- Editor: autocomplete no `ui-input` (`[suggestions]`, abre ao digitar `{{`; modo `path` para caminhos), alimentado
  pelo que existe no ponto selecionado, com os caminhos reais do último teste. As variáveis do painel podem ser
  arrastadas para os campos (texto `{{nome}}`); passar o mouse mostra um tooltip com o tipo, a origem, o valor quando vazia e o valor no último teste (`testValue`). O tooltip é medido depois de renderizar e troca de lado para caber inteiro na tela (`ui/placement.ts`, `placeBeside`). "Guardar resposta/corpo em variável" cria o apelido em um clique.
- Descartado: tipos compostos (esquema de objeto) e expressões livres (fórmulas). Ficam caros de validar e explicar,
  e as operações cobrem os casos do MVP.

## Consequências
- Renomear variável ou passo atualiza `{{…}}`, caminhos de condição, apelidos e destinos das operações.
- Variáveis existem só nos projetos de workflow; formulários e containers de mini app ficam para o próximo incremento,
  reaproveitando `VariableDef` e o autocomplete.
- O tipo é validado ao gravar (Transformar/apelido), não em cada `{{}}` de texto, que continua sendo texto.

**Arquivos:** `api/src/Domain/Flows/Variables.cs`, `api/src/Domain/Flows/FlowRunner.cs`, `api/src/Domain/Flows/FlowRules.cs`,
`api/src/Domain/Apps/AppDefinition.cs`, `api/tests/Tests/VariableTests.cs`, `web/src/app/ui/completion.ts`, `web/src/app/ui/placement.ts`,
`web/src/app/ui/ui.ts`, `web/src/app/features/flows/flow-ops.ts`, `web/src/app/features/flows/flow-tab.ts`,
`web/src/app/features/builder/condition-editor.ts`

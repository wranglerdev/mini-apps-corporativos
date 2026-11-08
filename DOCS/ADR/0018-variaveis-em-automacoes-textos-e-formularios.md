# 0018. Variáveis nas automações, nos textos do mini app e nos formulários

- **Data:** 2026-11-08
- **Status:** Aceito
- **Tipo:** feature

## Contexto
O ADR 0017 criou as variáveis tipadas, o apelido, o Transformar por operações, o autocomplete `{{` e os chips
arrastáveis só nos projetos de workflow. Mini apps e formulários continuavam com `{{campo}}` digitado de memória, sem
variável própria, e os textos exibidos (títulos, perguntas) não aceitavam variáveis.

## Decisão
- **Automações** (mini app e formulário, `WorkflowEngine`): mesmo `WorkflowDef.Variables` e mesmo Transformar
  (`Variables.ApplyOps`, compartilhado com o `FlowRunner`). As variáveis começam com o padrão e os apelidos são reaplicados
  depois de cada passo (ex.: apelido de `api.response`). Uma variável não pode ter o nome de um campo de tabela ou de um
  input (esconderia o contexto). Se, para cada e esperar continuam só nos projetos de workflow.
- **Contexto por ponto** (`automationVarsAt`): campos do registro (ou respostas, no formulário) nos gatilhos de registro,
  inputs das páginas no clique, now/today no agendado, `user.*`, e `api.status`/`api.response` só depois de um Chamar API.
- **Textos do mini app**: texto, card, título de container e rótulo de botão trocam `{{variável}}` no app rodando
  (`render` em `runtime/visibility.ts`, espelho de `Template.Render`); no editor aparecem como foram escritos. Variáveis:
  inputs das páginas e `user.*` (aba Variáveis do painel esquerdo do design).
- **Formulários**: título, descrição e tela final citam respostas anteriores (`{{coluna}}`); cada pergunta só oferece as
  perguntas anteriores (`answerVarsAt`). Só exibição no navegador; o envio não muda.
- Um só conjunto de peças no editor: `variable-ops.ts` (regras), `VarPanel` (chips, tooltip), `VarEditor` e
  `TransformOpsEditor`, usados no workflow, nas automações, no design e no formulário.
- Descartado: variáveis de estado da página (setar valor por botão, como "custom states") e variáveis declaradas no
  formulário. Pedem execução no navegador e um segundo motor de regras; os inputs e as respostas já cobrem a exibição.

## Consequências
- Renomear variável atualiza referências também nas automações (condição do gatilho inclusive).
- Resposta pulada pela lógica de pulo fica vazia no texto; tela final pode citar qualquer resposta.
- Campo com espaço no nome funciona (`{{Nome completo}}`), mas o autocomplete fecha ao digitar o espaço; escolher da lista resolve.

**Arquivos:** `api/src/Domain/Flows/Variables.cs`, `api/src/Domain/Workflows/WorkflowEngine.cs`, `api/src/Domain/Apps/AppDefinition.cs`,
`web/src/app/features/builder/variable-ops.ts`, `web/src/app/features/builder/var-panel.ts`, `web/src/app/features/builder/var-editor.ts`,
`web/src/app/features/builder/transform-ops-editor.ts`, `web/src/app/features/builder/workflows-tab.ts`, `web/src/app/features/builder/design-tab.ts`,
`web/src/app/features/runtime/visibility.ts`, `web/src/app/features/runtime/rendered-component.ts`, `web/src/app/features/forms/form-ops.ts`,
`web/src/app/features/forms/form-tab.ts`, `web/src/app/features/forms/form-runner.ts`

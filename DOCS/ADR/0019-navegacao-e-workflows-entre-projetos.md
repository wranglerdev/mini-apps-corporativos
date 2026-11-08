# 0019. Navegação e workflows entre projetos (mini app, formulário e workflow)

- **Data:** 2026-11-08
- **Status:** Aceito
- **Tipo:** feature

## Contexto
Mini apps, formulários e workflows só enxergavam as próprias páginas, tabelas e automações. Ir de um mini app para um
formulário exigia colar URL; tratar a resposta de um formulário num workflow exigia chamar o webhook com a chave à mão
(o "Chamar API" das automações nem mostrava cabeçalhos). O formulário só redirecionava para http(s) fixo.

## Decisão
- **Gatilho "Chamado por outro projeto"** (`Triggers.Call`) nos projetos de workflow, com **esquema de entradas**
  (`TriggerDef.Inputs`, o mesmo `VariableDef` das variáveis): chegam como `{{input.nome}}` já no tipo (vazia = padrão;
  fora do tipo falha o gatilho com mensagem clara). `{{trigger.source}}` e `{{trigger.user}}` dizem quem chamou.
- **Ação "Iniciar workflow"** (`startFlow`) nas automações de mini app e formulário: escolhe um workflow do mesmo
  workspace e mapeia valores para as entradas (ao escolher, liga sozinho as de mesmo nome: `nome ← {{Nome}}`). Enfileira
  no **mesmo ambiente** (teste chama o rascunho; produção, a versão publicada) via `FlowQueue`, a mesma fila do workflow.
- **Ação "Abrir projeto ou link"** (`openLink`) nas automações de clique: formulário ou mini app do workspace (endereço
  do ambiente: `/f`, `/run` ou as prévias) ou link http(s)/`/caminho`, com valores pré-preenchidos na query string
  (escapados). O formulário e o mini app leem esses valores e preenchem as perguntas/inputs de mesmo nome.
- **Formulário**: depois de enviar, ficar, link (aceita `{{respostas}}`, escapadas) ou projeto; **regras condicionais**
  (`RedirectRules`, `ConditionDef` sobre as respostas) avaliadas no servidor, a primeira que bater decide. Atalho
  "Enviar respostas para um workflow" cria a automação "registro criado → Iniciar workflow".
- Segurança: só projetos do mesmo workspace; só http(s) ou caminho do site (nada de `javascript:` nem `//host`),
  conferido ao salvar e de novo depois de montar o endereço.
- Descartado: ler/gravar dados de outro projeto a partir do workflow (fase 3, fora do escopo) e um gatilho que observa a
  tabela de outro projeto diretamente (acopla os projetos; a ação explícita deixa claro quem chama quem).

## Consequências
- Mini app → formulário → workflow → (redirect) mini app funciona sem URL colada nem chave de webhook.
- O destino é guardado por id: renomear o projeto não quebra; excluir ou despublicar faz a ação falhar com mensagem
  (o redirecionamento do formulário cai na tela final). Ainda não há "Usado por" mostrando quem aponta para um projeto.
- `WorkflowEngine` passa a depender de `IAppRepository` e `IRunStore` (portas já existentes; sem adaptador novo).

**Arquivos:** `api/src/Domain/Apps/Links.cs`, `api/src/Domain/Apps/AppDefinition.cs`, `api/src/Domain/Workflows/WorkflowEngine.cs`,
`api/src/Domain/Flows/FlowService.cs`, `api/src/Domain/Flows/FlowRunner.cs`, `api/src/Domain/Flows/Variables.cs`,
`api/src/Domain/Forms/FormDefinition.cs`, `api/src/Domain/Forms/FormService.cs`, `api/tests/Tests/ProjectLinkTests.cs`,
`web/src/app/features/runtime/links.ts`, `web/src/app/features/runtime/run-context.ts`, `web/src/app/features/runtime/app-runner.ts`,
`web/src/app/features/forms/form-runner.ts`, `web/src/app/features/forms/form-tab.ts`, `web/src/app/features/forms/form-share-tab.ts`,
`web/src/app/features/builder/workflows-tab.ts`, `web/src/app/features/builder/variable-ops.ts`, `web/src/app/features/flows/flow-tab.ts`

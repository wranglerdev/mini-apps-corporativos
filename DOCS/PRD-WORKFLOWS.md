# PRD — Workflows (inspirado em n8n / trigger.dev)

Status: **MVP implementado em 2026-11-07** (ver tabela abaixo e [ADR 0014](ADR/0014-workflows-com-fila-e-historico.md)). Complementa o [PRD principal](PRD.md).

## Problema

Os workflows de hoje existem só dentro de um mini app e servem para reagir ao app (clique, registro, agendado,
webhook). Para virar a ferramenta de automação da empresa (o que hoje as áreas resolvem com n8n, Power Automate,
Zapier ou scripts soltos em servidores), faltam três coisas:

1. **Workflow como projeto próprio**, sem precisar de páginas: "todo dia às 8h, buscar na API X e mandar resumo".
2. **Confiabilidade**: hoje a execução é síncrona, sem fila, sem retry, sem timeout por passo e sem histórico.
   Se falhar, só aparece `workflow.error` na auditoria.
3. **Expressividade**: uma condição só, sem loop, sem passar o resultado de um passo para o próximo.

## Objetivo

Builder monta um fluxo **gatilho → passos** que roda em background, sobrevive a falhas, mostra o histórico de cada
execução passo a passo e pode ser reexecutado, com a infra (fila, worker, segredos, logs) cuidada pelo time central.

## Princípio de modelagem (KISS)

Um workflow **é um projeto**: `App.Kind = workflow`. Reaproveita workspace, rascunho × produção, versões, permissões,
auditoria, templates e duplicar. A definição continua um `AppDefinition` com `Workflows` (e tabelas opcionais, para
guardar estado). O motor (`WorkflowEngine`) é o mesmo para workflows de mini apps e formulários; eles ganham as
melhorias automaticamente.

## Personas

| Papel | Faz |
|---|---|
| Builder | Cria, testa com dados de exemplo, publica, vê execuções, reexecuta, gerencia segredos do workspace |
| Admin | Vê execuções de todos, limites de uso, pausa workflow de qualquer área |
| Usuário | Só indireto: recebe e-mails/aprovações; dispara workflows de clique ou formulário |

## Jornadas

1. **Criar**: Início → Novo → Workflow → nome → escolhe gatilho → adiciona passos → "Testar" (roda no rascunho com
   payload de exemplo e mostra a saída de cada passo) → publicar.
2. **Rodar**: gatilho dispara → execução entra na fila → worker executa passo a passo → cada passo grava entrada,
   saída, duração e erro.
3. **Diagnosticar**: aba Execuções → lista (status, gatilho, duração) → abre uma → vê cada passo e o JSON de saída →
   "Reexecutar" (do início ou a partir do passo que falhou).
4. **Integrar com segurança**: guarda token de API como segredo do workspace e usa `{{secrets.NOME}}` no passo, sem
   o valor aparecer na definição, na auditoria nem no histórico.

## Escopo

### MVP do workflow
| Feature | Status | Como ficou |
|---|---|---|
| Tipo de projeto "Workflow" | ✅ | `AppDefinition.Automation` (tipo derivado, sem coluna nova). Um workflow por projeto. Abas Workflow, Execuções, Segredos, Publicação. Não vai ao catálogo |
| Gatilhos | ✅ | Manual ("Executar agora"/"Testar"), agendado (hora/dia/semana ou **cron** de 5 campos) e **webhook** `POST /api/hooks/wf/{appId}` com `X-Webhook-Key` (corpo JSON vira `{{trigger.body.*}}`). Gatilhos de registro ficam para quando o projeto tiver tabelas próprias |
| Passos | ✅ | Chamar API (com **cabeçalhos**), Enviar e-mail, **Se/senão**, **Para cada** (lista JSON, até 1.000 itens), **Esperar** (até 1 h), **Transformar**. Criar/atualizar registro e aprovação ficam nas automações de mini app |
| Saída entre passos | ✅ | Cada passo tem id; `{{steps.<id>.campo}}` (JSON achatado); `callApi` expõe `status` e `body`. Renomear o id atualiza as referências |
| Variáveis | ✅ | `{{nome}}` com tipo (texto, número, sim/não, data, lista, objeto) e padrão; vazia = padrão ou vazio do tipo. **Apelido** de um caminho (`steps.api1.body`, `trigger.body`), visível só onde o caminho existe; "Guardar resposta/corpo em variável" em um clique ([ADR 0017](ADR/0017-variaveis-tipadas-no-workflow.md)) |
| Transformar | ✅ | Operações em ordem, cada uma grava numa variável: definir, se vazio; maiúsculas, minúsculas, tirar espaços, juntar, separar; somar, subtrair, multiplicar, dividir, arredondar; contar, somar itens, primeiro, último, campo de cada item, juntar em texto; pegar campo; somar dias, formatar data. Formato antigo (campos) continua valendo |
| Autocomplete e arrastar | ✅ | Digitar `{{` nos campos sugere o que existe naquele ponto (variáveis, gatilho, saídas anteriores com os caminhos do último teste, item do "para cada"); variáveis do painel podem ser arrastadas para os campos; passar o mouse mostra tipo, origem, valor quando vazia e valor no último teste |
| Condições | ✅ | Várias regras por "se", juntadas por **E** (todas) ou **OU** (qualquer uma), mesmo `ConditionDef` das automações e da visibilidade ([ADR 0015](ADR/0015-condicoes-com-varias-regras-e-ou.md)). Um nível: para misturar E com OU, aninhe "se" |
| Execução assíncrona | ✅ | Porta `IRunStore` (fila = execuções `queued` no banco) + `FlowWorkerHostedService` (1 s, uma execução por vez). Automações de mini app/formulário continuam síncronas (compartilham o código das ações) |
| Histórico | ✅ | `WorkflowRuns` + `RunSteps` (passos, tentativas, esperas, itens; entrada/saída até 16 KB). Retenção de 30 dias. Tela em waterfall |
| Retry | ✅ | Por passo (0–5, padrão 3 em API e 2 em e-mail), espera 1 s, 2 s, 4 s…; API com status ≥ 400 conta como falha |
| Timeout | ✅ | Por passo (padrão 30 s, até 600 s) e por execução (15 min). O tempo limite do passo não cancela a chamada já feita |
| Reexecutar | ✅ | Do início ou a partir de um passo de 1º nível (os anteriores reaproveitam a saída da execução de origem) |
| Segredos | ✅ | Porta `ISecretStore` por workspace; adaptador cifra com AES-GCM da BCL (chave em `data/secrets.key`). Valor nunca volta pela API e aparece como •••• no histórico |
| Alertas | ✅ | Falha final em produção → e-mail para quem criou o projeto |
| Concorrência | ✅ | Um worker, uma execução por vez (global). Várias instâncias exigem fila real |
| Auditoria | ✅ | `workflow.run`, `workflow.fail`, `secret.update`, `secret.delete` (sem valor) |
| Testar com dados de exemplo | 🟡 | "Testar no rascunho" salva, roda na fila (ambiente de teste) e mostra o resultado em cada passo. Chamadas de API do teste vão de verdade (sem confirmação ainda) |

### Depois do MVP
- Editor em grafo (canvas com nós e setas); o MVP é lista vertical com blocos aninhados (se/para cada).
- Conectores dedicados (Sheets, SharePoint, Teams, ERP) como passos prontos sobre `callApi` + segredo.
- Passo de código (JS/C# em sandbox).
- Passo de IA (classificar/extrair/resumir) via porta própria.
- Subworkflows com versão fixa; espera por evento externo ("aguardar aprovação" por dias, retomando a execução).

### Fora de escopo
- Executar código arbitrário sem sandbox; agentes de terceiros rodando na nossa infra.

## Regras e decisões

- Mantém o limite de encadeamento (5 níveis) e acrescenta limite de passos executados por execução (500, cada item do
  "para cada" conta os passos de dentro; `FlowRules.MaxStepsPerRun`) e de itens em "para cada" (1.000).
- Workflow agendado/webhook roda com privilégio de sistema do **projeto** (como hoje); segredos são do workspace e
  só builders do workspace os veem pelo nome, nunca o valor.
- Rascunho roda contra dados de rascunho. Hoje "Testar" executa as ações de verdade, inclusive `callApi` (ver 🟡 na
  tabela); a confirmação antes de chamar API externa no teste está pendente. E-mail no MVP só loga (`LogEmailSender`).
- O histórico guarda saída truncada (ex.: 16 KB por passo) para não virar banco de payloads.

## Testes (por jornada)

- Back (Domain com fakes): enfileirar e executar; saída de um passo disponível no seguinte; se/senão e E/OU; para cada
  com limite; limite de passos por execução; retry com backoff até sucesso e até desistir (alerta enviado); timeout; reexecutar do passo que falhou;
  segredo resolvido e mascarado no histórico; webhook do workflow com payload.
- Front: funções puras do editor (inserir/mover passos aninhados, validar referências `{{steps.x}}`).

## Métricas de sucesso

- Workflows em produção por área; scripts/servidores e licenças (Power Automate/Zapier/n8n) desligados.
- % de execuções com sucesso ≥ 99% (excluindo erro de API externa); tempo médio de diagnóstico de falha.

## Perguntas em aberto

- Qual fila/worker o ambiente corporativo oferece (Service Bus, RabbitMQ, Hangfire)? Define o adaptador de `IRunStore` (hoje a fila são as execuções `queued` no banco).
- Política de egress: quais domínios `callApi` pode chamar (lista permitida por workspace?).
- Onde ficam os segredos no corporativo (Key Vault, CyberArk)?

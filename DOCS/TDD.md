# TDD — Estratégia de testes

Somente testes **unitários**, organizados pelas **jornadas do usuário** (ver PRD). O objetivo é garantir
a jornada, não cobrir linha a linha. Regra: mudou uma regra de jornada → primeiro ajuste/escreva o teste.

## Como rodar

```bash
cd api && dotnet test                 # backend (xUnit)
cd web && npm test                    # frontend (Karma + Jasmine, ChromeHeadless)
```

## Backend — `api/tests/Tests`

Testa o **Domain** com fakes em memória das portas (`Fakes.cs`: `World` monta o grafo de serviços com workspaces
RH/TI e usuários admin/builder/usuário). Sem banco, sem HTTP, sem libs de mock.

| Suíte (JourneyTests.cs) | Jornada | Garante |
|---|---|---|
| `BuildAndPublishTests` | 1. Builder cria e publica | criar só no próprio departamento; usuário não abre editor/rascunho; publicar congela versão; rollback gera nova versão; clonar da Biblioteca sem dados; criar de template; Biblioteca por departamento; definição inválida rejeitada |
| `RecordTests` | 2. Usuário usa o app | validação/normalização por tipo; obrigatórios; campo só-builders invisível e ignorado; permissões de tabela; dados de rascunho × produção separados; CSV export/import com erros por linha |
| `WorkflowTests` | 3. Automação | clique cria registro com inputs + e-mail + navegação; condição falsa não executa; callApi com template |
| `ApprovalTests` | 4. Aprovação | registro vira Pendente, aprovador notificado, aprovação atualiza status e avisa solicitante; só o aprovador decide e uma única vez |
| `AccessRulesTests` | RBAC | matriz de papéis × departamento; app não publicado não abre em produção |

| Suíte (EvolutionTests.cs) | Jornada | Garante |
|---|---|---|
| `ReadOnlyFieldTests` | 2. Usuário usa o app | usuário vê mas não grava campo só leitura |
| `FieldRenameTests` | 1. Builder evolui o app | renomear migra rascunho ao salvar e produção ao publicar; rollback desfaz o renome nos dados |
| `FileTests` | 2. Anexos | upload/download só para quem acessa o app; arquivo de um app não abre por outro |
| `WebhookTests` | Integração | chave certa cria registro em produção e dispara workflow; chave errada/ausente/desligada é bloqueada; app não publicado recusa |

| Suíte (AutomationTests.cs) | Jornada | Garante |
|---|---|---|
| `WorkflowChainTests` | 3. Automação encadeada | registro criado por automação dispara automações da tabela; "executar outra automação" repassa o contexto; ciclo para no limite sem erro (e audita); decisão de aprovação dispara "registro atualizado"; validação recusa executar a si mesmo ou automação inexistente |
| `ScheduleTests` | 3. Automação agendada | próxima execução (hora, dia, semana); validação da configuração; roda só quando vence e uma vez por ocorrência, como "agendador", com `{{today}}`; app não publicado não roda; gestor executa na hora (com `{{today}}`) e usuário não |

| Suíte (LayoutTests.cs) | Jornada | Garante |
|---|---|---|
| `LayoutTests` | 1. Builder monta layouts | container aninhado com visibilidade salva e publica intacto; só container tem filhos; limite de 4 níveis; ids únicos em toda a árvore |

| Suíte (QueryTests.cs) | Jornada | Garante |
|---|---|---|
| `ServerQueryTests` | 2. Usuário encontra registros | paginação (recentes primeiro, total, páginas); busca sem acento/maiúscula; campo oculto não é pesquisável por usuário; página além do fim volta para a última; `size` limitado; resumo por campo e recusa de campo oculto |
| `SqliteRecordRepositoryTests` | Contrato do repositório (SQLite real, arquivo temporário) | busca no banco sem acento; só nos campos pedidos; `%` e `_` tratados como texto; ordem e paginação; isolamento rascunho × produção; agregação com vazios |

| Suíte (FormTests.cs) | Jornada | Garante |
|---|---|---|
| `FormTests` | 6. Formulário | criar nasce com tabela de respostas e pergunta (sem páginas); tipo não muda; caminho segue a lógica de pulo; envio grava só o caminho em produção e dispara automação; obrigatória exigida só no caminho; e-mail/escala inválidos; acesso por departamento; link público grava "anonimo" e a governança desliga; campo-isca não grava; rascunho só para quem gerencia; pulo para trás/inexistente e tipo incompatível recusados; resumo conta aberturas, perguntas e envios (só gestor) |

| Suíte (FlowTests.cs) | Jornada | Garante |
|---|---|---|
| `FlowTests` | 7. Workflow | nasce sem páginas com gatilho manual; saída de um passo alimenta os seguintes com "se" e "para cada"; repetição com espera crescente; esgotadas as tentativas falha, para e avisa quem gerencia; tempo limite; segredo usado em URL e cabeçalho e mascarado no histórico; reexecutar a partir de um passo reaproveita os anteriores; webhook com chave e corpo como variável; agendado por cron enfileira na hora; cálculo e validação de cron; definição inválida recusada; só quem gerencia executa e vê segredos; teste no rascunho e retenção de 30 dias |

| Suíte (SeedTests.cs) | Jornada | Garante |
|---|---|---|
| `SeedTests` | Demonstração | todo projeto do seed valida e seus registros passam no `RecordValidator`; cada área tem mini app, formulário e workflow; "Iniciar workflow" aponta para workflow chamado da mesma área com as entradas certas; execuções na fila têm entradas do tipo do gatilho |

| Suíte (DocumentTests.cs) | Jornada | Garante |
|---|---|---|
| `SpreadsheetTests` | Excel | escreve/lê com acentos, XML especial, vazios e coluna numérica; partes OpenXML obrigatórias; lê arquivo no formato do Excel (sharedStrings, colunas puladas, relação absoluta); arquivo inválido vira erro de validação |
| `PdfReportTests` | Relatório | PDF válido com xref coerente; acentos em WinAnsi e parênteses escapados; quebra de página com "Página X de N"; gráfico com título e cores de status; texto longo quebra em várias linhas; limite de linhas por célula e palavra gigante partida |
| `ExportImportJourneyTests` | 2. Usuário extrai/carrega dados | exporta xlsx e reimporta o mesmo arquivo; data serial do Excel vira data; PDF respeita campos ocultos e formata em pt-BR; formato desconhecido é recusado |

## Frontend — `web/src/**/*.spec.ts`

| Spec | Jornada | Garante |
|---|---|---|
| `features/builder/editor-ops.spec.ts` | 1. Editor | defaults (container nasce vazio); inserir na posição do drop; mover na lista e para dentro/fora de containers; impede container dentro de si; limite de níveis ao inserir e mover; remover em qualquer nível; gerar página de tabela; excluir tabela limpa referências inclusive dentro de containers; descrição dos agendamentos em português; paleta agrupada com cada componente uma vez; resumos dos nós de automação (gatilho, condição, passos); duplicar com ids novos; subir/descer no mesmo pai; caminho e estrutura da árvore |
| `features/runtime/visibility.spec.ts` | Visibilidade | sem condição mostra; variáveis do usuário sem diferenciar maiúsculas; inputs vazios, comparação numérica e `{{variável}}` no valor |
| `shell.spec.ts` | Moldura | navegação segue o papel (usuário, builder, admin); contador de aprovações pendentes; recolher só no editor de um app; ciclo de tema sistema → claro → escuro |
| `features/home/home.spec.ts` | Início | mini app, formulário e workflow disponíveis; link por tipo (/f ou /run); recentes primeiro, limitados e filtrados por tipo, sem alterar a lista; miniatura com até 8 blocos e largura válida |
| `features/forms/form-flow.spec.ts` | 6. Formulário | caminho igual ao backend (mesma pesquisa dos `FormTests`); próxima pergunta e fim; validação antes de avançar; letras das opções; editor: nova pergunta cria o campo, trocar tipo ajusta campo e limpa regras, remover limpa regras que apontavam, mover não deixa pulo para trás, destinos de regra |
| `features/flows/flow-ops.spec.ts` | 7. Workflow | paleta insere no fim, depois do selecionado ou dentro de se/para cada com ids únicos; remover/mover na mesma lista; renomear id atualiza referências e valida; variáveis disponíveis por passo; resumos de gatilho (cron) e passos; linha do tempo em waterfall; resultado por passo no teste |
| `core/auth/auth.spec.ts` | RBAC no front | papéis; permissões de tabela; campos ocultos; campos só leitura fora do formulário |
| `features/runtime/runtime.spec.ts` | 2/3. Runtime | formulário gerado mostra campos visíveis; salvar cria registro, aplica log do workflow, recarrega e navega; erro vira aviso; tabela consulta o servidor, troca de página e busca com espera (uma consulta só, página 1); gráfico com "(vazio)"; data e número da tabela em pt-BR; `isVisible` com usuário/inputs; runner renderiza container e esconde o filho condicional |

## O que não é testado (de propósito)

- Controllers (finos, sem regra). Repositórios EF/SQLite só têm teste de contrato onde há SQL próprio (`SqliteRecordRepositoryTests`).
- Templates visuais/CSS (o design system será trocado).
- Mock de autenticação (descartável).

Ao trocar um adaptador, os testes continuam válidos porque dependem só das portas.

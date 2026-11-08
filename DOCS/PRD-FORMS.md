# PRD — Formulários (inspirado no Typeform)

Status: **MVP implementado em 2026-11-07** (ver tabela abaixo e [ADR 0013](ADR/0013-formularios-implementados.md)). Complementa o [PRD principal](PRD.md).

## Problema

Hoje um formulário só existe dentro de um mini app: é o componente `form` gerado da tabela, com todos os campos de uma
vez, atrás do login. Pesquisas internas, inscrições, checklists de campo e pedidos simples pedem outra experiência:
**uma pergunta por vez, caminho que muda conforme a resposta e um link que qualquer pessoa abre** (inclusive quem
está fora do SSO, quando permitido). Hoje as áreas pagam Typeform/Google Forms/Microsoft Forms para isso, com os
dados saindo do ambiente corporativo.

## Objetivo

Builder cria um formulário em minutos, publica um link, as respostas caem numa tabela do próprio projeto e podem
disparar automações (aprovação, e-mail, chamar API), sem nada de infra por conta da área.

## Princípio de modelagem (KISS)

Um formulário **é um projeto** do mesmo tipo dos mini apps: o `App` ganha `Kind = app | form | workflow`.
Ganha de graça: workspace, rascunho × produção, versões/rollback, permissões por departamento, auditoria,
catálogo, template e duplicar. A definição continua um `AppDefinition`:

- **Respostas = uma tabela** (`TableDef`) criada junto com o formulário. Cada pergunta é um campo.
  Exportar Excel/CSV/PDF, busca e gráficos já funcionam sobre ela.
- **Perguntas = nova lista `Form.Questions`** apontando para os campos (texto da pergunta, ajuda, obrigatório vem do campo).
- **Lógica = `ConditionDef`** (o mesmo formato de workflows e visibilidade). Sem linguagem nova.
- **Automações** = `WorkflowDef` com o gatilho `recordCreated` da tabela de respostas (já existe).

## Personas

| Papel | Faz |
|---|---|
| Builder | Cria, edita perguntas e lógica, publica, vê respostas, exporta, liga automações |
| Respondente (usuário logado) | Abre o link, responde, vê tela de agradecimento |
| Respondente externo | Só quando o builder liga "link público": responde sem login |
| Admin | Vê todos, audita, pode desligar link público de qualquer formulário |

## Jornadas

1. **Criar**: Início → Novo → Formulário → nome → editor de perguntas (adicionar, reordenar, tipo, obrigatório)
   → pré-visualizar → publicar → copiar link `/f/{slug}`.
2. **Responder**: abre o link → tela de boas-vindas → uma pergunta por tela (Enter avança, Voltar) → barra de
   progresso → enviar → tela de agradecimento. Funciona em 390px.
3. **Lógica**: na pergunta, "Se a resposta for X, ir para a pergunta Y" ou "terminar". Sem regra = próxima.
4. **Acompanhar**: aba Respostas (a tabela já existente) + resumo: quantos abriram, quantos enviaram, taxa de
   conclusão e gráfico por pergunta de seleção.
5. **Automatizar**: "Quando chegar resposta" → as ações que já existem (e-mail, aprovação, callApi, criar registro).

## Escopo

### MVP do formulário
| Feature | Status | Como ficou |
|---|---|---|
| Tipo de projeto "Formulário" | ✅ | `App.Kind` **derivado da definição** (`AppDefinition.Form` preenchido = formulário; sem coluna nova). Início cria, filtra e mostra o tipo; Meus apps e Catálogo também. O tipo não muda depois de criado |
| Editor de perguntas | ✅ | Aba Perguntas: lista (boas-vindas, perguntas, tela final), paleta de tipos, prévia no centro, propriedades à direita. Tipos: texto curto/longo, e-mail, número, data, seleção, sim/não, escala 0–10. Cada pergunta grava num campo da tabela Respostas (criar/remover/trocar tipo mexe no campo junto). `file` existe no backend, fora da paleta |
| Uma pergunta por vez | ✅ | `/f/{slug}` (publicado) e `/f-preview/{id}` (rascunho, só quem gerencia, grava nos dados de teste). Boas-vindas, progresso, Voltar, Enter avança, escolha avança sozinha. Sem barra lateral |
| Validação | ✅ | No navegador antes de avançar (`answerProblem`) e no envio (`FormService`): obrigatória do caminho, e-mail, escala 0–10, tipos (`RecordValidator`) |
| Lógica de pulo | ✅ | `QuestionDef.Jumps: [{ op, value, goTo }]` sobre a resposta da própria pergunta; primeira que bater vence; só para frente (sem ciclos). Mesma regra em `FormFlow` (back) e `form-flow.ts` (front) |
| Respostas | ✅ | Envio grava só as perguntas do caminho na tabela de respostas (produção) e dispara `recordCreated` |
| Tela final | ✅ | Título, texto e redirecionamento opcional (só http/https, validado ao salvar no `FormFlow.Problems` e de novo no respondente) |
| Respostas anteriores no texto | ✅ | Título, descrição e tela final citam respostas já dadas (`Certo, {{Nome}}!`). Cada pergunta só oferece as anteriores (autocomplete `{{` e painel "Respostas anteriores"); resposta pulada fica vazia. Automações do formulário têm variáveis e Transformar ([ADR 0018](ADR/0018-variaveis-em-automacoes-textos-e-formularios.md)) |
| Depois de enviar | ✅ | Ficar, link (http(s) ou /caminho, com `{{respostas}}` escapadas) ou **projeto** do workspace; **regras condicionais** sobre as respostas (a primeira que bater decide), avaliadas no servidor. Valores na URL (`?Nome=Ana`) pré-preenchem as perguntas. Atalho "Enviar respostas para um workflow" ([ADR 0019](ADR/0019-navegacao-e-workflows-entre-projetos.md)) |
| Link público | ✅ | Desligado por padrão (aba Compartilhar). Sem login grava como `anonimo`. Limite nativo do ASP.NET Core (`Forms:SubmitsPerHour`, por usuário logado ou por IP) e campo-isca no envio. `Forms:AllowPublic=false` desliga todos |
| Respondente identificado | 🟡 | Com login, o registro guarda quem respondeu (`CreatedBy`). Departamento não é gravado à parte |
| Resumo | ✅ | Abriram × enviaram, taxa de conclusão, "onde as pessoas param" (chegou a cada pergunta) e gráfico por pergunta de seleção/sim-não/escala; tabela com busca e exportação dos mini apps. Contadores na tabela `FormCounters` |
| Auditoria | 🟡 | `form.submit`. Ligar/desligar o link público aparece como edição do app (`app.update`) |

### Depois do MVP
- Pré-preencher pela URL (`?campo=valor`) e campos ocultos vindos da URL.
- Respostas parciais (salvar e continuar depois).
- Uma resposta por pessoa (com login).
- Tema (cor/logo da área) via tokens do design system.
- Quiz com pontuação.
- Embutir o formulário como componente dentro de um mini app.

### Fora de escopo
- Pagamentos, assinatura digital, editor visual livre (isso é o mini app).

## Regras e decisões

- Formulário com link público **nunca expõe dados**: o endpoint público só aceita envio e só lê a definição publicada.
- Perguntas apontam para campos pelo **Id**; renomear pergunta não quebra respostas (já há migração por renome).
- Excluir pergunta não apaga dados da coluna na produção até publicar (mesma regra das tabelas).
- Lógica e visibilidade usam **uma** implementação de condição por lado (back/front). Mudou uma, muda a outra e os testes.

## Testes (por jornada)

- Back: envio válido cria registro e dispara automação; obrigatória no caminho é exigida e fora do caminho não;
  link público desligado recusa; ligado aceita sem usuário e respeita limite; definição com pulo para pergunta
  inexistente é recusada.
- Front: função pura `nextQuestion(form, answers, current)` (próxima, pulo, fim, voltar respeita o caminho percorrido)
  e progresso.

## Métricas de sucesso

- Formulários publicados por área em 90 dias; contratos de Typeform/Forms cancelados.
- Taxa de conclusão média ≥ 60%.
- Tempo de criar e publicar o primeiro formulário < 10 min.

## Perguntas em aberto

- Link público é permitido pela segurança da informação? Em quais dados (LGPD: consentimento no formulário)?
- Respondente externo precisa de captcha corporativo ou rate limit basta?

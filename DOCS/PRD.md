# PRD — Mini apps (MVP)

Criador de mini apps corporativos, low-code, inspirado no Bubble. Builders de cada unidade montam apps
(páginas + banco + workflows) sem código, e usuários finais usam a versão publicada pelo catálogo interno.

## Princípios

- **YAGNI / KISS**: cada feature do PRD original foi entregue na forma mais simples que resolve o caso de uso.
  O que ficou de fora está listado em "Fora do MVP", com o caminho previsto.
- **Pronto para o ambiente corporativo**: auth, e-mail, persistência, arquivos e design system ficam atrás de
  portas/adaptadores (ver [TROCA-DE-ADAPTADORES.md](TROCA-DE-ADAPTADORES.md)).

## Próximos tipos de projeto

O produto passa a ter três tipos de projeto, todos sobre o mesmo modelo (workspace, rascunho × produção, versões,
permissões, auditoria): **mini app** (este PRD), **formulário** ([PRD-FORMS.md](PRD-FORMS.md), inspirado no Typeform,
**MVP implementado**) e **workflow** ([PRD-WORKFLOWS.md](PRD-WORKFLOWS.md), inspirado em n8n/trigger.dev, **MVP
implementado**).

## Referências de UI

Decididas em 2026-11-07. Cada área imita o layout da referência, sobre a mesma base visual.

| Área | Referência | Como aparece |
|---|---|---|
| Base (todas as telas) | Linear / Vercel | Neutro e denso, fonte Geist, cor só para ação/seleção; tema claro e escuro (segue o sistema, botão ◐ força). Barra lateral clara com contador de aprovações, que recolhe para ícones no editor |
| Início | Figma (navegador de arquivos) | "Criar" em cartões no topo (Mini app, Formulário, Workflow), "Recentes" em grade com miniatura gerada da 1ª página e filtro por tipo |
| Editor de mini app | Figma (moldura) + Bubble (paleta) | Barra de ferramentas com nome editável e abas no centro; à esquerda Páginas e "Inserir/Camadas" (paleta agrupada do Bubble); canvas cinza com a página como frame; propriedades à direita |
| Automações | n8n (nós) | Nós em coluna ligados por conectores (Gatilho → Se → Passos), parâmetros do nó selecionado à direita. Canvas em grafo: depois |
| Execuções de workflow | trigger.dev (waterfall) | Entra com o histórico de execuções do [PRD-WORKFLOWS](PRD-WORKFLOWS.md) |
| Formulário | Typeform | Entra com o [PRD-FORMS](PRD-FORMS.md) |

## Personas e papéis (RBAC)

| Papel | Pode |
|---|---|
| **Admin** (governança central) | Tudo: todos os workspaces, criar workspaces, log de auditoria, decidir qualquer aprovação |
| **Builder** | Criar/editar/publicar apps nos workspaces do **seu departamento**; usar templates; clonar apps do catálogo |
| **Usuário** | Usar apps publicados liberados para o seu departamento; aprovar o que for endereçado a ele |

Regras centralizadas em `api/src/Domain/Identity/Identity.cs` (`AccessRules`).

## Jornadas cobertas

1. **Builder cria e publica**: Builder → Novo app (em branco ou template) → Dados (tabelas/campos) → Design
   (arrastar componentes) → Workflows → Visualizar rascunho → Publicar → URL interna `/run/{slug}`.
2. **Usuário usa**: Catálogo → Abrir → preenche formulário gerado da tabela → vê registro na tabela/lista/gráfico
   → exporta CSV / imprime PDF.
3. **Automação**: registro criado/atualizado ou clique em botão → condição → ações (salvar, atualizar, e-mail,
   navegar, chamar API, solicitar aprovação).
4. **Aprovação**: solicitação → aprovador recebe (e-mail + caixa "Aprovações") → aprova/rejeita → status volta
   ao registro e o solicitante é notificado.
5. **Governança**: Admin cria workspaces por unidade e acompanha o log de auditoria.

## Escopo do MVP (status por item do PRD original)

### Núcleo
| Feature | Status | Como foi resolvido |
|---|---|---|
| Editor visual drag-and-drop | ✅ | HTML5 DnD nativo; componentes texto, botão, input, tabela, lista, card, formulário, gráfico e **container** (grade própria, aninhável até 4 níveis, arrastar para dentro/fora); grid de 12 colunas que vira 1 coluna no celular. **Visibilidade condicional** por componente ("Mostrar quando": inputs da página, papel, departamento, e-mail, se gerencia o app) |
| Banco embutido | ✅ | Tabelas/campos texto, número, data, seleção, relação, arquivo; CRUD automático `/api/apps/{id}/{env}/tables/{t}/records` |
| Formulários e listas gerados das tabelas | ✅ | Componentes form/table/list leem o schema; botão "Gerar página com formulário e lista". Tabelas e listas com busca (ignora acentos/maiúsculas) e paginação **no servidor** (20 por página na tabela, 12 na lista, máx. 100 pela API) |
| Workflows visuais | ✅ | Gatilho (clique, registro criado/atualizado, **agendado**: a cada hora, diário ou semanal) → condição → ações (createRecord, updateRecord, sendEmail, navigate, callApi, requestApproval, **executar outra automação**) com variáveis `{{campo}}`. **Encadeamento**: registros criados/alterados por automação e decisões de aprovação disparam as automações da tabela, com limite de 5 níveis contra ciclos. Agendados rodam na versão publicada e têm "Executar agora" no rascunho |
| Publicação em um clique | ✅ | Rascunho × produção (definição **e dados** separados); URL interna `/run/{slug}` |

### Corporativo
| Feature | Status | Como foi resolvido |
|---|---|---|
| SSO + perfis | 🟡 mock | `IUserProvider` (mock: usuário de `mock-auth.json`). Perfis admin/builder/usuário prontos |
| Permissões por app, tabela, campo, departamento | ✅ | App: departamentos permitidos. Tabela: usuário pode criar/editar/excluir. Campo: "oculto" (só builders veem) ou "só leitura" (usuário vê, não edita — ex.: status de aprovação) |
| Multi-workspace com governança | ✅ | Workspace = unidade/departamento; admin vê tudo |
| Log de auditoria | ✅ | Criação, edição, publicação, rollback, acesso a app, CRUD de registros, import/export, workflows, aprovações, uploads |
| Fluxo de aprovação | ✅ | Ação `requestApproval` + caixa de aprovações |
| Notificações por e-mail | 🟡 mock | `IEmailSender` só loga (`[EMAIL] ...`). Teams/Slack: fora do MVP |

### Substituição de licenças
| Feature | Status | Como foi resolvido |
|---|---|---|
| Templates prontos | ✅ | Solicitações c/ aprovação, Checklist, Inventário, Chamados, Onboarding, Reservas, CRM simples, Cadastros (seed) |
| Importação/exportação Excel/CSV | ✅ | `.xlsx` nativo (cabeçalho em negrito e congelado, números como número) e CSV (`;` + BOM). Importa `.xlsx` (inclusive salvo pelo Excel, com datas seriais) ou CSV, com relatório de erros por linha. Exportação reimportável |
| Dashboards e relatórios | ✅ básico | Gráfico de barras (contagem agregada no banco) + tabela na tela. Relatório **PDF gerado no servidor**: mesmos gráficos do app (cores dos status), tabela com quebra de linha nas células (até 6 linhas), valores em pt-BR, relações pelo rótulo, cabeçalho repetido e "Página X de N". "Imprimir página" do navegador continua disponível |
| Anexos e upload | ✅ | Campo arquivo → `IFileStorage` (disco local), isolado por app: só quem acessa o app envia/baixa |
| Conectores | ✅ genérico | Saída: ação `callApi` (REST). Entrada: webhook por tabela (`POST /api/hooks/{app}/{tabela}` + `X-Webhook-Key`) que cria registros na produção e dispara workflows. Google Sheets/SharePoint/ERP específicos: via callApi/webhook ou novo adaptador |

### Democratização
| Feature | Status | Como foi resolvido |
|---|---|---|
| Biblioteca compartilhável | ✅ | Qualquer app pode ser marcado "template" e aparece para builders de todas as unidades |
| Duplicar app (de outra unidade) | ✅ | Clona definição (sem dados) de app próprio, template ou do catálogo |
| Versionamento com rollback | ✅ | Cada publicação gera versão imutável; rollback publica nova versão com o conteúdo antigo. Renomear campo migra os dados (rascunho ao salvar, produção ao publicar/rollback) |
| Modo builder × modo usuário | ✅ | `/builder/*` (protegido por papel) × `/run/{slug}` (sem nada do editor) |
| Catálogo interno | ✅ | `/catalog` lista apps publicados e liberados para o departamento |
| Formulários | ✅ | Ver [PRD-FORMS.md](PRD-FORMS.md): perguntas com lógica de pulo, `/f/{slug}`, link público opcional, resumo e respostas |
| Workflows | ✅ | Ver [PRD-WORKFLOWS.md](PRD-WORKFLOWS.md): projeto próprio, passos aninhados, fila com histórico em waterfall, tentativas, segredos, webhook e cron |
| Início | ✅ | `/` (estilo Figma): criar Mini app, Formulário ou Workflow (abre o editor "sem título"); recentes em grade com miniatura e filtro por tipo (builder) ou apps para você (usuário). O que cada papel pode fazer fica na barra lateral, com contador de aprovações |

## Fora do MVP (próximos passos)

- SSO real (Entra/Google/SAML) → trocar adaptador de auth.
- E-mail real, Teams/Slack → adaptadores de `IEmailSender` (ou nova porta `INotifier`).
- Migrations de banco (hoje `EnsureCreated`) — o banco será trocado no ambiente corporativo.
- Conectores dedicados (Google Sheets, SharePoint, ERP) se callApi/webhook não bastarem.

## Limitações conhecidas (decisões KISS)

- Registros guardam valores como string normalizada (número invariante, data `yyyy-MM-dd`).
- Renomear campo migra os dados, mas **não** atualiza referências por nome em componentes (`groupBy`, `titleField`)
  e em `{{variáveis}}` de workflows: o builder ajusta à mão.
- O webhook usa a chave da versão publicada; ligar/trocar a chave exige publicar. No SSO corporativo, a rota
  `/api/hooks` precisa ficar fora da autenticação (a chave é a credencial).
- Ações de workflow rodam com privilégio de sistema. Cadeias com mais de 5 níveis são interrompidas (registro na auditoria como `workflow.chain-limit`). `requestApproval` não dispara "registro atualizado" ao marcar Pendente; a decisão dispara.
- Agendador: horário do servidor; roda em processo na API (uma instância). Primeira execução só na próxima ocorrência após publicar; execuções perdidas com o servidor parado viram uma só. Agendado não percorre registros (não há "para cada").
- Importação CSV não dispara workflows (webhook dispara).
- Visibilidade condicional é só apresentação (avaliada no navegador): quem precisa de dado protegido usa permissões
  de tabela/campo, que o servidor aplica. Condições aceitam várias regras com E ou OU (um nível; para misturar os dois, aninhe containers).
- A busca procura no valor gravado: campo de relação é encontrado pelo id, não pelo rótulo exibido; campo oculto
  nunca entra na busca de quem não o vê. Rótulos de relação (`/labels`) ainda carregam a tabela relacionada inteira
  (tabelas de apoio costumam ser pequenas). Exportações levam a tabela inteira, sem o filtro da busca.

## Histórico de evolução

O porquê de cada entrega está nos ADRs: [DOCS/ADR](ADR/README.md).

| Data | Entrega |
|---|---|
| 2026-11-05 | MVP: núcleo, corporativo (mock de auth/e-mail), templates, CSV, versões, catálogo |
| 2026-11-06 | Campo só leitura; renomear campo migrando dados; anexos isolados por app; webhook de entrada; busca e paginação em tabelas |
| 2026-11-06 | Excel `.xlsx` nativo (exportar e importar) e relatório PDF gerado no servidor, ambos sem dependências novas |
| 2026-11-06 | Busca, paginação e agregação de gráficos no servidor (SQL no repositório, sem acento/maiúscula) |
| 2026-11-06 | Containers aninhados no editor e visibilidade condicional de componentes |
| 2026-11-06 | PDF com gráficos e quebra de linha; workflows encadeados (incl. aprovação → "registro atualizado" e ação "executar outra automação") e agendados |
| 2026-11-07 | PRDs de formulários e workflows; nova tela Início (catálogo foi para `/catalog`) |
| 2026-11-07 | Nova UI: base Linear/Vercel com tema escuro, Início estilo Figma, editor com moldura Figma + paleta Bubble, automações em nós estilo n8n |
| 2026-11-07 | Formulários (MVP do PRD-FORMS): editor de perguntas e lógica, respondente `/f/{slug}`, link público com limite, resumo |
| 2026-11-07 | Workflows (MVP do PRD-WORKFLOWS): projeto próprio, passos aninhados, fila + worker, histórico em waterfall, tentativas, tempo limite, segredos, webhook e cron |
| 2026-11-07 | Revisão dos PRDs: limite de 500 passos por execução de workflow; redirecionamento do formulário validado também no servidor |
| 2026-11-07 | Condições com várias regras (E/OU) na visibilidade, nas automações e no "se" dos workflows |

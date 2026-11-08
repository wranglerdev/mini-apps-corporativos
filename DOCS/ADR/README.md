# ADRs: histórico de decisões

Registro curto do **porquê** das decisões, refactors e mudanças relevantes do app, em ordem. O PRD diz *o que* existe,
a ARQUITETURA diz *como* funciona, os ADRs dizem *por que* e *quando*.

Como criar: skill `adr` (`.claude/skills/adr/SKILL.md`). Um arquivo por decisão, ~25 linhas, numeração sequencial.
ADR aceito não é reescrito; uma decisão nova o substitui (`Substituído por NNNN`).

| # | Decisão | Tipo | Status | Data |
|---|---|---|---|---|
| [0001](0001-camadas-com-portas-e-adaptadores.md) | Camadas com portas e adaptadores | decisão | Aceito | 2026-11-05 |
| [0002](0002-app-como-documento-json.md) | App é um documento JSON com rascunho e produção | decisão | Aceito | 2026-11-05 |
| [0003](0003-auth-e-email-mockados.md) | Auth e e-mail mockados atrás de portas | decisão | Aceito | 2026-11-05 |
| [0004](0004-excel-e-pdf-sem-dependencias.md) | Excel e PDF gerados sem dependências | dependência | Aceito | 2026-11-06 |
| [0005](0005-consultas-no-servidor-sobre-json.md) | Busca, paginação e gráficos no servidor | refactor | Aceito | 2026-11-06 |
| [0006](0006-workflows-encadeados-e-agendados.md) | Workflows encadeados e agendados em processo | feature | Aceito | 2026-11-06 |
| [0007](0007-visibilidade-condicional-e-condicoes-espelhadas.md) | Visibilidade condicional só na tela, com condição espelhada | decisão | Aceito | 2026-11-06 |
| [0008](0008-formulario-e-workflow-como-tipos-de-projeto.md) | Formulário e workflow como tipos de projeto | decisão | Substituído por 0013 e 0014 | 2026-11-07 |
| [0009](0009-home-e-catalogo-em-rota-propria.md) | Início em `/` e catálogo em `/catalog` | feature | Aceito | 2026-11-07 |
| [0010](0010-referencias-de-ui-e-tema-escuro.md) | Referências de UI por área e tema claro/escuro | ui | Aceito | 2026-11-07 |
| [0011](0011-miniatura-pelo-resumo-do-app.md) | Miniatura do projeto gerada da definição | decisão | Aceito | 2026-11-07 |
| [0012](0012-historico-em-adrs.md) | Histórico de decisões em ADRs curtos | decisão | Aceito | 2026-11-07 |
| [0013](0013-formularios-implementados.md) | Formulários dentro do AppDefinition, com tipo derivado e link público limitado | feature | Aceito | 2026-11-07 |
| [0014](0014-workflows-com-fila-e-historico.md) | Workflows como projeto, com fila no banco e histórico por passo | feature | Aceito | 2026-11-07 |
| [0015](0015-condicoes-com-varias-regras-e-ou.md) | Condições com várias regras (E/OU), sem converter definições salvas | feature | Aceito | 2026-11-07 |
| [0016](0016-aba-do-editor-na-url.md) | Aba do editor na URL (`?aba=`) para reload e link | ui | Aceito | 2026-11-08 |

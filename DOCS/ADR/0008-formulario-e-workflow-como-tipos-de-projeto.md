# 0008. Formulário e workflow como tipos de projeto

- **Data:** 2026-11-07
- **Status:** Substituído por 0013 (formulário) e 0014 (workflow)
- **Tipo:** decisão

## Contexto
O produto quer cobrir Typeform e n8n/trigger.dev além do Bubble, sem três plataformas separadas.

## Decisão
- `App` ganha `Kind = app | form | workflow`; todos usam `AppDefinition`.
- Herdam workspace, rascunho × produção, versões, permissões, auditoria, catálogo e templates.
- Detalhes em `PRD-FORMS.md` e `PRD-WORKFLOWS.md`. Descartado: entidades e telas de publicação próprias por tipo.

## Consequências
- Um só fluxo de publicação e governança para os três tipos.
- Melhorias no motor de workflows valem para mini apps e formulários.
- Pendente: implementar `Kind`; hoje a Home trata todo projeto como mini app.

**Arquivos:** `DOCS/PRD-FORMS.md`, `DOCS/PRD-WORKFLOWS.md`, `web/src/app/features/home/home.ts`

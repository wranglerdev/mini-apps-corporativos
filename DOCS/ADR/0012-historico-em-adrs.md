# 0012. Histórico de decisões em ADRs curtos

- **Data:** 2026-11-07
- **Status:** Aceito
- **Tipo:** decisão

## Contexto
Ao levar o app para o ambiente corporativo, o time precisa saber por que as coisas são como são, não só o que existe.

## Decisão
- Cada decisão, refactor amplo ou mudança de UI relevante gera um ADR curto (~25 linhas) em `DOCS/ADR/`, com índice.
- A skill `adr` (`.claude/skills/adr/`) define quando criar, o modelo e as regras; `CLAUDE.md` obriga no mesmo change.
- ADR aceito não é reescrito: decisão nova substitui a antiga.
- Histórico de 2026-11-05 a 2026-11-07 registrado retroativamente (0001–0011).

## Consequências
- PRD diz o quê, ARQUITETURA diz como, ADR diz por quê e quando.
- Custo: alguns minutos por change relevante.

**Arquivos:** `DOCS/ADR/README.md`, `.claude/skills/adr/SKILL.md`, `CLAUDE.md`

# 0005. Busca, paginação e gráficos no servidor

- **Data:** 2026-11-06
- **Status:** Aceito
- **Tipo:** refactor

## Contexto
Tabelas, listas e gráficos carregavam todos os registros no navegador, o que não escala.

## Decisão
- `GET .../records?q=&page=&size=` filtra e pagina no banco; gráficos usam `summary?groupBy=` com `GROUP BY`.
- No SQLite: `json_each`/`json_extract` sobre a coluna JSON + função `norm()` (sem acento/maiúscula), igual a `TextSearch.Normalize`.
- Campo oculto nunca é pesquisável por quem não o vê; `size` limitado a 100.

## Consequências
- O front pede só a página visível; a busca espera 300 ms sem digitação.
- Ao trocar de banco no corporativo, reescrever `QueryAsync`/`CountByAsync` no novo adaptador (há teste de contrato).

**Arquivos:** `api/src/Domain/Records/RecordService.cs`, `api/src/Infra/Persistence/`, `web/src/app/features/runtime/run-context.ts`

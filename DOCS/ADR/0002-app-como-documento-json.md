# 0002. App é um documento JSON com rascunho e produção

- **Data:** 2026-11-05
- **Status:** Aceito
- **Tipo:** decisão

## Contexto
Builders editam páginas, tabelas e workflows juntos, e publicar precisa congelar tudo de uma vez, com rollback.

## Decisão
- A definição inteira do app é um documento (`AppDefinition`: páginas, tabelas, workflows).
- `Draft` e `Published` são cópias; cada publicação grava uma `AppVersion` imutável; rollback publica uma nova versão com o conteúdo antigo.
- Registros guardam `Env` (rascunho × produção) para separar dados de teste dos reais.
- Descartado: tabelas relacionais por componente (migrações a cada mudança do builder).

## Consequências
- Template, clone e versão são só cópias do documento.
- Valores dos registros ficam como string normalizada; busca e agregação usam SQL sobre JSON (ver 0005).
- Renomear campo exige migrar dados por Id (feito ao salvar/publicar).

**Arquivos:** `api/src/Domain/Apps/AppDefinition.cs`, `api/src/Domain/Apps/AppService.cs`, `api/src/Domain/Entities.cs`

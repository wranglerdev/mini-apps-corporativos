# 0007. Visibilidade condicional só na tela, com condição espelhada

- **Data:** 2026-11-06
- **Status:** Aceito
- **Tipo:** decisão

## Contexto
Builders querem mostrar/esconder componentes conforme inputs ou usuário, e workflows já tinham condições no backend.

## Decisão
- `ComponentDef.VisibleWhen` usa o mesmo formato de `ConditionDef` dos workflows.
- Avaliada no navegador (`visibility.ts`), espelho de `Conditions.Evaluate`; mudou uma, muda a outra e os dois testes.
- É só apresentação: dado protegido usa permissões de tabela/campo, que o servidor aplica.

## Consequências
- Sem ida ao servidor para esconder componentes.
- Custo: duas implementações para manter iguais; uma regra só por condição (sem E/OU; aninhar containers).

**Arquivos:** `web/src/app/features/runtime/visibility.ts`, `api/src/Domain/Workflows/WorkflowEngine.cs`

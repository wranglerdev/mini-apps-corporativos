# 0015. Condições com várias regras (E/OU), sem converter definições salvas

- **Data:** 2026-11-07
- **Status:** Aceito
- **Tipo:** feature

## Contexto
Condições (visibilidade, automações de mini app e "se" dos workflows) tinham uma regra só; combinar exigia aninhar
containers ou "se". O PRD-WORKFLOWS pedia grupos E/OU. Remove a limitação aceita no ADR 0007 (o resto dele vale).

## Decisão
- `ConditionDef` herda de `ConditionRule`: a 1ª regra continua nos próprios campos (`Field/Op/Value`), as demais vão
  em `More`, e `Join` diz `and` (padrão, todas) ou `or` (basta uma). JSON antigo é uma condição válida de uma regra:
  nada a converter no banco nem nas versões publicadas. Descartado: lista `Rules` nova (exigiria conversão dos dois lados).
- Um nível só (sem grupos dentro de grupos): para misturar E com OU, aninhe "se"/containers.
- Mesma regra nos dois lados: `Conditions.Evaluate` e `visibility.ts` (`evaluate`), com os mesmos casos de teste.
- Um editor só (`app-condition-editor`) nas três telas, com as operações puras em `condition-ops.ts`.

## Consequências
- Builder combina regras sem aninhar; o histórico do "se" mostra cada regra e a junção.
- Formato fica assimétrico (1ª regra fora da lista) em troca de não migrar dados.
- Lógica de pulo dos formulários segue com uma regra por pulo (`JumpDef`).

**Arquivos:** `api/src/Domain/Apps/AppDefinition.cs`, `api/src/Domain/Workflows/WorkflowEngine.cs`,
`web/src/app/features/runtime/visibility.ts`, `web/src/app/features/builder/condition-editor.ts`,
`web/src/app/features/builder/condition-ops.ts`

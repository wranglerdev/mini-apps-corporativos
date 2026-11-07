# 0006. Workflows encadeados e agendados em processo

- **Data:** 2026-11-06
- **Status:** Aceito
- **Tipo:** feature

## Contexto
Automações precisavam disparar outras (registro criado por automação, decisão de aprovação) e rodar por horário.

## Decisão
- Criar/atualizar registro por automação dispara as automações da tabela; ação "executar outra automação".
- Limite de 5 níveis contra ciclos (auditado como `workflow.chain-limit`).
- Agendados (hora/dia/semana) rodam num `HostedService` dentro da API, a cada minuto.
- Descartado agora: fila/worker externo (ver `PRD-WORKFLOWS.md`).

## Consequências
- Simples e sem infra extra.
- Limitação: execução síncrona, sem retry nem histórico; uma instância só para o agendador. Resolver com a porta `IRunQueue` do PRD de workflows.

**Arquivos:** `api/src/Domain/Workflows/WorkflowEngine.cs`, `api/src/Domain/Workflows/ScheduledWorkflowService.cs`

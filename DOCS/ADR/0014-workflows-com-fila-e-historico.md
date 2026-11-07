# 0014. Workflows como projeto, com fila no banco e histórico por passo

- **Data:** 2026-11-07
- **Status:** Aceito
- **Tipo:** feature

## Contexto
O PRD-WORKFLOWS pede execução em segundo plano, histórico, tentativas e segredos, sem nova infraestrutura no MVP e sem quebrar as automações de mini app.

## Decisão
- `AppDefinition.Automation` marca o projeto (tipo derivado, sem migração); os passos são `ActionDef` em árvore (`Steps`/`Else`) com `Id`, `Retries` e `TimeoutSeconds`.
- Fila = execuções `queued` no banco (`IRunStore`) + `BackgroundService` em processo, uma por vez. Descartado: Hangfire/fila externa (dependência e infra antes da hora).
- `FlowRunner` cuida de controle, tentativas, tempo limite e histórico; as ações reaproveitam `WorkflowEngine.ExecuteActionAsync`. Automações de mini app continuam síncronas.
- Segredos por workspace (`ISecretStore`), cifrados com AES-GCM da BCL e mascarados no histórico; `IHttpConnector` ganha cabeçalhos.

## Consequências
- Diagnóstico por execução (waterfall) e reexecução a partir de um passo, sem pacote novo.
- Uma instância só: em várias, trocar a fila/worker (`TROCA-DE-ADAPTADORES.md`). O tempo limite não cancela a chamada já feita.
- Pendentes: grupos E/OU nas condições, confirmação de API externa no teste, passos de registro/aprovação no projeto.

**Arquivos:** `api/src/Domain/Flows/`, `api/src/Api/FlowWorkerHostedService.cs`, `api/src/Infra/Persistence/Repositories.cs`, `web/src/app/features/flows/`

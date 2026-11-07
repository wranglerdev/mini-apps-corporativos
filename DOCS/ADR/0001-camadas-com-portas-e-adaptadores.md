# 0001. Camadas com portas e adaptadores

- **Data:** 2026-11-05
- **Status:** Aceito
- **Tipo:** decisão

## Contexto
O MVP roda local, mas vai para um ambiente corporativo com SSO, e-mail, banco e arquivos próprios. Trocar essas peças não pode exigir reescrever regras.

## Decisão
- Backend em `Api` (controllers finos + `CompositionRoot`) → `Domain` (regras + portas) ← `Infra` (adaptadores).
- `Domain` não referencia pacote nem outro projeto; toda integração externa entra por uma porta.
- Adaptadores registrados só no `CompositionRoot`. Descartado: chamar EF/HTTP direto dos serviços (amarra o domínio à infra).

## Consequências
- Troca de auth, e-mail, banco ou arquivos = novo adaptador, sem mexer no domínio (ver `TROCA-DE-ADAPTADORES.md`).
- Testes do domínio rodam com fakes em memória, sem banco nem mocks.
- Custo: um pouco mais de cerimônia (interface + implementação) por integração.

**Arquivos:** `api/src/Domain/Ports.cs`, `api/src/Api/CompositionRoot.cs`, `api/src/Infra/`, `DOCS/ARQUITETURA.md`

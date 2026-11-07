# 0003. Auth e e-mail mockados atrás de portas

- **Data:** 2026-11-05
- **Status:** Aceito
- **Tipo:** decisão

## Contexto
Não há SSO nem servidor de e-mail no ambiente de desenvolvimento, e o mock não pode vazar para a UI.

## Decisão
- Usuário de dev vem só de `mock-auth.json` (`MockUserProvider`, porta `IUserProvider`); o front só lê `/api/me`.
- E-mail só é logado (`LogEmailSender`, porta `IEmailSender`).
- Sem troca de usuário pela UI: troca-se editando o JSON. Descartado: seletor de usuário (vira dívida e risco em produção).

## Consequências
- No corporativo: adaptador de SSO (Entra/Google/SAML) e de e-mail/Teams, sem tocar no domínio.
- RBAC (`AccessRules`) já é real; só a origem do usuário é falsa.

**Arquivos:** `mock-auth.json`, `api/src/Api/Auth/MockUserProvider.cs`, `web/src/app/core/auth/dev-auth.ts`

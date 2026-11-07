# 0011. Miniatura do projeto gerada da definição

- **Data:** 2026-11-07
- **Status:** Aceito
- **Tipo:** decisão

## Contexto
O Início estilo Figma precisa de uma miniatura por projeto.

## Decisão
- `AppSummary.sketch` traz tipo e largura dos 8 primeiros componentes da 1ª página (rascunho para quem gerencia, publicada no catálogo).
- O front desenha blocos em CSS na grade de 12 colunas (`sketchBlocks`).
- Descartado: screenshot real (exige render headless no servidor) e só ícone por tipo (pouco informativo).

## Consequências
- Sem imagem armazenada nem serviço extra; a miniatura muda junto com o app.
- É um esboço, não uma prévia fiel.

**Arquivos:** `api/src/Api/Controllers/Controllers.cs`, `web/src/app/features/home/home.ts`

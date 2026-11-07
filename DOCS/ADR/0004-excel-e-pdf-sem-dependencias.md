# 0004. Excel e PDF gerados sem dependências

- **Data:** 2026-11-06
- **Status:** Aceito
- **Tipo:** dependência

## Contexto
Usuários precisam exportar/importar `.xlsx` e gerar relatório PDF, e cada pacote novo é revisão de licença e segurança no corporativo.

## Decisão
- `.xlsx` escrito/lido com OpenXML mínimo sobre `System.IO.Compression` (BCL).
- PDF montado à mão (texto, tabela com quebra, gráficos de barras, "Página X de N").
- Descartado: ClosedXML/QuestPDF (dependências e licenças para um caso simples).

## Consequências
- Zero pacotes novos; tudo coberto por testes de contrato (`DocumentTests`).
- Custo: recursos avançados (fórmulas, imagens, fontes embutidas) exigem trabalho próprio ou trocar o adaptador (`ISpreadsheet`/`IPdfReport`).

**Arquivos:** `api/src/Infra/Documents/`, `api/tests/Tests/DocumentTests.cs`, `DOCS/DEPENDENCIAS.md`

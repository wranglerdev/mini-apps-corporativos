---
name: adr
description: Registra decisões de arquitetura, refactors e features relevantes como ADRs curtos em DOCS/ADR/ (com índice), para manter o histórico do app ao levá-lo para o ambiente corporativo. Use ao concluir uma mudança que escolhe um caminho entre alternativas, troca/adiciona dependência, porta ou adaptador, muda estrutura/fluxo, faz refactor amplo ou muda UI de forma visível; ou quando o usuário pedir "/adr", "registra essa decisão", "cria um ADR".
---

# ADR: registro curto de decisões

Os ADRs ficam em `DOCS/ADR/`, um arquivo por decisão, e o índice fica em `DOCS/ADR/README.md`. São escritos para
humanos lerem: curtos, diretos e em português.

## Quando criar

Crie um ADR no mesmo change em que algo destes acontece:
- uma escolha entre alternativas (ex.: biblioteca, onde guardar um dado, síncrono × fila);
- dependência, porta, adaptador ou `CompositionRoot` alterados;
- estrutura ou fluxo alterados (o que também atualiza `ARQUITETURA.md`);
- refactor amplo (renomear conceitos, mover camadas, trocar padrões);
- feature ou mudança de UI que muda a experiência ou o escopo do PRD.

**Não** crie ADR para bugfix pontual, texto, estilo pequeno ou teste isolado. Na dúvida, pergunte: "alguém vai
querer saber por que isso é assim daqui a 6 meses?". Se sim, crie.

## Como criar

1. Leia `DOCS/ADR/README.md` e pegue o próximo número (4 dígitos, sequencial, nunca reutilize).
2. Crie `DOCS/ADR/NNNN-titulo-em-kebab-case.md` com o modelo abaixo.
3. Adicione uma linha na tabela do índice (número com link, título, tipo, status, data).
4. Se substitui um ADR anterior, mude o status do antigo para `Substituído por NNNN` (não apague nem reescreva o
   conteúdo dele) e ajuste o índice.
5. Uma mudança com várias decisões independentes gera um ADR para cada; decisões que só existem juntas ficam num só.

## Modelo

```markdown
# NNNN. Título no imperativo ou como afirmação curta

- **Data:** AAAA-MM-DD
- **Status:** Proposto | Aceito | Substituído por NNNN | Descartado
- **Tipo:** decisão | refactor | feature | ui | dependência

## Contexto
1 a 3 frases: o problema ou a necessidade, e a restrição que importa.

## Decisão
2 a 5 bullets: o que foi feito/escolhido. Cite a alternativa descartada e o porquê, em meia linha.

## Consequências
2 a 4 bullets: o que fica mais fácil, o custo/limitação aceita e o que fazer no ambiente corporativo, se houver.

**Arquivos:** caminhos principais (até 5), separados por vírgula.
```

## Regras de escrita

- **Máximo de ~25 linhas** por ADR. Se passar, é detalhe de doc (PRD, ARQUITETURA), então linke em vez de copiar.
- Sem código, sem diffs, sem logs. Nomes de arquivos, classes e rotas entre crases, sim.
- Datas absolutas (nunca "hoje" ou "semana passada").
- ADR aceito é imutável: corrigir erro de digitação pode; mudar a decisão é um ADR novo que substitui o anterior.
- `Proposto` serve para o que está planejado e documentado (ex.: um PRD), mas ainda não está implementado. Ao
  implementar, mude para `Aceito` e acrescente a data no status: `Aceito (2026-12-01)`.
- Termine dizendo ao usuário o número e o título do ADR criado.

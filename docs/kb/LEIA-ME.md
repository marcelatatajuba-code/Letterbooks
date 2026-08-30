# KBs do ciclo SDD

Saída de uma volta completa do ciclo (`/ciclo`), rodada em 30/08/2026 com
catorze agentes. São a base de decisão da rodada seguinte — não são
documentação do que existe.

| arquivo | quem escreveu | o que é |
|---|---|---|
| `produto.json` | especialista de produto | inventário das features do Letterboxd contra o que o app cumpre, com arquivo e função como evidência |
| `mercado.json` | pesquisa de mercado | concorrentes e oportunidades, **com procedência declarada** |
| `design-system.json` | design | tokens, componentes, regras e inconsistências extraídos do `css/app.css` real |
| `backlog.json` | curadoria | os 12 itens ordenados, e **o que foi cortado com o motivo** |
| `especificacoes.json` | GPM + design | história, DoR, DoD, requisitos, casos de uso e spec de tela dos 4 primeiros |
| `marca.json` | design | identidade e estrutura do site de apresentação |
| `plano-tecnico.json` | tech lead | o que cabe, em que ordem, e o que colide |

## Como ler

**Leia `plano-tecnico.json` antes de implementar qualquer coisa.** Ele
contradiz o backlog em quatro pontos, com razão em todos:

- a trava de migração "por conta no servidor" que o backlog pede **não resolve
  o problema** — apaga o botão e deixa a duplicação. A decisão tem que ser por
  item (`cliente_id`), não por aparelho nem por conta;
- agregação no PostgREST (`nota.avg()`) volta 400 — o Supabase desliga as
  funções de agregação por padrão. Média e distribuição se somam no cliente;
- a contagem exata de avaliações não existe sem `count=exact`, e `Nuvem.pedir`
  descarta os cabeçalhos da resposta. Rótulo sem número, ou refactor próprio;
- barra de progresso determinada precisa do total antes de baixar, que é o
  mesmo `count=exact`. Barra indeterminada.

**Desconfie do que tem procedência fraca.** O campo `procedencia` de
`mercado.json` separa o que foi verificado por busca do que veio de
conhecimento de treino. O proxy do contêiner bloqueou parte da medição, e o
item de acervo em português entrou na fila com uma medição como primeira
entrega justamente por isso.

## O que já saiu daqui

A primeira coisa que o ciclo produziu foram três defeitos **vivos** que
ninguém tinha visto, todos corrigidos antes de qualquer feature nova:

1. livro sem capa deixava a pessoa presa na tela — o chevron de voltar morava
   dentro de um elemento que só existia quando havia capa;
2. visitante sem conta abrindo um link compartilhado tomava `TypeError`;
3. `.voltar` estava fora da lista de área de toque.

E um quarto, ainda por corrigir e o mais caro: **a migração duplica dado**.
`migrar()` envia com `return=minimal` e nunca grava o `remoto`, então quem
migra e depois edita uma resenha ganha uma segunda linha no servidor.

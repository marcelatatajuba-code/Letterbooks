---
name: ciclo
description: Roda uma volta completa do ciclo SDD do Letterbooks com o time de agentes — descoberta (produto, mercado, design em paralelo), curadoria num backlog único, especificação por item, e validação técnica. Use quando quiser decidir e especificar o que entra na próxima entrega, não para tarefa pontual.
---

# Uma volta do ciclo SDD

Orquestração multiagente. **Só vale a pena quando o assunto é "o que fazer a
seguir"** — para tarefa pontual, chame o agente do papel direto (`produto`,
`design`, `gpm`, `tech-lead`, `tester`, `harness`).

## A forma

```
   dentro do script (agentes)         │  fora do script (uma frente só)
                                      │
Descoberta  produto·mercado·design    │
     ↓        (paralelo)              │
Curadoria   backlog único             │
     ↓                                │
Especificação  GPM → design           │
     ↓        (pipeline, 4 itens)     │
Validação   tech lead vs. código      │
     ↓                                │
Revisão     QA, plano de teste        │
            ANTES de existir código   │
     └────────────────────────────────┼→  Implementação, UM item por vez
                                      │        ↓
                                      │   /verificar
                                      │        ↓
                                      │   commit + push
                                      │        ↓
                                      │   volta à implementação, ou ao
                                      │   script quando o backlog acabar
```

**O script termina na Revisão de propósito, e isso não é o ciclo parando.**
A implementação fica fora porque `js/app.js` tem ~3000 linhas e quase toda
tela passa por ele: agentes editando esse arquivo em paralelo se sobrescrevem,
e trabalho perdido em silêncio custa mais do que o paralelismo rende.

Quem quiser automatizar mais deste laço deve automatizar a **verificação**,
não a implementação.

**Cuidado com a leitura errada desta regra, porque ela já foi feita.** "A
implementação fica fora do script" é sobre a EDIÇÃO ser serial — `js/app.js`
não aceita duas mãos ao mesmo tempo. Não é sobre trabalhar sozinho.
Especificar, validar contra o código, planejar o teste e revisar antes de subir
não encostam em `js/app.js`: são trabalho de agente, e fazê-los sozinho é
desperdiçar a squad inteira. As entregas V5 e V6 saíram assim, sem nenhum
papel acionado, e ninguém notou até a dona do projeto perguntar.

**Por item, a volta híbrida é:**

```
gpm + design + tech-lead   (paralelo, só leem)   → especificação e plano
        ↓
eu, sozinho, em série                            → a edição
        ↓
tester                                           → verificação e o ciclo
        ↓
tech-lead                                        → revisão antes de subir
```

## Regras que o ciclo carrega

1. **Fidelidade ganha de novidade.** Item que o original faz e nós não sobe na
   frente de feature nova, empatados os outros critérios.
2. **Nenhum agente escreve no repositório.** Eles devolvem dado estruturado;
   quem escreve é uma frente só. Catorze agentes editando `js/app.js` em
   paralelo se sobrescrevem.
3. **Mercado declara procedência.** O que foi verificado por busca nesta
   sessão e o que veio de conhecimento de treino. Decisão de investimento sai
   daí.
4. **Design reusa antes de criar**, e justifica por que nenhum componente
   existente servia.
5. **O que for cortado, é listado.** Cortar em silêncio é pior que cortar.

## Rodar

O script vive em `docs/ciclo-sdd.js`. Invoque com a ferramenta Workflow
apontando `scriptPath` para ele. Ele lê o repositório, não recebe estado por
parâmetro — então roda igual em qualquer sessão.

**Os agentes de `.claude/agents/` podem não estar carregados.** Eles só são
registrados quando a sessão abre NESTE diretório. Desde que o Letterbooks
virou repositório próprio, uma sessão que começa noutra pasta não os enxerga —
e a chamada falha com "agent type not found", que é fácil de confundir com "a
squad não serve aqui". Quando isso acontecer, chame um agente `general-purpose`
e **cole o conteúdo do arquivo do papel no começo do prompt**. Funciona igual;
o papel é o texto, não o registro.

Depois de rodar: **leia o plano do tech lead antes de implementar**. Ele é
quem diz o que colide e em que ordem.

## Quando parar

Não quando o backlog acabar — backlog sempre volta a encher.

```bash
python3 docs/processo/portoes.py
```

Ele mede o **portão 1 (fidelidade)** e o **portão 2 (solidez)**, e devolve
código 0 só quando os dois fecham. Enquanto algum estiver aberto, o ciclo dá
outra volta.

Quando os dois fecharem, o ciclo **não termina — troca de combustível**. O que
decide competitividade dali em diante é o **portão 3**, que precisa de gente
usando e não se fecha com mais volta de agente: alguém de fora usando uma
semana sem pedir ajuda, retenção de primeira semana, cobertura do acervo em
português medida, e alguém compartilhando um link por vontade própria.

Chamar o app de competitivo com os dois primeiros portões fechados seria
confundir o que dá para medir daqui com o que decide a coisa.

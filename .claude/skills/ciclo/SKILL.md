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
Descoberta   produto · mercado · design          (paralelo, não conversam)
     ↓
Curadoria    um backlog único, ordenado          (fidelidade ganha de novidade)
     ↓
Especificação  GPM → design, por item            (pipeline, 4 primeiros)
     ↓
Validação    tech lead contra o código real      (viabilidade, ordem, colisões)
     ↓
Implementação  em SÉRIE                          (js/app.js é gargalo)
     ↓
Verificação  /verificar
     ↓
Publicação   commit + push (o Pages publica sozinho)
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

Depois de rodar: **leia o plano do tech lead antes de implementar**. Ele é
quem diz o que colide e em que ordem.

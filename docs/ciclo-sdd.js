export const meta = {
  name: 'sdd-letterbooks',
  description: 'Ciclo SDD do Letterbooks: produto, mercado e design em paralelo, curadoria, especificação por item e validação técnica',
  phases: [
    { title: 'Descoberta', detail: 'produto, mercado e design system, em paralelo' },
    { title: 'Curadoria', detail: 'unifica num backlog único e priorizado' },
    { title: 'Especificação', detail: 'história + DoR/DoD + casos de uso, e spec de design, por item' },
    { title: 'Validação', detail: 'tech lead confere viabilidade contra o código real' },
  ],
}

const REPO = '/home/user/letterbooks'

const CONTEXTO = `
PROJETO: Letterbooks — um "Letterboxd para livros". Repositório em ${REPO}.
Pilha: PWA em JavaScript puro (ES5-ish, var, sem framework, sem build), CSS
com custom properties, service worker. Acervo: API pública da Open Library.
Contas e camada social: Supabase (Postgres + RLS + PostgREST), já no ar.

NÃO É um app iOS nativo. Não há Xcode nem macOS neste ambiente. Qualquer
proposta que exija Swift/SwiftUI é inviável aqui — o alvo é o PWA, que instala
na tela do iPhone.

Arquivos que importam:
  index.html            casca: topo, barra de abas de baixo
  css/app.css           ~1400 linhas, paleta em :root, tudo por token
  js/api.js             Open Library
  js/dados.js           estado local (localStorage) + observador de mudanças
  js/nuvem.js           Supabase: conta, sessão, escrita, social
  js/sinc.js            fila de sincronização local→nuvem
  js/app.js             ~3000 linhas: roteador por hash + todas as telas
  servidor/esquema.sql  10 tabelas, RLS, view feed, gatilho de cadastro
  docs/mapa_dados.py    inventário das 24 telas do Letterboxd, tirado do vídeo
  docs/rastreador.py    rastreador autônomo (crawling + self-healing)
  docs/jornada_e2e.py   jornada de ponta a ponta com duas contas

REGRA DE IDENTIDADE: o pedido da dona do projeto é fidelidade total ao
original no que o original já faz. Feature nova é BEM-VINDA, mas tem que vir
marcada como nova, nunca disfarçada de "como no Letterboxd".

Leia o código de verdade antes de afirmar o que existe. Não confie em suposição.
`

const F_PRODUTO = {
  type: 'object',
  required: ['features', 'lacunas', 'observacoes'],
  properties: {
    features: {
      type: 'array',
      items: {
        type: 'object',
        required: ['nome', 'area', 'noOriginal', 'noLetterbooks', 'estado'],
        properties: {
          nome: { type: 'string' },
          area: { type: 'string', description: 'Livros, Buscar, Registrar, Atividade, Perfil, Sistema' },
          noOriginal: { type: 'string', description: 'o que o Letterboxd faz, em uma frase' },
          noLetterbooks: { type: 'string', description: 'o que existe hoje, com arquivo e função quando houver' },
          estado: { type: 'string', enum: ['completo', 'parcial', 'ausente', 'fora-de-escopo'] },
          evidencia: { type: 'string', description: 'arquivo:linha ou nome de função que comprova' },
        },
      },
    },
    lacunas: {
      type: 'array',
      items: {
        type: 'object',
        required: ['titulo', 'porque', 'esforco'],
        properties: {
          titulo: { type: 'string' },
          porque: { type: 'string', description: 'que dor de uso isso deixa em aberto' },
          esforco: { type: 'string', enum: ['P', 'M', 'G'] },
        },
      },
    },
    observacoes: { type: 'string' },
  },
}

const F_MERCADO = {
  type: 'object',
  required: ['concorrentes', 'oportunidades', 'procedencia'],
  properties: {
    concorrentes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['nome', 'posicionamento', 'forca', 'fraqueza'],
        properties: {
          nome: { type: 'string' },
          posicionamento: { type: 'string' },
          forca: { type: 'string' },
          fraqueza: { type: 'string' },
        },
      },
    },
    oportunidades: {
      type: 'array',
      items: {
        type: 'object',
        required: ['titulo', 'descricao', 'porqueAgora', 'alcance', 'impacto', 'confianca', 'esforco'],
        properties: {
          titulo: { type: 'string' },
          descricao: { type: 'string' },
          porqueAgora: { type: 'string' },
          alcance: { type: 'integer', description: '1 a 5' },
          impacto: { type: 'integer', description: '1 a 5' },
          confianca: { type: 'integer', description: '1 a 5' },
          esforco: { type: 'integer', description: '1 a 5, onde 5 e mais caro' },
        },
      },
    },
    procedencia: {
      type: 'string',
      description: 'DIGA CLARAMENTE o que foi verificado por busca na web nesta sessão e o que veio de conhecimento de treino, que pode estar desatualizado',
    },
  },
}

const F_DESIGN = {
  type: 'object',
  required: ['tokens', 'componentes', 'regras', 'inconsistencias'],
  properties: {
    tokens: {
      type: 'array',
      items: {
        type: 'object',
        required: ['nome', 'valor', 'papel'],
        properties: { nome: { type: 'string' }, valor: { type: 'string' }, papel: { type: 'string' } },
      },
    },
    componentes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['nome', 'classe', 'quando', 'anatomia'],
        properties: {
          nome: { type: 'string' },
          classe: { type: 'string' },
          quando: { type: 'string', description: 'quando usar, e quando NAO usar' },
          anatomia: { type: 'string' },
        },
      },
    },
    regras: { type: 'array', items: { type: 'string' } },
    inconsistencias: {
      type: 'array',
      items: {
        type: 'object',
        required: ['onde', 'problema', 'correcao'],
        properties: { onde: { type: 'string' }, problema: { type: 'string' }, correcao: { type: 'string' } },
      },
    },
  },
}

const F_BACKLOG = {
  type: 'object',
  required: ['backlog', 'cortados', 'raciocinio'],
  properties: {
    backlog: {
      type: 'array',
      items: {
        type: 'object',
        required: ['ordem', 'titulo', 'tipo', 'resumo', 'valor', 'esforco', 'depende'],
        properties: {
          ordem: { type: 'integer' },
          titulo: { type: 'string' },
          tipo: { type: 'string', enum: ['fidelidade', 'nova'] },
          resumo: { type: 'string' },
          valor: { type: 'string', description: 'que dor resolve, para quem' },
          esforco: { type: 'string', enum: ['P', 'M', 'G'] },
          depende: { type: 'string', description: 'do que depende, ou "nada"' },
        },
      },
    },
    cortados: { type: 'array', items: { type: 'string' } },
    raciocinio: { type: 'string' },
  },
}

const F_HISTORIA = {
  type: 'object',
  required: ['titulo', 'historia', 'contexto', 'definitionOfReady', 'definitionOfDone', 'requisitos', 'casosDeUso', 'aceite'],
  properties: {
    titulo: { type: 'string' },
    historia: { type: 'string', description: 'Como <quem>, quero <o que>, para <por que>' },
    contexto: { type: 'string' },
    definitionOfReady: { type: 'array', items: { type: 'string' } },
    definitionOfDone: { type: 'array', items: { type: 'string' } },
    requisitos: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'texto', 'tipo'],
        properties: {
          id: { type: 'string' },
          texto: { type: 'string' },
          tipo: { type: 'string', enum: ['funcional', 'nao-funcional'] },
        },
      },
    },
    casosDeUso: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'nome', 'ator', 'preCondicao', 'fluxo', 'alternativos', 'posCondicao'],
        properties: {
          id: { type: 'string' },
          nome: { type: 'string' },
          ator: { type: 'string' },
          preCondicao: { type: 'string' },
          fluxo: { type: 'array', items: { type: 'string' } },
          alternativos: { type: 'array', items: { type: 'string' }, description: 'erro, offline, sem conta, dado ausente' },
          posCondicao: { type: 'string' },
        },
      },
    },
    aceite: {
      type: 'array',
      items: {
        type: 'object',
        required: ['dado', 'quando', 'entao'],
        properties: { dado: { type: 'string' }, quando: { type: 'string' }, entao: { type: 'string' } },
      },
    },
  },
}

const F_DESIGN_SPEC = {
  type: 'object',
  required: ['titulo', 'telas', 'componentesNovos', 'reaproveitados', 'estados', 'acessibilidade'],
  properties: {
    titulo: { type: 'string' },
    telas: {
      type: 'array',
      items: {
        type: 'object',
        required: ['rota', 'estrutura', 'referenciaOriginal'],
        properties: {
          rota: { type: 'string' },
          estrutura: { type: 'string', description: 'de cima para baixo, com medidas em px' },
          referenciaOriginal: { type: 'string', description: 'que quadro/tela do Letterboxd embasa, ou "novo" se nao ha' },
        },
      },
    },
    componentesNovos: {
      type: 'array',
      items: {
        type: 'object',
        required: ['classe', 'porqueNaoDeuParaReusar', 'css'],
        properties: { classe: { type: 'string' }, porqueNaoDeuParaReusar: { type: 'string' }, css: { type: 'string' } },
      },
    },
    reaproveitados: { type: 'array', items: { type: 'string' } },
    estados: { type: 'array', items: { type: 'string' }, description: 'vazio, carregando, erro, offline, sem conta' },
    acessibilidade: { type: 'array', items: { type: 'string' } },
  },
}

const F_MARCA = {
  type: 'object',
  required: ['posicionamento', 'promessa', 'tomDeVoz', 'paleta', 'tipografia', 'secoesDoSite', 'nomeDosBotoes'],
  properties: {
    posicionamento: { type: 'string' },
    promessa: { type: 'string', description: 'uma frase, do lado de quem lê' },
    tomDeVoz: { type: 'array', items: { type: 'string' } },
    paleta: { type: 'array', items: { type: 'object', required: ['hex', 'papel'], properties: { hex: { type: 'string' }, papel: { type: 'string' } } } },
    tipografia: { type: 'string' },
    secoesDoSite: {
      type: 'array',
      items: {
        type: 'object',
        required: ['secao', 'titulo', 'texto', 'visual'],
        properties: { secao: { type: 'string' }, titulo: { type: 'string' }, texto: { type: 'string' }, visual: { type: 'string' } },
      },
    },
    nomeDosBotoes: { type: 'array', items: { type: 'string' } },
  },
}

const F_PLANO = {
  type: 'object',
  required: ['viavel', 'inviavel', 'ordem', 'riscos', 'colisoes'],
  properties: {
    viavel: {
      type: 'array',
      items: {
        type: 'object',
        required: ['titulo', 'arquivos', 'passos', 'testes'],
        properties: {
          titulo: { type: 'string' },
          arquivos: { type: 'array', items: { type: 'string' } },
          passos: { type: 'array', items: { type: 'string' } },
          testes: { type: 'array', items: { type: 'string' }, description: 'que verificação prova cada um, em que suíte' },
        },
      },
    },
    inviavel: {
      type: 'array',
      items: {
        type: 'object',
        required: ['titulo', 'porque'],
        properties: { titulo: { type: 'string' }, porque: { type: 'string' } },
      },
    },
    ordem: { type: 'array', items: { type: 'string' }, description: 'ordem de execução, justificada por dependência' },
    riscos: { type: 'array', items: { type: 'string' } },
    colisoes: { type: 'array', items: { type: 'string' }, description: 'itens que mexem no mesmo arquivo e nao podem ir em paralelo' },
  },
}

// ---------------------------------------------------------------- fase 1 ---
phase('Descoberta')
log('Produto, mercado e design system, em paralelo — cada um lendo o código de verdade')

const [produto, mercado, design] = await parallel([
  () => agent(`${CONTEXTO}

VOCÊ É O ESPECIALISTA DE PRODUTO.

Sua tarefa: inventariar TODAS as features do Letterboxd e dizer, feature por
feature, o que o Letterbooks já cumpre.

Como trabalhar:
1. Leia ${REPO}/docs/mapa_dados.py — é o inventário das 24 telas do app
   original, tirado quadro a quadro de um vídeo de uso real. É a sua fonte
   primária do que o original faz.
2. Leia js/app.js, js/nuvem.js, js/dados.js e index.html para saber o que o
   Letterbooks REALMENTE faz. Cite arquivo e função como evidência. Não
   afirme que algo existe sem ter visto.
3. Para cada feature, classifique o estado. "parcial" exige dizer o que
   falta. "fora-de-escopo" exige justificar por que não cabe a livros.

Cubra as seis áreas: Livros (home, grades, ficha), Buscar, Registrar,
Atividade (social), Perfil, e Sistema (PWA, offline, conta, sincronização).

Depois, liste as lacunas: o que falta que MAIS DÓI em uso, não o que é mais
fácil. Ordene por dor.`,
    { label: 'produto:inventário', phase: 'Descoberta', schema: F_PRODUTO }),

  () => agent(`${CONTEXTO}

VOCÊ É O ESPECIALISTA DE PESQUISA DE MERCADO.

Sua tarefa: mapear o mercado de apps sociais de leitura e propor features
NOVAS — coisas que o Letterboxd não tem porque filme não é livro.

Como trabalhar:
1. TENTE buscar na web (WebSearch/WebFetch) dados atuais sobre Goodreads,
   StoryGraph, Fable, Bookwyrm, Skoob (o brasileiro), Literal, Hardcover.
   Se a busca falhar ou vier vazia, DIGA ISSO no campo procedencia.
2. No campo "procedencia", separe explicitamente: o que você VERIFICOU nesta
   sessão, e o que veio de conhecimento de treino e pode estar desatualizado.
   Isso não é formalidade — a dona do projeto vai decidir investimento com
   base nisto, e um número inventado custa caro.
3. Leia o código em ${REPO} para não propor o que já existe.

O produto é brasileiro e a interface é em português. Pense no que isso muda:
acervo em português na Open Library é irregular, ISBN brasileiro, Skoob é o
incumbente local.

Para cada oportunidade dê alcance, impacto, confiança e esforço de 1 a 5
(esforço 5 = mais caro). Proponha entre 6 e 10. Prefira o que só faz sentido
para LIVROS — progresso de página, meta anual, releitura, empréstimo,
audiobook, clube de leitura, citações — a variações genéricas de rede social.`,
    { label: 'mercado:pesquisa', phase: 'Descoberta', schema: F_MERCADO }),

  () => agent(`${CONTEXTO}

VOCÊ É O ESPECIALISTA DE DESIGN.

Sua tarefa: extrair o design system que JÁ EXISTE no Letterbooks e apontar
onde ele se contradiz.

Como trabalhar:
1. Leia ${REPO}/css/app.css inteiro. É a fonte da verdade.
2. Os tokens estão em :root. A paleta foi medida nos pixels do app original:
   fundo #14181c, verde #00e054 (ação/feito), azul #40bcf4 (onde você está),
   laranja #ff8000 (o que você curtiu). Cada acento tem um trabalho FIXO —
   registre essa regra, ela é o que segura a coerência.
3. Catalogue os componentes de verdade: .trilho, .grade, .capa, .cartao,
   .segmentos, .linhas, .resultado, .feed-linha, .botao, .campo, .folha,
   .tabela-diario, .escopos, .selos, .abas-pe, .heroi. Para cada um: quando
   usar E quando não usar.
4. Procure INCONSISTÊNCIAS: mesma coisa resolvida de duas formas, valor
   fixo onde devia haver token, componente que só serve a uma tela,
   tamanho fora da escala. Seja específico com seletor e linha.

As regras devem incluir escala tipográfica, espaçamento, raio, e o mínimo de
área de toque (44px, já corrigido no código — veja o bloco "alvos de toque").`,
    { label: 'design:sistema', phase: 'Descoberta', schema: F_DESIGN }),
])

// ---------------------------------------------------------------- fase 2 ---
phase('Curadoria')
log('Unificando produto + mercado num backlog único')

const backlog = await agent(`${CONTEXTO}

VOCÊ É O ORQUESTRADOR DE CURADORIA. Duas frentes trabalharam em paralelo e
agora precisam virar UMA fila.

DO ESPECIALISTA DE PRODUTO (o que falta para ter identidade com o original):
${JSON.stringify({ lacunas: produto ? produto.lacunas : [], parciais: produto ? produto.features.filter(f => f.estado !== 'completo') : [] }, null, 1)}

DO ESPECIALISTA DE MERCADO (o que o original não tem e livros pedem):
${JSON.stringify(mercado ? mercado.oportunidades : [], null, 1)}

Procedência declarada pela pesquisa de mercado:
${mercado ? mercado.procedencia : '(sem retorno)'}

SUA TAREFA: um backlog único, ordenado, de 8 a 12 itens.

Critérios, nesta ordem de peso:
1. FIDELIDADE PRIMEIRO. A dona pediu identidade total com o original. Item de
   fidelidade empata com item novo? Fidelidade ganha.
2. Dependência. O que destrava outros itens sobe.
3. Dor sobre facilidade. Não ordene por esforço.
4. Desconfie de oportunidade de mercado cuja procedência for "conhecimento de
   treino" sem verificação. Ela pode entrar, mas não no topo, e o
   raciocínio tem que dizer isso.

Marque o tipo de cada item: "fidelidade" (o original faz e nós não) ou "nova"
(o original não faz). Nunca disfarce item novo de fidelidade.

Em "cortados", liste o que você tirou e por quê — cortar em silêncio é pior
que cortar.`,
  { label: 'curadoria:backlog', schema: F_BACKLOG })

const topo = (backlog && backlog.backlog ? backlog.backlog : []).slice(0, 4)
log(`Backlog com ${backlog && backlog.backlog ? backlog.backlog.length : 0} itens. Especificando os ${topo.length} primeiros.`)

// ---------------------------------------------------------------- fase 3 ---
phase('Especificação')

const specs = await pipeline(
  topo,
  (item, _orig, i) => agent(`${CONTEXTO}

VOCÊ É O GPM. Escreva a especificação completa deste item do backlog.

ITEM ${i + 1}: ${item.titulo} (${item.tipo})
Resumo: ${item.resumo}
Valor: ${item.valor}
Depende de: ${item.depende}

Leia o código em ${REPO} antes de escrever — a especificação tem que caber no
que existe, e citar as funções e rotas reais.

Exigências:
· Definition of Ready: o que precisa estar decidido ANTES de alguém codar.
· Definition of Done: como se sabe que acabou. Inclua verificação
  automatizada — as suítes reais são docs/jornada_e2e.py, docs/testar_social.py,
  docs/rastreador.py e a suíte local de ponta a ponta.
· Casos de uso com fluxo principal E alternativos. Os alternativos que
  importam neste app: sem conta, offline (existe fila de sincronização em
  js/sinc.js), livro sem capa, campo da Open Library ausente, erro do
  servidor. Um caso de uso sem caminho de erro está incompleto.
· Critérios de aceite em Dado/Quando/Então, testáveis.`,
    { label: `gpm:${item.titulo}`.slice(0, 46), phase: 'Especificação', schema: F_HISTORIA }),

  (historia, item) => agent(`${CONTEXTO}

VOCÊ É O ESPECIALISTA DE DESIGN. Especifique a interface deste item, dentro
do design system que já existe.

ITEM: ${item.titulo}
História: ${historia ? historia.historia : item.resumo}
Casos de uso: ${JSON.stringify(historia ? historia.casosDeUso.map(c => c.nome) : [], null, 1)}

DESIGN SYSTEM VIGENTE (extraído do css/app.css real):
Tokens: ${JSON.stringify(design ? design.tokens : [], null, 1)}
Componentes: ${JSON.stringify(design ? design.componentes.map(c => c.classe + ' — ' + c.quando) : [], null, 1)}
Regras: ${JSON.stringify(design ? design.regras : [], null, 1)}

REGRAS DURAS:
1. REUSE ANTES DE CRIAR. Todo componente novo tem que justificar por que
   nenhum dos existentes servia. Componente novo sem justificativa é dívida.
2. Verde = ação e feito. Azul = onde você está. Laranja = o que você curtiu.
   Não invente papel novo para cor existente nem cor nova para papel existente.
3. Estrutura de cima para baixo com medidas em px, na largura de 390.
4. Área de toque mínima de 44px em qualquer controle.
5. Diga qual tela do Letterboxd embasa cada uma — ou escreva "novo"
   explicitamente se não há referência. Não invente uma referência.
6. Estados obrigatórios: vazio, carregando, erro, offline, sem conta.
   Uma tela que só desenhou o caminho feliz não está especificada.`,
    { label: `design:${item.titulo}`.slice(0, 46), phase: 'Especificação', schema: F_DESIGN_SPEC }),
)

const marca = await agent(`${CONTEXTO}

VOCÊ É O ESPECIALISTA DE DESIGN, agora na identidade de marca.

Tarefa: definir a identidade do Letterbooks e a estrutura do site de
apresentação — a página que alguém abre ANTES de usar o app.

Restrições reais:
· A paleta e a tipografia do app vieram de medir os pixels do Letterboxd:
  fundo #14181c, verde #00e054, azul #40bcf4, laranja #ff8000, tipo Inter.
  A dona pediu explicitamente esse mesmo padrão de cores.
· O logo é uma estante: três lombadas de livro nas três cores da marca sobre
  fundo escuro (veja icons/ e a marca em index.html).
· A promessa tem que ser do lado de quem lê, não do lado do sistema.
· O produto é brasileiro, a interface é em português.

Onde você TEM liberdade: o site de apresentação não é o app. Ele pode ter
respiro, escala tipográfica maior e um momento de destaque que o app não tem.

Escreva o texto de verdade de cada seção — nada de "aqui vai a descrição".
E os nomes reais dos botões, do jeito que aparecem na tela.`,
  { label: 'marca:identidade', phase: 'Especificação', schema: F_MARCA })

// ---------------------------------------------------------------- fase 4 ---
phase('Validação')
log('Tech lead conferindo viabilidade contra o código real')

const plano = await agent(`${CONTEXTO}

VOCÊ É O TECH LEAD. As especificações abaixo vão virar código. Sua tarefa é
dizer o que cabe, o que não cabe, e em que ordem.

ESPECIFICAÇÕES:
${JSON.stringify(specs.filter(Boolean).map(s => s && s.titulo ? { titulo: s.titulo, telas: s.telas } : s), null, 1)}

BACKLOG COMPLETO:
${JSON.stringify(backlog ? backlog.backlog : [], null, 1)}

Como trabalhar:
1. LEIA O CÓDIGO. js/app.js tem cerca de 3000 linhas e um roteador por hash;
   js/nuvem.js fala com o Supabase; servidor/esquema.sql define as tabelas e
   as políticas de RLS. Uma feature que exige coluna nova exige migração — e
   migração de RLS é onde vaza dado.
2. Para cada item viável: quais ARQUIVOS mexe, quais PASSOS, e qual
   VERIFICAÇÃO prova que funcionou (em qual das suítes reais).
3. Marque como inviável o que este ambiente não faz: nada de iOS nativo, nada
   que exija serviço pago, nada que dependa de host bloqueado pela política de
   rede do contêiner (a Open Library e o Supabase não são alcançáveis de
   dentro do ambiente de desenvolvimento — só do navegador da usuária).
4. COLISÕES: aponte quais itens mexem no mesmo arquivo e portanto NÃO podem
   ser feitos em paralelo. js/app.js é o gargalo — quase tudo passa por ele.
5. Riscos: o que pode quebrar em produção e não aparece em teste.

Seja duro. Especificação bonita que não cabe no código custa mais do que
especificação que já nasce recortada.`,
  { label: 'techlead:plano', schema: F_PLANO })

return {
  produto,
  mercado,
  design,
  backlog,
  especificacoes: specs.filter(Boolean),
  marca,
  plano,
}

/* ============================================================================
   dados.js — a "conta" da pessoa, guardada no proprio aparelho.

   O Letterbooks nao tem servidor: tudo o que voce registra (leituras, estrelas,
   resenhas, listas) fica no localStorage do navegador. Isso quer dizer que os
   dados sao seus e ficam offline, mas tambem que nao sincronizam entre
   aparelhos — por isso existe o exportar/importar no fim deste arquivo.

   Formato guardado:

   {
     versao: 1,
     perfil:    { nome, bio, meta },
     livros:    { chave: {...livro} },        // cache das fichas ja vistas
     logs:      [ {id, chave, nota, resenha, lidoEm, relido, spoiler, criadoEm} ],
     querLer:   [ chave ],
     curtidas:  [ chave ],
     favoritos: [ chave ],                    // no maximo 4, como as vitrines
     listas:    [ {id, nome, descricao, livros: [chave], criadoEm} ],
     buscas:    [ termo ]                     // as ultimas buscas, para repetir
   }
   ========================================================================== */
var Dados = (function () {
  'use strict';

  var CHAVE_LS = 'letterbooks:v1';
  var MAX_FAVORITOS = 4;

  var vazio = {
    versao: 1,
    perfil: { nome: 'Leitora', bio: '', meta: { ano: new Date().getFullYear(), total: 12 } },
    livros: {},
    logs: [],
    querLer: [],
    curtidas: [],
    favoritos: [],
    listas: [],
    buscas: []
  };

  var estado = carregar();

  function carregar() {
    try {
      var cru = localStorage.getItem(CHAVE_LS);
      if (!cru) return clonar(vazio);
      var d = JSON.parse(cru);
      /* Completa campos que possam faltar de uma versao anterior. */
      for (var k in vazio) if (d[k] === undefined) d[k] = clonar(vazio[k]);
      return d;
    } catch (e) {
      return clonar(vazio);
    }
  }

  function salvar() {
    try {
      localStorage.setItem(CHAVE_LS, JSON.stringify(estado));
    } catch (e) {
      /* Cota estourada ou navegacao privada: o app segue funcionando na sessao. */
      console.warn('Nao foi possivel gravar no aparelho:', e);
    }
    return estado;
  }

  /* Quem quiser saber que algo mudou aqui. E por onde a sincronizacao com a
     nuvem escuta: o Dados nao conhece a nuvem, so anuncia o que aconteceu, e
     quem se importa que se vire. Sem isso a sincronizacao teria que ser
     chamada em cada ponto do app.js que escreve — e um deles ia ficar de
     fora, cedo ou tarde. */
  var ouvintes = [];
  function aoMudar(f) { ouvintes.push(f); return f; }
  function anunciar(tipo, dado) {
    for (var i = 0; i < ouvintes.length; i++) {
      try { ouvintes[i](tipo, dado); } catch (e) { console.warn('ouvinte:', e); }
    }
  }

  function clonar(o) { return JSON.parse(JSON.stringify(o)); }
  function id() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function hoje() { return new Date().toISOString().slice(0, 10); }

  /* ------------------------------------------------------------ ficha lida */

  /* Guarda a ficha do livro para que diario, estante e listas consigam mostrar
     capa e titulo sem precisar consultar a rede de novo. */
  function guardarLivro(livro) {
    if (!livro || !livro.chave) return livro;
    var atual = estado.livros[livro.chave] || {};
    /* Nao deixa um resultado de busca mais pobre apagar dados ja conhecidos. */
    for (var k in livro) if (livro[k] !== null && livro[k] !== undefined) atual[k] = livro[k];
    atual.chave = livro.chave;
    estado.livros[livro.chave] = atual;
    salvar();
    return atual;
  }

  function livro(chave) { return estado.livros[chave] || null; }

  /* ---------------------------------------------------------------- leituras */

  /* Registra ou atualiza uma leitura. Como no Letterboxd, um mesmo livro pode
     ter varias entradas — cada releitura e uma linha nova no diario. */
  function registrar(entrada) {
    var reg;
    if (entrada.id) {
      reg = estado.logs.filter(function (l) { return l.id === entrada.id; })[0];
      if (!reg) return null;
    } else {
      reg = { id: id(), criadoEm: new Date().toISOString() };
      estado.logs.unshift(reg);
    }
    reg.chave   = entrada.chave;
    reg.nota    = typeof entrada.nota === 'number' ? entrada.nota : null;
    reg.resenha = entrada.resenha || '';
    reg.lidoEm  = entrada.lidoEm || hoje();
    reg.relido  = !!entrada.relido;
    reg.spoiler = !!entrada.spoiler;
    salvar();
    anunciar('leitura', reg);
    return reg;
  }

  function apagarLog(idLog) {
    var saindo = log(idLog);
    estado.logs = estado.logs.filter(function (l) { return l.id !== idLog; });
    salvar();
    if (saindo) anunciar('leitura-apagada', saindo);
    return estado;
  }

  function log(idLog) {
    return estado.logs.filter(function (l) { return l.id === idLog; })[0] || null;
  }

  function listaPorRemoto(idRemoto) {
    if (!idRemoto) return null;
    return estado.listas.filter(function (l) { return l.remoto === idRemoto; })[0] || null;
  }

  function marcarRemotoLista(idLista, idRemoto) {
    var l = lista(idLista);
    if (!l) return null;
    l.remoto = idRemoto;
    salvar();
    return l;
  }

  /* O caminho inverso: da linha do servidor de volta para a do aparelho. A
     pagina da resenha usa isto como plano B — se o endereco publico nao
     responde (apagado noutro aparelho, servidor fora), a resenha esta INTACTA
     aqui e nao pode ficar inalcancavel a partir do proprio diario de quem
     escreveu. */
  function logPorRemoto(idRemoto) {
    if (!idRemoto) return null;
    return estado.logs.filter(function (l) { return l.remoto === idRemoto; })[0] || null;
  }

  /* O id que o banco deu para esta leitura. E o que liga a linha daqui a
     linha de la — sem ele, editar uma resenha no aparelho criaria uma
     segunda leitura no servidor em vez de corrigir a primeira. */
  function marcarRemoto(idLog, idRemoto) {
    var l = log(idLog);
    if (!l) return null;
    l.remoto = idRemoto;
    salvar();
    return l;
  }

  /* Do mais recente para o mais antigo, pela data de leitura. */
  function logs() {
    return estado.logs.slice().sort(function (a, b) {
      return (b.lidoEm || '').localeCompare(a.lidoEm || '') ||
             (b.criadoEm || '').localeCompare(a.criadoEm || '');
    });
  }

  function logsDo(chave) {
    return logs().filter(function (l) { return l.chave === chave; });
  }

  function jaLeu(chave) { return logsDo(chave).length > 0; }

  /* A nota que vale e a da leitura mais recente. */
  function notaDe(chave) {
    var l = logsDo(chave).filter(function (x) { return typeof x.nota === 'number'; })[0];
    return l ? l.nota : null;
  }

  /* ------------------------------------------------------------------ fusao */

  /* Junta o que veio da conta com o que ja esta no aparelho.

     A regra que atravessa a funcao: NUNCA APAGA NADA DO APARELHO. Se as duas
     versoes existem, a de la ganha nos campos — porque foi a ultima a subir de
     algum aparelho — mas a linha daqui nunca some. Perder resenha por conta de
     uma fusao seria o pior defeito possivel neste app, e "some sem avisar" e
     como isso apareceria.

     Casa em duas passadas: primeiro por cliente_id (o id que o aparelho deu, e
     que a linha de la carrega), depois pelo id do servidor ja anotado aqui.
     O que nao casar em nenhuma das duas e leitura de outro aparelho, e entra.

     Devolve as contagens que a tela mostra — e elas sao contagens de verdade,
     nao estimativa: quem desenha a tela nao inventa numero. */
  /* A chave do terceiro casamento, abaixo. Livro + dia + nota + resenha: quatro
     campos iguais sao a mesma leitura para qualquer efeito pratico. So livro +
     dia — que e a regra do backfill em SQL — juntaria duas releituras do mesmo
     dia com resenhas diferentes, e essas sao duas de verdade. */
  function assinaturaDaLeitura(chave, dia, nota, resenha) {
    return chave + '|' + dia + '|' +
           (typeof nota === 'number' ? nota : '') + '|' + (resenha || '');
  }

  function fundir(remotas, marcadoresRemotos) {
    var porCliente = {}, porRemoto = {}, orfas = {};
    estado.logs.forEach(function (l) {
      porCliente[l.id] = l;
      if (l.remoto) porRemoto[l.remoto] = l;
      /* Leitura local que ainda nao esta amarrada a nenhuma linha do servidor.
         So estas participam do terceiro casamento. */
      else orfas[assinaturaDaLeitura(l.chave, l.lidoEm, l.nota, l.resenha)] = l;
    });

    var vieram = 0, jaEstavam = 0, adotar = [];

    (remotas || []).forEach(function (r) {
      var local = (r.cliente_id && porCliente[r.cliente_id]) || porRemoto[r.id];

      /* TERCEIRO CASAMENTO, e ele existe por causa de um banco que ainda nao
         rodou o esquema.sql da V1. Antes dela toda leitura subia sem
         cliente_id; o backfill preenche essas linhas, mas se ele nao rodou a
         linha volta orfa, nao casa por cliente_id nem por remoto, e a descida
         DUPLICA o diario inteiro em silencio — no aparelho e, na subida
         seguinte, no servidor tambem. Quem instalou o Supabase antes da V1 e
         nao reexecutou o SQL esta exatamente nesse estado agora.

         Casada a linha, ela entra em `adotar`: o Sinc grava o cliente_id nela
         no servidor, e a partir dai o caminho normal de upsert funciona
         sozinho. E conserto de uma vez, nao remendo a cada descida. */
      if (!local && !r.cliente_id) {
        var assinatura = assinaturaDaLeitura(r.livro, r.lido_em, r.nota, r.resenha);
        local = orfas[assinatura];
        if (local) {
          delete orfas[assinatura];   /* uma linha do servidor por leitura local */
          adotar.push({ remoto: r.id, cliente_id: local.id });
        }
      }

      if (local) {
        local.remoto  = r.id;
        local.nota    = typeof r.nota === 'number' ? r.nota : null;
        local.resenha = r.resenha || '';
        local.lidoEm  = r.lido_em;
        local.relido  = !!r.relido;
        local.spoiler = !!r.spoiler;
        jaEstavam++;
        return;
      }
      /* Leitura de outro aparelho. O id local passa a ser o cliente_id que ela
         ja tem, para nao nascer com uma identidade nova e subir duplicada na
         proxima sincronizacao. */
      var novo = {
        id:       r.cliente_id || ('srv-' + String(r.id).replace(/-/g, '')),
        remoto:   r.id,
        chave:    r.livro,
        nota:     typeof r.nota === 'number' ? r.nota : null,
        resenha:  r.resenha || '',
        lidoEm:   r.lido_em,
        relido:   !!r.relido,
        spoiler:  !!r.spoiler,
        criadoEm: r.criado_em || new Date().toISOString()
      };
      estado.logs.push(novo);
      porCliente[novo.id] = novo;
      porRemoto[r.id] = novo;
      vieram++;
    });

    var marcadores = 0;
    var COLECAO = { quero: 'querLer', curtida: 'curtidas', favorito: 'favoritos' };
    (marcadoresRemotos || []).forEach(function (m) {
      var col = COLECAO[m.tipo];
      if (!col) return;
      if (estado[col].indexOf(m.livro) < 0) { estado[col].unshift(m.livro); marcadores++; }
    });

    salvar();
    return { vieram: vieram, jaEstavam: jaEstavam, marcadores: marcadores,
             adotar: adotar,
             subiram: estado.logs.length - vieram - jaEstavam };
  }

  /* Junta as listas da conta com as do aparelho. Mesma regra da fusao das
     leituras, e pelos mesmos motivos: NUNCA apaga nada daqui, e casa em tres
     passos — cliente_id, depois remoto, depois assinatura, para o banco que
     ainda nao rodou o backfill nao duplicar a lista inteira em silencio.

     A assinatura de uma lista e o NOME. Nao inclui os itens de proposito: se
     incluisse, a mesma lista com um livro a mais de um lado viraria duas, que
     e exatamente o contrario do que a fusao serve para fazer. Duas listas com
     o mesmo nome sao raras e, quando existem, virar uma so e o mal menor
     perto de duplicar o acervo de listas de quem migrou. */
  function fundirListas(remotas) {
    var porCliente = {}, porRemoto = {}, orfas = {};
    estado.listas.forEach(function (l) {
      porCliente[l.id] = l;
      if (l.remoto) porRemoto[l.remoto] = l;
      else orfas[(l.nome || '').trim().toLowerCase()] = l;
    });

    var vieram = 0, jaEstavam = 0, adotar = [];

    (remotas || []).forEach(function (r) {
      var local = (r.cliente_id && porCliente[r.cliente_id]) || porRemoto[r.id];
      if (!local && !r.cliente_id) {
        var chave = (r.nome || '').trim().toLowerCase();
        local = orfas[chave];
        if (local) {
          delete orfas[chave];
          adotar.push({ remoto: r.id, cliente_id: local.id });
        }
      }

      /* Os itens: a uniao dos dois lados. Some quem tirou o livro lá e ele
         some daqui? Nao — sem um registro de "tirei", a diferenca entre "voce
         tirou la" e "voce acrescentou aqui e ainda nao subiu" e indistinguivel,
         e apagar no escuro e o unico erro que nao da para desfazer. */
      var deLa = (r.lista_itens || [])
        .slice().sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0); })
        .map(function (i) { return i.livro; });

      if (local) {
        local.remoto = r.id;
        local.nome = r.nome || local.nome;
        local.descricao = r.descricao || '';
        deLa.forEach(function (c) {
          if (local.livros.indexOf(c) < 0) local.livros.push(c);
        });
        jaEstavam++;
        return;
      }

      var nova = {
        id: r.cliente_id || ('srv-' + String(r.id).replace(/-/g, '')),
        remoto: r.id, nome: r.nome || 'Lista', descricao: r.descricao || '',
        livros: deLa, criadoEm: r.criado_em || new Date().toISOString()
      };
      estado.listas.push(nova);
      porCliente[nova.id] = nova;
      porRemoto[r.id] = nova;
      vieram++;
    });

    salvar();
    return { vieram: vieram, jaEstavam: jaEstavam, adotar: adotar };
  }

  /* ------------------------------------------------- listas de marcacao rapida */

  function alterna(colecao, chave, limite) {
    var i = estado[colecao].indexOf(chave);
    if (i >= 0) estado[colecao].splice(i, 1);
    else {
      if (limite && estado[colecao].length >= limite) return { ok: false, cheio: true };
      estado[colecao].unshift(chave);
    }
    salvar();
    var ativo = estado[colecao].indexOf(chave) >= 0;
    anunciar('marcador', { colecao: colecao, chave: chave, ativo: ativo });
    return { ok: true, ativo: ativo };
  }

  function tem(colecao, chave) { return estado[colecao].indexOf(chave) >= 0; }

  /* ------------------------------------------------------------------ listas */

  function criarLista(nome, descricao) {
    var l = {
      id: id(), nome: nome || 'Nova lista', descricao: descricao || '',
      livros: [], criadoEm: new Date().toISOString()
    };
    estado.listas.unshift(l);
    salvar();
    anunciar('lista', l);
    return l;
  }

  function lista(idLista) {
    return estado.listas.filter(function (l) { return l.id === idLista; })[0] || null;
  }

  function editarLista(idLista, campos) {
    var l = lista(idLista);
    if (!l) return null;
    if (campos.nome !== undefined) l.nome = campos.nome;
    if (campos.descricao !== undefined) l.descricao = campos.descricao;
    salvar();
    anunciar('lista', l);
    return l;
  }

  function apagarLista(idLista) {
    var saindo = lista(idLista);
    estado.listas = estado.listas.filter(function (l) { return l.id !== idLista; });
    salvar();
    if (saindo) anunciar('lista-apagada', saindo);
    return estado;
  }

  function alternarNaLista(idLista, chave) {
    var l = lista(idLista);
    if (!l) return null;
    var i = l.livros.indexOf(chave);
    if (i >= 0) l.livros.splice(i, 1); else l.livros.push(chave);
    salvar();
    /* A fila manda o ESTADO da lista, nao o movimento: reenviar duas vezes o
       mesmo estado nao duplica item nenhum, e um envio perdido se conserta
       sozinho no proximo. */
    anunciar('lista', l);
    return l.livros.indexOf(chave) >= 0;
  }

  /* ------------------------------------------------------------ buscas */

  var MAX_BUSCAS = 8;

  /* Guarda o termo no topo da lista, sem repetir. */
  function registrarBusca(termo) {
    termo = String(termo || '').trim();
    if (termo.length < 2) return estado.buscas;
    estado.buscas = [termo].concat(
      estado.buscas.filter(function (b) { return b.toLowerCase() !== termo.toLowerCase(); })
    ).slice(0, MAX_BUSCAS);
    salvar();
    return estado.buscas;
  }

  function esquecerBuscas() { estado.buscas = []; return salvar(); }

  /* ------------------------------------------------------------ estatisticas */

  function estatisticas() {
    var todos = logs();
    var comNota = todos.filter(function (l) { return typeof l.nota === 'number'; });
    var soma = comNota.reduce(function (s, l) { return s + l.nota; }, 0);
    var ano = String(estado.perfil.meta.ano);
    var noAno = todos.filter(function (l) { return (l.lidoEm || '').slice(0, 4) === ano; });

    var paginas = todos.reduce(function (s, l) {
      var b = estado.livros[l.chave];
      return s + ((b && b.paginas) || 0);
    }, 0);

    /* Distribuicao das notas em meias-estrelas, de 0,5 a 5 — o grafico do perfil. */
    var faixas = [];
    for (var i = 1; i <= 10; i++) {
      var v = i / 2;
      faixas.push({
        nota: v,
        qtd: comNota.filter(function (l) { return l.nota === v; }).length
      });
    }

    return {
      lidos:      todos.length,
      obras:      Object.keys(todos.reduce(function (m, l) { m[l.chave] = 1; return m; }, {})).length,
      noAno:      noAno.length,
      meta:       estado.perfil.meta.total,
      resenhas:   todos.filter(function (l) { return l.resenha; }).length,
      media:      comNota.length ? soma / comNota.length : null,
      paginas:    paginas,
      querLer:    estado.querLer.length,
      curtidas:   estado.curtidas.length,
      listas:     estado.listas.length,
      faixas:     faixas
    };
  }

  /* --------------------------------------------------------- exportar/importar */

  function exportar() {
    return JSON.stringify(estado, null, 2);
  }

  function importar(texto) {
    var d = JSON.parse(texto);
    if (!d || typeof d !== 'object' || !d.versao) throw new Error('Arquivo fora do formato do Letterbooks.');
    for (var k in vazio) if (d[k] === undefined) d[k] = clonar(vazio[k]);
    estado = d;
    salvar();
    return estado;
  }

  function limpar() {
    estado = clonar(vazio);
    return salvar();
  }

  return {
    estado:     function () { return estado; },
    aoMudar:    aoMudar,
    marcarRemoto: marcarRemoto,
    fundir:     fundir,
    salvar:     salvar,
    guardarLivro: guardarLivro,
    livro:      livro,

    registrar:  registrar,
    apagarLog:  apagarLog,
    log:        log,
    logPorRemoto: logPorRemoto,
    marcarRemotoLista: marcarRemotoLista,
    listaPorRemoto: listaPorRemoto,
    fundirListas: fundirListas,
    logs:       logs,
    logsDo:     logsDo,
    jaLeu:      jaLeu,
    notaDe:     notaDe,

    querLer:        function (c) { return tem('querLer', c); },
    alternarQuerLer: function (c) { return alterna('querLer', c); },
    curtido:        function (c) { return tem('curtidas', c); },
    alternarCurtida: function (c) { return alterna('curtidas', c); },
    favorito:       function (c) { return tem('favoritos', c); },
    alternarFavorito: function (c) { return alterna('favoritos', c, MAX_FAVORITOS); },
    MAX_FAVORITOS:  MAX_FAVORITOS,

    criarLista:     criarLista,
    lista:          lista,
    editarLista:    editarLista,
    apagarLista:    apagarLista,
    alternarNaLista: alternarNaLista,

    buscas:         function () { return estado.buscas.slice(); },
    registrarBusca: registrarBusca,
    esquecerBuscas: esquecerBuscas,

    estatisticas: estatisticas,
    exportar:     exportar,
    importar:     importar,
    limpar:       limpar
  };
})();

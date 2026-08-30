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
    return l;
  }

  function apagarLista(idLista) {
    estado.listas = estado.listas.filter(function (l) { return l.id !== idLista; });
    return salvar();
  }

  function alternarNaLista(idLista, chave) {
    var l = lista(idLista);
    if (!l) return null;
    var i = l.livros.indexOf(chave);
    if (i >= 0) l.livros.splice(i, 1); else l.livros.push(chave);
    salvar();
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
    salvar:     salvar,
    guardarLivro: guardarLivro,
    livro:      livro,

    registrar:  registrar,
    apagarLog:  apagarLog,
    log:        log,
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

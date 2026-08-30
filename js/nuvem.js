/* ============================================================================
   nuvem.js — conta, sessao e a mudanca do diario local para a conta.

   Fala direto com o Supabase por fetch: /auth/v1 para conta e sessao,
   /rest/v1 para as tabelas. Sem SDK e sem passo de build, igual ao resto
   do aplicativo.

   REGRA QUE ATRAVESSA O ARQUIVO: se CONFIG.supabaseUrl estiver vazio, tudo
   aqui devolve "desligado" e ninguem chama a rede. O Letterbooks continua
   sendo o diario local que ja era. A nuvem e um acrescimo, nao uma troca.

   O que fica guardado no aparelho:
     letterbooks:sessao        { token, atualizar, expiraEm, id, email }
     letterbooks:migrado:<id>  data em que o diario local subiu para a conta
   ========================================================================== */
var Nuvem = (function () {
  'use strict';

  var CHAVE_SESSAO = 'letterbooks:sessao';
  var MARGEM_MS = 60000;   /* renova o token um minuto antes de vencer */
  var LOTE = 50;           /* linhas por requisicao na migracao */

  var sessao = lerSessao();
  var ouvintes = [];

  /* ------------------------------------------------------------- desligado */

  function base() { return String(CONFIG.supabaseUrl || '').replace(/\/+$/, ''); }
  function anon() { return String(CONFIG.supabaseChave || ''); }

  /* A chave do Supabase e um JWT com o papel escrito dentro. A "anon" nasce
     para ficar no navegador; a "service_role", que fica logo abaixo dela no
     painel, IGNORA todas as politicas de RLS — quem tiver essa chave apaga o
     banco inteiro do console do navegador.

     As duas sao textos parecidos, coladas do mesmo lugar, e trocar uma pela
     outra e o erro mais facil e mais caro de cometer aqui. Entao o app le o
     papel e se recusa a subir com a chave errada, em vez de funcionar
     perfeitamente enquanto expoe tudo. */
  var papelDaChave = (function () {
    var t = anon().split('.');
    if (t.length !== 3) return null;
    try {
      var corpo = t[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(corpo + '==='.slice((corpo.length + 3) % 4))).role || null;
    } catch (e) { return null; }
  })();

  if (papelDaChave && papelDaChave !== 'anon') {
    console.error('Letterbooks: a chave em js/config.js e "' + papelDaChave +
      '", nao "anon". A nuvem fica DESLIGADA — essa chave ignora todas as ' +
      'regras de acesso do banco e nao pode ir para o navegador. Troque pela ' +
      'chave "anon public", em Project Settings > API.');
  }

  function ligada() {
    return !!(base() && anon()) && papelDaChave !== 'service_role' &&
           (papelDaChave === null || papelDaChave === 'anon');
  }

  /* --------------------------------------------------------------- sessao */

  function lerSessao() {
    try {
      var cru = localStorage.getItem(CHAVE_SESSAO);
      return cru ? JSON.parse(cru) : null;
    } catch (e) { return null; }
  }

  function gravarSessao(s) {
    sessao = s;
    try {
      if (s) localStorage.setItem(CHAVE_SESSAO, JSON.stringify(s));
      else localStorage.removeItem(CHAVE_SESSAO);
    } catch (e) { /* navegacao privada: a sessao vale so enquanto a aba viver */ }
    avisar();
    return s;
  }

  /* Guarda o que a resposta do Supabase tem de util e nada mais — o token de
     acesso, o de renovacao, quando vence, e quem e a pessoa. */
  function daResposta(d) {
    if (!d || !d.access_token) return null;
    return {
      token:     d.access_token,
      atualizar: d.refresh_token,
      expiraEm:  Date.now() + ((d.expires_in || 3600) * 1000),
      id:        d.user ? d.user.id : (sessao && sessao.id),
      email:     d.user ? d.user.email : (sessao && sessao.email)
    };
  }

  function entrou() { return !!(ligada() && sessao && sessao.token); }
  function quemSou() { return sessao ? { id: sessao.id, email: sessao.email } : null; }

  /* Quem quiser redesenhar a tela quando a pessoa entra ou sai. */
  function aoMudar(f) { ouvintes.push(f); return f; }
  function avisar() {
    for (var i = 0; i < ouvintes.length; i++) {
      try { ouvintes[i](quemSou()); } catch (e) { console.warn(e); }
    }
  }

  /* ------------------------------------------------------------ requisicao */

  function erroDe(resposta, corpo) {
    var m = (corpo && (corpo.message || corpo.error_description || corpo.msg ||
                       corpo.error || corpo.hint)) || '';
    var t = String(m).toLowerCase();

    /* As mensagens do Supabase chegam em ingles. Traduz as que a pessoa
       realmente vai encontrar; o resto passa como veio. */
    if (t.indexOf('invalid login') >= 0)        return 'E-mail ou senha não conferem.';
    if (t.indexOf('already registered') >= 0)   return 'Já existe uma conta com esse e-mail.';
    if (t.indexOf('email not confirmed') >= 0)  return 'Confirme o e-mail antes de entrar. Veja a caixa de entrada.';
    if (t.indexOf('password should be') >= 0)   return 'A senha precisa de pelo menos 6 caracteres.';
    if (t.indexOf('unable to validate email') >= 0) return 'Esse e-mail não parece válido.';
    if (t.indexOf('perfis_usuario_key') >= 0)   return 'Esse nome de usuário já está em uso.';
    if (t.indexOf('perfis_usuario_check') >= 0) return 'O usuário aceita só letras minúsculas, números e _, de 3 a 20.';
    if (t.indexOf('rate limit') >= 0)           return 'Muitas tentativas seguidas. Espere um minuto.';
    if (resposta.status === 401)                return 'Sua sessão expirou. Entre de novo.';
    return m || ('Erro ' + resposta.status + ' no servidor.');
  }

  function pedir(caminho, opcoes) {
    opcoes = opcoes || {};
    var cab = { apikey: anon(), 'Content-Type': 'application/json' };
    cab.Authorization = 'Bearer ' + (opcoes.semSessao || !sessao ? anon() : sessao.token);
    for (var k in (opcoes.cabecalhos || {})) cab[k] = opcoes.cabecalhos[k];

    return fetch(base() + caminho, {
      method: opcoes.metodo || 'GET',
      headers: cab,
      body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo)
    }).then(function (r) {
      if (r.status === 204) return null;
      return r.text().then(function (t) {
        var d = null;
        try { d = t ? JSON.parse(t) : null; } catch (e) { d = { message: t }; }
        if (!r.ok) throw new Error(erroDe(r, d));
        return d;
      });
    }, function () {
      throw new Error('Sem conexão com o servidor.');
    });
  }

  /* Renova o token se estiver perto de vencer, e so entao segue. Toda chamada
     as tabelas passa por aqui — assim ninguem leva 401 no meio de uma acao. */
  function comSessao(f) {
    if (!ligada()) return Promise.reject(new Error('A nuvem ainda não está configurada.'));
    if (!sessao)   return Promise.reject(new Error('Entre na sua conta para fazer isso.'));
    if (sessao.expiraEm - MARGEM_MS > Date.now()) return f();
    return renovar().then(f);
  }

  function renovar() {
    if (!sessao || !sessao.atualizar) return Promise.reject(new Error('Sua sessão expirou. Entre de novo.'));
    return pedir('/auth/v1/token?grant_type=refresh_token', {
      metodo: 'POST', semSessao: true, corpo: { refresh_token: sessao.atualizar }
    }).then(function (d) {
      var s = daResposta(d);
      if (!s) throw new Error('Sua sessão expirou. Entre de novo.');
      return gravarSessao(s);
    }, function (e) {
      gravarSessao(null);        /* token de renovacao morto: e sair mesmo */
      throw e;
    });
  }

  /* ------------------------------------------------------- entrar e sair */

  function cadastrar(email, senha, nome) {
    return pedir('/auth/v1/signup', {
      metodo: 'POST', semSessao: true,
      corpo: { email: email, password: senha, data: { nome: nome || '' } }
    }).then(function (d) {
      var s = daResposta(d);
      /* Se o projeto exigir confirmacao de e-mail, nao vem token: a conta
         existe, mas so vale depois do clique no e-mail. */
      if (!s) return { confirmar: true };
      gravarSessao(s);
      return { confirmar: false, eu: quemSou() };
    });
  }

  function entrar(email, senha) {
    return pedir('/auth/v1/token?grant_type=password', {
      metodo: 'POST', semSessao: true, corpo: { email: email, password: senha }
    }).then(function (d) {
      var s = daResposta(d);
      if (!s) throw new Error('Não foi possível entrar.');
      gravarSessao(s);
      return quemSou();
    });
  }

  /* Avisa o servidor e some com a sessao daqui. Se o aviso falhar, sai
     mesmo assim — ficar preso dentro da conta seria pior. */
  function sair() {
    var fim = function () { gravarSessao(null); return null; };
    if (!ligada() || !sessao) return Promise.resolve(fim());
    return pedir('/auth/v1/logout', { metodo: 'POST' }).then(fim, fim);
  }

  function recuperarSenha(email) {
    return pedir('/auth/v1/recover', {
      metodo: 'POST', semSessao: true,
      corpo: { email: email, redirect_to: location.origin + location.pathname }
    }).then(function () { return true; });
  }

  /* ------------------------------------------------------------- tabelas */

  /* Atalho para o PostgREST. `tabela('leituras', '?select=*&perfil=eq.' + id)` */
  function tabela(nome, consulta, opcoes) {
    opcoes = opcoes || {};
    return comSessao(function () {
      return pedir('/rest/v1/' + nome + (consulta || ''), opcoes);
    });
  }

  /* Leitura publica: perfil e diario de qualquer pessoa, sem precisar de
     conta. Usa a chave anon direto, sem passar por comSessao. */
  function publico(nome, consulta) {
    if (!ligada()) return Promise.reject(new Error('A nuvem ainda não está configurada.'));
    return pedir('/rest/v1/' + nome + (consulta || ''), { semSessao: !sessao });
  }

  function meuPerfil() {
    return tabela('perfis', '?select=*&id=eq.' + sessao.id).then(function (l) {
      return (l && l[0]) || null;
    });
  }

  function salvarPerfil(campos) {
    return tabela('perfis', '?id=eq.' + sessao.id, {
      metodo: 'PATCH', corpo: campos,
      cabecalhos: { Prefer: 'return=representation' }
    }).then(function (l) { return (l && l[0]) || null; });
  }

  /* ============================================================= escrita ==

     O que o Sinc chama para espelhar o diario do aparelho no banco. Tudo aqui
     e "upsert por estado": manda como a coisa E agora, nao o movimento que a
     levou ate aqui. Assim reenviar o mesmo item duas vezes nao duplica nada,
     que e o que uma fila com repeticao exige. */

  function salvarLivro(b) {
    return tabela('livros', '', {
      metodo: 'POST', corpo: [linhaLivro(b)],
      cabecalhos: { Prefer: 'return=minimal,resolution=merge-duplicates' }
    });
  }

  /* Com id remoto e correcao (PATCH); sem, e leitura nova (POST). A releitura
     do mesmo livro e uma linha NOVA, como no original — por isso a chave nao
     e (perfil, livro). */
  /* O id do APARELHO vai junto, sempre. E ele que faz a decisao de gravar ser
     por ITEM: mandar a mesma leitura duas vezes atualiza a linha em vez de
     criar outra. Antes disto, quem migrava o diario ficava sem `remoto` em
     todas as leituras (migrar mandava com return=minimal e nunca gravava o id
     de volta), e a primeira edicao de resenha depois disso nascia como linha
     nova no servidor. O diario duplicava sozinho. */
  function salvarLeitura(log) {
    var corpo = {
      perfil:     sessao.id,
      cliente_id: log.id,
      livro:      log.chave,
      nota:       typeof log.nota === 'number' ? log.nota : null,
      resenha:    log.resenha || null,
      lido_em:    log.lidoEm,
      relido:     !!log.relido,
      spoiler:    !!log.spoiler
    };
    return tabela('leituras', '?on_conflict=perfil,cliente_id', {
      metodo: 'POST', corpo: corpo,
      cabecalhos: { Prefer: 'resolution=merge-duplicates,return=representation' }
    }).then(function (l) { return (l && l[0]) || null; });
  }

  /* Adota uma linha antiga: grava nela o cliente_id da leitura que ja existe
     neste aparelho. E o que o backfill do esquema.sql faria, feito pelo lado do
     cliente para quem nunca reexecutou o SQL. Depois disto o upsert por
     (perfil, cliente_id) volta a encontrar a linha certa, e a leitura para de
     duplicar a cada edicao. A RLS ja cuida de so deixar mexer no que e seu. */
  function adotarLeitura(idRemoto, clienteId) {
    return tabela('leituras', '?id=eq.' + encodeURIComponent(idRemoto), {
      metodo: 'PATCH', corpo: { cliente_id: clienteId },
      cabecalhos: { Prefer: 'return=minimal' }
    });
  }

  function apagarLeitura(idRemoto) {
    return tabela('leituras', '?id=eq.' + idRemoto, { metodo: 'DELETE' });
  }

  function porMarcador(livro, tipo) {
    return tabela('marcadores', '', {
      metodo: 'POST', corpo: { perfil: sessao.id, livro: livro, tipo: tipo },
      cabecalhos: { Prefer: 'return=minimal,resolution=ignore-duplicates' }
    });
  }

  function tirarMarcador(livro, tipo) {
    return tabela('marcadores',
      '?perfil=eq.' + sessao.id + '&livro=eq.' + encodeURIComponent(livro) +
      '&tipo=eq.' + tipo, { metodo: 'DELETE' });
  }

  /* ============================================================== social ==

     Ler o feed, seguir gente, curtir e comentar resenha. Tudo passa por
     "publico()" quando da para ler sem conta: perfil e diario sao publicos,
     e quem chega por um link compartilhado tem que ver a pagina sem precisar
     se cadastrar antes. */

  var CAMPOS_FEED = 'id,perfil,livro,nota,resenha,lido_em,relido,spoiler,criado_em,' +
                    'usuario,perfil_nome,titulo,autores,ano,capa,curtidas,comentarios';

  /* O feed de quem eu sigo, mais o meu. Duas consultas em vez de uma: o
     PostgREST nao faz subconsulta em "in", entao a lista de quem eu sigo vem
     primeiro. E ainda e melhor do que parece — a lista e pequena e fica em
     cache do navegador entre as aberturas. */
  function feed(pagina, limite) {
    limite = limite || 20;
    var de = (pagina || 0) * limite;
    return quemEuSigo().then(function (ids) {
      var todos = ids.concat([sessao.id]);
      var lista = todos.map(function (x) { return '"' + x + '"'; }).join(',');
      return tabela('feed', '?select=' + CAMPOS_FEED +
        '&perfil=in.(' + lista + ')' +
        '&order=criado_em.desc&offset=' + de + '&limit=' + limite);
    });
  }

  /* O feed geral, de todo mundo — o que a pessoa ve antes de seguir alguem.
     Sem ele, quem acabou de criar conta abre a aba de atividade e encontra
     uma tela vazia, sem nada para fazer. */
  function feedGeral(pagina, limite) {
    limite = limite || 20;
    return publico('feed', '?select=' + CAMPOS_FEED +
      '&order=criado_em.desc&offset=' + ((pagina || 0) * limite) + '&limit=' + limite);
  }

  /* ------------------------------------------------------------- descida ---

     O caminho que faltava inteiro. Ate aqui a Nuvem so sabia LER o diario dos
     outros (feed, leiturasDe) — nenhuma funcao lia o SEU. Entrar na conta num
     celular novo mostrava um diario vazio, e a conta nao significava nada. */

  function minhasLeituras() {
    return tabela('leituras',
      '?select=id,cliente_id,livro,nota,resenha,lido_em,relido,spoiler,criado_em' +
      '&perfil=eq.' + sessao.id + '&order=lido_em.desc&limit=2000');
  }

  function meusMarcadores() {
    return tabela('marcadores',
      '?select=livro,tipo&perfil=eq.' + sessao.id + '&limit=2000');
  }

  /* Os livros que as leituras baixadas mencionam, para o diario ter titulo e
     capa sem uma ida a Open Library por linha. */
  function livrosPorChave(chaves) {
    if (!chaves.length) return Promise.resolve([]);
    var lista = chaves.map(function (c) { return '"' + c + '"'; }).join(',');
    return publico('livros',
      '?select=chave,titulo,autores,autores_ids,ano,capa,capa_grande,paginas,edicoes,sinopse' +
      '&chave=in.(' + lista + ')');
  }

  function leiturasDe(usuario, limite) {
    return publico('feed', '?select=' + CAMPOS_FEED +
      '&usuario=eq.' + encodeURIComponent(usuario) +
      '&order=lido_em.desc&limit=' + (limite || 40));
  }

  /* As leituras que a comunidade registrou DESTE livro. É a consulta de onde
     saem três coisas na ficha: a distribuição de notas, quem você segue que já
     leu, e as resenhas escritas sobre ele.

     A média e a distribuição são somadas no cliente, e não por função de
     agregação do PostgREST (`nota.avg()`): o Supabase desliga a agregação por
     padrão, a consulta voltaria 400, e a mensagem crua do servidor apareceria
     na tela de quem está lendo. */
  function leiturasDoLivro(chave, limite) {
    return publico('feed', '?select=' + CAMPOS_FEED +
      '&livro=eq.' + encodeURIComponent(chave) +
      '&order=criado_em.desc&limit=' + (limite || 60));
  }

  function perfilDe(usuario) {
    return publico('perfis', '?select=*&usuario=eq.' + encodeURIComponent(usuario))
      .then(function (l) { return (l && l[0]) || null; });
  }

  function procurarLeitores(termo) {
    var t = encodeURIComponent('*' + termo + '*');
    return publico('perfis',
      '?select=id,usuario,nome,bio&or=(usuario.ilike.' + t + ',nome.ilike.' + t + ')&limit=20');
  }

  /* ------------------------------------------------------------- seguir --- */

  function quemEuSigo() {
    return tabela('seguidores', '?select=seguido&seguidor=eq.' + sessao.id)
      .then(function (l) { return (l || []).map(function (x) { return x.seguido; }); });
  }

  function sigo(id) {
    return tabela('seguidores',
      '?select=seguido&seguidor=eq.' + sessao.id + '&seguido=eq.' + id)
      .then(function (l) { return !!(l && l.length); });
  }

  function seguir(id) {
    return tabela('seguidores', '', {
      metodo: 'POST', corpo: { seguidor: sessao.id, seguido: id },
      cabecalhos: { Prefer: 'return=minimal,resolution=ignore-duplicates' }
    });
  }

  function deixarDeSeguir(id) {
    return tabela('seguidores',
      '?seguidor=eq.' + sessao.id + '&seguido=eq.' + id, { metodo: 'DELETE' });
  }

  function contagemSocial(id) {
    return Promise.all([
      publico('seguidores', '?select=seguidor&seguido=eq.' + id),
      publico('seguidores', '?select=seguido&seguidor=eq.' + id)
    ]).then(function (r) {
      return { seguidores: (r[0] || []).length, seguindo: (r[1] || []).length };
    });
  }

  /* ------------------------------------------------------ curtir e comentar */

  function curti(leitura) {
    return tabela('curtidas',
      '?select=leitura&perfil=eq.' + sessao.id + '&leitura=eq.' + leitura)
      .then(function (l) { return !!(l && l.length); });
  }

  function curtir(leitura) {
    return tabela('curtidas', '', {
      metodo: 'POST', corpo: { perfil: sessao.id, leitura: leitura },
      cabecalhos: { Prefer: 'return=minimal,resolution=ignore-duplicates' }
    });
  }

  function descurtir(leitura) {
    return tabela('curtidas',
      '?perfil=eq.' + sessao.id + '&leitura=eq.' + leitura, { metodo: 'DELETE' });
  }

  function comentarios(leitura) {
    return publico('comentarios',
      '?select=id,texto,criado_em,perfil,perfis(usuario,nome)' +
      '&leitura=eq.' + leitura + '&order=criado_em.asc');
  }

  function comentar(leitura, texto) {
    return tabela('comentarios', '', {
      metodo: 'POST', corpo: { leitura: leitura, perfil: sessao.id, texto: texto },
      cabecalhos: { Prefer: 'return=representation' }
    }).then(function (l) { return (l && l[0]) || null; });
  }

  function apagarComentario(id) {
    return tabela('comentarios', '?id=eq.' + id, { metodo: 'DELETE' });
  }

  function denunciar(alvo, motivo) {
    var corpo = { autor: sessao.id, motivo: motivo };
    corpo[alvo.tipo] = alvo.id;      /* 'leitura' ou 'comentario' */
    return tabela('denuncias', '', { metodo: 'POST', corpo: corpo });
  }

  /* ------------------------------------------------------------- migracao */

  function chaveMigrado() { return 'letterbooks:migrado:' + (sessao ? sessao.id : ''); }

  function jaMigrou() {
    try { return localStorage.getItem(chaveMigrado()) || null; } catch (e) { return null; }
  }

  /* Manda um array em pedacos, um pedaco de cada vez. Uma requisicao com mil
     linhas costuma bater no limite do servidor; cinquenta nao. */
  function emLotes(nome, linhas, prefer, consulta) {
    var partes = [];
    for (var i = 0; i < linhas.length; i += LOTE) partes.push(linhas.slice(i, i + LOTE));
    var criadas = [];
    return partes.reduce(function (antes, parte) {
      return antes.then(function () {
        return tabela(nome, consulta || '', {
          metodo: 'POST', corpo: parte,
          cabecalhos: { Prefer: prefer || 'return=minimal,resolution=ignore-duplicates' }
        }).then(function (r) {
          if (r && r.length) criadas = criadas.concat(r);
        });
      });
    }, Promise.resolve()).then(function () { return criadas; });
  }

  function linhaLivro(b) {
    return {
      chave:       b.chave,
      titulo:      b.titulo || 'Sem titulo',
      autores:     b.autores || [],
      autores_ids: b.autoresIds || [],
      ano:         b.ano || null,
      capa:        b.capa || null,
      capa_grande: b.capaGrande || null,
      paginas:     b.paginas || null,
      edicoes:     b.edicoes || null,
      assuntos:    b.assuntos || [],
      sinopse:     b.sinopse || null
    };
  }

  /* Sobe o diario local inteiro para a conta. Nao apaga nada do aparelho: se
     algo der errado no meio, o Letterbooks continua funcionando local e da
     para tentar de novo. Roda uma vez por conta — depois disso, marca a data
     e nao repete, para nao duplicar o diario a cada visita. */
  function migrar(dados, aoAndar) {
    var passo = aoAndar || function () {};
    if (!entrou()) return Promise.reject(new Error('Entre na sua conta primeiro.'));

    var chaves = {};
    dados.logs.forEach(function (l) { chaves[l.chave] = 1; });
    dados.querLer.concat(dados.curtidas, dados.favoritos).forEach(function (c) { chaves[c] = 1; });
    dados.listas.forEach(function (l) { l.livros.forEach(function (c) { chaves[c] = 1; }); });

    /* Um livro so pode virar leitura depois de existir no acervo — e o que a
       chave estrangeira exige. Por isso os livros vao primeiro. */
    var livros = Object.keys(chaves)
      .map(function (c) { return dados.livros[c]; })
      .filter(Boolean)
      .map(linhaLivro);

    var leituras = dados.logs.map(function (l) {
      return {
        perfil:  sessao.id,
        cliente_id: l.id,
        livro:   l.chave,
        nota:    typeof l.nota === 'number' ? l.nota : null,
        resenha: l.resenha || null,
        lido_em: l.lidoEm,
        relido:  !!l.relido,
        spoiler: !!l.spoiler
      };
    }).filter(function (l) { return chaves[l.livro] && dados.livros[l.livro]; });

    var marcadores = [];
    [['querLer', 'quero'], ['curtidas', 'curtida'], ['favoritos', 'favorito']]
      .forEach(function (par) {
        dados[par[0]].forEach(function (c) {
          if (dados.livros[c]) marcadores.push({ perfil: sessao.id, livro: c, tipo: par[1] });
        });
      });

    passo('livros', 0, 4);
    return emLotes('livros', livros, 'return=minimal,resolution=merge-duplicates')
      .then(function () {
        passo('leituras', 1, 4);
        /* representation, nao minimal: e daqui que sai o id do servidor, e sem
           ele a leitura local fica orfa e a proxima edicao duplica. */
        return emLotes('leituras', leituras,
                       'resolution=merge-duplicates,return=representation',
                       '?on_conflict=perfil,cliente_id')
          .then(function (criadas) {
            /* Amarra cada linha do servidor a leitura daqui. Sem este passo a
               migracao "funcionava" e deixava todas as leituras orfas — o
               defeito ficava escondido ate a primeira edicao de resenha. */
            (criadas || []).forEach(function (l) {
              if (l && l.cliente_id && l.id) Dados.marcarRemoto(l.cliente_id, l.id);
            });
          });
      })
      .then(function () {
        passo('marcadores', 2, 4);
        return emLotes('marcadores', marcadores);
      })
      .then(function () {
        passo('listas', 3, 4);
        return migrarListas(dados.listas);
      })
      .then(function () {
        try { localStorage.setItem(chaveMigrado(), new Date().toISOString()); } catch (e) {}
        passo('pronto', 4, 4);
        return {
          livros: livros.length, leituras: leituras.length,
          marcadores: marcadores.length, listas: dados.listas.length
        };
      });
  }

  /* As listas precisam do id que o banco gera antes de mandar os itens, entao
     vao uma a uma, com return=representation. Sao poucas. */
  function migrarListas(listas) {
    return listas.reduce(function (antes, l) {
      return antes.then(function () {
        return tabela('listas', '', {
          metodo: 'POST',
          corpo: { perfil: sessao.id, nome: l.nome, descricao: l.descricao || null },
          cabecalhos: { Prefer: 'return=representation' }
        }).then(function (criada) {
          var nova = criada && criada[0];
          if (!nova || !l.livros.length) return null;
          return emLotes('lista_itens', l.livros.map(function (c, i) {
            return { lista: nova.id, livro: c, ordem: i };
          }));
        });
      });
    }, Promise.resolve());
  }

  return {
    ligada:    ligada,
    entrou:    entrou,
    quemSou:   quemSou,
    aoMudar:   aoMudar,

    cadastrar: cadastrar,
    entrar:    entrar,
    sair:      sair,
    recuperarSenha: recuperarSenha,

    tabela:    tabela,
    publico:   publico,
    meuPerfil: meuPerfil,
    salvarPerfil: salvarPerfil,

    minhasLeituras: minhasLeituras,
    meusMarcadores: meusMarcadores,
    livrosPorChave: livrosPorChave,

    salvarLivro:    salvarLivro,
    salvarLeitura:  salvarLeitura,
    adotarLeitura:  adotarLeitura,
    apagarLeitura:  apagarLeitura,
    porMarcador:    porMarcador,
    tirarMarcador:  tirarMarcador,

    feed:           feed,
    feedGeral:      feedGeral,
    leiturasDe:     leiturasDe,
    leiturasDoLivro: leiturasDoLivro,
    perfilDe:       perfilDe,
    procurarLeitores: procurarLeitores,

    quemEuSigo:     quemEuSigo,
    sigo:           sigo,
    seguir:         seguir,
    deixarDeSeguir: deixarDeSeguir,
    contagemSocial: contagemSocial,

    curti:          curti,
    curtir:         curtir,
    descurtir:      descurtir,
    comentarios:    comentarios,
    comentar:       comentar,
    apagarComentario: apagarComentario,
    denunciar:      denunciar,

    migrar:    migrar,
    jaMigrou:  jaMigrou
  };
})();

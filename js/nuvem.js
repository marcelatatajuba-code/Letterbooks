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
  function ligada() { return !!(base() && anon()); }

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

  /* ------------------------------------------------------------- migracao */

  function chaveMigrado() { return 'letterbooks:migrado:' + (sessao ? sessao.id : ''); }

  function jaMigrou() {
    try { return localStorage.getItem(chaveMigrado()) || null; } catch (e) { return null; }
  }

  /* Manda um array em pedacos, um pedaco de cada vez. Uma requisicao com mil
     linhas costuma bater no limite do servidor; cinquenta nao. */
  function emLotes(nome, linhas, prefer) {
    var partes = [];
    for (var i = 0; i < linhas.length; i += LOTE) partes.push(linhas.slice(i, i + LOTE));
    return partes.reduce(function (antes, parte) {
      return antes.then(function () {
        return tabela(nome, '', {
          metodo: 'POST', corpo: parte,
          cabecalhos: { Prefer: prefer || 'return=minimal,resolution=ignore-duplicates' }
        });
      });
    }, Promise.resolve());
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
        return emLotes('leituras', leituras, 'return=minimal');
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

    migrar:    migrar,
    jaMigrou:  jaMigrou
  };
})();

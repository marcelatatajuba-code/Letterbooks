/* ============================================================================
   app.js — telas, navegacao e interacao do Letterbooks.

   Vanilla JS, sem framework e sem build. A navegacao e por hash (#/diario,
   #/livro/...), o que mantem o app funcionando no GitHub Pages e aberto
   direto do sistema de arquivos.

   A organizacao das telas segue a do Letterboxd: pagina do livro em tres
   colunas com painel de acoes a direita, diario em tabela com a celula do mes
   atravessando as linhas, e grades de capas sem legenda.
   ========================================================================== */
(function () {
  'use strict';

  var tela   = document.getElementById('tela');
  var camada = document.getElementById('camada');

  /* ====================================================== utilidades de texto */

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
               'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  function dataBr(iso) {
    if (!iso) return '';
    var p = String(iso).slice(0, 10).split('-');
    if (p.length !== 3) return iso;
    return Number(p[2]) + ' ' + MESES[Number(p[1]) - 1] + ' ' + p[0];
  }

  function hoje() { return new Date().toISOString().slice(0, 10); }

  /* As datas da Open Library vem soltas: "1839", "1839-06-21", "21 June 1839".
     Formata as que sao ISO e devolve as outras como vieram. */
  function dataLivre(texto) {
    var t = String(texto || '').trim();
    var m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(t);
    if (!m) return t;
    var mes = MESES[Number(m[2]) - 1];
    return (m[3] ? Number(m[3]) + ' ' : '') + mes + ' ' + m[1];
  }
  function plural(n, um, muitos) { return n + ' ' + (n === 1 ? um : muitos); }

  /* Estrelas em texto: 3,5 vira "★★★½". */
  function estrelasTexto(nota) {
    if (typeof nota !== 'number' || nota <= 0) return '';
    return new Array(Math.floor(nota) + 1).join('★') + (nota % 1 >= 0.5 ? '½' : '');
  }

  function autoria(livro) {
    var a = livro.autores || [];
    if (!a.length) return 'Autoria desconhecida';
    if (a.length <= 2) return a.join(' e ');
    return a[0] + ' e mais ' + (a.length - 1);
  }

  /* A autoria com cada nome clicavel, quando a Open Library deu o id da pessoa.
     E o equivalente de clicar num nome do elenco no original. */
  function htmlAutoria(livro) {
    var nomes = livro.autores || [];
    var ids   = livro.autoresIds || [];
    if (!nomes.length) return '<b>Autoria desconhecida</b>';
    return nomes.slice(0, 3).map(function (nome, i) {
      return ids[i]
        ? '<a href="#/autor/' + encodeURIComponent(ids[i]) + '"><b>' + esc(nome) + '</b></a>'
        : '<b>' + esc(nome) + '</b>';
    }).join(', ') + (nomes.length > 3 ? ' e mais ' + (nomes.length - 3) : '');
  }

  function aviso(texto) {
    var d = document.createElement('div');
    d.className = 'aviso-flutuante';
    d.setAttribute('role', 'status');
    d.textContent = texto;
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 2600);
  }

  /* ========================================================= rotas / navegacao */

  function ir(rota) { location.hash = rota; }
  function rotaLivro(chave) { return '#/livro/' + encodeURIComponent(chave); }

  function marcarAba(nome) {
    var alvo = '#/' + nome;
    ['topo-nav', 'abas-pe'].forEach(function (id) {
      Array.prototype.forEach.call(document.getElementById(id).querySelectorAll('a'), function (a) {
        var ativa = a.getAttribute('href') === alvo;
        a.classList.toggle('ativa', ativa);
        if (ativa) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
    });
  }

  /* Troca a tela inteira por um elemento novo, em vez de so reescrever o HTML.
     Cada tela registra os proprios listeners depois de pintar; se o elemento
     sobrevivesse, esses listeners se acumulariam a cada navegacao e um clique
     em "apagar" acabaria disparando varias vezes. Descartando o no, eles morrem
     junto. */
  function pintar(html) {
    var novo = document.createElement('main');
    novo.className = 'pagina';
    novo.id = 'tela';
    novo.tabIndex = -1;
    novo.innerHTML = html;
    tela.replaceWith(novo);
    tela = novo;
    tela.focus({ preventScroll: true });
  }

  function carregando(texto) {
    pintar('<p class="carregando">' + esc(texto || 'Carregando…') + '</p>');
  }

  /* Atalho para ligar um punhado de acoes delegadas na tela atual. */
  function acoes(mapa) {
    tela.addEventListener('click', function (ev) {
      var alvo = ev.target.closest('[data-acao]');
      if (!alvo || !tela.contains(alvo)) return;
      var fn = mapa[alvo.getAttribute('data-acao')];
      if (fn) fn(alvo, ev);
    });
  }

  /* ========================================================= pecas reutilizaveis */

  function htmlCapa(livro, extra) {
    var url = livro.capa || livro.capaGrande;
    var miolo = url
      ? '<img src="' + esc(url) + '" alt="Capa de ' + esc(livro.titulo) + '" loading="lazy">'
      : '<div class="capa-vazia"><span>' + esc(livro.titulo) + '</span></div>';
    return '<div class="capa">' + miolo + (extra || '') + '</div>';
  }

  /* Um item da grade: so a capa, como as grades de posters do original. O que
     voce marcou naquele livro aparece na fita do pe. */
  function htmlCartao(livro, ordem) {
    var selos = '';
    if (Dados.jaLeu(livro.chave))   selos += '<i title="Lido" style="color:var(--a1)">◉</i>';
    if (Dados.curtido(livro.chave)) selos += '<i title="Curtido" style="color:var(--curtida)">♥</i>';
    if (Dados.querLer(livro.chave)) selos += '<i title="Quero ler" style="color:var(--quero)">◷</i>';
    var nota = Dados.notaDe(livro.chave);
    var dica = livro.titulo + (livro.ano ? ' (' + livro.ano + ')' : '') +
               (nota ? ' — ' + estrelasTexto(nota) : '');

    /* A legenda vai sempre no HTML e quem decide se aparece e o CSS
       (.grade { --legenda }), para alternar entre a grade sem legenda do
       original e a grade com titulo sem mexer no JavaScript. */
    /* Numa lista, a posicao importa: o original numera cada poster. */
    var extra = (selos ? '<div class="selos">' + selos + '</div>' : '') +
                (ordem ? '<span class="ordem">' + ordem + '</span>' : '');

    return '<a class="cartao" href="' + rotaLivro(livro.chave) + '" title="' + esc(dica) + '">' +
           htmlCapa(livro, extra) +
           '<div class="cartao-legenda">' + esc(livro.titulo) +
             (nota ? '<span class="estrelas">' + estrelasTexto(nota) + '</span>' : '') +
           '</div></a>';
  }

  function htmlGrade(livros, classe, numerar) {
    if (!livros.length) return '';
    return '<div class="grade ' + (classe || '') + '">' +
      livros.map(function (l, i) { return htmlCartao(l, numerar ? i + 1 : 0); }).join('') +
      '</div>';
  }

  function htmlVazio(titulo, texto, botao) {
    return '<div class="vazio"><strong>' + esc(titulo) + '</strong><div>' + esc(texto) + '</div>' +
           (botao || '') + '</div>';
  }

  function livroDe(chave) {
    return Dados.livro(chave) || { chave: chave, titulo: 'Livro', autores: [], capa: null };
  }

  /* Histograma de notas, usado no painel do livro e no perfil. */
  function htmlHistograma(faixas) {
    var maior = Math.max.apply(null, faixas.map(function (f) { return f.qtd; }).concat([1]));
    return '<div class="histograma">' +
      faixas.map(function (f) {
        return '<div class="col' + (f.qtd ? ' tem' : '') + '" title="' +
               String(f.nota).replace('.', ',') + ' — ' + plural(f.qtd, 'livro', 'livros') + '">' +
               '<i style="height:' + Math.round((f.qtd / maior) * 100) + '%"></i></div>';
      }).join('') +
    '</div><div class="histograma-eixo"><span class="estrelas">★</span>' +
    '<span class="estrelas">★★★★★</span></div>';
  }

  function mediaTexto(media) {
    return media === null ? '' : media.toFixed(1).replace('.', ',');
  }

  /* ================================================================== TELA: inicio */

  function telaInicio() {
    marcarAba('inicio');
    var logs = Dados.logs();
    var e = Dados.estatisticas();
    var html = '';

    if (logs.length) {
      var vistos = {}, recentes = [];
      logs.forEach(function (l) {
        if (vistos[l.chave] || recentes.length >= 12) return;
        vistos[l.chave] = 1;
        recentes.push(livroDe(l.chave));
      });
      html += '<section class="secao"><h2>Suas leituras recentes<a href="#/diario">ver o diário</a></h2>' +
              htmlGrade(recentes) + '</section>';
    } else {
      html += '<h1 class="titulo-pagina">Seu diário de leitura começa aqui</h1>' +
              '<p class="sub-pagina">Busque um livro, dê estrelas e escreva o que achou. ' +
              'Tudo fica guardado neste aparelho, sem conta e sem senha.</p>';
    }

    if (Dados.estado().querLer.length) {
      html += '<section class="secao"><h2>Quero ler<a href="#/estante">ver a estante</a></h2>' +
              htmlGrade(Dados.estado().querLer.slice(0, 14).map(livroDe), 'miuda') + '</section>';
    }

    html += '<section class="secao" id="secao-alta"><h2>Em alta esta semana</h2>' +
            '<p class="carregando">Buscando na Open Library…</p></section>';

    if (logs.length) {
      html += '<section class="secao"><h2>Onde você está</h2><div class="numeros">' +
              numero(e.lidos, 'leituras') +
              numero(e.noAno, 'em ' + Dados.estado().perfil.meta.ano) +
              numero(e.media ? e.media.toFixed(1).replace('.', ',') : '—', 'nota média') +
              numero(e.resenhas, 'resenhas') +
              '</div></section>';
    }

    pintar(html);

    preencherEmAlta(14);
  }

  /* Preenche a secao #secao-alta, usada tanto no inicio quanto na busca. */
  function preencherEmAlta(quantos) {
    API.emAlta(quantos).then(function (livros) {
      var s = document.getElementById('secao-alta');
      if (!s) return;
      livros.forEach(Dados.guardarLivro);
      s.querySelector('.carregando').outerHTML = livros.length
        ? htmlGrade(livros)
        : '<p class="erro">Não consegui carregar os destaques agora.</p>';
    }).catch(function (err) {
      var s = document.getElementById('secao-alta');
      if (!s) return;
      s.querySelector('.carregando').outerHTML =
        '<p class="erro">' + esc(err.message) + ' Verifique a conexão e recarregue.</p>';
    });
  }

  function atalho(rota, rotulo, conta) {
    return '<a href="' + rota + '"><b>' + conta + '</b><span>' + esc(rotulo) + '</span></a>';
  }

  function numero(valor, rotulo) {
    return '<div class="numero"><b>' + esc(valor) + '</b><span>' + esc(rotulo) + '</span></div>';
  }

  /* ================================================================== TELA: busca */

  /* Sem termo, a busca e uma tela em si — o que o icone da lupa abre no
     celular. Com termo, e a tela de resultados. */
  function telaBuscaVazia() {
    marcarAba('buscar');
    pintar('<h1 class="titulo-pagina">Buscar</h1>' +
      '<p class="sub-pagina">Título, autor ou ISBN. O acervo é o da Open Library.</p>' +
      '<form class="busca-grande" id="busca-grande">' +
        '<input id="busca-grande-campo" type="search" autocomplete="off" ' +
               'placeholder="O que você está procurando?" aria-label="Buscar livros">' +
        '<button type="submit" class="botao destaque">Buscar</button>' +
      '</form>' +
      '<section class="secao" id="secao-alta" style="margin-top:32px">' +
        '<h2>Em alta esta semana</h2>' +
        '<p class="carregando">Buscando na Open Library…</p></section>');

    document.getElementById('busca-grande').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var t = document.getElementById('busca-grande-campo').value.trim();
      if (t) ir('#/buscar/' + encodeURIComponent(t) + '/1');
    });
    document.getElementById('busca-grande-campo').focus();
    preencherEmAlta(14);
  }

  function telaBusca(termo, pagina) {
    marcarAba('buscar');
    document.getElementById('campo-busca').value = termo;
    carregando('Procurando “' + termo + '” no acervo…');

    API.buscar(termo, pagina).then(function (r) {
      r.livros.forEach(Dados.guardarLivro);
      var html = '<h1 class="titulo-pagina">' + esc(termo) + '</h1>';

      if (!r.livros.length) {
        return pintar(html + htmlVazio('Nada encontrado',
          'Tente outra grafia, o nome do autor, ou o ISBN da edição.'));
      }

      html += '<p class="sub-pagina">' + plural(r.total, 'resultado', 'resultados') +
              ' no acervo da Open Library.</p>' + htmlGrade(r.livros);

      var ultima = Math.min(Math.ceil(r.total / 24), 42);
      if (ultima > 1) {
        html += '<div class="linha-botoes" style="margin-top:24px;justify-content:center">';
        if (pagina > 1) {
          html += '<a class="botao" href="#/buscar/' + encodeURIComponent(termo) + '/' +
                  (pagina - 1) + '">← Anteriores</a>';
        }
        html += '<span class="botao" style="cursor:default">Página ' + pagina + ' de ' + ultima + '</span>';
        if (pagina < ultima) {
          html += '<a class="botao" href="#/buscar/' + encodeURIComponent(termo) + '/' +
                  (pagina + 1) + '">Próximos →</a>';
        }
        html += '</div>';
      }
      pintar(html);
      window.scrollTo(0, 0);
    }).catch(function (err) {
      pintar('<h1 class="titulo-pagina">' + esc(termo) + '</h1>' +
             '<p class="erro">Não foi possível buscar agora. ' + esc(err.message) + '</p>');
    });
  }

  /* ================================================================== TELA: livro */

  function telaLivro(chave) {
    marcarAba('');
    var livro = Dados.livro(chave);
    if (livro) desenhaLivro(livro); else carregando('Abrindo a ficha do livro…');

    API.detalhe(chave).then(function (d) {
      var base = Dados.livro(chave) || { chave: chave, titulo: 'Livro', autores: [] };
      if (!base.capa && d.capaId) {
        base.capa = API.capa(d.capaId, 'M');
        base.capaGrande = API.capa(d.capaId, 'L');
      }
      base.sinopse = d.sinopse;
      if (d.assuntos.length) base.assuntos = d.assuntos;
      desenhaLivro(Dados.guardarLivro(base));
    }).catch(function () {
      if (!Dados.livro(chave)) {
        pintar('<p class="erro">Não consegui abrir este livro. Volte e tente pela busca.</p>');
      }
    });
  }

  function desenhaLivro(livro, abaAtiva) {
    abaAtiva = abaAtiva || 'sinopse';
    var logs  = Dados.logsDo(livro.chave);
    var nota  = Dados.notaDe(livro.chave);
    var lido  = logs.length > 0;
    var quero = Dados.querLer(livro.chave);
    var curti = Dados.curtido(livro.chave);
    var fav   = Dados.favorito(livro.chave);
    var fundo = livro.capaGrande || livro.capa;

    /* ---- coluna do meio: as abas internas da ficha ---- */
    var miolo = '';
    if (abaAtiva === 'sinopse') {
      var s = livro.sinopse || '';
      var longa = s.length > 520;
      miolo = s
        ? '<p class="sinopse' + (longa ? ' recolhida' : '') + '" id="sinopse">' + esc(s) + '</p>' +
          (longa ? '<button class="mais" data-acao="expandir">Ler a sinopse inteira</button>' : '')
        : '<p class="sinopse" style="color:var(--texto-3)">Esta obra ainda não tem sinopse na Open Library.</p>';
    } else if (abaAtiva === 'detalhes') {
      var linhas = [
        ['Autoria', (livro.autores || []).join(', ') || '—'],
        ['Publicado', livro.ano || '—'],
        ['Páginas', livro.paginas || '—'],
        ['Edições', livro.edicoes || '—'],
        ['Open Library', livro.chave]
      ];
      miolo = '<table class="detalhes"><tbody>' + linhas.map(function (l) {
        return '<tr><th>' + esc(l[0]) + '</th><td>' + esc(l[1]) + '</td></tr>';
      }).join('') + '</tbody></table>';
    } else {
      var as = livro.assuntos || [];
      miolo = as.length
        ? '<div class="assuntos">' + as.slice(0, 24).map(function (a) {
            return '<a class="assunto" href="#/buscar/' + encodeURIComponent(a) + '/1">' + esc(a) + '</a>';
          }).join('') + '</div>'
        : '<p class="sinopse" style="color:var(--texto-3)">Sem assuntos cadastrados para esta obra.</p>';
    }

    function aba(id, rotulo) {
      return '<button data-acao="aba" data-aba="' + id + '"' +
             (abaAtiva === id ? ' class="ativa"' : '') + '>' + rotulo + '</button>';
    }

    /* ---- painel lateral ---- */
    var e = Dados.estatisticas();
    var painel =
      '<aside class="painel">' +
        '<div class="painel-acoes">' +
          acaoPainel('registrar', 'lido',   lido,  lido ? '◉' : '○', 'Lido') +
          acaoPainel('curtir',    'curtir', curti, curti ? '♥' : '♡', 'Curtir') +
          acaoPainel('quero',     'quero',  quero, quero ? '◷' : '◌', 'Quero ler') +
        '</div>' +
        '<div class="painel-nota">' +
          '<span class="rotulo">' + (nota ? 'Sua nota' : 'Avaliar') + '</span>' +
          (nota ? '<span class="estrelas" style="font-size:17px">' + estrelasTexto(nota) + '</span>'
                : '<span style="color:var(--texto-3);font-size:12px">ainda sem nota</span>') +
        '</div>' +
        '<button class="painel-botao" data-acao="registrar">' +
          (lido ? plural(logs.length, 'leitura registrada', 'leituras registradas') : 'Registrar leitura') +
        '</button>' +
        '<button class="painel-botao" data-acao="listas">Adicionar a uma lista</button>' +
        '<button class="painel-botao" data-acao="favorito">' +
          (fav ? '★ Nos favoritos' : '☆ Favoritar') + '</button>' +
        '<button class="painel-botao" data-acao="compartilhar">Compartilhar</button>' +
        (e.media !== null
          ? '<div class="painel-bloco">' +
            '<div class="bloco-topo"><span class="rotulo">Como você avalia</span>' +
            '<span class="histograma-media">' + mediaTexto(e.media) + '</span></div>' +
            htmlHistograma(e.faixas) + '</div>'
          : '') +
      '</aside>';

    var html =
      (fundo ? '<div class="heroi"><div class="heroi-imagem" style="background-image:url(' +
               esc(fundo) + ')"></div></div>' : '') +
      '<div class="livro-colunas">' +
        '<div class="livro-capa">' + htmlCapa(livro) + '</div>' +
        '<div>' +
          '<h1 class="livro-titulo">' + esc(livro.titulo) + '</h1>' +
          '<div class="livro-linha">' +
            (livro.ano ? '<span class="ano">' + livro.ano + '</span>' : '') +
            '<span class="autoria">de ' + htmlAutoria(livro) + '</span>' +
          '</div>' +
          '<div class="fichas">' + aba('sinopse', 'Sinopse') + aba('detalhes', 'Detalhes') +
            aba('assuntos', 'Assuntos') + '</div>' +
          miolo +
          (logs.length ? '<section class="secao" style="margin-top:30px">' +
            '<h2>Suas leituras<span class="conta">' + logs.length + '</span></h2>' +
            tabelaDiario(logs, false) + '</section>' : '') +
        '</div>' +
        painel +
      '</div>';

    pintar(html);

    acoes({
      aba: function (a) { desenhaLivro(livro, a.getAttribute('data-aba')); },
      expandir: function (a) {
        document.getElementById('sinopse').classList.remove('recolhida');
        a.remove();
      },
      registrar: function () { abrirFolhaRegistro(livro, null); },
      quero:  function () { Dados.alternarQuerLer(livro.chave); desenhaLivro(livro, abaAtiva); },
      curtir: function () { Dados.alternarCurtida(livro.chave); desenhaLivro(livro, abaAtiva); },
      listas: function () { abrirFolhaListas(livro); },
      compartilhar: function (b) {
        b.disabled = true;
        b.textContent = 'Montando…';
        cartaoDeCompartilhar(livro, nota).then(function (msg) {
          if (msg) aviso(msg);
        }).catch(function (err) {
          aviso('Não consegui montar a imagem: ' + err.message);
        }).then(function () { desenhaLivro(livro, abaAtiva); });
      },
      favorito: function () {
        var r = Dados.alternarFavorito(livro.chave);
        if (r.cheio) aviso('Os favoritos guardam ' + Dados.MAX_FAVORITOS + ' livros. Tire um antes.');
        else desenhaLivro(livro, abaAtiva);
      },
      'editar-log': function (a) {
        var log = Dados.log(a.getAttribute('data-id'));
        if (log) abrirFolhaRegistro(livroDe(log.chave), log.id);
      },
      'apagar-log': function (a) {
        if (!confirm('Apagar este registro de leitura?')) return;
        Dados.apagarLog(a.getAttribute('data-id'));
        desenhaLivro(livro, abaAtiva);
      },
      'ver-spoiler': revelarSpoiler
    });
  }

  function acaoPainel(acao, classe, ativa, glifo, rotulo) {
    return '<button class="acao ' + classe + (ativa ? ' ativa' : '') + '" data-acao="' + acao + '"' +
           ' aria-pressed="' + (ativa ? 'true' : 'false') + '">' +
           '<span class="glifo" aria-hidden="true">' + glifo + '</span>' +
           '<span>' + esc(rotulo) + '</span></button>';
  }

  function revelarSpoiler(a) {
    a.outerHTML = '<p class="resenha-texto">' + esc(a.getAttribute('data-texto')) + '</p>';
  }

  /* ============================================== diario em forma de tabela == */

  /* comMes = true monta a tabela cheia do diario, com a celula do mes
     atravessando as linhas daquele mes. false monta a versao curta que aparece
     dentro da ficha do livro. */
  function tabelaDiario(logs, comMes) {
    if (!logs.length) return '';

    /* Agrupa por mes preservando a ordem ja vinda de Dados.logs(). */
    var grupos = [], atual = null;
    logs.forEach(function (l) {
      var mes = (l.lidoEm || '').slice(0, 7);
      if (!atual || atual.mes !== mes) { atual = { mes: mes, itens: [] }; grupos.push(atual); }
      atual.itens.push(l);
    });

    var cabecalho = '<thead><tr>' +
      (comMes ? '<th>Mês</th><th>Dia</th><th></th>' : '<th>Dia</th>') +
      '<th>Livro</th>' +
      (comMes ? '<th>Publicado</th>' : '') +
      '<th>Nota</th><th></th><th></th></tr></thead>';

    var corpo = grupos.map(function (g) {
      /* O rowspan precisa contar tambem as linhas extras de resenha. */
      var alturaTotal = g.itens.reduce(function (n, l) { return n + (l.resenha ? 2 : 1); }, 0);
      var p = g.mes.split('-');
      var primeira = true;
      var nomeMes = p.length === 2 ? MESES[Number(p[1]) - 1] + ' de ' + p[0] : 'sem data';

      /* No computador o mes e uma celula a esquerda, atravessando as linhas.
         No celular vira uma faixa de largura inteira, como no original — as
         duas estao no HTML e o CSS escolhe qual aparece. */
      var faixa = comMes
        ? '<tr class="faixa-mes"><td colspan="8">' + esc(nomeMes) + '</td></tr>'
        : '';

      return faixa + g.itens.map(function (l) {
        var livro = livroDe(l.chave);
        var celMes = '';
        if (comMes && primeira) {
          celMes = '<td class="cel-mes" rowspan="' + alturaTotal + '">' +
                   '<b>' + (p.length === 2 ? MESES[Number(p[1]) - 1] : '—') + '</b>' +
                   '<span>' + (p[0] || '') + '</span></td>';
          primeira = false;
        }
        /* Colunas que a linha da resenha precisa atravessar. Nao contam a do
           mes, que ja vem de um rowspan da primeira linha do grupo.
           Com mes: dia, capa, livro, ano, nota, coracao, acoes = 7.
           Sem mes: dia, livro, nota, coracao, acoes = 5. */
        var colunas = (comMes ? 7 : 5);

        var linha = '<tr>' + celMes +
          '<td class="cel-dia">' + (l.lidoEm ? Number(l.lidoEm.slice(8, 10)) : '—') + '</td>' +
          (comMes ? '<td class="cel-capa"><a href="' + rotaLivro(l.chave) + '">' +
                    htmlCapa(livro) + '</a></td>' : '') +
          '<td><a class="cel-livro" href="' + rotaLivro(l.chave) + '">' + esc(livro.titulo) + '</a>' +
            (l.relido ? ' <span class="rotulo" style="font-size:9px">releitura</span>' : '') + '</td>' +
          (comMes ? '<td class="cel-ano">' + (livro.ano || '') + '</td>' : '') +
          '<td class="cel-nota"><span class="estrelas">' + estrelasTexto(l.nota) + '</span></td>' +
          '<td class="cel-marca">' + glifosDaLinha(l) + '</td>' +
          '<td class="cel-acoes">' +
            '<button data-acao="editar-log" data-id="' + l.id + '">editar</button>' +
            '<button data-acao="apagar-log" data-id="' + l.id + '">apagar</button>' +
          '</td></tr>';

        if (l.resenha) {
          linha += '<tr class="linha-resenha"><td colspan="' + colunas + '">' +
            (l.spoiler
              ? '<button class="spoiler-aviso" data-acao="ver-spoiler" data-texto="' +
                esc(l.resenha) + '">Esta resenha tem spoiler. Toque para ler.</button>'
              : '<p class="resenha-texto">' + esc(l.resenha) + '</p>') +
            '</td></tr>';
        }
        return linha;
      }).join('');
    }).join('');

    /* A tabela rola dentro do proprio container: numa tela estreita ela pode
       exceder a largura, e isso nunca deve virar rolagem horizontal da pagina. */
    return '<div class="tabela-rolagem"><table class="tabela-diario">' +
           cabecalho + '<tbody>' + corpo + '</tbody></table></div>';
  }

  /* Curtida, releitura e resenha, do jeito que o original marca cada entrada. */
  function glifosDaLinha(log) {
    var g = '';
    if (Dados.curtido(log.chave)) g += '<i class="on" title="Curtido">♥</i>';
    if (log.relido)               g += '<i title="Releitura">↺</i>';
    if (log.resenha) {
      g += '<a href="#/resenha/' + log.id + '" title="Tem resenha">≡</a>';
    }
    return g;
  }

  function telaDiario() {
    marcarAba('diario');
    var logs = Dados.logs();

    if (!logs.length) {
      return pintar('<h1 class="titulo-pagina">Diário</h1>' +
        htmlVazio('Nenhuma leitura registrada ainda',
          'Cada livro que você terminar vira uma linha aqui, com data, nota e resenha.',
          '<a class="botao destaque" href="#/inicio">Encontrar um livro</a>'));
    }

    pintar('<h1 class="titulo-pagina">Diário</h1>' +
      '<p class="sub-pagina">' + plural(logs.length, 'leitura registrada', 'leituras registradas') + '.</p>' +
      tabelaDiario(logs, true));

    acoes({
      'editar-log': function (a) {
        var log = Dados.log(a.getAttribute('data-id'));
        if (log) abrirFolhaRegistro(livroDe(log.chave), log.id);
      },
      'apagar-log': function (a) {
        if (!confirm('Apagar este registro de leitura?')) return;
        Dados.apagarLog(a.getAttribute('data-id'));
        rotear();
      },
      'ver-spoiler': revelarSpoiler
    });
  }

  /* =============================================================== TELA: resenha */
  /* Uma resenha tem endereco proprio, como no original: da para abrir direto
     nela em vez de cacar a linha no diario. */

  function telaResenha(idLog) {
    marcarAba('');
    var log = Dados.log(idLog);
    if (!log) return pintar('<p class="erro">Esta resenha não existe mais.</p>');

    var livro = livroDe(log.chave);
    var perfil = Dados.estado().perfil;
    var fundo = livro.capaGrande || livro.capa;

    pintar(
      (fundo ? '<div class="heroi"><div class="heroi-imagem" style="background-image:url(' +
               esc(fundo) + ')"></div></div>' : '') +
      '<article class="resenha' + (fundo ? ' sobre-heroi' : '') + '">' +
        '<div class="lista-autoria">' +
          '<span class="avatar avatar-mini" aria-hidden="true">' +
            esc((perfil.nome || '?').trim().charAt(0).toUpperCase()) + '</span>' +
          '<span>' + esc(perfil.nome) + '</span>' +
        '</div>' +

        '<div class="resenha-topo">' +
          '<div>' +
            '<h1 class="resenha-titulo"><a href="' + rotaLivro(log.chave) + '">' +
              esc(livro.titulo) + '</a>' +
              (livro.ano ? ' <span class="ano">' + livro.ano + '</span>' : '') + '</h1>' +
            '<p class="resenha-linha">' +
              '<span class="estrelas">' + estrelasTexto(log.nota) + '</span>' +
              (Dados.curtido(log.chave)
                ? ' <span style="color:var(--curtida)">♥</span>' : '') +
            '</p>' +
            '<p class="resenha-data">Lido em ' + dataBr(log.lidoEm) +
              (log.relido ? ' · releitura' : '') + '</p>' +
          '</div>' +
          '<a class="resenha-capa" href="' + rotaLivro(log.chave) + '" aria-label="' +
            esc(livro.titulo) + '">' + htmlCapa(livro) + '</a>' +
        '</div>' +

        (log.resenha
          ? '<div class="resenha-corpo">' +
              (log.spoiler
                ? '<p class="rotulo" style="color:var(--a1);margin-bottom:10px">' +
                  'Contém spoiler</p>' : '') +
              '<p class="resenha-texto">' + esc(log.resenha) + '</p>' +
            '</div>'
          : '<p class="resenha-corpo" style="color:var(--texto-3)">' +
            'Esta leitura foi registrada sem resenha.</p>') +

        '<div class="linha-botoes" style="margin-top:26px">' +
          '<button class="botao" data-acao="editar-log" data-id="' + log.id + '">Editar</button>' +
          '<a class="botao" href="' + rotaLivro(log.chave) + '">Ver o livro</a>' +
          '<button class="botao perigo" data-acao="apagar-log" data-id="' + log.id + '">Apagar</button>' +
        '</div>' +
      '</article>');

    acoes({
      'editar-log': function (a) {
        abrirFolhaRegistro(livroDe(log.chave), a.getAttribute('data-id'));
      },
      'apagar-log': function (a) {
        if (!confirm('Apagar este registro de leitura?')) return;
        Dados.apagarLog(a.getAttribute('data-id'));
        ir('#/diario');
      }
    });
  }

  /* ================================================================ TELA: estante */

  function telaEstante() {
    marcarAba('estante');
    var d = Dados.estado();
    var vistos = {}, lidos = [];
    Dados.logs().forEach(function (l) {
      if (vistos[l.chave]) return;
      vistos[l.chave] = 1;
      lidos.push(livroDe(l.chave));
    });

    pintar('<h1 class="titulo-pagina">Estante</h1>' +
      '<p class="sub-pagina">O que você quer ler, o que já leu e o que amou.</p>' +
      secaoEstante('Quero ler', d.querLer.map(livroDe),
        'A fila está vazia. Marque “Quero ler” na ficha de um livro.') +
      secaoEstante('Lidos', lidos, 'Nada por aqui ainda. Registre uma leitura.') +
      secaoEstante('Curtidos', d.curtidas.map(livroDe), 'Você ainda não curtiu nenhum livro.') +
      secaoEstante('Favoritos', d.favoritos.map(livroDe),
        'Escolha até ' + Dados.MAX_FAVORITOS + ' favoritos na ficha de cada livro.'));
  }

  function secaoEstante(titulo, livros, vazio) {
    return '<section class="secao"><h2>' + esc(titulo) +
      '<span class="conta">' + livros.length + '</span></h2>' +
      (livros.length ? htmlGrade(livros)
                     : '<p style="color:var(--texto-3);font-size:13px;margin:0">' + esc(vazio) + '</p>') +
      '</section>';
  }

  /* ================================================================= TELA: listas */

  function telaListas() {
    marcarAba('listas');
    var listas = Dados.estado().listas;

    var html = '<h1 class="titulo-pagina">Listas</h1>' +
      '<p class="sub-pagina">Agrupe livros do jeito que fizer sentido: por tema, por ano, por vontade.</p>' +
      '<div class="linha-botoes" style="margin-bottom:22px">' +
        '<button class="botao destaque" data-acao="nova-lista">Criar uma lista</button></div>';

    html += listas.length
      ? listas.map(function (l) {
          var capas = l.livros.slice(0, 6).map(function (c) { return htmlCapa(livroDe(c)); }).join('');
          return '<a class="cartao-lista" href="#/lista/' + l.id + '">' +
            '<h3>' + esc(l.nome) + '</h3>' +
            (l.descricao ? '<p>' + esc(l.descricao) + '</p>' : '') +
            (capas ? '<div class="pilha">' + capas + '</div>'
                   : '<p style="color:var(--texto-3);margin:0">Lista vazia</p>') +
            '<p style="margin:10px 0 0;color:var(--texto-3);font-size:12px">' +
              plural(l.livros.length, 'livro', 'livros') + '</p></a>';
        }).join('')
      : htmlVazio('Nenhuma lista ainda',
          'Uma lista pode ser “Li na praia”, “Para reler” ou “Presentes de 2027”.');

    pintar(html);
    acoes({
      'nova-lista': function () {
        var nome = prompt('Nome da lista:');
        if (nome && nome.trim()) { Dados.criarLista(nome.trim()); telaListas(); }
      }
    });
  }

  function telaLista(idLista) {
    marcarAba('listas');
    var l = Dados.lista(idLista);
    if (!l) return pintar('<p class="erro">Esta lista não existe mais.</p>');

    var livros = l.livros.map(livroDe);
    var fundo = (livros.filter(function (b) { return b.capaGrande || b.capa; })[0] || {});
    fundo = fundo.capaGrande || fundo.capa;
    var perfil = Dados.estado().perfil;

    pintar(
      (fundo ? '<div class="heroi"><div class="heroi-imagem" style="background-image:url(' +
               esc(fundo) + ')"></div></div>' : '') +
      '<div class="lista-cabecalho' + (fundo ? ' sobre-heroi' : '') + '">' +
        '<div class="lista-autoria">' +
          '<span class="avatar avatar-mini" aria-hidden="true">' +
            esc((perfil.nome || '?').trim().charAt(0).toUpperCase()) + '</span>' +
          '<span>' + esc(perfil.nome) + '</span>' +
        '</div>' +
        '<h1 class="titulo-pagina">' + esc(l.nome) + '</h1>' +
        (l.descricao ? '<p class="lista-descricao">' + esc(l.descricao) + '</p>' : '') +
        '<p class="sub-pagina" style="margin:0">' +
          plural(l.livros.length, 'livro', 'livros') + '</p>' +
      '</div>' +
      (l.livros.length ? htmlGrade(livros, '', true)
                       : htmlVazio('Lista vazia', 'Abra a ficha de um livro e use “Adicionar a uma lista”.')) +
      '<div class="linha-botoes" style="margin-top:28px">' +
        '<button class="botao" data-acao="renomear">Renomear</button>' +
        '<button class="botao" data-acao="descrever">Editar descrição</button>' +
        '<button class="botao perigo" data-acao="apagar-lista">Apagar lista</button></div>');

    acoes({
      renomear: function () {
        var nome = prompt('Novo nome:', l.nome);
        if (nome && nome.trim()) { Dados.editarLista(l.id, { nome: nome.trim() }); telaLista(l.id); }
      },
      descrever: function () {
        var d = prompt('Descrição:', l.descricao || '');
        if (d !== null) { Dados.editarLista(l.id, { descricao: d.trim() }); telaLista(l.id); }
      },
      'apagar-lista': function () {
        if (confirm('Apagar a lista “' + l.nome + '”? Os livros continuam no seu diário.')) {
          Dados.apagarLista(l.id);
          ir('#/listas');
        }
      }
    });
  }

  /* ================================================================== TELA: autor */

  function telaAutor(chave) {
    marcarAba('');
    carregando('Abrindo a página do autor…');

    Promise.all([API.autor(chave), API.obrasDo(chave, 48)]).then(function (r) {
      var a = r[0], obras = r[1];
      obras.forEach(function (o) {
        /* Nao deixa a obra sem autoria sobrescrever o que a busca ja sabia. */
        var guardado = Dados.livro(o.chave);
        if (!guardado) { o.autores = [a.nome]; o.autoresIds = [a.chave]; }
        Dados.guardarLivro(o);
      });

      var vida = [a.nascimento, a.morte].filter(Boolean).map(dataLivre).join(' — ');
      var retrato = API.retrato(a.retrato, 'M');
      var lidas = obras.filter(function (o) { return Dados.jaLeu(o.chave); }).length;

      var bio = a.bio || '';
      var longa = bio.length > 460;

      pintar(
        '<div class="autor-topo">' +
          (retrato
            ? '<img class="autor-retrato" src="' + esc(retrato) + '" alt="Retrato de ' +
              esc(a.nome) + '" loading="lazy">'
            : '<div class="autor-retrato autor-retrato-vazio" aria-hidden="true">' +
              esc(a.nome.trim().charAt(0).toUpperCase()) + '</div>') +
          '<div>' +
            '<h1 class="titulo-pagina" style="margin-bottom:2px">' + esc(a.nome) + '</h1>' +
            (vida ? '<p class="sub-pagina" style="margin-bottom:10px">' + esc(vida) + '</p>' : '') +
            '<div class="numeros" style="margin:0">' +
              numero(obras.length, 'obras no acervo') +
              numero(lidas, lidas === 1 ? 'você leu' : 'você leu') +
            '</div>' +
          '</div>' +
        '</div>' +

        (bio
          ? '<p class="sinopse' + (longa ? ' recolhida' : '') + '" id="bio">' + esc(bio) + '</p>' +
            (longa ? '<button class="mais" data-acao="expandir-bio">Ler a biografia inteira</button>' : '')
          : '') +

        '<section class="secao" style="margin-top:28px"><h2>Obras' +
          '<span class="conta">' + obras.length + '</span></h2>' +
          (obras.length ? htmlGrade(obras)
                        : '<p style="color:var(--texto-3);font-size:13px;margin:0">' +
                          'A Open Library não lista obras para esta pessoa.</p>') +
        '</section>');

      acoes({
        'expandir-bio': function (b) {
          document.getElementById('bio').classList.remove('recolhida');
          b.remove();
        }
      });
    }).catch(function (err) {
      pintar('<p class="erro">Não consegui abrir esta página de autor. ' + esc(err.message) + '</p>');
    });
  }

  /* ================================================================= TELA: perfil */

  function telaPerfil() {
    marcarAba('perfil');
    var d = Dados.estado();
    var e = Dados.estatisticas();
    var pct = e.meta ? Math.min(100, Math.round((e.noAno / e.meta) * 100)) : 0;
    var inicial = (d.perfil.nome || '?').trim().charAt(0).toUpperCase();

    var html =
      '<div class="perfil-topo">' +
        '<div class="avatar" aria-hidden="true">' + esc(inicial) + '</div>' +
        '<div><h1 class="perfil-nome">' + esc(d.perfil.nome) + '</h1>' +
        '<p class="perfil-bio">' + (d.perfil.bio ? esc(d.perfil.bio) : 'Sem descrição ainda.') + '</p></div>' +
      '</div>' +

      '<div class="numeros">' +
        numero(e.lidos, 'leituras') +
        numero(e.noAno, 'em ' + d.perfil.meta.ano) +
        numero(e.obras, 'obras') +
        numero(e.resenhas, 'resenhas') +
        numero(e.paginas ? e.paginas.toLocaleString('pt-BR') : '—', 'páginas') +
      '</div>' +

      /* No original, estante e listas vivem dentro do perfil — nao na barra
         principal. Esta fileira e a porta de entrada para elas. */
      '<nav class="perfil-atalhos" aria-label="Suas coleções">' +
        atalho('#/diario',  'Diário',   e.lidos) +
        atalho('#/estante', 'Estante',  d.querLer.length + d.curtidas.length + d.favoritos.length) +
        atalho('#/listas',  'Listas',   e.listas) +
      '</nav>' +

      '<section class="secao"><h2>Meta de ' + d.perfil.meta.ano + '</h2>' +
        '<p style="margin:0 0 4px;color:var(--texto-2);font-size:13px">' +
          e.noAno + ' de ' + e.meta + ' livros · ' + pct + '%</p>' +
        '<div class="meta-barra"><i style="width:' + pct + '%"></i></div>' +
        '<button class="botao" data-acao="editar-meta" style="margin-top:10px">Ajustar a meta</button>' +
      '</section>';

    if (e.media !== null) {
      html += '<section class="secao"><h2>Como você avalia' +
        '<span class="conta">média ' + mediaTexto(e.media) + '</span></h2>' +
        '<div style="max-width:300px">' + htmlHistograma(e.faixas) + '</div></section>';
    }

    if (d.favoritos.length) {
      html += '<section class="secao"><h2>Favoritos<span class="conta">' +
        d.favoritos.length + ' de ' + Dados.MAX_FAVORITOS + '</span></h2>' +
        htmlGrade(d.favoritos.map(livroDe)) + '</section>';
    }

    var ultimos = Dados.logs().slice(0, 8);
    if (ultimos.length) {
      html += '<section class="secao"><h2>Diário recente<a href="#/diario">ver tudo</a></h2>' +
        tabelaDiario(ultimos, true) + '</section>';
    }

    html += '<section class="secao"><h2>Seus dados</h2>' +
      '<p style="color:var(--texto-2);font-size:13px;margin:0 0 14px">' +
        'Tudo fica guardado só neste navegador. Exporte um arquivo para levar seu diário ' +
        'para outro aparelho — ou para não perder nada.</p>' +
      '<div class="linha-botoes">' +
        '<button class="botao" data-acao="editar-perfil">Editar perfil</button>' +
        '<button class="botao" data-acao="exportar">Exportar diário</button>' +
        '<button class="botao" data-acao="importar">Importar diário</button>' +
        '<button class="botao perigo" data-acao="limpar">Apagar tudo</button></div>' +
      '<input type="file" id="arquivo-importar" accept="application/json,.json" hidden>' +
      '</section>';

    pintar(html);

    acoes({
      'editar-perfil': function () {
        var nome = prompt('Como você quer ser chamada?', d.perfil.nome);
        if (nome === null) return;
        var bio = prompt('Uma linha sobre você (opcional):', d.perfil.bio || '');
        d.perfil.nome = nome.trim() || d.perfil.nome;
        d.perfil.bio = (bio || '').trim();
        Dados.salvar();
        telaPerfil();
      },
      'editar-meta': function () {
        var n = parseInt(prompt('Quantos livros você quer ler em ' + d.perfil.meta.ano + '?',
                                d.perfil.meta.total), 10);
        if (n > 0) { d.perfil.meta.total = n; Dados.salvar(); telaPerfil(); }
      },
      exportar: exportarArquivo,
      importar: function () { document.getElementById('arquivo-importar').click(); },
      limpar: function () {
        if (!confirm('Isso apaga leituras, resenhas, listas e favoritos deste aparelho. ' +
                     'Não dá para desfazer. Continuar?')) return;
        Dados.limpar();
        aviso('Tudo apagado.');
        ir('#/inicio');
        rotear();
      },
      'editar-log': function (a) {
        var log = Dados.log(a.getAttribute('data-id'));
        if (log) abrirFolhaRegistro(livroDe(log.chave), log.id);
      },
      'apagar-log': function (a) {
        if (!confirm('Apagar este registro de leitura?')) return;
        Dados.apagarLog(a.getAttribute('data-id'));
        telaPerfil();
      },
      'ver-spoiler': revelarSpoiler
    });

    document.getElementById('arquivo-importar').addEventListener('change', function () {
      var f = this.files[0];
      if (!f) return;
      var leitor = new FileReader();
      leitor.onload = function () {
        try {
          Dados.importar(String(leitor.result));
          aviso('Diário importado.');
          telaPerfil();
        } catch (err) {
          alert('Não consegui ler este arquivo: ' + err.message);
        }
      };
      leitor.readAsText(f);
    });
  }

  function exportarArquivo() {
    var blob = new Blob([Dados.exportar()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'letterbooks-' + hoje() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ================================================== folha: registrar leitura */

  function abrirFolhaRegistro(livro, idLog) {
    var reg = idLog ? Dados.log(idLog) : null;
    var nota = reg && typeof reg.nota === 'number' ? reg.nota : 0;

    camada.innerHTML =
      '<div class="folha-fundo" data-fechar="fundo"><div class="folha" role="dialog" aria-modal="true" ' +
        'aria-label="Registrar leitura de ' + esc(livro.titulo) + '">' +
        '<h2>' + esc(livro.titulo) + '</h2>' +
        '<p class="folha-sub">' + esc(autoria(livro)) + (livro.ano ? ' · ' + livro.ano : '') + '</p>' +

        '<span class="rotulo" style="display:block;margin-bottom:7px">Sua nota</span>' +
        '<div class="seletor-estrelas" id="seletor" role="slider" tabindex="0" ' +
             'aria-label="Nota de meia a cinco estrelas" aria-valuemin="0" aria-valuemax="5" ' +
             'aria-valuenow="' + nota + '" aria-valuetext="' + (nota ? nota + ' estrelas' : 'sem nota') + '">' +
          '<div class="campo" style="margin:0">' + estrelasBotoes(nota) + '</div>' +
          '<button type="button" class="limpar" data-nota="0">limpar</button>' +
        '</div>' +

        '<label class="campo" style="margin-top:16px"><span>Terminei de ler em</span>' +
          '<input type="date" id="campo-data" max="' + hoje() + '" value="' +
          esc(reg ? reg.lidoEm : hoje()) + '"></label>' +

        '<label class="campo"><span>Resenha</span>' +
          '<textarea id="campo-resenha" placeholder="O que ficou depois da última página?">' +
          esc(reg ? reg.resenha : '') + '</textarea></label>' +

        '<label class="marcador"><input type="checkbox" id="campo-relido"' +
          (reg && reg.relido ? ' checked' : '') + '> Já tinha lido antes</label>' +
        '<label class="marcador"><input type="checkbox" id="campo-spoiler"' +
          (reg && reg.spoiler ? ' checked' : '') + '> A resenha tem spoiler</label>' +

        '<div class="folha-rodape">' +
          '<button class="botao destaque" data-fechar="salvar">' +
            (reg ? 'Salvar alterações' : 'Registrar leitura') + '</button>' +
          '<button class="botao" data-fechar="cancelar">Cancelar</button>' +
          (reg ? '<button class="botao perigo espaco" data-fechar="apagar">Apagar</button>' : '') +
        '</div>' +
      '</div></div>';

    /* Os listeners vao no painel, nao na camada: o painel e descartado ao
       fechar, entao nao sobra nada ligado para a proxima abertura. */
    var painel = camada.firstElementChild;
    var notaAtual = nota;
    var seletor = document.getElementById('seletor');

    function repinta(v) {
      notaAtual = v;
      seletor.querySelector('.campo').innerHTML = estrelasBotoes(v);
      seletor.setAttribute('aria-valuenow', v);
      seletor.setAttribute('aria-valuetext', v ? v + ' estrelas' : 'sem nota');
    }

    seletor.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      if (b.classList.contains('limpar')) return repinta(0);
      var pos = Number(b.getAttribute('data-pos'));
      /* metade esquerda da estrela vale meia nota, como no original */
      repinta(ev.offsetX < b.offsetWidth / 2 ? pos - 0.5 : pos);
    });

    seletor.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') {
        ev.preventDefault(); repinta(Math.min(5, notaAtual + 0.5));
      } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') {
        ev.preventDefault(); repinta(Math.max(0, notaAtual - 0.5));
      }
    });

    function fechar() {
      document.removeEventListener('keydown', aoTeclar);
      camada.innerHTML = '';
    }
    function aoTeclar(ev) { if (ev.key === 'Escape') fechar(); }
    document.addEventListener('keydown', aoTeclar);

    painel.addEventListener('click', function (ev) {
      var alvo = ev.target.closest('[data-fechar]');
      if (!alvo) return;
      var qual = alvo.getAttribute('data-fechar');
      if (qual === 'fundo' && ev.target !== alvo) return;

      if (qual === 'salvar') {
        Dados.guardarLivro(livro);
        Dados.registrar({
          id:      idLog || null,
          chave:   livro.chave,
          nota:    notaAtual > 0 ? notaAtual : null,
          resenha: document.getElementById('campo-resenha').value.trim(),
          lidoEm:  document.getElementById('campo-data').value || hoje(),
          relido:  document.getElementById('campo-relido').checked,
          spoiler: document.getElementById('campo-spoiler').checked
        });
        aviso(idLog ? 'Registro atualizado.' : 'Leitura registrada.');
      }

      if (qual === 'apagar') {
        if (!confirm('Apagar este registro de leitura?')) return;
        Dados.apagarLog(idLog);
        aviso('Registro apagado.');
      }

      fechar();
      rotear();
    });
  }

  function estrelasBotoes(nota) {
    var s = '';
    for (var i = 1; i <= 5; i++) {
      var estado = nota >= i ? 'cheia' : (nota >= i - 0.5 ? 'meia' : 'vazia');
      s += '<button type="button" class="est" data-pos="' + i + '" data-preenchida="' + estado + '"' +
           ' aria-label="' + i + ' estrela' + (i > 1 ? 's' : '') + '"></button>';
    }
    return s;
  }

  /* ====================================================== cartao para compartilhar */
  /* Desenha, no proprio aparelho, uma imagem 1080x1920 com a capa, o titulo, a
     autoria e a sua nota — para mandar no story ou em qualquer conversa.
     Nada e enviado a servidor nenhum: o canvas vira arquivo e vai direto para
     a folha de compartilhamento do sistema. */

  function cartaoDeCompartilhar(livro, nota) {
    var L = 1080, A = 1920;
    var cv = document.createElement('canvas');
    cv.width = L; cv.height = A;
    var c = cv.getContext('2d');

    /* As cores saem das variaveis do tema, para o cartao acompanhar a paleta. */
    var raiz = getComputedStyle(document.documentElement);
    function cor(nome) { return raiz.getPropertyValue(nome).trim(); }

    c.fillStyle = cor('--fundo') || '#16110e';
    c.fillRect(0, 0, L, A);

    return carregarCapa(livro).then(function (img) {
      var cL = 560, cA = 840, cX = (L - cL) / 2, cY = 300;

      if (img) {
        /* Fundo: a propria capa, ampliada, escurecida — como na ficha. */
        c.save();
        c.globalAlpha = 0.28;
        c.filter = 'blur(60px)';
        c.drawImage(img, -140, -120, L + 280, 1100);
        c.restore();

        c.save();
        c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 60; c.shadowOffsetY = 18;
        c.drawImage(img, cX, cY, cL, cA);
        c.restore();
      } else {
        c.fillStyle = cor('--superficie') || '#271f19';
        c.fillRect(cX, cY, cL, cA);
        c.fillStyle = cor('--a1') || '#ff7a3d';
        c.fillRect(cX, cY, 16, cA);
      }

      var y = cY + cA + 110;
      c.textAlign = 'center';

      /* Titulo, quebrado em ate tres linhas. */
      c.fillStyle = cor('--texto') || '#f4ede4';
      c.font = '700 60px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      y = escreverLinhas(c, livro.titulo, L / 2, y, 880, 74, 3);

      /* Autoria. */
      c.fillStyle = cor('--texto-2') || '#b3a595';
      c.font = '400 38px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      c.fillText('de ' + autoria(livro), L / 2, y + 20);
      y += 90;

      /* A nota, se houver. */
      if (nota) {
        c.fillStyle = cor('--a1') || '#ff7a3d';
        c.font = '400 66px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
        c.fillText(estrelasTexto(nota), L / 2, y + 20);
        y += 80;
      }

      /* Rodape com a marca. */
      c.strokeStyle = cor('--borda') || '#43362b';
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(L / 2 - 130, A - 190); c.lineTo(L / 2 + 130, A - 190); c.stroke();

      c.fillStyle = cor('--texto-3') || '#82756a';
      c.font = '700 26px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      c.fillText('N O   L E T T E R B O O K S', L / 2, A - 130);

      return entregarCartao(cv, livro);
    });
  }

  /* Quebra o texto em linhas que caibam na largura, com reticencias na ultima. */
  function escreverLinhas(c, texto, x, y, largura, altura, maxLinhas) {
    var palavras = String(texto).split(/\s+/);
    var linha = '', linhas = [];
    palavras.forEach(function (p) {
      var tentativa = linha ? linha + ' ' + p : p;
      if (c.measureText(tentativa).width > largura && linha) { linhas.push(linha); linha = p; }
      else linha = tentativa;
    });
    if (linha) linhas.push(linha);

    if (linhas.length > maxLinhas) {
      linhas = linhas.slice(0, maxLinhas);
      linhas[maxLinhas - 1] = linhas[maxLinhas - 1].replace(/\s*\S*$/, '…');
    }
    linhas.forEach(function (t, i) { c.fillText(t, x, y + i * altura); });
    return y + linhas.length * altura;
  }

  /* A capa precisa vir com CORS liberado, senao o canvas fica "sujo" e o
     navegador recusa a exportacao. Se falhar, o cartao sai sem capa. */
  function carregarCapa(livro) {
    var url = livro.capaGrande || livro.capa;
    if (!url) return Promise.resolve(null);
    return new Promise(function (ok) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = function () { ok(img); };
      img.onerror = function () { ok(null); };
      img.src = url;
    });
  }

  function entregarCartao(cv, livro) {
    return new Promise(function (ok, falha) {
      var nome = 'letterbooks-' + (livro.titulo || 'livro')
        .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '.png';

      cv.toBlob(function (blob) {
        if (!blob) return falha(new Error('o navegador não gerou a imagem'));
        var arquivo = new File([blob], nome, { type: 'image/png' });

        /* No celular, a folha de compartilhamento do sistema — que e onde o
           Instagram, o WhatsApp e o resto aparecem. */
        if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
          return navigator.share({ files: [arquivo], title: livro.titulo })
            .then(function () { ok(''); })
            .catch(function (e) { ok(e && e.name === 'AbortError' ? '' : baixar(blob, nome)); });
        }
        ok(baixar(blob, nome));
      }, 'image/png');
    });
  }

  function baixar(blob, nome) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    return 'Imagem salva nos seus downloads.';
  }

  /* ================================== folha: escolher o livro para registrar */
  /* O que o "+ REGISTRAR" do topo abre: busca, escolhe o livro, e emenda
     direto na folha de registro. */

  function abrirFolhaEscolha() {
    camada.innerHTML =
      '<div class="folha-fundo" data-fechar="fundo"><div class="folha" role="dialog" aria-modal="true" ' +
        'aria-label="Escolher um livro para registrar">' +
        '<h2>Registrar uma leitura</h2>' +
        '<p class="folha-sub">Qual livro você terminou?</p>' +
        '<label class="campo"><span>Buscar</span>' +
          '<input id="escolha-termo" placeholder="Título, autor ou ISBN" autocomplete="off"></label>' +
        '<div id="escolha-resultados"></div>' +
        '<div class="folha-rodape"><button class="botao" data-fechar="cancelar">Fechar</button></div>' +
      '</div></div>';

    var painel = camada.firstElementChild;
    var campo = document.getElementById('escolha-termo');
    var caixa = document.getElementById('escolha-resultados');
    var espera = null;
    campo.focus();

    function buscar() {
      var termo = campo.value.trim();
      if (termo.length < 3) { caixa.innerHTML = ''; return; }
      caixa.innerHTML = '<p class="carregando" style="padding:20px">Procurando…</p>';
      API.buscar(termo, 1).then(function (r) {
        if (campo.value.trim() !== termo) return;   /* chegou tarde, ja mudou */
        r.livros.forEach(Dados.guardarLivro);
        caixa.innerHTML = r.livros.length
          ? '<div class="grade miuda">' + r.livros.slice(0, 12).map(function (l) {
              return '<a class="cartao" href="#" data-escolher="' + esc(l.chave) + '" title="' +
                     esc(l.titulo) + '">' + htmlCapa(l) + '</a>';
            }).join('') + '</div>'
          : '<p style="color:var(--texto-3);font-size:13px">Nada encontrado.</p>';
      }).catch(function (err) {
        caixa.innerHTML = '<p class="erro">' + esc(err.message) + '</p>';
      });
    }

    campo.addEventListener('input', function () {
      clearTimeout(espera);
      espera = setTimeout(buscar, 350);   /* espera a pessoa parar de digitar */
    });

    function fechar() {
      clearTimeout(espera);
      document.removeEventListener('keydown', aoTeclar);
      camada.innerHTML = '';
    }
    function aoTeclar(ev) { if (ev.key === 'Escape') fechar(); }
    document.addEventListener('keydown', aoTeclar);

    painel.addEventListener('click', function (ev) {
      var escolha = ev.target.closest('[data-escolher]');
      if (escolha) {
        ev.preventDefault();
        var livro = livroDe(escolha.getAttribute('data-escolher'));
        fechar();
        return abrirFolhaRegistro(livro, null);
      }
      var alvo = ev.target.closest('[data-fechar]');
      if (!alvo) return;
      if (alvo.getAttribute('data-fechar') === 'fundo' && ev.target !== alvo) return;
      fechar();
    });
  }

  /* ============================================================ folha: listas */

  function abrirFolhaListas(livro) {
    var listas = Dados.estado().listas;
    var corpo = listas.length
      ? listas.map(function (l) {
          return '<label class="marcador"><input type="checkbox" data-lista="' + l.id + '"' +
            (l.livros.indexOf(livro.chave) >= 0 ? ' checked' : '') + '> ' + esc(l.nome) +
            ' <span style="color:var(--texto-3)">· ' + plural(l.livros.length, 'livro', 'livros') +
            '</span></label>';
        }).join('')
      : '<p style="color:var(--texto-3);margin:0 0 14px">Você ainda não criou nenhuma lista.</p>';

    camada.innerHTML =
      '<div class="folha-fundo" data-fechar="fundo"><div class="folha" role="dialog" aria-modal="true" ' +
        'aria-label="Adicionar a uma lista">' +
        '<h2>Adicionar a uma lista</h2>' +
        '<p class="folha-sub">' + esc(livro.titulo) + '</p>' + corpo +
        '<label class="campo" style="margin-top:16px"><span>Criar uma lista nova</span>' +
          '<input id="nova-lista" placeholder="Ex.: Para reler em 2027" autocomplete="off"></label>' +
        '<div class="folha-rodape"><button class="botao destaque" data-fechar="ok">Pronto</button></div>' +
      '</div></div>';

    var painel = camada.firstElementChild;

    painel.addEventListener('change', function (ev) {
      var c = ev.target.closest('[data-lista]');
      if (!c) return;
      Dados.alternarNaLista(c.getAttribute('data-lista'), livro.chave);
    });

    painel.addEventListener('click', function (ev) {
      var alvo = ev.target.closest('[data-fechar]');
      if (!alvo) return;
      if (alvo.getAttribute('data-fechar') === 'fundo' && ev.target !== alvo) return;

      var nome = (document.getElementById('nova-lista') || {}).value;
      if (nome && nome.trim()) {
        var l = Dados.criarLista(nome.trim());
        Dados.guardarLivro(livro);
        Dados.alternarNaLista(l.id, livro.chave);
        aviso('Lista “' + l.nome + '” criada.');
      }
      camada.innerHTML = '';
      rotear();
    });
  }

  /* ==================================================================== roteador */

  function rotear() {
    camada.innerHTML = '';
    var partes = (location.hash || '#/inicio').replace(/^#\/?/, '').split('/');
    var rota = partes[0] || 'inicio';

    if (rota === 'buscar') {
      var termo = decodeURIComponent(partes[1] || '');
      if (!termo) return telaBuscaVazia();
      return telaBusca(termo, Math.max(1, parseInt(partes[2], 10) || 1));
    }
    if (rota === 'autor')   return telaAutor(decodeURIComponent(partes.slice(1).join('/')));
    if (rota === 'resenha') return telaResenha(partes[1]);
    if (rota === 'livro')   return telaLivro(decodeURIComponent(partes.slice(1).join('/')));
    if (rota === 'diario')  return telaDiario();
    if (rota === 'estante') return telaEstante();
    if (rota === 'listas')  return telaListas();
    if (rota === 'lista')   return telaLista(partes[1]);
    if (rota === 'perfil')  return telaPerfil();
    return telaInicio();
  }

  document.getElementById('forma-busca').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var termo = document.getElementById('campo-busca').value.trim();
    if (termo) ir('#/buscar/' + encodeURIComponent(termo) + '/1');
  });

  document.getElementById('botao-registrar').addEventListener('click', abrirFolhaEscolha);
  document.getElementById('aba-mais').addEventListener('click', abrirFolhaEscolha);

  window.addEventListener('hashchange', rotear);
  rotear();
})();

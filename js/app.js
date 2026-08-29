/* ============================================================================
   app.js — telas, navegacao e interacao do Letterbooks.

   Vanilla JS, sem framework e sem build: o arquivo e servido como esta.
   A navegacao e por hash (#/diario, #/livro/...), o que mantem o app
   funcionando aberto direto do sistema de arquivos e no GitHub Pages.
   ========================================================================== */
(function () {
  'use strict';

  var tela   = document.getElementById('tela');
  var camada = document.getElementById('camada');
  var abas   = document.getElementById('abas');

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

  function plural(n, um, muitos) { return n + ' ' + (n === 1 ? um : muitos); }

  /* Estrelas em texto, no estilo do Letterboxd: 3,5 vira "★★★½". */
  function estrelasTexto(nota) {
    if (typeof nota !== 'number' || nota <= 0) return '';
    var cheias = Math.floor(nota);
    return new Array(cheias + 1).join('★') + (nota % 1 >= 0.5 ? '½' : '');
  }

  function autoria(livro) {
    var a = livro.autores || [];
    if (!a.length) return 'Autoria desconhecida';
    if (a.length <= 2) return a.join(' e ');
    return a[0] + ' e mais ' + (a.length - 1);
  }

  function aviso(texto) {
    var d = document.createElement('div');
    d.className = 'aviso-flutuante';
    d.setAttribute('role', 'status');
    d.textContent = texto;
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 2600);
  }

  /* ========================================================== rotas / navegacao */

  function ir(rota) { location.hash = rota; }
  function rotaLivro(chave) { return '#/livro/' + encodeURIComponent(chave); }

  function marcarAba(nome) {
    Array.prototype.forEach.call(abas.querySelectorAll('a'), function (a) {
      var ativa = a.getAttribute('href') === '#/' + nome;
      a.classList.toggle('ativa', ativa);
      if (ativa) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
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

  /* ========================================================= pecas reutilizaveis */

  /* A capa de um livro. Quando a Open Library nao tem imagem, desenha uma
     lombada com o titulo — melhor do que um retangulo cinza. */
  function htmlCapa(livro, tamanho, extra) {
    var url = tamanho === 'L' ? (livro.capaGrande || livro.capa) : livro.capa;
    var miolo = url
      ? '<img src="' + esc(url) + '" alt="Capa de ' + esc(livro.titulo) + '" loading="lazy">'
      : '<div class="capa-vazia"><span>' + esc(livro.titulo) + '</span></div>';
    return '<div class="capa">' + miolo + (extra || '') + '</div>';
  }

  /* Um item da grade, com os selos do que voce ja marcou naquele livro. */
  function htmlCartao(livro) {
    var nota = Dados.notaDe(livro.chave);
    var selos = '';
    if (Dados.jaLeu(livro.chave))   selos += '<i title="Lido" style="color:var(--ambar)">◉</i>';
    if (Dados.curtido(livro.chave)) selos += '<i title="Curtido" style="color:var(--curtida)">♥</i>';
    if (Dados.querLer(livro.chave)) selos += '<i title="Quero ler" style="color:var(--quero)">◷</i>';

    return '<a class="cartao" href="' + rotaLivro(livro.chave) + '">' +
             htmlCapa(livro, 'M', selos ? '<div class="selos">' + selos + '</div>' : '') +
             '<div class="cartao-legenda">' + esc(livro.titulo) + '</div>' +
             (nota ? '<div class="cartao-nota estrelas">' + estrelasTexto(nota) + '</div>' : '') +
           '</a>';
  }

  function htmlGrade(livros, classe) {
    if (!livros.length) return '';
    return '<div class="grade ' + (classe || '') + '">' +
           livros.map(htmlCartao).join('') + '</div>';
  }

  function htmlVazio(titulo, texto, botao) {
    return '<div class="vazio"><strong>' + esc(titulo) + '</strong>' +
           '<div>' + esc(texto) + '</div>' +
           (botao || '') + '</div>';
  }

  /* Resolve a ficha de um livro a partir da chave, usando o cache local. */
  function livroDe(chave) {
    return Dados.livro(chave) || { chave: chave, titulo: 'Livro', autores: [], capa: null };
  }

  /* ================================================================== TELA: inicio */

  function telaInicio() {
    marcarAba('inicio');
    var logs = Dados.logs();
    var e = Dados.estatisticas();

    var html = '';

    if (logs.length) {
      var recentes = [];
      var vistos = {};
      logs.forEach(function (l) {
        if (vistos[l.chave] || recentes.length >= 12) return;
        vistos[l.chave] = 1;
        recentes.push(livroDe(l.chave));
      });
      html += '<section class="secao"><h2>Suas leituras recentes' +
              '<a href="#/diario">ver o diário</a></h2>' +
              htmlGrade(recentes) + '</section>';
    } else {
      html += '<h1 class="titulo-pagina">Seu diário de leitura começa aqui</h1>' +
              '<p class="sub-pagina">Busque um livro, dê estrelas e escreva o que achou. ' +
              'Tudo fica guardado neste aparelho, sem conta e sem senha.</p>';
    }

    if (Dados.estado().querLer.length) {
      html += '<section class="secao"><h2>Quero ler' +
              '<a href="#/estante">ver a estante</a></h2>' +
              htmlGrade(Dados.estado().querLer.slice(0, 12).map(livroDe), 'compacta') +
              '</section>';
    }

    html += '<section class="secao" id="secao-alta"><h2>Em alta esta semana</h2>' +
            '<p class="carregando">Buscando na Open Library…</p></section>';

    if (logs.length) {
      html += '<section class="secao"><h2>Onde você está</h2><div class="numeros">' +
              numero(e.lidos, 'leituras') +
              numero(e.noAno, 'em ' + Dados.estado().perfil.meta.ano) +
              numero(e.media ? e.media.toFixed(1).replace('.', ',') : '—', 'média') +
              numero(e.resenhas, 'resenhas') +
              '</div></section>';
    }

    pintar(html);

    API.emAlta(12).then(function (livros) {
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

  function numero(valor, rotulo) {
    return '<div class="numero"><b>' + esc(valor) + '</b><span>' + esc(rotulo) + '</span></div>';
  }

  /* ================================================================== TELA: busca */

  function telaBusca(termo, pagina) {
    marcarAba('');
    document.getElementById('campo-busca').value = termo;
    carregando('Procurando “' + termo + '” no acervo…');

    API.buscar(termo, pagina).then(function (r) {
      r.livros.forEach(Dados.guardarLivro);

      var html = '<h1 class="titulo-pagina">' + esc(termo) + '</h1>';
      if (!r.livros.length) {
        html += htmlVazio('Nada encontrado',
          'Tente outra grafia, o nome do autor, ou o ISBN da edição.');
        return pintar(html);
      }

      html += '<p class="sub-pagina">' +
              plural(r.total, 'resultado', 'resultados') + ' no acervo da Open Library.</p>' +
              htmlGrade(r.livros);

      var ultimas = Math.ceil(r.total / 24);
      if (ultimas > 1) {
        html += '<div class="linha-botoes" style="margin-top:26px;justify-content:center">';
        if (pagina > 1) {
          html += '<a class="botao discreto" href="#/buscar/' + encodeURIComponent(termo) +
                  '/' + (pagina - 1) + '">← Anteriores</a>';
        }
        html += '<span class="botao discreto" style="cursor:default">Página ' + pagina +
                ' de ' + Math.min(ultimas, 42) + '</span>';
        if (pagina < ultimas && pagina < 42) {
          html += '<a class="botao discreto" href="#/buscar/' + encodeURIComponent(termo) +
                  '/' + (pagina + 1) + '">Próximos →</a>';
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

  function desenhaLivro(livro) {
    var logs  = Dados.logsDo(livro.chave);
    var nota  = Dados.notaDe(livro.chave);
    var lido  = logs.length > 0;
    var quero = Dados.querLer(livro.chave);
    var curti = Dados.curtido(livro.chave);
    var fav   = Dados.favorito(livro.chave);

    var meta = [];
    if (livro.ano)     meta.push('Publicado em ' + livro.ano);
    if (livro.paginas) meta.push(livro.paginas + ' páginas');
    if (livro.edicoes) meta.push(plural(livro.edicoes, 'edição', 'edições'));

    var sinopse = livro.sinopse || '';
    var longa = sinopse.length > 460;

    var html =
      '<article class="ficha">' +
        '<div>' +
          '<div class="ficha-capa">' + htmlCapa(livro, 'L') + '</div>' +
        '</div>' +
        '<div>' +
          '<h1>' + esc(livro.titulo) + '</h1>' +
          '<p class="autoria">de <b>' + esc(autoria(livro)) + '</b></p>' +
          (meta.length ? '<div class="meta">' +
            meta.map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('') +
            '</div>' : '') +

          '<div class="acoes">' +
            botaoAcao('registrar', 'lido',   lido,  lido ? '◉' : '○',
                      lido ? plural(logs.length, 'leitura', 'leituras') : 'Registrar leitura') +
            botaoAcao('quero',     'quero',  quero, quero ? '◷' : '◌',
                      quero ? 'Na fila' : 'Quero ler') +
            botaoAcao('curtir',    'curtir', curti, curti ? '♥' : '♡',
                      curti ? 'Curtido' : 'Curtir') +
          '</div>' +

          (nota ? '<p class="estrelas" style="font-size:20px;margin:0 0 16px">' +
                  estrelasTexto(nota) +
                  '<span style="color:var(--texto-3);font-size:13px;margin-left:8px">' +
                  'sua nota: ' + String(nota).replace('.', ',') + '</span></p>' : '') +

          (sinopse
            ? '<p class="sinopse' + (longa ? ' recolhida' : '') + '" id="sinopse">' + esc(sinopse) + '</p>' +
              (longa ? '<button class="botao discreto" data-acao="expandir" ' +
                       'style="margin:-8px 0 20px">Ler a sinopse inteira</button>' : '')
            : '<p class="sinopse" style="color:var(--texto-3)">Esta obra ainda não tem sinopse na Open Library.</p>') +

          ((livro.assuntos && livro.assuntos.length)
            ? '<div class="assuntos">' + livro.assuntos.slice(0, 10).map(function (a) {
                return '<a class="assunto" href="#/buscar/' + encodeURIComponent(a) + '/1">' +
                       esc(a) + '</a>';
              }).join('') + '</div>' : '') +

          '<div class="linha-botoes">' +
            '<button class="botao" data-acao="listas">Adicionar a uma lista</button>' +
            '<button class="botao discreto" data-acao="favorito">' +
              (fav ? '★ Nos favoritos' : '☆ Marcar como favorito') +
            '</button>' +
          '</div>' +
        '</div>' +
      '</article>';

    if (logs.length) {
      html += '<section class="secao" style="margin-top:40px"><h2>Suas leituras</h2>' +
              logs.map(function (l) { return htmlEntrada(l, false); }).join('') +
              '</section>';
    }

    pintar(html);

    tela.addEventListener('click', function (ev) {
      var alvo = ev.target.closest('[data-acao]');
      if (!alvo) return;
      var acao = alvo.getAttribute('data-acao');

      if (acao === 'registrar') abrirFolhaRegistro(livro, null);
      if (acao === 'quero')     { Dados.alternarQuerLer(livro.chave); desenhaLivro(livro); }
      if (acao === 'curtir')    { Dados.alternarCurtida(livro.chave); desenhaLivro(livro); }
      if (acao === 'listas')    abrirFolhaListas(livro);
      if (acao === 'expandir')  {
        document.getElementById('sinopse').classList.remove('recolhida');
        alvo.remove();
      }
      if (acao === 'favorito') {
        var r = Dados.alternarFavorito(livro.chave);
        if (r.cheio) aviso('Os favoritos guardam ' + Dados.MAX_FAVORITOS + ' livros. Tire um antes.');
        else desenhaLivro(livro);
      }
      if (acao === 'editar-log') abrirFolhaRegistro(livro, alvo.getAttribute('data-id'));
      if (acao === 'apagar-log') {
        if (confirm('Apagar este registro de leitura?')) {
          Dados.apagarLog(alvo.getAttribute('data-id'));
          desenhaLivro(livro);
        }
      }
      if (acao === 'ver-spoiler') {
        alvo.outerHTML = '<p class="entrada-resenha">' + esc(alvo.getAttribute('data-texto')) + '</p>';
      }
    });
  }

  function botaoAcao(acao, classe, ativa, glifo, rotulo) {
    return '<button class="acao ' + classe + (ativa ? ' ativa' : '') + '" data-acao="' + acao + '"' +
           ' aria-pressed="' + (ativa ? 'true' : 'false') + '">' +
           '<span class="glifo" aria-hidden="true">' + glifo + '</span>' +
           '<span>' + esc(rotulo) + '</span></button>';
  }

  /* ================================================== folha: registrar leitura */

  function abrirFolhaRegistro(livro, idLog) {
    var reg = idLog ? Dados.log(idLog) : null;
    var nota = reg && typeof reg.nota === 'number' ? reg.nota : 0;

    var html =
      '<div class="folha-fundo" data-fechar="fundo"><div class="folha" role="dialog" aria-modal="true" ' +
        'aria-label="Registrar leitura de ' + esc(livro.titulo) + '">' +
        '<h2>' + esc(livro.titulo) + '</h2>' +
        '<p class="folha-sub">' + esc(autoria(livro)) + (livro.ano ? ' · ' + livro.ano : '') + '</p>' +

        '<label class="campo"><span>Sua nota</span></label>' +
        '<div class="seletor-estrelas" id="seletor" role="slider" tabindex="0" ' +
             'aria-label="Nota de meia a cinco estrelas" aria-valuemin="0" aria-valuemax="5" ' +
             'aria-valuenow="' + nota + '" aria-valuetext="' + (nota ? nota + ' estrelas' : 'sem nota') + '">' +
          '<div class="campo">' + estrelasBotoes(nota) + '</div>' +
          '<button type="button" class="limpar" data-nota="0">limpar</button>' +
        '</div>' +

        '<label class="campo" style="margin-top:18px"><span>Terminei de ler em</span>' +
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
          '<button class="botao discreto" data-fechar="cancelar">Cancelar</button>' +
          (reg ? '<button class="botao perigo espaco" data-fechar="apagar">Apagar</button>' : '') +
        '</div>' +
      '</div></div>';

    camada.innerHTML = html;
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
      /* metade esquerda da estrela vale meia nota, como no Letterboxd */
      var meia = ev.offsetX < b.offsetWidth / 2;
      repinta(meia ? pos - 0.5 : pos);
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

    function aoTeclar(ev) {
      if (ev.key === 'Escape') fechar();
    }
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

  /* ============================================================ folha: listas */

  function abrirFolhaListas(livro) {
    var listas = Dados.estado().listas;

    var corpo = listas.length
      ? listas.map(function (l) {
          var dentro = l.livros.indexOf(livro.chave) >= 0;
          return '<label class="marcador"><input type="checkbox" data-lista="' + l.id + '"' +
                 (dentro ? ' checked' : '') + '> ' + esc(l.nome) +
                 ' <span style="color:var(--texto-3)">· ' + plural(l.livros.length, 'livro', 'livros') +
                 '</span></label>';
        }).join('')
      : '<p style="color:var(--texto-3);margin:0 0 16px">Você ainda não criou nenhuma lista.</p>';

    camada.innerHTML =
      '<div class="folha-fundo" data-fechar="fundo"><div class="folha" role="dialog" aria-modal="true" ' +
        'aria-label="Adicionar a uma lista">' +
        '<h2>Adicionar a uma lista</h2>' +
        '<p class="folha-sub">' + esc(livro.titulo) + '</p>' +
        corpo +
        '<label class="campo" style="margin-top:18px"><span>Criar uma lista nova</span>' +
          '<input id="nova-lista" placeholder="Ex.: Para reler em 2027" autocomplete="off"></label>' +
        '<div class="folha-rodape">' +
          '<button class="botao destaque" data-fechar="ok">Pronto</button>' +
        '</div>' +
      '</div></div>';

    var painel = camada.firstElementChild;

    painel.addEventListener('change', function (ev) {
      var c = ev.target.closest('[data-lista]');
      if (!c) return;
      Dados.alternarNaLista(c.getAttribute('data-lista'), livro.chave);
    });

    painel.addEventListener('click', function (ev) {
      if (!ev.target.closest('[data-fechar]')) return;
      var alvo = ev.target.closest('[data-fechar]');
      if (alvo.getAttribute('data-fechar') === 'fundo' && ev.target !== alvo) return;

      var nome = (document.getElementById('nova-lista') || {}).value;
      if (nome && nome.trim()) {
        var l = Dados.criarLista(nome.trim());
        Dados.guardarLivro(livro);
        Dados.alternarNaLista(l.id, livro.chave);
        aviso('Lista “' + l.nome + '” criada.');
      }
      camada.innerHTML = '';
    });
  }

  /* ================================================================= TELA: diario */

  function htmlEntrada(log, comCapa) {
    var livro = livroDe(log.chave);
    var linha = [];
    linha.push(dataBr(log.lidoEm));
    if (log.relido) linha.push('releitura');
    if (Dados.curtido(log.chave)) linha.push('<span style="color:var(--curtida)">♥</span>');

    var resenha = '';
    if (log.resenha) {
      resenha = log.spoiler
        ? '<button class="spoiler-aviso" data-acao="ver-spoiler" data-texto="' + esc(log.resenha) +
          '">Esta resenha tem spoiler. Toque para ler.</button>'
        : '<p class="entrada-resenha">' + esc(log.resenha) + '</p>';
    }

    return '<div class="entrada' + (comCapa ? '' : ' sem-capa') + '">' +
      (comCapa
        ? '<a href="' + rotaLivro(log.chave) + '">' + htmlCapa(livro) + '</a>'
        : '<div>' + (typeof log.nota === 'number'
            ? '<div class="estrelas" style="font-size:15px">' + estrelasTexto(log.nota) + '</div>'
            : '<span style="color:var(--texto-3)">—</span>') + '</div>') +
      '<div>' +
        '<div class="entrada-topo">' +
          (comCapa
            ? '<a class="entrada-titulo" href="' + rotaLivro(log.chave) + '">' + esc(livro.titulo) + '</a>' +
              (livro.ano ? '<span class="entrada-ano">' + livro.ano + '</span>' : '') +
              (typeof log.nota === 'number'
                ? '<span class="estrelas">' + estrelasTexto(log.nota) + '</span>' : '')
            : '<span class="entrada-ano">' + dataBr(log.lidoEm) + '</span>') +
        '</div>' +
        (comCapa ? '<div class="entrada-linha">' + linha.join(' · ') + '</div>' : '') +
        resenha +
        '<div class="entrada-acoes">' +
          '<button data-acao="editar-log" data-id="' + log.id + '">editar</button>' +
          '<button data-acao="apagar-log" data-id="' + log.id + '">apagar</button>' +
        '</div>' +
      '</div>' +
    '</div>';
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

    /* Agrupa por mes, como o diario do Letterboxd. */
    var grupos = [];
    var atual = null;
    logs.forEach(function (l) {
      var chaveMes = (l.lidoEm || '').slice(0, 7);
      if (!atual || atual.mes !== chaveMes) {
        atual = { mes: chaveMes, itens: [] };
        grupos.push(atual);
      }
      atual.itens.push(l);
    });

    var html = '<h1 class="titulo-pagina">Diário</h1>' +
               '<p class="sub-pagina">' + plural(logs.length, 'leitura registrada', 'leituras registradas') +
               '.</p>';

    grupos.forEach(function (g) {
      var p = g.mes.split('-');
      var titulo = p.length === 2 ? MESES[Number(p[1]) - 1] + ' de ' + p[0] : 'Sem data';
      html += '<section class="secao"><h2>' + esc(titulo) + '</h2>' +
              g.itens.map(function (l) { return htmlEntrada(l, true); }).join('') +
              '</section>';
    });

    pintar(html);
    ligarAcoesDeEntrada();
  }

  function ligarAcoesDeEntrada() {
    tela.addEventListener('click', function (ev) {
      var alvo = ev.target.closest('[data-acao]');
      if (!alvo) return;
      var acao = alvo.getAttribute('data-acao');

      if (acao === 'editar-log') {
        var log = Dados.log(alvo.getAttribute('data-id'));
        if (log) abrirFolhaRegistro(livroDe(log.chave), log.id);
      }
      if (acao === 'apagar-log') {
        if (confirm('Apagar este registro de leitura?')) {
          Dados.apagarLog(alvo.getAttribute('data-id'));
          rotear();
        }
      }
      if (acao === 'ver-spoiler') {
        alvo.outerHTML = '<p class="entrada-resenha">' + esc(alvo.getAttribute('data-texto')) + '</p>';
      }
    });
  }

  /* ================================================================ TELA: estante */

  function telaEstante() {
    marcarAba('estante');
    var d = Dados.estado();

    /* obras distintas ja lidas, da leitura mais recente para a mais antiga */
    var vistos = {};
    var lidos = [];
    Dados.logs().forEach(function (l) {
      if (vistos[l.chave]) return;
      vistos[l.chave] = 1;
      lidos.push(livroDe(l.chave));
    });

    var html = '<h1 class="titulo-pagina">Estante</h1>' +
               '<p class="sub-pagina">O que você quer ler, o que já leu e o que amou.</p>';

    html += secaoEstante('Quero ler', d.querLer.map(livroDe),
      'A fila está vazia. Marque “Quero ler” na ficha de um livro.');
    html += secaoEstante('Lidos', lidos,
      'Nada por aqui ainda. Registre uma leitura para ela aparecer.');
    html += secaoEstante('Curtidos', d.curtidas.map(livroDe),
      'Você ainda não curtiu nenhum livro.');
    html += secaoEstante('Favoritos', d.favoritos.map(livroDe),
      'Escolha até ' + Dados.MAX_FAVORITOS + ' livros favoritos na ficha de cada um.');

    pintar(html);
  }

  function secaoEstante(titulo, livros, vazio) {
    return '<section class="secao"><h2>' + esc(titulo) +
           '<span style="margin-left:auto;color:var(--texto-3)">' + livros.length + '</span></h2>' +
           (livros.length
             ? htmlGrade(livros)
             : '<p style="color:var(--texto-3);font-size:13.5px;margin:0">' + esc(vazio) + '</p>') +
           '</section>';
  }

  /* ================================================================= TELA: listas */

  function telaListas() {
    marcarAba('listas');
    var listas = Dados.estado().listas;

    var html = '<h1 class="titulo-pagina">Listas</h1>' +
      '<p class="sub-pagina">Agrupe livros do jeito que fizer sentido: por tema, por ano, por vontade.</p>' +
      '<div class="linha-botoes" style="margin-bottom:26px">' +
        '<button class="botao destaque" data-acao="nova-lista">Criar uma lista</button>' +
      '</div>';

    if (!listas.length) {
      html += htmlVazio('Nenhuma lista ainda',
        'Uma lista pode ser “Li na praia”, “Para reler” ou “Presentes de 2027”.');
    } else {
      html += listas.map(function (l) {
        var capas = l.livros.slice(0, 5).map(function (c) { return htmlCapa(livroDe(c)); }).join('');
        return '<a class="cartao-lista" href="#/lista/' + l.id + '">' +
          '<h3>' + esc(l.nome) + '</h3>' +
          (l.descricao ? '<p>' + esc(l.descricao) + '</p>' : '') +
          (capas ? '<div class="pilha">' + capas + '</div>'
                 : '<p style="color:var(--texto-3);margin:0">Lista vazia</p>') +
          '<p style="margin:12px 0 0;color:var(--texto-3);font-size:12.5px">' +
            plural(l.livros.length, 'livro', 'livros') + '</p>' +
        '</a>';
      }).join('');
    }

    pintar(html);

    tela.addEventListener('click', function (ev) {
      if (!ev.target.closest('[data-acao="nova-lista"]')) return;
      var nome = prompt('Nome da lista:');
      if (nome && nome.trim()) {
        Dados.criarLista(nome.trim());
        telaListas();
      }
    });
  }

  function telaLista(idLista) {
    marcarAba('listas');
    var l = Dados.lista(idLista);
    if (!l) return pintar('<p class="erro">Esta lista não existe mais.</p>');

    var html = '<h1 class="titulo-pagina">' + esc(l.nome) + '</h1>' +
      '<p class="sub-pagina">' + (l.descricao ? esc(l.descricao) + ' · ' : '') +
      plural(l.livros.length, 'livro', 'livros') + '</p>' +
      (l.livros.length
        ? htmlGrade(l.livros.map(livroDe))
        : htmlVazio('Lista vazia',
            'Abra a ficha de um livro e use “Adicionar a uma lista”.')) +
      '<div class="linha-botoes" style="margin-top:30px">' +
        '<button class="botao discreto" data-acao="renomear">Renomear</button>' +
        '<button class="botao discreto" data-acao="descrever">Editar descrição</button>' +
        '<button class="botao perigo" data-acao="apagar-lista">Apagar lista</button>' +
      '</div>';

    pintar(html);

    tela.addEventListener('click', function (ev) {
      var alvo = ev.target.closest('[data-acao]');
      if (!alvo) return;
      var acao = alvo.getAttribute('data-acao');

      if (acao === 'renomear') {
        var nome = prompt('Novo nome:', l.nome);
        if (nome && nome.trim()) { Dados.editarLista(l.id, { nome: nome.trim() }); telaLista(l.id); }
      }
      if (acao === 'descrever') {
        var d = prompt('Descrição:', l.descricao || '');
        if (d !== null) { Dados.editarLista(l.id, { descricao: d.trim() }); telaLista(l.id); }
      }
      if (acao === 'apagar-lista') {
        if (confirm('Apagar a lista “' + l.nome + '”? Os livros continuam no seu diário.')) {
          Dados.apagarLista(l.id);
          ir('#/listas');
        }
      }
    });
  }

  /* ================================================================= TELA: perfil */

  function telaPerfil() {
    marcarAba('perfil');
    var d = Dados.estado();
    var e = Dados.estatisticas();
    var pct = e.meta ? Math.min(100, Math.round((e.noAno / e.meta) * 100)) : 0;
    var maior = Math.max.apply(null, e.faixas.map(function (f) { return f.qtd; }).concat([1]));

    var html =
      '<h1 class="titulo-pagina">' + esc(d.perfil.nome) + '</h1>' +
      '<p class="sub-pagina">' + (d.perfil.bio ? esc(d.perfil.bio) : 'Sem descrição ainda.') + '</p>' +

      '<div class="numeros">' +
        numero(e.lidos, 'leituras') +
        numero(e.obras, 'obras') +
        numero(e.resenhas, 'resenhas') +
        numero(e.media ? e.media.toFixed(1).replace('.', ',') : '—', 'nota média') +
        numero(e.paginas ? e.paginas.toLocaleString('pt-BR') : '—', 'páginas') +
        numero(e.listas, 'listas') +
      '</div>' +

      '<section class="secao"><h2>Meta de ' + d.perfil.meta.ano + '</h2>' +
        '<p style="margin:0 0 4px;color:var(--texto-2)">' +
          e.noAno + ' de ' + e.meta + ' livros · ' + pct + '%</p>' +
        '<div class="meta-barra"><i style="width:' + pct + '%"></i></div>' +
        '<button class="botao discreto" data-acao="editar-meta" style="margin-top:12px">' +
          'Ajustar a meta</button>' +
      '</section>';

    if (e.media !== null) {
      html += '<section class="secao"><h2>Como você avalia</h2>' +
        '<div class="histograma">' +
          e.faixas.map(function (f) {
            return '<div class="col' + (f.qtd ? ' tem' : '') + '" title="' +
                   String(f.nota).replace('.', ',') + ' — ' + plural(f.qtd, 'livro', 'livros') + '">' +
                   '<i style="height:' + Math.round((f.qtd / maior) * 100) + '%"></i></div>';
          }).join('') +
        '</div>' +
        '<div class="histograma-eixo"><span class="estrelas">★</span>' +
        '<span class="estrelas">★★★★★</span></div>' +
      '</section>';
    }

    if (d.favoritos.length) {
      html += '<section class="secao"><h2>Favoritos</h2>' +
              htmlGrade(d.favoritos.map(livroDe)) + '</section>';
    }

    html +=
      '<section class="secao"><h2>Seus dados</h2>' +
        '<p style="color:var(--texto-2);font-size:13.5px;margin:0 0 16px">' +
          'Tudo fica guardado só neste navegador. Exporte um arquivo para levar ' +
          'seu diário para outro aparelho — ou para não perder nada.</p>' +
        '<div class="linha-botoes">' +
          '<button class="botao" data-acao="editar-perfil">Editar perfil</button>' +
          '<button class="botao discreto" data-acao="exportar">Exportar diário</button>' +
          '<button class="botao discreto" data-acao="importar">Importar diário</button>' +
          '<button class="botao perigo" data-acao="limpar">Apagar tudo</button>' +
        '</div>' +
        '<input type="file" id="arquivo-importar" accept="application/json,.json" hidden>' +
      '</section>';

    pintar(html);

    tela.addEventListener('click', function (ev) {
      var alvo = ev.target.closest('[data-acao]');
      if (!alvo) return;
      var acao = alvo.getAttribute('data-acao');

      if (acao === 'editar-perfil') {
        var nome = prompt('Como você quer ser chamada?', d.perfil.nome);
        if (nome === null) return;
        var bio = prompt('Uma linha sobre você (opcional):', d.perfil.bio || '');
        d.perfil.nome = nome.trim() || d.perfil.nome;
        d.perfil.bio = (bio || '').trim();
        Dados.salvar();
        telaPerfil();
      }

      if (acao === 'editar-meta') {
        var alvoMeta = prompt('Quantos livros você quer ler em ' + d.perfil.meta.ano + '?',
                              d.perfil.meta.total);
        var n = parseInt(alvoMeta, 10);
        if (n > 0) { d.perfil.meta.total = n; Dados.salvar(); telaPerfil(); }
      }

      if (acao === 'exportar') exportarArquivo();

      if (acao === 'importar') document.getElementById('arquivo-importar').click();

      if (acao === 'limpar') {
        if (confirm('Isso apaga leituras, resenhas, listas e favoritos deste aparelho. ' +
                    'Não dá para desfazer. Continuar?')) {
          Dados.limpar();
          aviso('Tudo apagado.');
          ir('#/inicio');
          rotear();
        }
      }
    });

    var campoArquivo = document.getElementById('arquivo-importar');
    campoArquivo.addEventListener('change', function () {
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

  /* ==================================================================== roteador */

  function rotear() {
    camada.innerHTML = '';
    var partes = (location.hash || '#/inicio').replace(/^#\/?/, '').split('/');
    var rota = partes[0] || 'inicio';

    if (rota === 'buscar') {
      var termo = decodeURIComponent(partes[1] || '');
      var pagina = Math.max(1, parseInt(partes[2], 10) || 1);
      if (!termo) return ir('#/inicio');
      return telaBusca(termo, pagina);
    }
    if (rota === 'livro')   return telaLivro(decodeURIComponent(partes.slice(1).join('/')));
    if (rota === 'diario')  return telaDiario();
    if (rota === 'estante') return telaEstante();
    if (rota === 'listas')  return telaListas();
    if (rota === 'lista')   return telaLista(partes[1]);
    if (rota === 'perfil')  return telaPerfil();
    return telaInicio();
  }

  /* A busca do topo leva sempre para a tela de resultados. */
  document.getElementById('forma-busca').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var termo = document.getElementById('campo-busca').value.trim();
    if (!termo) return;
    ir('#/buscar/' + encodeURIComponent(termo) + '/1');
  });

  window.addEventListener('hashchange', rotear);
  rotear();
})();

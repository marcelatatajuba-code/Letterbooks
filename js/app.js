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

  /* A lombada com o titulo fica SEMPRE no HTML, e a imagem por cima dela.
     Se a capa nao carregar — 404 na Open Library, limite de taxa, rede caindo —
     o proprio img se remove e a lombada reaparece, em vez de sobrar uma caixa
     vazia. Numa tela que pede quarenta capas de uma vez, isso e a diferenca
     entre uma grade e um paredao de buracos. */
  /* A imagem de fundo das telas de detalhe, com o chevron de voltar por cima
     — nelas o cabecalho com a marca sai, e este vira o unico jeito de voltar. */
  function htmlHeroi(fundo) {
    if (!fundo) return '';
    return '<div class="heroi">' +
      '<div class="heroi-imagem" style="background-image:url(' + esc(fundo) + ')"></div>' +
      '<button class="voltar" data-acao="voltar" aria-label="Voltar">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"' +
        ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M15 5 8 12l7 7"></path></svg>' +
      '</button></div>';
  }

  /* Pôster de cinema é sempre 2:3; capa de livro, não. A Open Library devolve
     de tudo — quadrada, alta, larga — e forçar isso numa caixa 2:3 com
     object-fit:cover corta a borda, que numa capa é onde mora o título. Então
     a capa vai INTEIRA (contain) sobre uma cópia dela mesma desfocada, que
     preenche a caixa. É a mesma imagem: uma requisição, dois usos.

     A lombada com o título fica sempre no HTML, embaixo de tudo. Se a imagem
     falhar — 404, limite de taxa, rede caindo — os dois <img> se removem e a
     lombada reaparece, em vez de sobrar uma caixa vazia. */
  function htmlCapa(livro, extra) {
    var url = livro.capa || livro.capaGrande;
    var img = '';
    if (url) {
      img = '<img class="capa-fundo" src="' + esc(url) + '" alt="" aria-hidden="true"' +
            ' loading="lazy" onerror="this.remove()">' +
            '<img class="capa-imagem" src="' + esc(url) + '"' +
            ' alt="Capa de ' + esc(livro.titulo) + '"' +
            ' loading="lazy" onerror="this.remove()">';
    }
    return '<div class="capa">' +
      '<div class="capa-vazia"><span>' + esc(livro.titulo) + '</span></div>' +
      img + (extra || '') + '</div>';
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

  /* Trilho horizontal: o formato da home no original. */
  function htmlTrilho(livros) {
    if (!livros.length) return '';
    return '<div class="trilho">' +
      livros.map(function (l) { return htmlCartao(l, 0); }).join('') + '</div>';
  }

  /* As abas do topo: Livros, Resenhas e Listas — a tradução das abas
     Films / Reviews / Lists do original. */
  function htmlSegmentos(ativo) {
    var abas = [['inicio', 'Livros'], ['resenhas', 'Resenhas'], ['listas', 'Listas']];
    return '<nav class="segmentos" aria-label="Seções">' + abas.map(function (a) {
      return '<a href="#/' + a[0] + '"' + (a[0] === ativo ? ' class="ativa"' : '') + '>' +
             a[1] + '</a>';
    }).join('') + '</nav>';
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

  /* Um item da fileira de atividade: capa com nota e marcadores embaixo —
     como o original resume cada leitura recente no perfil. */
  function htmlAtividade(log) {
    var livro = livroDe(log.chave);
    return '<a class="cartao atividade" href="' + rotaLivro(log.chave) + '" title="' +
      esc(livro.titulo) + '">' + htmlCapa(livro) +
      '<span class="atividade-marcas">' +
        (typeof log.nota === 'number'
          ? '<span class="estrelas">' + estrelasTexto(log.nota) + '</span>' : '') +
        glifosDaLinha(log, true) +
      '</span></a>';
  }

  function mediaTexto(media) {
    return media === null ? '' : media.toFixed(1).replace('.', ',');
  }

  /* ================================================================== TELA: inicio */

  /* A home do app nao tem chamada de capa: ela abre direto no conteudo e
     empilha varios trilhos, tres deles visiveis antes de rolar. A versao
     anterior gastava a primeira dobra inteira num titulo de marketing e
     mostrava um trilho so. Aqui a ordem e: o que e seu primeiro, o acervo
     depois. */
  function telaInicio() {
    marcarAba('inicio');
    var logs = Dados.logs();
    var e = Dados.estatisticas();
    var html = htmlSegmentos('inicio');

    if (logs.length) {
      var vistos = {}, recentes = [];
      logs.forEach(function (l) {
        if (vistos[l.chave] || recentes.length >= 12) return;
        vistos[l.chave] = 1;
        recentes.push(livroDe(l.chave));
      });
      html += secaoTrilho('Suas leituras recentes', recentes, '#/diario');
    }

    if (Dados.estado().querLer.length) {
      html += secaoTrilho('Quero ler',
                          Dados.estado().querLer.slice(0, 16).map(livroDe), '#/estante');
    }

    html += '<section class="secao" id="secao-alta"><h2>Em alta esta semana</h2>' +
            '<div class="trilho-vazio" aria-hidden="true"></div></section>';

    /* Os demais trilhos so vao a rede quando chegam perto da tela. Quatro
       consultas de uma vez na abertura seriam quatro esperas para ver a
       primeira capa — e a Open Library limita a taxa. */
    html += secaoPreguicosa('populares',  'Mais lidos') +
            secaoPreguicosa('classicos',  'Clássicos') +
            secaoPreguicosa('brasileira', 'Literatura brasileira') +
            secaoPreguicosa('poesia',     'Poesia');

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
    ligarPreguicosas();
  }

  /* Titulo com o chevron a direita, como toda secao da home do app. */
  function secaoTrilho(titulo, livros, destino) {
    if (!livros.length) return '';
    return '<section class="secao"><h2>' + esc(titulo) +
      (destino ? '<a class="seta" href="' + destino + '" aria-label="Ver tudo em ' +
                 esc(titulo) + '"></a>' : '') +
      '</h2>' + htmlTrilho(livros) + '</section>';
  }

  function secaoPreguicosa(recorte, titulo) {
    return '<section class="secao preguicosa" data-recorte="' + esc(recorte) + '">' +
      '<h2>' + esc(titulo) + '<a class="seta" href="#/explorar/' + esc(recorte) +
      '" aria-label="Ver tudo em ' + esc(titulo) + '"></a></h2>' +
      '<div class="trilho-vazio" aria-hidden="true"></div></section>';
  }

  /* Carrega cada trilho quando ele chega a 300px da tela. Sem
     IntersectionObserver (navegador antigo), carrega todos de uma vez. */
  function ligarPreguicosas() {
    var secoes = Array.prototype.slice.call(tela.querySelectorAll('.preguicosa'));
    if (!secoes.length) return;

    function encher(s) {
      if (s.getAttribute('data-carregando')) return;
      s.setAttribute('data-carregando', '1');
      API.explorar(s.getAttribute('data-recorte'), 1).then(function (r) {
        if (!tela.contains(s)) return;
        r.livros.forEach(Dados.guardarLivro);
        var vazio = s.querySelector('.trilho-vazio');
        if (!vazio) return;
        if (r.livros.length) vazio.outerHTML = htmlTrilho(r.livros.slice(0, 14));
        else s.remove();
      }).catch(function () {
        /* Um trilho do acervo que nao carregou nao vale uma mensagem de erro
           no meio da home: a secao simplesmente sai. O erro da busca e do
           "em alta" continua aparecendo, porque ali a pessoa pediu. */
        if (tela.contains(s)) s.remove();
      });
    }

    if (!window.IntersectionObserver) return secoes.forEach(encher);

    var olho = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (en) {
        if (!en.isIntersecting) return;
        olho.unobserve(en.target);
        encher(en.target);
      });
    }, { rootMargin: '300px 0px' });
    secoes.forEach(function (s) { olho.observe(s); });
  }

  function espera(s) {
    return s.querySelector('.trilho-vazio') || s.querySelector('.carregando');
  }

  /* Preenche a secao #secao-alta, usada tanto no inicio quanto na busca. */
  function preencherEmAlta(quantos) {
    API.emAlta(quantos).then(function (livros) {
      var s = document.getElementById('secao-alta');
      if (!s) return;
      livros.forEach(Dados.guardarLivro);
      espera(s).outerHTML = livros.length
        ? (s.getAttribute('data-forma') === 'grade' ? htmlGrade(livros) : htmlTrilho(livros))
        : '<p class="erro">Não consegui carregar os destaques agora.</p>';
    }).catch(function (err) {
      var s = document.getElementById('secao-alta');
      if (!s) return;
      espera(s).outerHTML =
        '<p class="erro">' + esc(err.message) + ' Verifique a conexão e recarregue.</p>';
    });
  }

  /* Uma linha do bloco de ajustes: rotulo, valor opcional e o chevron. */
  function linhaAjuste(tag, atributos, rotulo, valor) {
    /* Paginas nao leva a lugar nenhum, entao nao ganha chevron: seta que nao
       abre nada e promessa que a tela nao cumpre. */
    var mudo = atributos.indexOf('sem-link') >= 0;
    return '<' + tag + ' ' + atributos + '>' + esc(rotulo) +
      (valor ? '<span class="valor">' + valor + '</span>' : '') +
      (mudo ? '' : '<span class="chevron" aria-hidden="true">›</span>') +
      '</' + tag + '>';
  }

  function numero(valor, rotulo) {
    return '<div class="numero"><b>' + esc(valor) + '</b><span>' + esc(rotulo) + '</span></div>';
  }

  /* ================================================================== TELA: busca */

  /* Sem termo, a busca e uma tela em si — o que o icone da lupa abre no
     celular. Com termo, e a tela de resultados. */
  function telaBuscaVazia() {
    marcarAba('buscar');
    var r = API.recortes();
    var linhas = Object.keys(r).map(function (k) {
      return '<a class="linha-diretorio" href="#/explorar/' + k + '/1">' +
             esc(r[k].rotulo) + '</a>';
    }).join('');

    pintar('<h1 class="titulo-pagina">Buscar</h1>' +
      '<form class="busca-grande" id="busca-grande">' +
        '<input id="busca-grande-campo" type="search" autocomplete="off" ' +
               'placeholder="Título, autor ou ISBN" aria-label="Buscar livros">' +
      '</form>' +
      '<div id="recentes-busca">' + htmlBuscasRecentes() + '</div>' +
      '<section class="secao" style="margin-top:28px"><h2>Explorar por</h2>' +
        '<nav class="diretorio">' + linhas + '</nav></section>' +
      '<section class="secao" id="secao-alta" data-forma="grade">' +
        '<h2>Em alta esta semana</h2>' +
        '<p class="carregando">Buscando na Open Library…</p></section>');

    document.getElementById('busca-grande').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var t = document.getElementById('busca-grande-campo').value.trim();
      if (t) ir('#/buscar/' + encodeURIComponent(t) + '/1');
    });
    acoes({});
    tela.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-busca]');
      if (b) { ev.preventDefault(); return ir('#/buscar/' + encodeURIComponent(b.getAttribute('data-busca')) + '/1'); }
      if (ev.target.closest('[data-esquecer]')) {
        ev.preventDefault();
        Dados.esquecerBuscas();
        document.getElementById('recentes-busca').innerHTML = '';
      }
    });
    preencherEmAlta(14);
  }

  /* Duas pilulas de escopo, como "Films | Cast, Crew or Studios" do app. */
  function htmlEscopos(termo, escopo) {
    var abas = [['', 'Livros'], ['autores', 'Autores']];
    if (Nuvem.ligada()) abas.push(['leitores', 'Leitores']);
    return '<nav class="escopos" aria-label="O que buscar">' + abas.map(function (a) {
      var alvo = '#/buscar/' + encodeURIComponent(termo) + '/1' + (a[0] ? '/' + a[0] : '');
      return '<a href="' + alvo + '"' + (a[0] === escopo ? ' class="ativa"' : '') + '>' +
             a[1] + '</a>';
    }).join('') + '</nav>';
  }

  /* Uma linha de resultado: capa pequena, titulo em negrito e "ano, de Fulano"
     em cinza embaixo. O app lista assim em vez de mostrar uma grade de
     posteres, e para livro isso importa mais ainda: capa de livro identifica
     muito menos que poster de filme, e boa parte do acervo nem tem capa. */
  function htmlLinhaLivro(l) {
    var meta = [l.ano, l.autores && l.autores.length ? 'de ' + l.autores[0] : '']
                 .filter(Boolean).join(', ');
    return '<a class="resultado" href="' + rotaLivro(l.chave) + '">' +
      '<div class="resultado-capa">' + htmlCapa(l) + '</div>' +
      '<div class="resultado-texto">' +
        '<b>' + esc(l.titulo) + '</b>' +
        (meta ? '<span>' + esc(meta) + '</span>' : '') +
      '</div></a>';
  }

  function telaBusca(termo, pagina, escopo) {
    marcarAba('buscar');
    Dados.registrarBusca(termo);
    document.getElementById('campo-busca').value = termo;
    carregando('Procurando “' + termo + '” no acervo…');

    if (escopo === 'autores')  return buscaDeAutores(termo, pagina);
    if (escopo === 'leitores') return buscaDeLeitores(termo);

    API.buscar(termo, pagina).then(function (r) {
      r.livros.forEach(Dados.guardarLivro);
      var html = '<h1 class="titulo-pagina">' + esc(termo) + '</h1>' +
                 htmlEscopos(termo, '');

      if (!r.livros.length) {
        return pintar(html + htmlVazio('Nada encontrado',
          'Tente outra grafia, o nome do autor, ou o ISBN da edição.'));
      }

      html += '<p class="sub-pagina">' + plural(r.total, 'resultado', 'resultados') +
              ' no acervo da Open Library.</p>' +
              '<div class="resultados">' + r.livros.map(htmlLinhaLivro).join('') + '</div>' +
              htmlPaginas(termo, pagina, r.total, '');
      pintar(html);
      window.scrollTo(0, 0);
    }).catch(function (err) {
      pintar('<h1 class="titulo-pagina">' + esc(termo) + '</h1>' + htmlEscopos(termo, '') +
             '<p class="erro">Não foi possível buscar agora. ' + esc(err.message) + '</p>');
    });
  }

  function buscaDeAutores(termo, pagina) {
    API.buscarAutores(termo, pagina).then(function (r) {
      var html = '<h1 class="titulo-pagina">' + esc(termo) + '</h1>' +
                 htmlEscopos(termo, 'autores');

      if (!r.autores.length) {
        return pintar(html + htmlVazio('Ninguém com esse nome',
          'Tente só o sobrenome, ou busque pelo título do livro.'));
      }

      html += '<p class="sub-pagina">' + plural(r.total, 'autor', 'autores') +
              ' no acervo.</p>' +
              '<div class="resultados">' + r.autores.map(function (a) {
                var meta = [a.anos, a.obras ? plural(a.obras, 'obra', 'obras') : '',
                            a.principal].filter(Boolean).join(' · ');
                return '<a class="resultado" href="#/autor/' + encodeURIComponent(a.chave) + '">' +
                  '<div class="resultado-inicial" aria-hidden="true">' +
                    esc(a.nome.trim().charAt(0).toUpperCase()) + '</div>' +
                  '<div class="resultado-texto"><b>' + esc(a.nome) + '</b>' +
                    (meta ? '<span>' + esc(meta) + '</span>' : '') +
                  '</div></a>';
              }).join('') + '</div>' +
              htmlPaginas(termo, pagina, r.total, 'autores', 20);
      pintar(html);
      window.scrollTo(0, 0);
    }).catch(function (err) {
      pintar('<h1 class="titulo-pagina">' + esc(termo) + '</h1>' + htmlEscopos(termo, 'autores') +
             '<p class="erro">Não foi possível buscar agora. ' + esc(err.message) + '</p>');
    });
  }

  /* Procurar gente. Sem isto ninguem acha ninguem para seguir, e o feed de
     "Seguindo" nasce vazio para sempre. */
  function buscaDeLeitores(termo) {
    Nuvem.procurarLeitores(termo).then(function (gente) {
      var eu = Nuvem.entrou() ? Nuvem.quemSou() : null;
      var outros = (gente || []).filter(function (p) { return !eu || p.id !== eu.id; });
      var html = '<h1 class="titulo-pagina">' + esc(termo) + '</h1>' +
                 htmlEscopos(termo, 'leitores');

      if (!outros.length) {
        return pintar(html + htmlVazio('Ninguém com esse nome',
          'Procure pelo @ da pessoa, ou pelo nome que ela usa no perfil.'));
      }

      html += '<p class="sub-pagina">' + plural(outros.length, 'leitor', 'leitores') +
              ' no Letterbooks.</p>' +
              '<div class="resultados">' + outros.map(function (p) {
                var nome = p.nome || p.usuario;
                return '<a class="resultado" href="#/leitor/' + encodeURIComponent(p.usuario) + '">' +
                  '<div class="resultado-inicial" aria-hidden="true">' +
                    esc(nome.trim().charAt(0).toUpperCase()) + '</div>' +
                  '<div class="resultado-texto"><b>' + esc(nome) + '</b>' +
                    '<span>@' + esc(p.usuario) +
                    (p.bio ? ' · ' + esc(p.bio) : '') + '</span></div></a>';
              }).join('') + '</div>';
      pintar(html);
      window.scrollTo(0, 0);
    }, function (err) {
      pintar('<h1 class="titulo-pagina">' + esc(termo) + '</h1>' +
             htmlEscopos(termo, 'leitores') +
             '<p class="erro">' + esc(err.message) + '</p>');
    });
  }

  function htmlPaginas(termo, pagina, total, escopo, porPagina) {
    var ultima = Math.min(Math.ceil(total / (porPagina || 24)), 42);
    if (ultima <= 1) return '';
    var base = '#/buscar/' + encodeURIComponent(termo) + '/';
    var fim = escopo ? '/' + escopo : '';
    var s = '<div class="linha-botoes" style="margin-top:24px;justify-content:center">';
    if (pagina > 1) s += '<a class="botao" href="' + base + (pagina - 1) + fim + '">← Anteriores</a>';
    s += '<span class="botao" style="cursor:default">Página ' + pagina + ' de ' + ultima + '</span>';
    if (pagina < ultima) s += '<a class="botao" href="' + base + (pagina + 1) + fim + '">Próximos →</a>';
    return s + '</div>';
  }

  /* =============================================================== TELA: recorte */

  function telaExplorar(chave, pagina) {
    marcarAba('buscar');
    carregando('Montando a seleção…');

    API.explorar(chave, pagina).then(function (r) {
      r.livros.forEach(Dados.guardarLivro);
      var html = '<h1 class="titulo-pagina">' + esc(r.recorte.rotulo) + '</h1>' +
        '<p class="sub-pagina">' + esc(r.recorte.descricao) + '</p>';

      if (!r.livros.length) {
        return pintar(html + htmlVazio('Nada aqui agora',
          'A Open Library não devolveu resultados para este recorte.'));
      }

      html += htmlGrade(r.livros);
      var ultima = Math.min(Math.ceil(r.total / 24), 42);
      if (ultima > 1) {
        html += '<div class="linha-botoes" style="margin-top:24px;justify-content:center">';
        if (pagina > 1) {
          html += '<a class="botao" href="#/explorar/' + chave + '/' + (pagina - 1) + '">← Anteriores</a>';
        }
        html += '<span class="botao" style="cursor:default">Página ' + pagina + '</span>';
        if (pagina < ultima) {
          html += '<a class="botao" href="#/explorar/' + chave + '/' + (pagina + 1) + '">Próximos →</a>';
        }
        html += '</div>';
      }
      pintar(html);
      window.scrollTo(0, 0);
    }).catch(function (err) {
      pintar('<p class="erro">Não consegui montar esta seleção. ' + esc(err.message) + '</p>');
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
    var fundo = livro.capaGrande || livro.capa;

    /* O original nao usa abas na ficha: empilha sinopse, assuntos e detalhes,
       com a sinopse longa esmaecendo no fim em vez de ser cortada. */
    var sin = livro.sinopse || '';
    /* ~320 caracteres sao cerca de quatro linhas no celular, que e onde o
       original comeca a esmaecer. */
    var longa = sin.length > 320;
    var miolo = (sin
      ? '<p class="sinopse' + (longa ? ' recolhida' : '') + '" id="sinopse">' + esc(sin) + '</p>' +
        (longa ? '<button class="mais" data-acao="expandir">Ler a sinopse inteira</button>' : '')
      : '<p class="sinopse" style="color:var(--texto-3)">' +
        'Esta obra ainda não tem sinopse na Open Library.</p>');

    var as = livro.assuntos || [];
    if (as.length) {
      miolo += '<div class="bloco"><span class="rotulo">Assuntos</span>' +
        '<div class="assuntos">' + as.slice(0, 18).map(function (a) {
          return '<a class="assunto" href="#/buscar/' + encodeURIComponent(a) + '/1">' +
                 esc(a) + '</a>';
        }).join('') + '</div></div>';
    }

    var linhas = [
      ['Publicado', livro.ano || '—'],
      ['Páginas', livro.paginas || '—'],
      ['Edições', livro.edicoes || '—'],
      ['Open Library', livro.chave]
    ];
    miolo += '<div class="bloco"><span class="rotulo">Detalhes</span>' +
      '<table class="detalhes"><tbody>' + linhas.map(function (l) {
        return '<tr><th>' + esc(l[0]) + '</th><td>' + esc(l[1]) + '</td></tr>';
      }).join('') + '</tbody></table></div>';

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
      '</aside>';

    /* O histograma sai do painel e vai para o corpo, com a media grande ao
       lado — e assim continua visivel no celular, onde o painel nao aparece. */
    var blocoNotas = e.media === null ? '' :
      '<section class="avaliacoes"><span class="rotulo">Avaliações</span>' +
        '<div class="avaliacoes-linha">' +
          '<div class="avaliacoes-grafico">' + htmlHistograma(e.faixas) + '</div>' +
          '<div class="avaliacoes-media">' + mediaTexto(e.media) + '</div>' +
        '</div>' +
      '</section>';

    var html =
      htmlHeroi(fundo) +
      '<div class="livro-colunas">' +
        '<div class="livro-capa">' + htmlCapa(livro) + '</div>' +
        /* No celular o titulo fica a ESQUERDA e a capa flutua a direita, sobre
           o fundo desfocado — e o desenho do app. O miolo (sinopse, assuntos,
           detalhes) volta a ocupar a largura inteira embaixo, senao ficaria
           espremido numa coluna de 250px ate o fim da pagina. */
        '<div class="livro-texto">' +
          '<div class="livro-topo">' +
            '<h1 class="livro-titulo">' + esc(livro.titulo) + '</h1>' +
            /* Dois niveis, como "2026 · DIRECTED BY / Na Hong-jin" no app: o
               versalete miudo diz o que e, e o nome fica em negrito embaixo. */
            '<div class="livro-linha">' +
              '<span class="rotulo">' + (livro.ano ? livro.ano + ' · ' : '') + 'De</span>' +
              '<span class="autoria">' + htmlAutoria(livro) + '</span>' +
            '</div>' +
          '</div>' +
          miolo +
          blocoNotas +
          (logs.length ? '<section class="secao" style="margin-top:30px">' +
            '<h2>Suas leituras<span class="conta">' + logs.length + '</span></h2>' +
            tabelaDiario(logs, false) + '</section>' : '') +
        '</div>' +
        painel +
      '</div>' +

      /* No celular o painel some e esta barra fica fixa acima da navegacao,
         como a barra de acao do original. */
      '<div class="barra-acao"><button data-acao="rapida">' +
        (lido ? 'Você leu' + (nota ? ' · ' + estrelasTexto(nota) : '') +
                ' — avaliar, resenhar…'
              : 'Avaliar, registrar, resenhar…') +
      '</button></div>';

    pintar(html);

    acoes({
      expandir: function (a) {
        document.getElementById('sinopse').classList.remove('recolhida');
        a.remove();
      },
      registrar: function () { abrirFolhaRegistro(livro, null); },
      rapida: function () { abrirFolhaRapida(livro); },
      quero:  function () { Dados.alternarQuerLer(livro.chave); desenhaLivro(livro); },
      curtir: function () { Dados.alternarCurtida(livro.chave); desenhaLivro(livro); },
      listas: function () { abrirFolhaListas(livro); },
      compartilhar: function (b) {
        b.disabled = true;
        b.textContent = 'Montando…';
        cartaoDeCompartilhar(livro, nota).then(function (msg) {
          if (msg) aviso(msg);
        }).catch(function (err) {
          aviso('Não consegui montar a imagem: ' + err.message);
        }).then(function () { desenhaLivro(livro); });
      },
      favorito: function () {
        var r = Dados.alternarFavorito(livro.chave);
        if (r.cheio) aviso('Os favoritos guardam ' + Dados.MAX_FAVORITOS + ' livros. Tire um antes.');
        else desenhaLivro(livro);
      },
      'editar-log': function (a) {
        var log = Dados.log(a.getAttribute('data-id'));
        if (log) abrirFolhaRegistro(livroDe(log.chave), log.id);
      },
      'apagar-log': function (a) {
        if (!confirm('Apagar este registro de leitura?')) return;
        Dados.apagarLog(a.getAttribute('data-id'));
        desenhaLivro(livro);
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

  /* Curtida, releitura e resenha, do jeito que o original marca cada entrada.
     Com semLink, o ≡ sai como texto e nao como link: dentro de um cartao ele
     seria uma ancora dentro de outra, o que o navegador nao aceita — fecha a
     de fora e joga o glifo para fora do cartao. */
  function glifosDaLinha(log, semLink) {
    var g = '';
    if (Dados.curtido(log.chave)) g += '<i class="on" title="Curtido">♥</i>';
    if (log.relido)               g += '<i title="Releitura">↺</i>';
    if (log.resenha) {
      g += semLink
        ? '<i title="Tem resenha">≡</i>'
        : '<a href="#/resenha/' + log.id + '" title="Tem resenha">≡</a>';
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
      htmlHeroi(fundo) +
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

  /* =============================================================== TELA: resenhas */
  /* O que a aba Reviews do original mostra: as resenhas em cartoes, da mais
     recente para a mais antiga. */

  function telaResenhas() {
    marcarAba('inicio');
    var comResenha = Dados.logs().filter(function (l) { return l.resenha; });

    if (!comResenha.length) {
      return pintar(htmlSegmentos('resenhas') +
        '<h1 class="titulo-pagina">Resenhas</h1>' +
        htmlVazio('Você ainda não escreveu nenhuma',
          'Ao registrar uma leitura, o que você escrever aparece aqui.',
          '<a class="botao destaque" href="#/inicio">Encontrar um livro</a>'));
    }

    pintar(htmlSegmentos('resenhas') +
      '<h1 class="titulo-pagina">Resenhas</h1>' +
      '<p class="sub-pagina">' +
        plural(comResenha.length, 'resenha escrita', 'resenhas escritas') + '.</p>' +
      comResenha.map(htmlCartaoResenha).join(''));
  }

  function htmlCartaoResenha(log) {
    var livro = livroDe(log.chave);
    var texto = log.resenha.length > 220 ? log.resenha.slice(0, 220).replace(/\s\S*$/, '…')
                                         : log.resenha;
    return '<a class="cartao-resenha" href="#/resenha/' + log.id + '">' +
      '<div class="cartao-resenha-capa">' + htmlCapa(livro) + '</div>' +
      '<div>' +
        '<h3>' + esc(livro.titulo) +
          (livro.ano ? ' <span class="ano">' + livro.ano + '</span>' : '') + '</h3>' +
        '<p class="cartao-resenha-linha">' +
          '<span class="estrelas">' + estrelasTexto(log.nota) + '</span> ' +
          '<span>' + dataBr(log.lidoEm) + '</span>' +
          (log.relido ? ' <span>· releitura</span>' : '') +
        '</p>' +
        (log.spoiler
          ? '<p class="cartao-resenha-texto" style="color:var(--texto-3)">' +
            'Contém spoiler — abra para ler.</p>'
          : '<p class="cartao-resenha-texto">' + esc(texto) + '</p>') +
      '</div></a>';
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

    var html = htmlSegmentos('listas') +
      '<h1 class="titulo-pagina">Listas</h1>' +
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
      htmlHeroi(fundo) +
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
    var ultimos = Dados.logs().slice(0, 8);

    /* A ordem e a do original: abas primeiro, avatar centralizado, favoritos,
       atividade recente, e so entao os numeros e o resto. */
    var html =
      '<nav class="perfil-atalhos" aria-label="Suas coleções">' +
        '<a class="ativa" href="#/perfil">Perfil</a>' +
        '<a href="#/diario">Diário</a>' +
        '<a href="#/listas">Listas</a>' +
        '<a href="#/estante">Estante</a>' +
      '</nav>' +

      '<div class="perfil-topo">' +
        '<div class="avatar" aria-hidden="true">' + esc(inicial) + '</div>' +
        '<h1 class="perfil-nome">' + esc(d.perfil.nome) + '</h1>' +
        '<p class="perfil-bio" id="meu-arroba">' +
          (d.perfil.bio ? esc(d.perfil.bio) : 'Sem descrição ainda.') + '</p>' +
      '</div>' +

      (d.favoritos.length
        ? '<section class="bloco"><span class="rotulo">Favoritos</span>' +
          '<div class="fileira">' + d.favoritos.slice(0, Dados.MAX_FAVORITOS)
            .map(function (c) { return htmlCartao(livroDe(c), 0); }).join('') +
          '</div></section>'
        : '') +

      (ultimos.length
        ? '<section class="bloco"><span class="rotulo">Atividade recente</span>' +
          '<div class="fileira">' + ultimos.slice(0, 4).map(htmlAtividade).join('') + '</div>' +
          '<a class="linha-mais" href="#/diario">Mais atividade</a></section>'
        : '') +

      /* A lista de contagens do perfil do app: cada linha e um numero E um
         caminho. A fileira de numeros soltos que eu tinha mostrava o mesmo
         dado sem levar a lugar nenhum. */
      '<div class="linhas linhas-conta">' +
        linhaAjuste('a', 'href="#/diario"', 'Leituras',
                    e.lidos + (e.noAno ? ' <i>' + e.noAno + ' em ' + d.perfil.meta.ano + '</i>' : '')) +
        linhaAjuste('a', 'href="#/diario"', 'Obras', String(e.obras)) +
        linhaAjuste('a', 'href="#/resenhas"', 'Resenhas', String(e.resenhas)) +
        linhaAjuste('a', 'href="#/listas"', 'Listas', String(e.listas)) +
        linhaAjuste('a', 'href="#/estante"', 'Quero ler', String(e.querLer)) +
        linhaAjuste('a', 'href="#/estante"', 'Curtidas', String(e.curtidas)) +
        linhaAjuste('span', 'class="sem-link"', 'Páginas',
                    e.paginas ? e.paginas.toLocaleString('pt-BR') : '—') +
        /* Preenchido depois, pela nuvem: quem me segue e quem eu sigo. Fica
           aqui como espaco reservado para a lista nao pular quando chegar. */
        (Nuvem.entrou() ? '<span class="sem-link" id="meu-social-espera">Seguidores' +
                          '<span class="valor">…</span></span>' : '') +
      '</div>' +

      '<section class="secao"><h2>Meta de ' + d.perfil.meta.ano + '</h2>' +
        '<p style="margin:0 0 4px;color:var(--texto-2);font-size:13px">' +
          e.noAno + ' de ' + e.meta + ' livros · ' + pct + '%</p>' +
        '<div class="meta-barra"><i style="width:' + pct + '%"></i></div>' +
      '</section>';

    if (e.media !== null) {
      html += '<section class="avaliacoes"><span class="rotulo">Como você avalia</span>' +
        '<div class="avaliacoes-linha">' +
          '<div class="avaliacoes-grafico">' + htmlHistograma(e.faixas) + '</div>' +
          '<div class="avaliacoes-media">' + mediaTexto(e.media) + '</div>' +
        '</div></section>';
    }

    var naNuvem = Nuvem.ligada();
    /* Linhas de lista, nao fileira de botoes: e o padrao do app para ajustes,
       e cabe o dobro de opcoes na mesma altura. */
    html += '<section class="secao"><h2>Seus dados</h2>' +
      '<p style="color:var(--texto-2);font-size:13px;margin:0 0 14px">' +
        (naNuvem
          ? (Nuvem.entrou()
              ? 'Você está na sua conta. O que registrar daqui em diante também fica no aparelho — o arquivo exportado continua sendo a sua cópia de segurança.'
              : 'Este diário está guardado só neste navegador. Crie uma conta para levá-lo com você e aparecer no feed de quem te segue.')
          : 'Tudo fica guardado só neste navegador. Exporte um arquivo para levar seu diário para outro aparelho — ou para não perder nada.') + '</p>' +
      '<div class="linhas">' +
        (naNuvem
          ? linhaAjuste('a', 'href="#/conta"', 'Conta',
                        Nuvem.entrou() ? 'entrou' : 'criar conta')
          : '') +
        linhaAjuste('button', 'data-acao="editar-perfil"', 'Editar perfil', esc(d.perfil.nome)) +
        linhaAjuste('button', 'data-acao="editar-meta"', 'Meta do ano',
                    d.perfil.meta.total + ' livros') +
        linhaAjuste('button', 'data-acao="exportar"', 'Exportar diário', '') +
        linhaAjuste('button', 'data-acao="importar"', 'Importar diário', '') +
        linhaAjuste('button', 'data-acao="limpar" class="perigo"', 'Apagar tudo', '') +
      '</div>' +
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

    if (Nuvem.entrou()) enfeitarPerfilComANuvem();

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

  /* As ultimas buscas, para repetir sem redigitar — como no cartao de
     adicionar do original. */
  function htmlBuscasRecentes() {
    var b = Dados.buscas();
    if (!b.length) return '';
    return '<div class="recentes"><div class="recentes-topo">' +
        '<span class="rotulo">Buscas recentes</span>' +
        '<button class="mais" data-esquecer="1">Limpar</button></div>' +
      b.map(function (t) {
        return '<button class="recente" data-busca="' + esc(t) + '">' + esc(t) + '</button>';
      }).join('') + '</div>';
  }

  /* ============================================== folha de acao rapida ==== */
  /* As quatro acoes do livro num cartao so, como o cartao de avaliacao rapida
     do original. E o que a barra fixa do celular abre. */

  function abrirFolhaRapida(livro) {
    function botao(acao, glifo, rotulo, ativa) {
      return '<button class="rapida-acao' + (ativa ? ' ativa' : '') + '" data-r="' + acao + '">' +
             '<span class="glifo" aria-hidden="true">' + glifo + '</span>' +
             '<span>' + esc(rotulo) + '</span></button>';
    }

    function pinta() {
      var nota = Dados.notaDe(livro.chave);
      var lido = Dados.jaLeu(livro.chave);
      return '<div class="rapida-capa">' + htmlCapa(livro) + '</div>' +
        '<h2>' + esc(livro.titulo) + '</h2>' +
        '<p class="folha-sub">' + esc(autoria(livro)) +
          (livro.ano ? ' · ' + livro.ano : '') + '</p>' +
        '<div class="rapida-acoes">' +
          botao('registrar', lido ? '◉' : '○', lido ? 'Lido' : 'Registrar', lido) +
          botao('curtir', Dados.curtido(livro.chave) ? '♥' : '♡', 'Curtir',
                Dados.curtido(livro.chave)) +
          botao('quero', Dados.querLer(livro.chave) ? '◷' : '◌', 'Quero ler',
                Dados.querLer(livro.chave)) +
          botao('favorito', Dados.favorito(livro.chave) ? '★' : '☆', 'Favorito',
                Dados.favorito(livro.chave)) +
        '</div>' +
        /* No app a folha de acao avalia ali mesmo: "Rate" e uma fileira de
           estrelas tocaveis, nao um numero para olhar. Sem isso, dar uma nota
           custava abrir a folha de registro inteira. */
        '<div class="rapida-nota">' +
          '<span class="rotulo">Sua nota</span>' +
          '<div class="seletor-estrelas"><div class="campo" style="margin:0">' +
            estrelasBotoes(nota) + '</div>' +
            (nota ? '<button type="button" class="limpar" data-pos="0">limpar</button>' : '') +
          '</div>' +
        '</div>' +
        '<div class="linhas">' +
          /* Se ja existe leitura deste livro, esta linha EDITA a mais recente.
             Antes ela abria em branco e criava uma segunda — quem desse a
             estrela aqui e depois quisesse escrever a resenha acabava com o
             livro duas vezes no diario. Releitura continua existindo, pelo
             botao da propria ficha do livro. */
          '<button data-r="registrar">' +
            (lido ? 'Escrever ou editar' : 'Registrar leitura') +
            '<span class="chevron">›</span></button>' +
          (lido ? '<button data-r="reler">Registrar outra leitura' +
                  '<span class="chevron">›</span></button>' : '') +
          '<button data-r="listas">Adicionar a uma lista<span class="chevron">›</span></button>' +
          '<button data-r="compartilhar">Compartilhar<span class="chevron">›</span></button>' +
        '</div>';
    }

    /* Meia estrela na metade esquerda do botao, estrela inteira na direita —
       a mesma regra da folha de registro. */
    function notaDoToque(botao, ev) {
      var pos = parseInt(botao.getAttribute('data-pos'), 10);
      if (!pos) return null;
      var cx = botao.getBoundingClientRect();
      var meia = (ev.clientX - cx.left) < cx.width / 2;
      return meia ? pos - 0.5 : pos;
    }

    /* Avaliar aqui atualiza a leitura mais recente do livro; se nao houver
       nenhuma, cria uma com a data de hoje. Sem isso, cada toque numa estrela
       viraria uma linha nova no diario. */
    function avaliar(valor) {
      var anteriores = Dados.logsDo(livro.chave);
      if (anteriores.length) {
        Dados.registrar({ id: anteriores[0].id, chave: livro.chave, nota: valor,
                          resenha: anteriores[0].resenha, lidoEm: anteriores[0].lidoEm,
                          relido: anteriores[0].relido, spoiler: anteriores[0].spoiler });
      } else {
        Dados.guardarLivro(livro);
        Dados.registrar({ chave: livro.chave, nota: valor });
      }
    }

    camada.innerHTML =
      '<div class="folha-fundo" data-fechar="fundo">' +
        '<div class="folha folha-rapida" role="dialog" aria-modal="true" aria-label="' +
          esc(livro.titulo) + '"><div id="rapida-miolo">' + pinta() + '</div>' +
        '<div class="folha-rodape"><button class="botao" data-fechar="ok">Fechar</button></div>' +
      '</div></div>';

    var painel = camada.firstElementChild;
    var miolo = document.getElementById('rapida-miolo');

    function fechar() {
      document.removeEventListener('keydown', aoTeclar);
      camada.innerHTML = '';
    }
    function aoTeclar(ev) { if (ev.key === 'Escape') { fechar(); rotear(); } }
    document.addEventListener('keydown', aoTeclar);

    painel.addEventListener('click', function (ev) {
      var acao = ev.target.closest('[data-r]');
      var est = ev.target.closest('.seletor-estrelas [data-pos]');
      if (est) {
        var v = notaDoToque(est, ev);
        avaliar(v);
        miolo.innerHTML = pinta();
        return;
      }
      if (acao) {
        var qual = acao.getAttribute('data-r');
        if (qual === 'registrar') {
          var anterior = Dados.logsDo(livro.chave)[0];
          fechar();
          return abrirFolhaRegistro(livro, anterior ? anterior.id : null);
        }
        if (qual === 'reler') { fechar(); return abrirFolhaRegistro(livro, null); }
        if (qual === 'listas')    { fechar(); return abrirFolhaListas(livro); }
        if (qual === 'compartilhar') {
          fechar();
          return cartaoDeCompartilhar(livro, Dados.notaDe(livro.chave)).then(function (m) {
            if (m) aviso(m);
          }).catch(function (e) { aviso('Não consegui montar a imagem: ' + e.message); });
        }
        if (qual === 'curtir')  Dados.alternarCurtida(livro.chave);
        if (qual === 'quero')   Dados.alternarQuerLer(livro.chave);
        if (qual === 'favorito') {
          var r = Dados.alternarFavorito(livro.chave);
          if (r.cheio) aviso('Os favoritos guardam ' + Dados.MAX_FAVORITOS + ' livros.');
        }
        miolo.innerHTML = pinta();
        return;
      }
      var alvo = ev.target.closest('[data-fechar]');
      if (!alvo) return;
      if (alvo.getAttribute('data-fechar') === 'fundo' && ev.target !== alvo) return;
      fechar();
      rotear();
    });
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

      /* Rodape com a marca, no arranjo do original: uma regua interrompida
         pela palavra "EM" e, embaixo, as tres lombadas com o nome. */
      var yr = A - 250;
      c.strokeStyle = cor('--borda') || '#43362b';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(L / 2 - 170, yr); c.lineTo(L / 2 - 40, yr);
      c.moveTo(L / 2 + 40, yr);  c.lineTo(L / 2 + 170, yr);
      c.stroke();

      c.fillStyle = cor('--texto-3') || '#82756a';
      c.font = '700 22px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      c.fillText('EM', L / 2, yr + 8);

      desenharMarca(c, L / 2, A - 170, cor);

      return entregarCartao(cv, livro);
    });
  }

  /* As tres lombadas e o nome, centrados em (cx, y). */
  function desenharMarca(c, cx, y, cor) {
    var cores = [cor('--a1') || '#ff7a3d', cor('--a2') || '#a8b864', cor('--a3') || '#e0a0b8'];
    var lom = 13, alt = 44, vao = 6;
    var largura = cores.length * lom + (cores.length - 1) * vao;
    var x = cx - 150 - largura / 2;

    cores.forEach(function (k, i) {
      c.fillStyle = k;
      var a = alt - (i === 1 ? 0 : 7);          /* a do meio um pouco mais alta */
      c.fillRect(x + i * (lom + vao), y - a, lom, a);
    });
    c.fillStyle = cor('--texto') || '#f4ede4';
    c.fillRect(x - 5, y, largura + 10, 4);       /* a prateleira */

    c.textAlign = 'left';
    c.font = '800 42px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    c.fillText('Letterbooks', x + largura + 22, y - 4);
    c.textAlign = 'center';
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
        '<div id="escolha-resultados">' + htmlBuscasRecentes() + '</div>' +
        '<div class="folha-rodape"><button class="botao" data-fechar="cancelar">Fechar</button></div>' +
      '</div></div>';

    var painel = camada.firstElementChild;
    var campo = document.getElementById('escolha-termo');
    var caixa = document.getElementById('escolha-resultados');
    var espera = null;
    campo.focus();

    function buscar() {
      var termo = campo.value.trim();
      if (termo.length < 3) { caixa.innerHTML = htmlBuscasRecentes(); return; }
      caixa.innerHTML = '<p class="carregando" style="padding:20px">Procurando…</p>';
      API.buscar(termo, 1).then(function (r) {
        if (campo.value.trim() !== termo) return;   /* chegou tarde, ja mudou */
        Dados.registrarBusca(termo);
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
      var repetir = ev.target.closest('[data-busca]');
      if (repetir) {
        ev.preventDefault();
        campo.value = repetir.getAttribute('data-busca');
        return buscar();
      }
      if (ev.target.closest('[data-esquecer]')) {
        ev.preventDefault();
        Dados.esquecerBuscas();
        caixa.innerHTML = htmlBuscasRecentes();
        return;
      }
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

  /* ============================================================ atividade ==

     A aba do raio: o que as pessoas que voce segue andaram lendo. No app cada
     linha e uma frase — "esther curtiu e avaliou Burning ★★★★" — e nao um
     cartao. Frase ocupa uma linha e cabem dez na tela; cartao ocupa cinco e
     cabem duas. */

  function telaAtividade(aba) {
    marcarAba('atividade');
    aba = aba || 'seguindo';

    if (!Nuvem.ligada()) {
      return pintar('<div class="conta"><h1>Atividade</h1>' +
        '<p class="conta-texto">Esta aba mostra o que as pessoas que você segue ' +
        'andaram lendo. Ela precisa da nuvem ligada — hoje o Letterbooks está ' +
        'em modo local, e um feed de uma pessoa só não é um feed.</p></div>');
    }
    if (!Nuvem.entrou()) {
      return pintar('<div class="conta"><h1>Atividade</h1>' +
        '<p class="conta-texto">Entre na sua conta para ver o que quem você segue ' +
        'anda lendo — e para aparecer no diário de quem te segue.</p>' +
        '<div class="linha-botoes">' +
          '<a class="botao destaque" href="#/conta">Entrar ou criar conta</a></div></div>');
    }

    var abas = [['seguindo', 'Seguindo'], ['todos', 'Todo mundo']];
    pintar(
      '<nav class="segmentos" aria-label="Atividade">' + abas.map(function (a) {
        return '<a href="#/atividade/' + a[0] + '"' +
               (a[0] === aba ? ' class="ativa"' : '') + '>' + a[1] + '</a>';
      }).join('') + '</nav>' +
      '<div id="feed"><p class="carregando">Carregando…</p></div>');

    acoes({
      'curtir-leitura': alternarCurtida,
      'ver-spoiler': revelarSpoiler
    });

    var alvo = document.getElementById('feed');
    var busca = aba === 'todos' ? Nuvem.feedGeral(0) : Nuvem.feed(0);

    busca.then(function (linhas) {
      if (!tela.contains(alvo)) return;
      if (!linhas.length) {
        alvo.innerHTML = aba === 'todos'
          ? htmlVazio('Ainda não há nada aqui',
              'Ninguém registrou leitura ainda. Seja a primeira: busque um livro e registre.')
          : htmlVazio('Você ainda não segue ninguém',
              'Procure leitores na busca, ou veja o que todo mundo anda lendo.',
              '<div class="linha-botoes" style="justify-content:center;margin-top:14px">' +
              '<a class="botao destaque" href="#/atividade/todos">Ver todo mundo</a></div>');
        return;
      }
      alvo.innerHTML = linhas.map(htmlLinhaFeed).join('');
      ligarCurtidas(alvo);
    }, function (err) {
      if (tela.contains(alvo)) {
        alvo.innerHTML = '<p class="erro">' + esc(err.message) + '</p>';
      }
    });
  }

  /* Uma entrada do feed. A frase muda conforme o que a pessoa fez: so
     registrou, avaliou, releu, escreveu. Montar a frase certa e o que faz a
     lista parecer gente conversando em vez de tabela de banco. */
  function htmlLinhaFeed(l) {
    var nome = l.perfil_nome || l.usuario;
    var verbo = l.relido ? 'releu' : 'leu';
    var nota = typeof l.nota === 'number'
      ? ' <span class="estrelas">' + estrelasTexto(l.nota) + '</span>' : '';
    var livro = '<a class="alvo" href="' + rotaLivro(l.livro) + '">' + esc(l.titulo) + '</a>';

    var resenha = '';
    if (l.resenha) {
      resenha = l.spoiler
        ? '<button class="spoiler-aviso" data-acao="ver-spoiler" data-texto="' +
          esc(l.resenha) + '">Esta resenha tem spoiler. Tocar para ler.</button>'
        : '<p class="feed-resenha">' + esc(recortar(l.resenha, 240)) + '</p>';
    }

    return '<article class="feed-linha" data-leitura="' + esc(l.id) + '">' +
      '<a class="feed-quem" href="#/leitor/' + encodeURIComponent(l.usuario) + '"' +
        ' aria-label="Perfil de ' + esc(nome) + '">' +
        '<span class="feed-avatar" aria-hidden="true">' +
          esc((nome || '?').trim().charAt(0).toUpperCase()) + '</span></a>' +
      '<div class="feed-corpo">' +
        '<p class="feed-frase">' +
          '<a class="alvo" href="#/leitor/' + encodeURIComponent(l.usuario) + '">' +
            esc(nome) + '</a> ' + verbo + ' ' + livro + nota +
        '</p>' +
        resenha +
        '<div class="feed-acoes">' +
          '<button class="feed-curtir" data-acao="curtir-leitura" data-id="' + esc(l.id) + '"' +
            ' aria-pressed="false"><span class="glifo">♡</span>' +
            '<span class="conta-curtidas">' + (l.curtidas || 0) + '</span></button>' +
          '<a class="feed-comentar" href="#/leitura/' + encodeURIComponent(l.id) + '">' +
            '<span class="glifo">💬</span>' + (l.comentarios || 0) + '</a>' +
          '<time>' + esc(quandoFoi(l.criado_em)) + '</time>' +
        '</div>' +
      '</div>' +
      (l.capa ? '<a class="feed-capa" href="' + rotaLivro(l.livro) + '">' +
                htmlCapa({ chave: l.livro, titulo: l.titulo, capa: l.capa }) + '</a>' : '') +
    '</article>';
  }

  function recortar(t, n) {
    t = String(t || '');
    return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t;
  }

  /* "22h", "3d", "2sem" — como o original. Data cheia so quando passa do mes,
     porque ali a distancia ja importa mais que o dia exato. */
  function quandoFoi(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'agora';
    if (s < 3600) return Math.floor(s / 60) + 'min';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 604800) return Math.floor(s / 86400) + 'd';
    if (s < 2592000) return Math.floor(s / 604800) + 'sem';
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  }

  /* O estado de "curti" nao vem no feed: seria uma subconsulta por linha. Vem
     numa consulta so, depois, e os corações acendem juntos. */
  function ligarCurtidas(raiz) {
    var botoes = Array.prototype.slice.call(raiz.querySelectorAll('[data-acao=curtir-leitura]'));
    if (!botoes.length) return;

    Nuvem.tabela('curtidas', '?select=leitura&perfil=eq.' + Nuvem.quemSou().id)
      .then(function (minhas) {
        var meu = {};
        (minhas || []).forEach(function (c) { meu[c.leitura] = 1; });
        botoes.forEach(function (b) {
          if (meu[b.getAttribute('data-id')]) marcarCurtido(b, true);
        });
      }).catch(function () { /* sem isso os corações ficam apagados, e tudo bem */ });
  }

  function marcarCurtido(botao, sim) {
    botao.classList.toggle('curtido', sim);
    botao.setAttribute('aria-pressed', sim ? 'true' : 'false');
    botao.querySelector('.glifo').textContent = sim ? '♥' : '♡';
  }

  /* Curtir e otimista: o coração acende na hora e a rede confirma depois. Se
     falhar, volta atras e avisa — melhor do que um botao que parece morto
     enquanto a rede pensa. */
  function alternarCurtida(botao) {
    if (!Nuvem.entrou()) { aviso('Entre na sua conta para curtir.'); return; }
    var id = botao.getAttribute('data-id');
    var eraCurtido = botao.classList.contains('curtido');
    var conta = botao.querySelector('.conta-curtidas');
    var antes = parseInt(conta.textContent, 10) || 0;

    marcarCurtido(botao, !eraCurtido);
    conta.textContent = Math.max(0, antes + (eraCurtido ? -1 : 1));

    (eraCurtido ? Nuvem.descurtir(id) : Nuvem.curtir(id)).catch(function (e) {
      marcarCurtido(botao, eraCurtido);
      conta.textContent = antes;
      aviso(e.message);
    });
  }

  /* ========================================================= perfil alheio ==

     O perfil de outra pessoa, no endereco #/leitor/usuario. E publico de
     proposito — foi a decisao que voce tomou quando escolheu "perfil publico,
     diario publico" — entao quem chega por um link ve a pagina sem precisar
     criar conta antes. Sem isso, compartilhar um perfil so serviria para
     mandar gente para uma tela de cadastro. */

  function telaLeitor(usuario) {
    marcarAba('');
    if (!Nuvem.ligada()) return pintar('<p class="erro">A nuvem não está ligada.</p>');
    carregando('Abrindo o perfil…');

    var eu = Nuvem.quemSou();

    Promise.all([
      Nuvem.perfilDe(usuario),
      Nuvem.leiturasDe(usuario, 40)
    ]).then(function (r) {
      var p = r[0], leituras = r[1] || [];
      if (!p) {
        return pintar(htmlVazio('Não achei esse leitor',
          'O endereço pode estar errado, ou a pessoa mudou de @.'));
      }
      /* Se sou eu mesma, isto e o meu perfil — vai para a tela que tem os
         botoes de editar, em vez de me mostrar a mim como visitante. */
      if (eu && eu.id === p.id) return ir('#/perfil');

      desenhaLeitor(p, leituras);
      /* Contagens e o estado do "seguir" chegam depois: a pagina ja e util
         sem eles, e sao duas idas a mais na rede. */
      Nuvem.contagemSocial(p.id).then(function (c) {
        var s = document.getElementById('leitor-numeros');
        if (s) {
          s.innerHTML = linhaAjuste('span', 'class="sem-link"', 'Leituras', String(leituras.length)) +
            linhaAjuste('a', 'href="#/seguidores/' + encodeURIComponent(p.id) + '"',
                        'Seguidores', String(c.seguidores)) +
            linhaAjuste('a', 'href="#/seguindo/' + encodeURIComponent(p.id) + '"',
                        'Seguindo', String(c.seguindo));
        }
      }).catch(function () {});
      if (eu) atualizarBotaoSeguir(p.id);
    }, function (err) {
      pintar('<p class="erro">' + esc(err.message) + '</p>');
    });
  }

  function desenhaLeitor(p, leituras) {
    var nome = p.nome || p.usuario;
    var comResenha = leituras.filter(function (l) { return l.resenha; });

    pintar(
      '<div class="perfil-topo">' +
        '<div class="avatar" aria-hidden="true">' +
          esc(nome.trim().charAt(0).toUpperCase()) + '</div>' +
        '<h1 class="perfil-nome">' + esc(nome) + '</h1>' +
        '<p class="perfil-bio">@' + esc(p.usuario) +
          (p.local ? ' · ' + esc(p.local) : '') + '</p>' +
        (p.bio ? '<p class="perfil-bio">' + esc(p.bio) + '</p>' : '') +
        (Nuvem.entrou()
          ? '<div class="linha-botoes" style="justify-content:center;margin-top:14px">' +
            '<button class="botao" id="botao-seguir" data-acao="seguir" disabled>…</button>' +
            '</div>'
          : '') +
      '</div>' +

      '<div class="linhas linhas-conta" id="leitor-numeros"></div>' +

      (comResenha.length
        ? '<section class="secao"><h2>Resenhas</h2>' +
          comResenha.slice(0, 10).map(htmlLinhaFeed).join('') + '</section>'
        : '') +

      (leituras.length
        ? '<section class="secao"><h2>Leu recentemente</h2>' +
          htmlTrilho(leituras.slice(0, 16).map(function (l) {
            return { chave: l.livro, titulo: l.titulo, capa: l.capa, ano: l.ano };
          })) + '</section>'
        : htmlVazio('Ainda sem leituras registradas',
                    'Quando ' + esc(nome) + ' registrar a primeira, ela aparece aqui.'))
    );

    acoes({
      seguir: function (b) { alternarSeguir(p.id, b); },
      'curtir-leitura': alternarCurtida,
      'ver-spoiler': revelarSpoiler
    });
    ligarCurtidas(tela);
  }

  function atualizarBotaoSeguir(id) {
    var b = document.getElementById('botao-seguir');
    if (!b) return;
    Nuvem.sigo(id).then(function (sim) {
      if (!document.body.contains(b)) return;
      b.disabled = false;
      b.classList.toggle('destaque', !sim);
      b.textContent = sim ? 'Seguindo' : 'Seguir';
      b.setAttribute('data-sigo', sim ? '1' : '');
    }).catch(function () {
      b.disabled = false; b.textContent = 'Seguir';
    });
  }

  function alternarSeguir(id, botao) {
    var sigo = !!botao.getAttribute('data-sigo');
    botao.disabled = true;
    (sigo ? Nuvem.deixarDeSeguir(id) : Nuvem.seguir(id)).then(function () {
      atualizarBotaoSeguir(id);
      aviso(sigo ? 'Deixou de seguir.' : 'Seguindo.');
    }, function (e) {
      botao.disabled = false;
      aviso(e.message);
    });
  }

  /* ====================================================== uma leitura ======

     A pagina de uma leitura do feed, com os comentarios. E o endereco que da
     para mandar para alguem — por isso ela carrega sem conta, e o campo de
     comentario e que aparece só para quem entrou. */

  function telaLeitura(id) {
    marcarAba('');
    if (!Nuvem.ligada()) return pintar('<p class="erro">A nuvem não está ligada.</p>');
    carregando('Abrindo…');

    Promise.all([
      Nuvem.publico('feed', '?select=*&id=eq.' + encodeURIComponent(id)),
      Nuvem.comentarios(id)
    ]).then(function (r) {
      var l = (r[0] || [])[0];
      var cs = r[1] || [];
      if (!l) return pintar(htmlVazio('Não achei esta leitura', 'Ela pode ter sido apagada.'));
      desenhaLeitura(l, cs);
    }, function (err) {
      pintar('<p class="erro">' + esc(err.message) + '</p>');
    });
  }

  function desenhaLeitura(l, comentarios) {
    var eu = Nuvem.entrou() ? Nuvem.quemSou() : null;
    var nome = l.perfil_nome || l.usuario;

    pintar(
      htmlHeroi(l.capa) +
      '<article class="resenha' + (l.capa ? ' sobre-heroi' : '') + '">' +
        '<a class="resenha-quem" href="#/leitor/' + encodeURIComponent(l.usuario) + '">' +
          '<span class="feed-avatar" aria-hidden="true">' +
            esc(nome.trim().charAt(0).toUpperCase()) + '</span>' +
          '<b>' + esc(nome) + '</b><span>@' + esc(l.usuario) + '</span></a>' +
        '<h1><a href="' + rotaLivro(l.livro) + '">' + esc(l.titulo) + '</a></h1>' +
        '<p class="resenha-meta">' +
          (typeof l.nota === 'number'
            ? '<span class="estrelas">' + estrelasTexto(l.nota) + '</span> · ' : '') +
          (l.relido ? 'releitura · ' : '') +
          esc(dataLonga(l.lido_em)) + '</p>' +
        (l.resenha
          ? (l.spoiler
              ? '<button class="spoiler-aviso" data-acao="ver-spoiler" data-texto="' +
                esc(l.resenha) + '">Esta resenha tem spoiler. Tocar para ler.</button>'
              : '<p class="resenha-texto">' + esc(l.resenha) + '</p>')
          : '') +
        '<div class="feed-acoes" style="margin-top:16px">' +
          '<button class="feed-curtir" data-acao="curtir-leitura" data-id="' + esc(l.id) + '"' +
            ' aria-pressed="false"><span class="glifo">♡</span>' +
            '<span class="conta-curtidas">' + (l.curtidas || 0) + '</span></button>' +
        '</div>' +
      '</article>' +

      '<section class="secao" style="margin-top:26px">' +
        '<h2>' + plural(comentarios.length, 'comentário', 'comentários') + '</h2>' +
        '<div id="comentarios">' + comentarios.map(htmlComentario).join('') + '</div>' +
        (eu
          ? '<form id="forma-comentario" style="margin-top:14px">' +
              '<label class="campo"><span>Seu comentário</span>' +
              '<textarea id="campo-comentario" maxlength="2000" style="min-height:74px" ' +
              'placeholder="O que você achou?"></textarea></label>' +
              '<div class="linha-botoes">' +
              '<button class="botao destaque" type="submit">Comentar</button></div>' +
            '</form>'
          : '<p class="conta-texto" style="margin-top:14px">' +
            '<a class="alvo" href="#/conta">Entre na sua conta</a> para comentar.</p>') +
      '</section>'
    );

    acoes({
      'curtir-leitura': alternarCurtida,
      'ver-spoiler': revelarSpoiler,
      'apagar-comentario': function (b) {
        if (!confirm('Apagar este comentário?')) return;
        var linha = b.closest('.comentario');
        Nuvem.apagarComentario(b.getAttribute('data-id')).then(function () {
          linha.remove();
        }, function (e) { aviso(e.message); });
      }
    });
    ligarCurtidas(tela);

    var forma = document.getElementById('forma-comentario');
    if (!forma) return;
    forma.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var campo = document.getElementById('campo-comentario');
      var texto = campo.value.trim();
      if (!texto) return;
      var b = forma.querySelector('button');
      b.disabled = true; b.textContent = 'Enviando…';
      Nuvem.comentar(l.id, texto).then(function (novo) {
        campo.value = '';
        b.disabled = false; b.textContent = 'Comentar';
        document.getElementById('comentarios').insertAdjacentHTML('beforeend',
          htmlComentario({ id: novo.id, texto: texto, criado_em: novo.criado_em,
                           perfil: eu.id, perfis: { usuario: 'você', nome: 'Você' } }));
      }, function (e) {
        b.disabled = false; b.textContent = 'Comentar';
        aviso(e.message);
      });
    });
  }

  function htmlComentario(c) {
    var p = c.perfis || {};
    var nome = p.nome || p.usuario || 'alguém';
    var eu = Nuvem.entrou() ? Nuvem.quemSou() : null;
    var meu = eu && eu.id === c.perfil;
    return '<div class="comentario">' +
      '<span class="feed-avatar" aria-hidden="true">' +
        esc(nome.trim().charAt(0).toUpperCase()) + '</span>' +
      '<div>' +
        '<p class="comentario-quem"><b>' + esc(nome) + '</b>' +
          '<time>' + esc(quandoFoi(c.criado_em)) + '</time></p>' +
        '<p class="comentario-texto">' + esc(c.texto) + '</p>' +
      '</div>' +
      (meu ? '<button class="comentario-apagar" data-acao="apagar-comentario" data-id="' +
             esc(c.id) + '" aria-label="Apagar comentário">×</button>' : '') +
    '</div>';
  }

  function dataLonga(iso) {
    var d = new Date(iso + 'T12:00:00');
    return isNaN(d.getTime()) ? String(iso)
      : d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  /* O meu @ e as minhas contagens sociais vivem no banco, nao no aparelho.
     Chegam depois de a tela ja estar de pe: o perfil e util sem eles, e sao
     duas idas a mais na rede. */
  function enfeitarPerfilComANuvem() {
    var eu = Nuvem.quemSou();

    Nuvem.meuPerfil().then(function (p) {
      var arroba = document.getElementById('meu-arroba');
      if (!p || !arroba || !document.body.contains(arroba)) return;
      arroba.innerHTML = '@' + esc(p.usuario) +
        (p.local ? ' · ' + esc(p.local) : '') +
        (p.bio ? '<br>' + esc(p.bio) : '');
    }).catch(function () {});

    Nuvem.contagemSocial(eu.id).then(function (c) {
      var espera = document.getElementById('meu-social-espera');
      if (!espera || !document.body.contains(espera)) return;
      espera.outerHTML =
        linhaAjuste('a', 'href="#/seguidores/' + encodeURIComponent(eu.id) + '"',
                    'Seguidores', String(c.seguidores)) +
        linhaAjuste('a', 'href="#/seguindo/' + encodeURIComponent(eu.id) + '"',
                    'Seguindo', String(c.seguindo));
    }).catch(function () {
      var espera = document.getElementById('meu-social-espera');
      if (espera) espera.remove();
    });
  }

  /* A lista de quem me segue / de quem eu sigo. Uma contagem que nao abre nada
     e uma seta que a tela nao cumpre — foi o que eu disse quando troquei os
     numeros soltos por linhas, e vale aqui tambem. */
  function telaGente(qual, id) {
    marcarAba('perfil');
    if (!Nuvem.ligada()) return pintar('<p class="erro">A nuvem não está ligada.</p>');
    var titulo = qual === 'seguidores' ? 'Seguidores' : 'Seguindo';
    carregando('Carregando…');

    var campo = qual === 'seguidores' ? 'seguido' : 'seguidor';
    var outro = qual === 'seguidores' ? 'seguidor' : 'seguido';

    Nuvem.publico('seguidores', '?select=' + outro + '&' + campo + '=eq.' + id)
      .then(function (linhas) {
        var ids = (linhas || []).map(function (x) { return x[outro]; });
        if (!ids.length) {
          return pintar('<h1 class="titulo-pagina">' + titulo + '</h1>' +
            htmlVazio(qual === 'seguidores' ? 'Ninguém ainda' : 'Você ainda não segue ninguém',
              qual === 'seguidores'
                ? 'Quem seguir você aparece aqui.'
                : 'Procure leitores na busca para o seu feed deixar de ser só seu.',
              '<div class="linha-botoes" style="justify-content:center;margin-top:14px">' +
              '<a class="botao destaque" href="#/buscar">Procurar leitores</a></div>'));
        }
        var lista = ids.map(function (x) { return '"' + x + '"'; }).join(',');
        return Nuvem.publico('perfis', '?select=id,usuario,nome,bio&id=in.(' + lista + ')')
          .then(function (gente) {
            pintar('<h1 class="titulo-pagina">' + titulo + '</h1>' +
              '<div class="resultados">' + (gente || []).map(function (p) {
                var nome = p.nome || p.usuario;
                return '<a class="resultado" href="#/leitor/' + encodeURIComponent(p.usuario) + '">' +
                  '<div class="resultado-inicial" aria-hidden="true">' +
                    esc(nome.trim().charAt(0).toUpperCase()) + '</div>' +
                  '<div class="resultado-texto"><b>' + esc(nome) + '</b>' +
                    '<span>@' + esc(p.usuario) + (p.bio ? ' · ' + esc(p.bio) : '') +
                  '</span></div></a>';
              }).join('') + '</div>');
          });
      }).catch(function (err) {
        pintar('<h1 class="titulo-pagina">' + titulo + '</h1>' +
               '<p class="erro">' + esc(err.message) + '</p>');
      });
  }

  /* ================================================================ conta == */

  /* A tela de conta e a unica que muda de cara conforme a nuvem esteja
     desligada, deslogada ou dentro. As tres versoes vivem aqui juntas para
     que de para ler a maquina de estados inteira de uma vez. */

  function telaConta() {
    marcarAba('perfil');
    if (!Nuvem.ligada()) return contaDesligada();
    if (!Nuvem.entrou())  return contaPorta('entrar');
    return contaDentro();
  }

  /* Sem chave em js/config.js: o app segue local, e a tela diz isso em vez de
     mostrar um formulario que nao ia funcionar. */
  function contaDesligada() {
    pintar(
      '<div class="conta">' +
        '<h1>Conta</h1>' +
        '<p class="conta-texto">O Letterbooks está no modo local: seu diário, suas ' +
          'listas e suas resenhas ficam guardados só neste aparelho, sem conta e sem ' +
          'servidor. Funciona, e funciona offline.</p>' +
        '<p class="conta-texto">Para ligar a parte de rede social — perfil público, ' +
          'feed de quem você segue, curtir e comentar — falta criar o banco e colar duas ' +
          'linhas em <code>js/config.js</code>. O passo a passo está em ' +
          '<code>servidor/LEIA-ME.md</code>, no repositório.</p>' +
        '<p class="conta-texto">Nada do que você já registrou se perde nisso: quando a ' +
          'conta existir, a primeira coisa que ela faz é subir o seu diário de hoje.</p>' +
        '<div class="linha-botoes"><a class="botao" href="#/perfil">Voltar ao perfil</a></div>' +
      '</div>'
    );
  }

  /* Entrar e criar conta sao o mesmo formulario com um campo a mais. Duas telas
     separadas so dariam duas copias do mesmo tratamento de erro. */
  function contaPorta(modo) {
    var criando = modo === 'criar';

    pintar(
      '<div class="conta">' +
        '<h1>' + (criando ? 'Criar conta' : 'Entrar') + '</h1>' +
        '<nav class="segmentos conta-abas">' +
          '<a href="#/conta" class="' + (criando ? '' : 'ativa') + '" data-acao="modo-entrar">Entrar</a>' +
          '<a href="#/conta" class="' + (criando ? 'ativa' : '') + '" data-acao="modo-criar">Criar conta</a>' +
        '</nav>' +
        '<form id="forma-conta" novalidate>' +
          (criando
            ? '<label class="campo"><span>Nome</span>' +
              '<input name="nome" autocomplete="name" placeholder="Como você quer aparecer"></label>'
            : '') +
          '<label class="campo"><span>E-mail</span>' +
            '<input name="email" type="email" autocomplete="email" required></label>' +
          '<label class="campo"><span>Senha</span>' +
            '<input name="senha" type="password" required ' +
            'autocomplete="' + (criando ? 'new-password' : 'current-password') + '" ' +
            'minlength="6"></label>' +
          (criando ? '<p class="conta-dica">Pelo menos 6 caracteres.</p>' : '') +
          '<p class="conta-erro" id="conta-erro" role="alert" hidden></p>' +
          '<div class="linha-botoes">' +
            '<button class="botao destaque" type="submit">' +
              (criando ? 'Criar conta' : 'Entrar') + '</button>' +
            (criando ? '' : '<button class="botao" type="button" data-acao="esqueci">Esqueci a senha</button>') +
          '</div>' +
        '</form>' +
        '<p class="conta-texto conta-rodape">Seu perfil e seu diário ficam públicos, como ' +
          'no Letterboxd. E-mail e senha, não.</p>' +
      '</div>'
    );

    var forma = document.getElementById('forma-conta');
    var caixaErro = document.getElementById('conta-erro');

    function erro(msg) {
      caixaErro.textContent = msg || '';
      caixaErro.hidden = !msg;
    }

    /* Enquanto a requisicao esta no ar, o botao trava e diz o que esta
       fazendo. Sem isso, dois toques seguidos viram duas contas. */
    function ocupado(sim, texto) {
      var b = forma.querySelector('button[type=submit]');
      b.disabled = sim;
      b.textContent = sim ? texto : (criando ? 'Criar conta' : 'Entrar');
    }

    forma.addEventListener('submit', function (ev) {
      ev.preventDefault();
      erro('');
      var email = forma.email.value.trim();
      var senha = forma.senha.value;
      if (!email || !senha) return erro('Preencha e-mail e senha.');
      if (criando && senha.length < 6) return erro('A senha precisa de pelo menos 6 caracteres.');

      ocupado(true, criando ? 'Criando…' : 'Entrando…');
      var promessa = criando
        ? Nuvem.cadastrar(email, senha, forma.nome.value.trim())
        : Nuvem.entrar(email, senha);

      promessa.then(function (r) {
        if (criando && r && r.confirmar) {
          ocupado(false);
          return pintar(
            '<div class="conta"><h1>Confirme o e-mail</h1>' +
            '<p class="conta-texto">Enviamos um link para <b>' + esc(email) + '</b>. ' +
            'Clique nele e depois volte aqui para entrar.</p>' +
            '<div class="linha-botoes"><a class="botao" href="#/conta">Voltar</a></div></div>'
          );
        }
        aviso(criando ? 'Conta criada.' : 'Você entrou.');
        contaDentro();
      }, function (e) {
        ocupado(false);
        erro(e.message);
      });
    });

    acoes({
      'modo-entrar': function (a, ev) { ev.preventDefault(); contaPorta('entrar'); },
      'modo-criar':  function (a, ev) { ev.preventDefault(); contaPorta('criar'); },
      esqueci: function () {
        var email = forma.email.value.trim();
        if (!email) return erro('Escreva o e-mail primeiro, e então peça a troca de senha.');
        Nuvem.recuperarSenha(email).then(function () {
          aviso('Link de nova senha enviado para ' + email + '.');
        }, function (e) { erro(e.message); });
      }
    });
  }

  /* Dentro da conta. Busca o perfil no servidor antes de pintar — o @usuario
     nasce la, no gatilho de cadastro, e nao existe do lado de ca. */
  function contaDentro() {
    carregando('Carregando sua conta…');
    Nuvem.meuPerfil().then(pintarConta, function (e) {
      pintar('<div class="conta"><h1>Conta</h1>' +
        '<p class="conta-erro">' + esc(e.message) + '</p>' +
        '<div class="linha-botoes">' +
          '<button class="botao" data-acao="tentar">Tentar de novo</button>' +
          '<button class="botao perigo" data-acao="sair">Sair</button></div></div>');
      acoes({ tentar: contaDentro, sair: sairDaConta });
    });
  }

  function pintarConta(p) {
    var eu = Nuvem.quemSou();
    var d = Dados.estado();
    var marcacoes = d.querLer.length + d.curtidas.length + d.favoritos.length;
    var quanto = d.logs.length + d.listas.length + marcacoes;
    var migrado = Nuvem.jaMigrou();

    /* O bloco de migracao so aparece se houver o que migrar e ainda nao tiver
       migrado. Depois disso vira uma linha com a data, para a pessoa saber que
       aconteceu e nao ficar procurando o botao. */
    var blocoMigrar = '';
    if (migrado) {
      blocoMigrar =
        '<section class="secao"><h2>Diário deste aparelho</h2>' +
        '<p class="conta-texto">Já enviado para a sua conta em ' +
          esc(dataCurta(migrado)) + '.</p></section>';
    } else if (quanto) {
      blocoMigrar =
        '<section class="secao"><h2>Trazer o diário deste aparelho</h2>' +
        '<p class="conta-texto">Você tem <b>' + d.logs.length + '</b> leituras, <b>' +
          d.listas.length + '</b> listas e <b>' + marcacoes + '</b> marcações guardadas ' +
          'só aqui. Enviar copia tudo para a conta. O que está no aparelho continua ' +
          'onde está — nada é apagado.</p>' +
        '<p class="conta-erro" id="migrar-erro" role="alert" hidden></p>' +
        '<div class="linha-botoes">' +
          '<button class="botao destaque" data-acao="migrar">Enviar para a conta</button>' +
        '</div></section>';
    }

    pintar(
      '<div class="conta">' +
        '<h1>Sua conta</h1>' +
        '<p class="conta-texto">' + esc(eu.email) + '</p>' +

        /* novalidate porque a mensagem do navegador vem no idioma dele e nao
           combina com a regra do banco; quem explica o erro e o codigo abaixo. */
        '<form id="forma-perfil" novalidate>' +
          '<label class="campo"><span>Usuário</span>' +
            '<input name="usuario" value="' + esc((p && p.usuario) || '') + '" ' +
            'autocapitalize="none" autocorrect="off" spellcheck="false"></label>' +
          '<p class="conta-dica">Minúsculas, números e _, de 3 a 20. É o endereço ' +
            'público do seu perfil.</p>' +
          '<label class="campo"><span>Nome</span>' +
            '<input name="nome" value="' + esc((p && p.nome) || '') + '"></label>' +
          '<label class="campo"><span>Bio</span>' +
            '<textarea name="bio" style="min-height:70px">' + esc((p && p.bio) || '') + '</textarea></label>' +
          '<label class="campo"><span>Lugar</span>' +
            '<input name="local" value="' + esc((p && p.local) || '') + '"></label>' +
          '<p class="conta-erro" id="perfil-erro" role="alert" hidden></p>' +
          '<div class="linha-botoes">' +
            '<button class="botao destaque" type="submit">Salvar</button></div>' +
        '</form>' +

        blocoMigrar +

        '<section class="secao"><h2>Sessão</h2>' +
          '<div class="linha-botoes">' +
            '<button class="botao perigo" data-acao="sair">Sair desta conta</button>' +
          '</div></section>' +
      '</div>'
    );

    var forma = document.getElementById('forma-perfil');
    var caixaErro = document.getElementById('perfil-erro');

    forma.addEventListener('submit', function (ev) {
      ev.preventDefault();
      caixaErro.hidden = true;
      var campos = {
        usuario: forma.usuario.value.trim().toLowerCase(),
        nome:    forma.nome.value.trim(),
        bio:     forma.bio.value.trim(),
        local:   forma.local.value.trim()
      };
      if (!/^[a-z0-9_]{3,20}$/.test(campos.usuario)) {
        caixaErro.textContent = 'O usuário aceita só letras minúsculas, números e _, de 3 a 20.';
        caixaErro.hidden = false;
        return;
      }
      var b = forma.querySelector('button[type=submit]');
      b.disabled = true; b.textContent = 'Salvando…';
      Nuvem.salvarPerfil(campos).then(function (novo) {
        /* Espelha o nome no perfil local, para o resto do app nao mostrar dois
           nomes diferentes para a mesma pessoa. */
        if (campos.nome) { Dados.estado().perfil.nome = campos.nome; Dados.salvar(); }
        aviso('Perfil salvo.');
        pintarConta(novo || p);
      }, function (e) {
        b.disabled = false; b.textContent = 'Salvar';
        caixaErro.textContent = e.message;
        caixaErro.hidden = false;
      });
    });

    acoes({
      sair: sairDaConta,
      migrar: function (botao) {
        var err = document.getElementById('migrar-erro');
        err.hidden = true;
        botao.disabled = true;
        Nuvem.migrar(Dados.estado(), function (etapa, feito, total) {
          botao.textContent = 'Enviando ' + etapa + '… (' + feito + '/' + total + ')';
        }).then(function (r) {
          aviso(r.leituras + ' leituras enviadas.');
          pintarConta(p);
        }, function (e) {
          botao.disabled = false;
          botao.textContent = 'Tentar enviar de novo';
          err.textContent = e.message;
          err.hidden = false;
        });
      }
    });
  }

  function sairDaConta() {
    Nuvem.sair().then(function () {
      aviso('Você saiu. Seu diário deste aparelho continua aqui.');
      contaPorta('entrar');
    });
  }

  function dataCurta(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR');
  }

  /* Quem chegou por um link direto nao tem para onde voltar: cai no inicio em
     vez de sair do site. */
  function voltarOuInicio() {
    if (history.length > 1) history.back(); else ir('#/inicio');
  }

  function rotear() {
    camada.innerHTML = '';
    /* A ficha do livro, a resenha e a lista correm a imagem ate o topo: nelas
       o cabecalho com a marca sai e sobra o chevron, sobre a foto. */
    var raiz = (location.hash || '').replace(/^#\/?/, '').split('/')[0];
    document.body.classList.toggle('imersiva',
      raiz === 'livro' || raiz === 'resenha' || raiz === 'lista');
    var partes = (location.hash || '#/inicio').replace(/^#\/?/, '').split('/');
    var rota = partes[0] || 'inicio';

    if (rota === 'buscar') {
      var termo = decodeURIComponent(partes[1] || '');
      if (!termo) return telaBuscaVazia();
      return telaBusca(termo, Math.max(1, parseInt(partes[2], 10) || 1), partes[3] || '');
    }
    if (rota === 'explorar') return telaExplorar(partes[1], Math.max(1, parseInt(partes[2], 10) || 1));
    if (rota === 'autor')   return telaAutor(decodeURIComponent(partes.slice(1).join('/')));
    if (rota === 'resenha') return telaResenha(partes[1]);
    if (rota === 'livro')   return telaLivro(decodeURIComponent(partes.slice(1).join('/')));
    if (rota === 'diario')  return telaDiario();
    if (rota === 'resenhas') return telaResenhas();
    if (rota === 'estante') return telaEstante();
    if (rota === 'listas')  return telaListas();
    if (rota === 'lista')   return telaLista(partes[1]);
    if (rota === 'perfil')  return telaPerfil();
    if (rota === 'conta')   return telaConta();
    if (rota === 'atividade') return telaAtividade(partes[1]);
    if (rota === 'leitor')  return telaLeitor(decodeURIComponent(partes[1] || ''));
    if (rota === 'seguidores' || rota === 'seguindo')
      return telaGente(rota, decodeURIComponent(partes[1] || ''));
    if (rota === 'leitura') return telaLeitura(decodeURIComponent(partes[1] || ''));
    return telaInicio();
  }

  document.getElementById('forma-busca').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var termo = document.getElementById('campo-busca').value.trim();
    if (termo) ir('#/buscar/' + encodeURIComponent(termo) + '/1');
  });

  document.getElementById('botao-registrar').addEventListener('click', abrirFolhaEscolha);
  document.getElementById('aba-mais').addEventListener('click', abrirFolhaEscolha);

  /* O chevron de voltar existe na ficha, na resenha e na lista. Um ouvinte no
     documento cobre as tres sem repetir a acao em cada mapa. */
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-acao="voltar"]');
    if (b) voltarOuInicio();
  });

  window.addEventListener('hashchange', rotear);
  Sinc.ligar();
  rotear();
})();

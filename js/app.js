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
    /* A casca NUNCA e condicional: so a imagem e. A rota ja escondeu o
       cabecalho da marca, e o chevron de voltar mora aqui dentro — devolver
       string vazia quando o livro nao tem capa deixava a pessoa presa na tela,
       sem nenhum caminho de volta. Sem capa, sobra o degrau de superficie. */
    return '<div class="heroi' + (fundo ? '' : ' heroi-vazio') + '">' +
      (fundo ? '<div class="heroi-imagem" style="background-image:url(' +
               esc(fundo) + ')"></div>' : '') +
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

    return '<a class="cartao" href="' + rotaLivro(livro.chave) + '" title="' + esc(dica) + '"' +
           ' aria-label="' + esc(livro.titulo) + '">' +
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

  /* Distribuição em meias-estrelas, de 0,5 a 5, a partir de uma lista de
     notas. O Dados calcula o mesmo para o SEU diário; aqui a lista vem da
     comunidade, e a soma é no cliente porque a agregação do PostgREST vem
     desligada no Supabase. */
  function faixasDe(notas) {
    var f = [];
    for (var i = 1; i <= 10; i++) {
      var v = i / 2;
      f.push({ nota: v, qtd: notas.filter(function (n) { return n === v; }).length });
    }
    return f;
  }

  function livroDe(chave) {
    return Dados.livro(chave) || { chave: chave, titulo: 'Livro', autores: [], capa: null };
  }

  /* Histograma de notas. Na ficha do livro conta AVALIAÇÕES daquele livro; no
     perfil conta LIVROS que você avaliou. Eram a mesma palavra até aqui, e o
     mesmo dado — que é o defeito que este item conserta.

     minhaNota, quando vem, marca a coluna onde a SUA nota cai dentro da
     distribuição da comunidade. É NOVO: o original não faz isso. A marca vai
     na .col e não no <i>, para continuar visível enquanto a barra tem 2px
     porque a sua nota ainda não subiu — que é o instante em que ela importa
     mais. O perfil chama sem os dois argumentos e não muda um pixel.

     Os dez <div> vazios com title não diziam nada a um leitor de tela: o
     gráfico inteiro passa a ser uma imagem com legenda, e o eixo de estrelas
     (que sairia como "estrela preta" cinco vezes) fica calado. */
  function htmlHistograma(faixas, substantivo, minhaNota) {
    var uni = substantivo || 'livro';
    var plu = uni === 'avaliação' ? 'avaliações' : uni + 's';
    var maior = Math.max.apply(null, faixas.map(function (f) { return f.qtd; }).concat([1]));
    var total = faixas.reduce(function (s, f) { return s + f.qtd; }, 0);
    var soma  = faixas.reduce(function (s, f) { return s + f.nota * f.qtd; }, 0);
    var pico  = faixas.reduce(function (a, f) { return f.qtd > a.qtd ? f : a; },
                             { nota: 0, qtd: 0 });
    var legenda = 'Distribuição de ' + plural(total, uni, plu) +
      (total ? ': média ' + mediaTexto(soma / total) + ' de 5. Nota mais dada: ' +
               nota1(pico.nota) + ', ' + plural(pico.qtd, uni, plu) + '.' : '.');
    return '<div class="histograma" role="img" aria-label="' + esc(legenda) + '">' +
      faixas.map(function (f) {
        var minha = minhaNota === f.nota;
        return '<div class="col' + (f.qtd ? ' tem' : '') + (minha ? ' minha' : '') +
               '" title="' + nota1(f.nota) + ' — ' + plural(f.qtd, uni, plu) +
               (minha ? ' — sua nota' : '') + '">' +
               '<i style="height:' + Math.round((f.qtd / maior) * 100) + '%"></i></div>';
      }).join('') +
    '</div><div class="histograma-eixo">' +
      '<span class="estrelas" aria-hidden="true">★</span>' +
      (minhaNota ? '<span class="marca-minha"><i aria-hidden="true"></i>sua nota</span>' : '') +
      '<span class="estrelas" aria-hidden="true">★★★★★</span>' +
    '</div>';
  }

  function nota1(n) { return String(n).replace('.', ','); }

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

    /* Aqui ficava um histograma de Dados.estatisticas() — as SUAS notas de
       todos os livros, idêntico em toda ficha do acervo, sob o rótulo
       "Avaliações". Não era ausência, era rótulo mentindo. Agora este é o
       lugar onde a comunidade entra, e ela chega depois da tela pintar: a
       ficha nunca espera a rede para existir. */

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
          '<div id="livro-rede" aria-live="polite" aria-busy="true">' +
            htmlRede(livro) + '</div>' +
          (logs.length ? '<section class="secao" style="margin-top:30px">' +
            '<h2>Suas leituras<span class="contador">' + logs.length + '</span></h2>' +
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
    ligarCurtidas(tela);
    carregarRede(livro.chave);

    acoes({
      expandir: function (a) {
        document.getElementById('sinopse').classList.remove('recolhida');
        a.remove();
      },
      'curtir-leitura': alternarCurtida,
      'rede-mais': function () {
        rede.mostrando += RESENHAS_POR_VEZ;
        repintarRede(livro.chave);
      },
      'rede-de-novo': function () {
        rede.chave = null;                 /* força a consulta a acontecer de novo */
        carregarRede(livro.chave);
        repintarRede(livro.chave);
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

  /* ======================================= a comunidade dentro da ficha ==== */

  /* desenhaLivro se redesenha INTEIRO a cada ♥/◷/★ do próprio livro. Se as
     seções da comunidade fossem montadas lá dentro, tocar no coração apagaria
     a lista de resenhas e bateria no servidor de novo, por toque. Elas vivem
     neste cache de módulo, indexado pela chave — e não numa variável de
     telaLivro, porque desenhaLivro é função de módulo e não enxerga aquele
     escopo. A repintura reinjeta o que já está em mãos, sem requisição. */
  var rede = { chave: null, leituras: null, sigo: null, falhou: false, mostrando: 0 };
  var RESENHAS_POR_VEZ = 3;
  /* O recorte da consulta. Acima disto a média sairia truncada sem dizer — por
     isso, quando a resposta vem cheia, o bloco declara o corte em vez de
     chamar de "a média" a média das mais recentes. */
  var TETO_LEITURAS = 200;

  function carregarRede(chave) {
    if (!Nuvem.ligada()) return;
    if (rede.chave === chave && (rede.leituras || rede.falhou)) return;  /* já em mãos */
    rede.chave = chave;
    rede.leituras = null;
    rede.sigo = null;
    rede.falhou = false;
    rede.mostrando = RESENHAS_POR_VEZ;

    if (navigator.onLine === false) { rede.falhou = 'offline'; return repintarRede(chave); }

    /* Duas promessas independentes, e NUNCA um Promise.all: quemEuSigo passa
       por comSessao, que rejeita sem sessão. Juntas, quem chega sem conta
       perderia também o histograma — que é justamente o que a ficha precisa
       mostrar a quem ainda não tem conta. Cada uma pinta a sua parte. */
    Nuvem.leiturasDoLivro(chave, TETO_LEITURAS).then(function (l) {
      if (rede.chave !== chave) return;
      rede.leituras = l || [];
      repintarRede(chave);
    }, function () {
      if (rede.chave !== chave) return;
      rede.falhou = 'erro';
      repintarRede(chave);
    });

    if (!Nuvem.entrou()) return;
    Nuvem.quemEuSigo().then(function (ids) {
      if (rede.chave !== chave) return;
      rede.sigo = ids || [];
      if (rede.leituras) repintarRede(chave);
    }, function () { /* sem a lista some a seção de gente; o resto do bloco fica */ });
  }

  function repintarRede(chave) {
    var caixa = document.getElementById('livro-rede');
    if (!caixa || rede.chave !== chave) return;
    caixa.innerHTML = htmlRede(livroDe(chave));
    caixa.setAttribute('aria-busy', (rede.leituras || rede.falhou) ? 'false' : 'true');
    ligarCurtidas(caixa);
  }

  function htmlRede(livro) {
    /* Sem nuvem não existe comunidade, e "0 avaliações" seria mentira de
       interface: a seção simplesmente não nasce. */
    if (!Nuvem.ligada()) return '';
    var minha = Dados.notaDe(livro.chave) || null;

    if (rede.chave !== livro.chave || (!rede.leituras && !rede.falhou)) {
      /* Esqueleto com a altura exata do estado cheio. A ficha já está pintada
         com o que é local: um anel girando no meio dela leria como quebra, e
         um bloco que cresce depois empurraria o herói de margem negativa. */
      return '<section class="avaliacoes esperando"><span class="rotulo">Avaliações</span>' +
        '<div class="avaliacoes-linha">' +
          '<div class="avaliacoes-grafico"></div><div class="avaliacoes-media"></div>' +
        '</div></section>';
    }

    if (rede.falhou) {
      /* De propósito não é a caixa .erro vermelha: o resto da página carregou,
         o livro está lá, e alarme de página inteira para um bloco secundário é
         desproporcional. */
      return '<section class="avaliacoes"><span class="rotulo">Avaliações</span>' +
        '<p class="avaliacoes-nota">' +
        (rede.falhou === 'offline'
          ? 'Você está sem conexão. As notas da comunidade voltam quando a rede voltar.'
          : 'Não consegui trazer as notas da comunidade agora.' +
            '<button class="mais" data-acao="rede-de-novo">Tentar de novo</button>') +
        '</p></section>';
    }

    var notas = rede.leituras
      .filter(function (l) { return typeof l.nota === 'number' && l.nota > 0; })
      .map(function (l) { return l.nota; });

    var html = '<section class="avaliacoes"><span class="rotulo">Avaliações</span>';
    if (!notas.length) {
      /* Dez colunas zeradas leem como "todo mundo deu zero", que é mentira. */
      html += '<p class="avaliacoes-nota">Ninguém avaliou este livro por aqui ainda.' +
        (Nuvem.entrou()
          ? (minha ? '' : '<button class="mais" data-acao="rapida">Avaliar este livro</button>')
          : '<a class="mais" href="#/conta">Criar conta para avaliar</a>') +
        '</p>';
    } else {
      var media = notas.reduce(function (a, b) { return a + b; }, 0) / notas.length;
      html += '<div class="avaliacoes-linha">' +
          '<div class="avaliacoes-grafico">' +
            htmlHistograma(faixasDe(notas), 'avaliação', minha) + '</div>' +
          '<div class="avaliacoes-media">' + mediaTexto(media) + '</div>' +
        '</div>' +
        (rede.leituras.length >= TETO_LEITURAS
          ? '<p class="avaliacoes-nota">Somando as ' + TETO_LEITURAS +
            ' leituras mais recentes deste livro.</p>' : '');
    }
    html += htmlAvisoDaMinhaNota(livro.chave, minha) + '</section>';

    /* ---- quem você segue leu ---- */
    var seguidos = rede.sigo || [];
    if (seguidos.length) {
      var vistos = {}, gente = [];
      rede.leituras.forEach(function (l) {
        if (seguidos.indexOf(l.perfil) < 0 || vistos[l.perfil]) return;
        vistos[l.perfil] = 1;
        gente.push(l);
      });
      if (gente.length) {
        html += '<section class="secao"><h2>Quem você segue leu' +
          '<span class="contador">' + gente.length + '</span></h2>' +
          '<div class="resultados">' + gente.map(htmlLeitorDoLivro).join('') +
          '</div></section>';
      }
    }

    /* ---- as resenhas escritas sobre este livro ---- */
    var resenhas = rede.leituras.filter(function (l) { return l.resenha; });
    if (resenhas.length) {
      var mostra = resenhas.slice(0, rede.mostrando);
      /* Sem contagem e sem chevron no título: não há contagem exata sem
         count=exact, e não existe rota "todas as resenhas deste livro" — seta
         que não leva a lugar nenhum é o que o próprio app já proíbe. */
      html += '<section class="secao"><h2>Resenhas</h2>' +
        mostra.map(htmlResenhaDoLivro).join('') +
        (resenhas.length > mostra.length
          ? '<div class="linha-botoes"><button class="botao rede-mais" ' +
            'data-acao="rede-mais">Ver mais resenhas</button></div>'
          : '') +
      '</section>';
    }

    return html;
  }

  /* A sua nota está no aparelho mas ainda não está na média — e o bloco diz
     qual dos dois motivos é, em vez de deixar a pessoa achar que o agregado
     está errado. */
  function htmlAvisoDaMinhaNota(chave, minha) {
    if (!minha) return '';
    if (!Nuvem.entrou()) {
      return '<p class="fila-aviso">Sua nota fica só neste aparelho. ' +
             '<a href="#/conta">Crie uma conta</a> para ela entrar na média.</p>';
    }
    if (Sinc.esperandoLeitura(chave)) {
      return '<p class="fila-aviso">Sua nota entra na conta quando a fila ' +
             'terminar de subir.</p>';
    }
    return '';
  }

  /* Mesma linha da busca de leitores (t061): a linha inteira é o alvo, 64px de
     altura, sem alvo aninhado dentro dela. */
  function htmlLeitorDoLivro(l) {
    var nome = l.perfil_nome || l.usuario || 'alguém';
    return '<a class="resultado" href="#/leitor/' + encodeURIComponent(l.usuario) + '">' +
      '<div class="resultado-inicial" aria-hidden="true">' +
        esc(nome.trim().charAt(0).toUpperCase()) + '</div>' +
      '<div class="resultado-texto"><b>' + esc(nome) + '</b><span>@' + esc(l.usuario) +
        (typeof l.nota === 'number' && l.nota > 0
          ? ' · <span class="estrelas" role="img" aria-label="' + esc(nota1(l.nota)) +
            ' de 5 estrelas">' + estrelasTexto(l.nota) + '</span>'
          : '') +
        ' · ' + esc(quandoFoi(l.criado_em)) +
      '</span></div></a>';
  }

  /* A linha do feed, com a terceira coluna vazia: a capa não se repete porque
     o livro É a página. E sem o verbo e sem o título — "Ana leu Dom Casmurro
     ★★★★" repetido em toda linha é o ruído que a regra da frase existe para
     evitar. */
  function htmlResenhaDoLivro(l) {
    var nome = l.perfil_nome || l.usuario || 'alguém';
    var corpo = l.spoiler
      ? '<button class="spoiler-aviso" data-acao="ver-spoiler" data-texto="' +
        esc(l.resenha) + '">Esta resenha tem spoiler. Tocar para ler.</button>'
      : '<a class="feed-resenha" href="#/resenha/' + encodeURIComponent(l.id) + '">' +
        esc(recortar(l.resenha, 240)) + '</a>';

    return '<article class="feed-linha" data-leitura="' + esc(l.id) + '">' +
      '<a class="feed-quem" href="#/leitor/' + encodeURIComponent(l.usuario) + '"' +
        ' aria-label="Perfil de ' + esc(nome) + '">' +
        '<span class="feed-avatar" aria-hidden="true">' +
          esc(nome.trim().charAt(0).toUpperCase()) + '</span></a>' +
      '<div class="feed-corpo">' +
        '<p class="feed-frase">' +
          '<a class="alvo" href="#/leitor/' + encodeURIComponent(l.usuario) + '">' +
            esc(nome) + '</a>' +
          (typeof l.nota === 'number' && l.nota > 0
            ? ' <span class="estrelas">' + estrelasTexto(l.nota) + '</span>' : '') +
          (l.relido ? ' · releitura' : '') +
        '</p>' +
        corpo +
        '<div class="feed-acoes">' +
          '<button class="feed-curtir" data-acao="curtir-leitura" data-id="' + esc(l.id) + '"' +
            ' aria-pressed="false" aria-label="Curtir a resenha de ' + esc(nome) + '">' +
            '<span class="glifo" aria-hidden="true">♡</span>' +
            '<span class="conta-curtidas">' + (l.curtidas || 0) + '</span></button>' +
          '<a class="feed-comentar" href="#/resenha/' + encodeURIComponent(l.id) + '"' +
            ' aria-label="Comentar a resenha de ' + esc(nome) + '">' +
            '<span class="glifo" aria-hidden="true">💬</span>' + (l.comentarios || 0) + '</a>' +
          '<time>' + esc(quandoFoi(l.criado_em)) + '</time>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  /* Dois gatilhos de recarga, registrados UMA vez: aoMudar não tem como tirar
     um ouvinte, então inscrever por pintura acumularia um por visita à ficha.
     Quando a rede volta, ou quando a fila esvazia e a sua nota finalmente
     entra na média, o bloco se refaz sozinho — sem recarregar a página. */
  function refazerRede() {
    var chave = rede.chave;
    if (!chave || !document.getElementById('livro-rede')) return;
    rede.chave = null;
    carregarRede(chave);
    repintarRede(chave);
  }
  window.addEventListener('online', refazerRede);
  /* Só na BORDA: a leitura deste livro estava na fila e acabou de subir. Sem a
     borda, qualquer mexida na fila — um ♥, um "quero ler" — refaria a consulta,
     uma ida à rede por toque e a lista de resenhas piscando junto. */
  var esperavaMinhaNota = false;
  Sinc.aoMudar(function () {
    var agora = !!(rede.chave && Sinc.esperandoLeitura(rede.chave));
    if (esperavaMinhaNota && !agora) refazerRede();
    esperavaMinhaNota = agora;
  });


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
          (comMes ? '<td class="cel-capa"><a href="' + rotaLivro(l.chave) + '"' +
                    ' aria-label="' + esc(livro.titulo) + '">' +
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
        : '<a href="#/resenha/' + log.id + '" title="Tem resenha"' +
          ' aria-label="Ler a resenha">≡</a>';
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

  /* ============================================================ TELA: resenha

     UM endereço. Até aqui a mesma resenha tinha dois, e nenhum servia à
     história: #/resenha/<id local> lia Dados.log com o id gerado no aparelho
     (js/dados.js) — que só existe no localStorage de quem escreveu, então o
     link mandado para outra pessoa caía em "Esta resenha não existe mais"; e
     #/leitura/<uuid> abria para todo mundo, com curtida e comentário, mas sem
     editar, sem apagar, sem compartilhar, e sem dizer que a resenha era sua.

     A ponte entre os dois ids já estava no dado: `log.remoto`. */

  /* Resolução em três passos, e a ordem importa:
     1. log local COM .remoto → troca a URL pelo endereço público e SAI sem
        pintar. `replace` e não `assign`: o apelido não pode ficar no
        histórico, senão o botão voltar devolve a pessoa para ele e o app fica
        pingando entre os dois. Retornar na hora também é obrigatório — o
        rotear() em curso não pode desenhar uma face e ser trocado no quadro
        seguinte.
     2. log local SEM .remoto → é minha e ainda não subiu. Pinta do
        localStorage, funciona no avião, e diz por que ainda não dá para
        compartilhar.
     3. sem log local → é uuid remoto, vai para a nuvem.

     Não testo o FORMATO do id para decidir (o local não tem hífen, o uuid
     tem). Funcionaria hoje e amarraria o desenho ao formato do id, que é o
     tipo de coisa que quebra calada no dia em que o formato muda. Procurar no
     localStorage é síncrono e custa zero. */
  function telaResenha(id) {
    marcarAba('');
    var local = Dados.log(id);
    if (local && local.remoto) {
      location.replace('#/resenha/' + encodeURIComponent(local.remoto));
      return;
    }
    if (local) return desenhaResenha(daLeituraLocal(local));
    return carregarResenhaRemota(id);
  }

  function carregarResenhaRemota(id) {
    /* Pode ser minha, já sincronizada: aí o log local existe com .remoto == id,
       e ele é o plano B se o servidor não responder. */
    var meu = Dados.logPorRemoto(id);

    if (!Nuvem.ligada()) {
      return meu ? desenhaResenha(daLeituraLocal(meu))
                 : pintar(htmlVazio('Não achei esta resenha',
                          'A nuvem não está ligada neste aparelho.'));
    }

    carregando('Abrindo a resenha…');
    Promise.all([
      Nuvem.publico('feed', '?select=*&id=eq.' + encodeURIComponent(id)),
      /* Comentário que não carrega não pode derrubar a resenha inteira. */
      Nuvem.comentarios(id).catch(function () { return []; })
    ]).then(function (r) {
      var l = (r[0] || [])[0];
      /* Apagada noutro aparelho e intacta neste: cair no estado vazio deixaria
         a resenha inalcançável a partir do próprio diário de quem escreveu. */
      if (!l) {
        return meu ? desenhaResenha(daLeituraLocal(meu))
                   : pintar(htmlVazio('Não achei esta resenha',
                            'Ela pode ter sido apagada por quem escreveu.'));
      }
      desenhaResenha(daLeituraRemota(l, r[1] || []));
    }, function (err) {
      if (meu) return desenhaResenha(daLeituraLocal(meu));
      pintar('<p class="erro">' + esc(err.message) + '</p>');
    });
  }

  /* As duas fontes viram a MESMA forma antes de chegar no desenho. Sem isto
     seriam dois renderizadores para uma tela só, que é exatamente a dívida que
     este item existe para pagar. `noAr` é o que separa as quatro faces: sem
     linha no servidor não há o que curtir, comentar nem compartilhar. */
  function daLeituraLocal(log) {
    var livro = livroDe(log.chave);
    var perfil = Dados.estado().perfil;
    return {
      id: log.remoto || log.id, idLocal: log.id, remoto: log.remoto || null,
      minha: true, noAr: !!log.remoto, naFila: Sinc.esperandoLeitura(log.chave),
      usuario: null, nome: perfil.nome || 'Você',
      chave: log.chave, titulo: livro.titulo, ano: livro.ano,
      capa: livro.capa, capaGrande: livro.capaGrande || livro.capa,
      nota: log.nota, resenha: log.resenha || '', spoiler: !!log.spoiler,
      relido: !!log.relido, data: dataBr(log.lidoEm),
      curtido: Dados.curtido(log.chave),
      curtidas: null, comentarios: null, perfilId: null
    };
  }

  function daLeituraRemota(l, comentarios) {
    var eu = Nuvem.entrou() ? Nuvem.quemSou() : null;
    var meuLog = Dados.logPorRemoto(l.id);
    return {
      id: l.id, idLocal: meuLog ? meuLog.id : null, remoto: l.id,
      minha: !!(eu && eu.id === l.perfil), noAr: true, naFila: false,
      usuario: l.usuario, nome: l.perfil_nome || l.usuario || 'alguém',
      chave: l.livro, titulo: l.titulo, ano: l.ano,
      capa: l.capa, capaGrande: l.capa,
      nota: typeof l.nota === 'number' ? l.nota : null,
      resenha: l.resenha || '', spoiler: !!l.spoiler, relido: !!l.relido,
      data: dataLonga(l.lido_em), curtido: false,
      curtidas: l.curtidas || 0, comentarios: comentarios, perfilId: l.perfil
    };
  }

  function enderecoDaResenha(v) {
    return location.origin + location.pathname + '#/resenha/' + encodeURIComponent(v.id);
  }

  function desenhaResenha(v) {
    var livroHref = rotaLivro(v.chave);
    var podeCompartilhar = v.noAr;

    /* Quatro faces, uma zona de ação. Compartilhar aparece SEM conta de
       propósito: quem recebeu o link é quem mais repassa. E some inteiro na
       face B — um botão que promete link e entrega nada é a pior variante
       possível desta história. */
    var botoes = [];
    if (podeCompartilhar) {
      botoes.push('<button class="botao' + (v.minha ? ' destaque' : '') +
                  '" data-acao="compartilhar-resenha">Compartilhar</button>');
    }
    if (v.minha && v.idLocal) {
      botoes.push('<button class="botao" data-acao="editar-log" data-id="' +
                  esc(v.idLocal) + '">Editar</button>');
    }
    botoes.push('<a class="botao" href="' + livroHref + '">Ver o livro</a>');
    if (v.minha && v.idLocal) {
      botoes.push('<button class="botao perigo" data-acao="apagar-resenha">Apagar</button>');
    } else if (!v.minha && Nuvem.entrou() && v.perfilId) {
      botoes.push('<button class="botao" id="botao-seguir" data-acao="seguir" disabled>…</button>');
    }

    var quem = v.usuario
      ? '<a class="resenha-quem" href="#/leitor/' + encodeURIComponent(v.usuario) + '">' +
          '<span class="feed-avatar" aria-hidden="true">' +
            esc(v.nome.trim().charAt(0).toUpperCase()) + '</span>' +
          '<b>' + esc(v.nome) + '</b><span>@' + esc(v.usuario) + '</span></a>'
      : '<div class="resenha-quem">' +
          '<span class="feed-avatar" aria-hidden="true">' +
            esc((v.nome || '?').trim().charAt(0).toUpperCase()) + '</span>' +
          '<b>' + esc(v.nome) + '</b></div>';

    /* A autora precisa saber, OLHANDO, que o que ela vê é o que a outra pessoa
       vai ver. É a resposta direta ao pedido: um endereço só, o mesmo que eu
       vejo e o mesmo que eu mando. */
    var estado = v.minha
      ? (v.noAr
          ? '<p class="rotulo resenha-estado">No ar · quem tem o link lê sem conta</p>'
          : '<p class="fila-aviso">' + (v.naFila
              ? 'Esta resenha está na fila para subir. Assim que subir, ela ganha um endereço para compartilhar.'
              : 'Esta resenha só existe neste aparelho. ' +
                '<a href="#/conta">Crie uma conta</a> para ela ganhar um endereço.') + '</p>')
      : '';

    /* Spoiler da SUA resenha não se esconde de você: o texto é seu e você já
       sabe o que escreveu — vem com o rótulo de aviso, como sempre veio. O de
       outra pessoa fica atrás do botão. O rótulo era style inline com --a1,
       verde de "o que você fez" num aviso; virou classe, em --texto-3. */
    var corpo = v.resenha
      ? '<div class="resenha-corpo">' +
          (v.spoiler && !v.minha
            ? '<button class="spoiler-aviso" data-acao="ver-spoiler" data-texto="' +
              esc(v.resenha) + '">Esta resenha tem spoiler. Tocar para ler.</button>'
            : (v.spoiler ? '<p class="rotulo resenha-spoiler">Contém spoiler</p>' : '') +
              '<p class="resenha-texto">' + esc(v.resenha) + '</p>') +
        '</div>'
      : '<p class="resenha-corpo resenha-sem-texto">' +
        'Esta leitura foi registrada sem resenha.</p>';

    var acoesSociais = v.noAr
      ? '<div class="feed-acoes resenha-acoes">' +
          '<button class="feed-curtir" data-acao="curtir-leitura" data-id="' + esc(v.id) + '"' +
            ' aria-pressed="false" aria-label="Curtir esta resenha">' +
            '<span class="glifo" aria-hidden="true">♡</span>' +
            '<span class="conta-curtidas">' + (v.curtidas || 0) + '</span></button>' +
          /* NÃO pode ser href="#comentarios". Num app roteado por hash isso não é
             âncora: o clique troca location.hash, dispara hashchange, o
             rotear() lê a raiz "comentarios", não casa com rota nenhuma e cai
             na home — a pessoa perde a resenha que estava lendo. Entrou na V4 e
             passou por seis suítes: o rastreador só clica em href^="#/", e a
             jornada clica neste mesmo seletor a partir do FEED, onde ele é
             rota de verdade. O app já sabia disso em outro lugar (a grade da
             folha de escolha usa href="#" com preventDefault). */
          '<button class="feed-comentar" data-acao="ir-comentarios"' +
            ' aria-label="Ir para os comentários">' +
            '<span class="glifo" aria-hidden="true">💬</span>' +
            (v.comentarios ? v.comentarios.length : 0) + '</button>' +
        '</div>'
      : '';

    pintar(
      htmlHeroi(v.capaGrande) +
      '<article class="resenha' + (v.capaGrande ? ' sobre-heroi' : '') + '">' +
        quem +
        '<div class="resenha-topo">' +
          '<div>' +
            '<h1 class="resenha-titulo"><a href="' + livroHref + '">' +
              esc(v.titulo) + '</a>' +
              (v.ano ? ' <span class="ano">' + v.ano + '</span>' : '') + '</h1>' +
            '<p class="resenha-linha">' +
              (v.nota ? '<span class="estrelas">' + estrelasTexto(v.nota) + '</span>' : '') +
              (v.curtido ? ' <span class="curtiu-o-livro" aria-label="curtiu o livro">♥</span>' : '') +
            '</p>' +
            '<p class="resenha-data">Lido em ' + esc(v.data) +
              (v.relido ? ' · releitura' : '') + '</p>' +
            estado +
          '</div>' +
          '<a class="resenha-capa" href="' + livroHref + '" aria-label="' +
            esc(v.titulo) + '">' +
            htmlCapa({ chave: v.chave, titulo: v.titulo, capa: v.capa }) + '</a>' +
        '</div>' +
        corpo +
        acoesSociais +
        '<div class="linha-botoes resenha-botoes">' + botoes.join('') + '</div>' +
      '</article>' +
      (v.noAr ? htmlSecaoComentarios(v) : ''));

    acoes({
      'editar-log': function (a) {
        abrirFolhaRegistro(livroDe(v.chave), a.getAttribute('data-id'));
      },
      'apagar-resenha': function () { abrirFolhaApagarResenha(v); },
      'compartilhar-resenha': function () { abrirFolhaCompartilharResenha(v); },
      'curtir-leitura': alternarCurtida,
      'ver-spoiler': revelarSpoiler,
      'ir-comentarios': function (b, ev) {
        ev.preventDefault();
        var secao = document.getElementById('comentarios');
        if (secao) secao.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      seguir: function (b) { alternarSeguir(v.perfilId, b); },
      'apagar-comentario': function (b) {
        var linha = b.closest('.comentario');
        Nuvem.apagarComentario(b.getAttribute('data-id')).then(function () {
          linha.remove();
        }, function (e) { aviso(e.message); });
      }
    });

    if (v.noAr) {
      ligarCurtidas(tela);
      ligarFormaComentario(v);
    }
    if (!v.minha && Nuvem.entrou() && v.perfilId) atualizarBotaoSeguir(v.perfilId);
  }

  function htmlSecaoComentarios(v) {
    var cs = v.comentarios || [];
    return '<section class="secao" id="comentarios" style="margin-top:26px">' +
      '<h2>' + plural(cs.length, 'comentário', 'comentários') + '</h2>' +
      '<div id="lista-comentarios">' + cs.map(htmlComentario).join('') + '</div>' +
      (Nuvem.entrou()
        ? '<form id="forma-comentario" style="margin-top:14px">' +
            '<label class="campo"><span>Seu comentário</span>' +
            '<textarea id="campo-comentario" maxlength="2000" style="min-height:74px" ' +
            'placeholder="O que você achou?"></textarea></label>' +
            '<div class="linha-botoes">' +
            '<button class="botao destaque" type="submit">Comentar</button></div>' +
          '</form>'
        : '<p class="conta-texto" style="margin-top:14px">' +
          '<a class="alvo" href="#/conta">Entre na sua conta</a> para comentar.</p>') +
    '</section>';
  }

  function ligarFormaComentario(v) {
    var forma = document.getElementById('forma-comentario');
    if (!forma) return;
    var eu = Nuvem.quemSou();
    forma.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var campo = document.getElementById('campo-comentario');
      var texto = campo.value.trim();
      if (!texto) return;
      var b = forma.querySelector('button');
      b.disabled = true; b.textContent = 'Enviando…';
      Nuvem.comentar(v.id, texto).then(function (novo) {
        campo.value = '';
        b.disabled = false; b.textContent = 'Comentar';
        document.getElementById('lista-comentarios').insertAdjacentHTML('beforeend',
          htmlComentario({ id: novo.id, texto: texto, criado_em: novo.criado_em,
                           perfil: eu.id, perfis: { usuario: 'você', nome: 'Você' } }));
      }, function (e) {
        b.disabled = false; b.textContent = 'Comentar';
        aviso(e.message);
      });
    });
  }

  /* ------------------------------------- folha: compartilhar esta resenha */

  /* NOVO — no Letterboxd a folha de ação é do FILME, não da resenha, e a
     escolha entre mandar o link e mandar a imagem não existe lá.

     A ordem é link primeiro, imagem por último, ao contrário do que o app
     fazia: até aqui "Compartilhar" desenhava um cartão do LIVRO e entregava por
     navigator.share({ files, title }) — não havia `url` em lugar nenhum do
     arquivo. Mandar o link, que é o pedido literal, simplesmente não existia.

     LIMITE HONESTO: a rota é por hash, então o servidor nunca vê o <id> e não
     há Open Graph por resenha — o cartão que o WhatsApp mostra é o genérico do
     index.html para toda resenha. Por isso nada aqui sugere prévia rica, e a
     linha da imagem é a compensação disponível: a imagem É a prévia, e vai com
     o link colado. */
  function abrirFolhaCompartilharResenha(v) {
    abrirFolhaDeLink({
      titulo: 'Compartilhar esta resenha',
      sub: esc(v.titulo) + ' · qualquer pessoa abre, sem conta.',
      url: enderecoDaResenha(v),
      tituloShare: 'Resenha de ' + v.titulo,
      texto: v.resenha ? recortar(v.resenha, 120) : '',
      imagem: function () {
        return cartaoDeCompartilhar(livroDe(v.chave), v.nota,
                                    enderecoDaResenha(v));
      }
    });
  }

  /* Uma folha de link só, usada pela resenha e pela lista. A ordem é link
     primeiro e imagem por último, ao contrário do que o app fazia: até a V4
     "Compartilhar" só sabia mandar uma imagem, e não havia `url` em nenhuma
     chamada de navigator.share.

     LIMITE HONESTO: a rota é por hash, o servidor nunca vê o <id> e não há
     Open Graph por página — o cartão que o WhatsApp mostra é o genérico do
     index.html. Por isso nada aqui sugere prévia rica; onde há imagem, ela É a
     prévia disponível, e vai com o link colado. */
  function abrirFolhaDeLink(o) {
    var curto = o.url.replace(/^https?:\/\//, '').replace(/\/index\.html/, '/');
    if (curto.length > 42) curto = curto.slice(0, 24) + '…' + curto.slice(-14);
    var temCopia = !!(navigator.clipboard && navigator.clipboard.writeText);
    var temShare = !!navigator.share;

    camada.innerHTML =
      '<div class="folha-fundo" data-fechar="fundo"><div class="folha" role="dialog" ' +
        'aria-modal="true" aria-label="' + esc(o.titulo) + '">' +
        '<h2>' + esc(o.titulo) + '</h2>' +
        '<p class="folha-sub">' + o.sub + '</p>' +
        '<div class="linhas">' +
          (temCopia
            ? '<button data-link="copiar">Copiar o link' +
              '<span class="valor">' + esc(curto) + '</span>' +
              '<span class="chevron" aria-hidden="true">›</span></button>'
            : '') +
          (temShare
            ? '<button data-link="mandar">Mandar o link' +
              '<span class="valor">pelo aparelho</span>' +
              '<span class="chevron" aria-hidden="true">›</span></button>'
            : '') +
          (o.imagem
            ? '<button data-link="imagem">Mandar como imagem' +
              '<span class="valor">com a capa e a nota</span>' +
              '<span class="chevron" aria-hidden="true">›</span></button>'
            : '') +
        '</div>' +
        /* Sem clipboard (contexto não seguro, iPhone antigo) a linha vira um
           campo já selecionado — nunca um botão que não faz nada. */
        (temCopia ? '' :
          '<label class="campo" style="margin-top:16px"><span>Copie o endereço</span>' +
          '<input id="link-para-copiar" readonly value="' + esc(o.url) + '"></label>') +
        '<div class="folha-rodape"><button class="botao" data-fechar="ok">Fechar</button></div>' +
      '</div></div>';

    var painel = camada.firstElementChild;
    var campo = document.getElementById('link-para-copiar');
    if (campo) { campo.focus(); campo.select(); }

    painel.addEventListener('click', function (ev) {
      var linha = ev.target.closest('[data-link]');
      if (linha) return executarLink(linha.getAttribute('data-link'), o);
      var alvo = ev.target.closest('[data-fechar]');
      if (!alvo) return;
      if (alvo.getAttribute('data-fechar') === 'fundo' && ev.target !== alvo) return;
      camada.innerHTML = '';
    });
  }

  function executarLink(qual, o) {
    if (qual === 'copiar') {
      return navigator.clipboard.writeText(o.url).then(function () {
        camada.innerHTML = '';
        aviso('Link copiado.');
      }, function () { aviso('Não consegui copiar. Segure no endereço para copiar à mão.'); });
    }
    if (qual === 'mandar') {
      return navigator.share({ title: o.tituloShare, text: o.texto || '', url: o.url })
        .then(function () { camada.innerHTML = ''; },
              function () { /* cancelar não é erro */ });
    }
    if (qual === 'imagem') {
      camada.innerHTML = '';
      return o.imagem().then(function (msg) {
        if (msg) aviso(msg);
      }, function (err) { aviso('Não consegui montar a imagem: ' + err.message); });
    }
  }

  /* ------------------------------------------ folha: apagar esta resenha */

  /* O confirm() do navegador não diz o que se perde, não carrega o tema — sai
     branco num app escuro — e no PWA do iPhone aparece com o endereço do site
     no título. E aqui a consequência é maior do que era: a tabela comentarios
     referencia leituras com `on delete cascade` (servidor/esquema.sql), então
     os comentários de outras pessoas somem junto. A frase abaixo é literal,
     não retórica. */
  function abrirFolhaApagarResenha(v) {
    var quantos = v.comentarios ? v.comentarios.length : 0;
    camada.innerHTML =
      '<div class="folha-fundo" data-fechar="fundo"><div class="folha" role="dialog" ' +
        'aria-modal="true" aria-label="Apagar esta resenha">' +
        '<h2>Apagar esta resenha?</h2>' +
        '<p class="folha-sub">O texto, a nota e a data somem daqui' +
          (v.noAr ? ' e do servidor' : '') + '.' +
          (quantos ? ' ' + plural(quantos, 'comentário que escreveram nela some',
                                  'comentários que escreveram nela somem') + ' junto.' : '') +
          (v.noAr ? ' O endereço para de abrir.' : '') + '</p>' +
        '<div class="folha-rodape">' +
          '<button class="botao" data-fechar="ok">Cancelar</button>' +
          '<span class="espaco"></span>' +
          '<button class="botao perigo" data-acao="confirmar-apagar">Apagar</button>' +
        '</div>' +
      '</div></div>';

    var painel = camada.firstElementChild;
    painel.addEventListener('click', function (ev) {
      if (ev.target.closest('[data-acao=confirmar-apagar]')) {
        camada.innerHTML = '';
        Dados.apagarLog(v.idLocal);
        aviso('Resenha apagada.');
        return ir('#/diario');
      }
      var alvo = ev.target.closest('[data-fechar]');
      if (!alvo) return;
      if (alvo.getAttribute('data-fechar') === 'fundo' && ev.target !== alvo) return;
      camada.innerHTML = '';
    });
  }

  /* =============================================================== TELA: resenhas */
  /* O que a aba Reviews do original mostra: as resenhas em cartoes, da mais
     recente para a mais antiga. */

  /* No original, Reviews é onde você LÊ GENTE — não onde você relê o que já
     escreveu. Esta aba mostrava Dados.logs() filtrado por resenha: exatamente
     o que já estava no Diário, com outro desenho. Quem abria esperando os
     outros encontrava a si mesma.

     DECISÃO (minha, e registrada para dar para reverter): três recortes em vez
     de dois. "Rede" é a fidelidade ao original. "Todas" existe porque quem
     ainda não segue ninguém encontraria uma aba vazia, e aba vazia no primeiro
     dia é o que faz o feed nunca encher — mesmo motivo pelo qual #/atividade
     já tem esse par. "Suas" preserva o recorte antigo, que é útil e não custa
     nada: é o mesmo cartão de sempre.

     O padrão default é "rede" só com nuvem E sessão. Sem uma das duas não há
     rede para ler, e desenhar "Rede" vazia seria o rótulo mentindo de novo —
     em modo local a aba abre em "Suas", que é o que existe. */
  function telaResenhas(aba) {
    marcarAba('inicio');
    var naRede = Nuvem.ligada() && Nuvem.entrou();
    aba = aba || (naRede ? 'rede' : 'suas');
    if (!naRede) aba = 'suas';

    var recortes = naRede
      ? '<nav class="segmentos segmentos-2" aria-label="Recorte das resenhas">' +
          [['rede', 'Rede'], ['todas', 'Todas'], ['suas', 'Suas']].map(function (a) {
            return '<a href="#/resenhas/' + a[0] + '"' +
                   (a[0] === aba ? ' class="ativa"' : '') + '>' + a[1] + '</a>';
          }).join('') + '</nav>'
      : '';

    if (aba === 'suas') return desenhaSuasResenhas(recortes);

    pintar(htmlSegmentos('resenhas') + recortes +
      '<h1 class="titulo-pagina">Resenhas</h1>' +
      '<div id="feed-resenhas"><p class="carregando">Carregando…</p></div>');

    acoes({
      'curtir-leitura': alternarCurtida,
      'ver-spoiler': revelarSpoiler
    });

    var alvo = document.getElementById('feed-resenhas');
    /* Uma página do feed pode vir inteira sem resenha nenhuma — a maioria das
       leituras é só nota. Pede três páginas e junta, que é mais honesto do que
       mostrar "ninguém escreveu" quando na verdade a primeira página não tinha. */
    var pagina = aba === 'todas' ? Nuvem.feedGeral : Nuvem.feed;
    Promise.all([pagina(0), pagina(1), pagina(2)]).then(function (paginas) {
      if (!tela.contains(alvo)) return;
      var vistas = {}, linhas = [];
      paginas.forEach(function (p) {
        (p || []).forEach(function (l) {
          if (!l.resenha || vistas[l.id]) return;
          vistas[l.id] = 1;
          linhas.push(l);
        });
      });
      if (!linhas.length) {
        alvo.innerHTML = aba === 'todas'
          ? htmlVazio('Ninguém escreveu resenha ainda',
              'Registre uma leitura com texto e a sua vai ser a primeira.')
          : htmlVazio('Quem você segue ainda não escreveu',
              'Dá para ler o que todo mundo escreveu enquanto isso.',
              '<div class="linha-botoes" style="justify-content:center;margin-top:14px">' +
              '<a class="botao destaque" href="#/resenhas/todas">Ver todas</a></div>');
        return;
      }
      alvo.innerHTML = '<p class="sub-pagina">' +
        plural(linhas.length, 'resenha', 'resenhas') + ' para ler.</p>' +
        linhas.map(htmlLinhaFeed).join('');
      ligarCurtidas(alvo);
    }, function (err) {
      if (tela.contains(alvo)) {
        alvo.innerHTML = '<p class="erro">' + esc(err.message) + '</p>';
      }
    });
  }

  /* O recorte antigo, intacto: o cartão com a capa é a forma certa para o que
     VOCÊ escreveu, e é a mesma que o original usa no perfil. Duas formas para
     o mesmo objeto não é inconsistência aqui — é o que o original faz. */
  function desenhaSuasResenhas(recortes) {
    var comResenha = Dados.logs().filter(function (l) { return l.resenha; });

    if (!comResenha.length) {
      return pintar(htmlSegmentos('resenhas') + recortes +
        '<h1 class="titulo-pagina">Resenhas</h1>' +
        htmlVazio('Você ainda não escreveu nenhuma',
          'Ao registrar uma leitura, o que você escrever aparece aqui.',
          '<a class="botao destaque" href="#/inicio">Encontrar um livro</a>'));
    }

    pintar(htmlSegmentos('resenhas') + recortes +
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
      '<span class="contador">' + livros.length + '</span></h2>' +
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

  /* Mesma resolução em três passos da resenha, e pelo mesmo motivo: até aqui
     #/lista/<id> só entendia o id do aparelho, então a lista não tinha
     endereço para mandar a ninguém — e a aba Listas do original é justamente
     onde as pessoas mandam recomendação uma para a outra. */
  function telaLista(id) {
    marcarAba('listas');
    var local = Dados.lista(id);
    if (local && local.remoto) {
      location.replace('#/lista/' + encodeURIComponent(local.remoto));
      return;
    }
    if (local) return desenhaLista(daListaLocal(local));

    /* Pode ser a MINHA, já sincronizada — o endereço público de uma lista
       minha continua abrindo com os botões de editar. */
    var meu = Dados.listaPorRemoto(id);
    if (meu) return desenhaLista(daListaLocal(meu));

    if (!Nuvem.ligada()) {
      return pintar(htmlVazio('Não achei esta lista',
                    'A nuvem não está ligada neste aparelho.'));
    }
    carregando('Abrindo a lista…');
    Nuvem.listaPorId(id).then(function (l) {
      if (!l) return pintar(htmlVazio('Não achei esta lista',
                            'Ela pode ter sido apagada por quem criou.'));
      desenhaLista(daListaRemota(l));
    }, function (err) {
      pintar('<p class="erro">' + esc(err.message) + '</p>');
    });
  }

  function daListaLocal(l) {
    return {
      id: l.remoto || l.id, idLocal: l.id, minha: true, noAr: !!l.remoto,
      naFila: true, nome: l.nome, descricao: l.descricao || '',
      chaves: l.livros || [], autor: Dados.estado().perfil.nome || 'Você', usuario: null
    };
  }

  function daListaRemota(l) {
    var p = l.perfis || {};
    return {
      id: l.id, idLocal: null, minha: false, noAr: true, naFila: false,
      nome: l.nome, descricao: l.descricao || '',
      chaves: (l.lista_itens || [])
        .slice().sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0); })
        .map(function (i) { return i.livro; }),
      autor: p.nome || p.usuario || 'alguém', usuario: p.usuario || null
    };
  }

  function desenhaLista(v) {
    var livros = v.chaves.map(livroDe);
    var comCapa = livros.filter(function (b) { return b.capaGrande || b.capa; })[0] || {};
    var fundo = comCapa.capaGrande || comCapa.capa;

    var autoria = v.usuario
      ? '<a class="lista-autoria" href="#/leitor/' + encodeURIComponent(v.usuario) + '">' +
          '<span class="avatar avatar-mini" aria-hidden="true">' +
            esc(v.autor.trim().charAt(0).toUpperCase()) + '</span>' +
          '<span>' + esc(v.autor) + '</span></a>'
      : '<div class="lista-autoria">' +
          '<span class="avatar avatar-mini" aria-hidden="true">' +
            esc((v.autor || '?').trim().charAt(0).toUpperCase()) + '</span>' +
          '<span>' + esc(v.autor) + '</span></div>';

    /* Mesma honestidade da resenha: sem linha no servidor não existe endereço
       para mandar, e o botão não é desenhado. */
    var botoes = [];
    if (v.noAr) {
      botoes.push('<button class="botao' + (v.minha ? ' destaque' : '') +
                  '" data-acao="compartilhar-lista">Compartilhar</button>');
    }
    if (v.minha) {
      botoes.push('<button class="botao" data-acao="renomear">Renomear</button>');
      botoes.push('<button class="botao" data-acao="descrever">Editar descrição</button>');
      botoes.push('<button class="botao perigo" data-acao="apagar-lista">Apagar lista</button>');
    }

    var aviso = (v.minha && !v.noAr && Nuvem.ligada())
      ? '<p class="fila-aviso">' + (Nuvem.entrou()
          ? 'Esta lista ainda não subiu. Quando subir, ganha um endereço para mandar a alguém.'
          : 'Esta lista fica só neste aparelho. <a href="#/conta">Crie uma conta</a> ' +
            'para ela ter um endereço.') + '</p>'
      : '';

    pintar(
      htmlHeroi(fundo) +
      '<div class="lista-cabecalho' + (fundo ? ' sobre-heroi' : '') + '">' +
        autoria +
        '<h1 class="titulo-pagina">' + esc(v.nome) + '</h1>' +
        (v.descricao ? '<p class="lista-descricao">' + esc(v.descricao) + '</p>' : '') +
        '<p class="sub-pagina" style="margin:0">' +
          plural(v.chaves.length, 'livro', 'livros') + '</p>' +
        aviso +
      '</div>' +
      (v.chaves.length
        ? htmlGrade(livros, '', true)
        : htmlVazio('Lista vazia', v.minha
            ? 'Abra a ficha de um livro e use “Adicionar a uma lista”.'
            : 'Quem criou ainda não pôs nenhum livro aqui.')) +
      (botoes.length
        ? '<div class="linha-botoes" style="margin-top:28px">' + botoes.join('') + '</div>'
        : ''));

    /* A lista de outra pessoa traz chaves de livros que este aparelho nunca
       viu: sem isto a grade seria uma parede de "Livro" sem capa. */
    if (!v.minha) completarLivrosDaLista(v);

    acoes({
      'compartilhar-lista': function () { abrirFolhaCompartilharLista(v); },
      renomear: function () {
        var nome = prompt('Novo nome:', v.nome);
        if (nome && nome.trim()) { Dados.editarLista(v.idLocal, { nome: nome.trim() }); rotear(); }
      },
      descrever: function () {
        var d = prompt('Descrição:', v.descricao || '');
        if (d !== null) { Dados.editarLista(v.idLocal, { descricao: d.trim() }); rotear(); }
      },
      'apagar-lista': function () { abrirFolhaApagarLista(v); }
    });
  }

  /* As fichas que faltam vêm da tabela comum de livros, numa consulta só, e
     entram no cache do aparelho — a grade se repinta quando chegam. */
  function completarLivrosDaLista(v) {
    var faltando = v.chaves.filter(function (c) { return !Dados.livro(c); });
    if (!faltando.length || !Nuvem.ligada()) return;
    Nuvem.livrosPorChave(faltando).then(function (bs) {
      if (!bs || !bs.length) return;
      bs.forEach(function (b) {
        Dados.guardarLivro({
          chave: b.chave, titulo: b.titulo, autores: b.autores || [],
          ano: b.ano, capa: b.capa, capaGrande: b.capa_grande,
          paginas: b.paginas, edicoes: b.edicoes
        });
      });
      if (location.hash.indexOf('#/lista/') === 0) desenhaLista(v);
    }).catch(function () { /* a grade fica com as lombadas, e tudo bem */ });
  }

  function abrirFolhaCompartilharLista(v) {
    abrirFolhaDeLink({
      titulo: 'Compartilhar esta lista',
      sub: esc(v.nome) + ' · qualquer pessoa abre, sem conta.',
      url: location.origin + location.pathname + '#/lista/' + encodeURIComponent(v.id),
      tituloShare: 'Lista: ' + v.nome,
      texto: v.descricao || plural(v.chaves.length, 'livro', 'livros')
    });
  }

  function abrirFolhaApagarLista(v) {
    camada.innerHTML =
      '<div class="folha-fundo" data-fechar="fundo"><div class="folha" role="dialog" ' +
        'aria-modal="true" aria-label="Apagar esta lista">' +
        '<h2>Apagar “' + esc(v.nome) + '”?</h2>' +
        '<p class="folha-sub">A lista some daqui' + (v.noAr ? ' e do servidor' : '') +
          '. Os ' + plural(v.chaves.length, 'livro continua', 'livros continuam') +
          ' no seu diário.' + (v.noAr ? ' O endereço para de abrir.' : '') + '</p>' +
        '<div class="folha-rodape">' +
          '<button class="botao" data-fechar="ok">Cancelar</button>' +
          '<span class="espaco"></span>' +
          '<button class="botao perigo" data-acao="confirmar-apagar">Apagar</button>' +
        '</div>' +
      '</div></div>';

    var painel = camada.firstElementChild;
    painel.addEventListener('click', function (ev) {
      if (ev.target.closest('[data-acao=confirmar-apagar]')) {
        camada.innerHTML = '';
        Dados.apagarLista(v.idLocal);
        aviso('Lista apagada.');
        return ir('#/listas');
      }
      var alvo = ev.target.closest('[data-fechar]');
      if (!alvo) return;
      if (alvo.getAttribute('data-fechar') === 'fundo' && ev.target !== alvo) return;
      camada.innerHTML = '';
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
          '<span class="contador">' + obras.length + '</span></h2>' +
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

  /* `endereco`, quando vem, faz duas coisas: entra desenhado embaixo da marca
     e vai junto no navigator.share. É o ponto inteiro do item — quem recebe a
     imagem recebe o link, e não uma foto solta que não leva a lugar nenhum. */
  function cartaoDeCompartilhar(livro, nota, endereco) {
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

      if (endereco) {
        c.fillStyle = cor('--texto-3') || '#82756a';
        c.font = '700 22px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
        c.fillText(endereco.replace(/^https?:\/\//, ''), L / 2, A - 108);
      }

      return entregarCartao(cv, livro, endereco);
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

  function entregarCartao(cv, livro, endereco) {
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
          var carga = { files: [arquivo], title: livro.titulo };
          /* Sem isto a imagem chega sozinha e não leva a lugar nenhum. */
          if (endereco) carga.url = endereco;
          return navigator.share(carga)
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

  /* A mesma fita para as duas telas. "Você" primeiro porque é o recorte mais
     apertado — o que aconteceu COM você — e os outros dois abrem para fora, na
     mesma gramática do original: Você | Seguindo | Todo mundo.

     "Você" é rota PRÓPRIA (#/avisos) e não um terceiro valor de
     #/atividade/<aba>: telaAtividade e telaAvisos leem coisas diferentes, e um
     item futuro do backlog mexe em telaAtividade + CAMPOS_FEED + htmlLinhaFeed
     ao mesmo tempo. Rota separada mantém os dois independentes; a fita
     compartilhada mantém a aparência de uma coisa só, que é o que a pessoa vê. */
  function htmlSegmentosAtividade(ativo) {
    var abas = [['avisos', 'Você', '#/avisos'],
                ['seguindo', 'Seguindo', '#/atividade/seguindo'],
                ['todos', 'Todo mundo', '#/atividade/todos']];
    return '<nav class="segmentos" aria-label="Atividade">' + abas.map(function (a) {
      return '<a href="' + a[2] + '"' + (a[0] === ativo ? ' class="ativa"' : '') +
             '>' + a[1] + '</a>';
    }).join('') + '</nav>';
  }

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

    pintar(htmlSegmentosAtividade(aba) +
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

    /* O trecho LEVA à resenha, como já leva na ficha do livro. Era um <p>
       inerte: na aba Resenhas, que existe para você ir ler, o alvo óbvio não
       fazia nada. Uma forma só nos dois lugares. */
    var resenha = '';
    if (l.resenha) {
      resenha = l.spoiler
        ? '<button class="spoiler-aviso" data-acao="ver-spoiler" data-texto="' +
          esc(l.resenha) + '">Esta resenha tem spoiler. Tocar para ler.</button>'
        : '<a class="feed-resenha" href="#/resenha/' + encodeURIComponent(l.id) + '">' +
          esc(recortar(l.resenha, 240)) + '</a>';
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
          '<a class="feed-comentar" href="#/resenha/' + encodeURIComponent(l.id) + '">' +
            '<span class="glifo">💬</span>' + (l.comentarios || 0) + '</a>' +
          '<time>' + esc(quandoFoi(l.criado_em)) + '</time>' +
        '</div>' +
      '</div>' +
      (l.capa ? '<a class="feed-capa" href="' + rotaLivro(l.livro) + '"' +
                ' aria-label="' + esc(l.titulo) + '">' +
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
    /* Sem conta nao ha o que acender, e quemSou() devolve null: seguir daqui
       estourava TypeError no visitante que abriu um link compartilhado — e a
       excecao nasce DENTRO do callback de sucesso, onde o tratamento de erro
       do Promise nao alcanca. */
    if (!Nuvem.entrou()) return;
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
      enfeitarComAsListas(usuario);
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

      '<section class="secao" id="listas-do-leitor" hidden></section>' +

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

  /* As listas de outra pessoa. Chegam DEPOIS da página estar de pé, como as
     contagens — é mais uma ida à rede, e o perfil é útil sem ela. Sem conta
     também aparecem: a política "listas são públicas" já permite. */
  function enfeitarComAsListas(usuario) {
    var caixa = document.getElementById('listas-do-leitor');
    Nuvem.listasDe(usuario).then(function (listas) {
      if (!caixa || !document.body.contains(caixa)) return;
      var comLivro = (listas || []).filter(function (l) {
        return (l.lista_itens || []).length;
      });
      if (!comLivro.length) return;
      caixa.innerHTML = '<h2>Listas<span class="contador">' + comLivro.length + '</span></h2>' +
        '<div class="linhas">' + comLivro.map(function (l) {
          return '<a href="#/lista/' + encodeURIComponent(l.id) + '">' + esc(l.nome) +
            '<span class="valor">' +
            plural(l.lista_itens.length, 'livro', 'livros') + '</span>' +
            '<span class="chevron" aria-hidden="true">›</span></a>';
        }).join('') + '</div>';
      caixa.hidden = false;
    }).catch(function () { /* sem as listas o perfil continua inteiro */ });
  }

  /* ==================================================== TELA: avisos ====== */

  /* NOVO — não existe quadro de notificação em nenhuma das 24 telas do
     inventário do original; o mais perto é "Ajustes" marcado parcial com
     "falta notificações". Está marcado como novo de propósito: inventar a
     referência seria pior do que assumir o acréscimo.

     O que a pessoa vê aqui vem de uma VIEW no banco (servidor/esquema.sql),
     não de uma tabela de notificações — o evento já estava gravado em
     curtidas, comentarios e seguidores desde o primeiro dia, com hora de
     servidor. O que não estava gravado era "já vi isto", e isso mora numa
     marca d'água no aparelho, logo abaixo. */

  var CHAVE_AVISOS = 'letterbooks:avisos:';

  function marcaDeAvisos() {
    var eu = Nuvem.entrou() ? Nuvem.quemSou() : null;
    if (!eu) return null;
    try { return JSON.parse(localStorage.getItem(CHAVE_AVISOS + eu.id) || 'null'); }
    catch (e) { return null; }
  }

  /* A marca é SEMPRE o criado_em da linha mais nova já mostrada — um horário
     de SERVIDOR. Nunca Date.now(). O relógio do aparelho e o do Postgres não
     são o mesmo relógio: um celular adiantado gravaria uma marca no futuro e a
     pessoa perderia avisos para sempre, sem erro, sem log e sem teste que
     visse. É o defeito silencioso mais caro que este item poderia ter. */
  function gravarMarcaDeAvisos(criadoEm) {
    var eu = Nuvem.entrou() ? Nuvem.quemSou() : null;
    if (!eu || !criadoEm) return;
    try {
      localStorage.setItem(CHAVE_AVISOS + eu.id, JSON.stringify({ visto: criadoEm }));
    } catch (e) { /* navegação privada: a marca vale enquanto a aba viver */ }
  }

  function telaAvisos() {
    marcarAba('atividade');

    if (!Nuvem.ligada()) {
      return pintar('<div class="conta"><h1>Você</h1>' +
        '<p class="conta-texto">Aviso é a notícia de que alguém do outro lado ' +
        'fez alguma coisa com o que você escreveu. No modo local não há outro ' +
        'lado — o diário é só seu, neste aparelho.</p></div>');
    }
    if (!Nuvem.entrou()) {
      return pintar('<div class="conta"><h1>Você</h1>' +
        '<p class="conta-texto">Entre na sua conta para saber quem curtiu, ' +
        'quem comentou e quem começou a te seguir.</p>' +
        '<div class="linha-botoes">' +
          '<a class="botao destaque" href="#/conta">Entrar ou criar conta</a></div></div>');
    }

    pintar(htmlSegmentosAtividade('avisos') +
      '<div id="avisos"><p class="carregando">Carregando…</p></div>');

    acoes({ 'ver-spoiler': revelarSpoiler });

    var alvo = document.getElementById('avisos');
    var marca = marcaDeAvisos();
    var desde = marca && marca.visto;

    Nuvem.avisos(50).then(function (linhas) {
      if (!tela.contains(alvo)) return;
      linhas = linhas || [];
      if (!linhas.length) {
        alvo.innerHTML = htmlVazio('Nada por aqui ainda',
          'Quando alguém curtir, comentar ou começar a te seguir, aparece aqui.');
        esconderPontoDeAvisos();
        return;
      }
      /* Pinta PRIMEIRO, marca depois: as linhas novas precisam nascer com o
         ponto naquele desenho. Marcar antes de pintar entregaria uma lista em
         que nada é novo, logo depois de o ponto ter dito que havia. */
      alvo.innerHTML = linhas.map(function (a) {
        return htmlLinhaAviso(a, !!(desde && a.criado_em > desde) || !desde);
      }).join('') +
      (linhas.length >= 50
        ? '<p class="avaliacoes-nota" style="margin-top:14px">' +
          'Mostrando os 50 mais recentes.</p>' : '');

      gravarMarcaDeAvisos(linhas[0].criado_em);
      esconderPontoDeAvisos();
    }, function (err) {
      if (tela.contains(alvo)) {
        alvo.innerHTML = '<p class="erro">' + esc(err.message) + '</p>';
      }
    });
  }

  /* Uma frase e um destino. Reusa .feed-linha porque é exatamente a mesma
     forma — retrato, frase, meta — e a linha inteira é o alvo, sem alvo
     aninhado: só há um lugar para onde ir. */
  function htmlLinhaAviso(a, nova) {
    var nome = a.quem_nome || a.usuario || 'alguém';
    var titulo = a.titulo ? '<b>' + esc(a.titulo) + '</b>' : '';
    var frase, destino;

    /* <b>, nunca <a>: a linha inteira JA e um <a>, e ancora dentro de ancora e
       HTML invalido — o navegador fecha a de fora e reabre, e uma linha vira
       tres fragmentos. E o D05, que ja tinha acontecido com o glifo do diario
       escapando para a celula seguinte. O destaque aqui e tipografico, nao um
       segundo destino: so ha um lugar para onde ir. */
    if (a.tipo === 'seguidor') {
      frase = '<b class="alvo">' + esc(nome) + '</b> começou a seguir você';
      destino = '#/leitor/' + encodeURIComponent(a.usuario || '');
    } else {
      /* "resenha" quando há texto, "registro" quando é só nota — a maioria das
         leituras é só nota, e chamar isso de resenha seria rótulo mentindo.
         As quatro frases estão escritas por extenso porque montar uma frase
         com replace() é como se erra concordância em português. */
      var oQue = a.tipo === 'curtida'
        ? (a.tem_resenha ? 'curtiu sua resenha de ' : 'curtiu seu registro de ')
        : (a.tem_resenha ? 'comentou na sua resenha de ' : 'comentou no seu registro de ');
      frase = '<b class="alvo">' + esc(nome) + '</b> ' + oQue + titulo;
      destino = '#/resenha/' + encodeURIComponent(a.leitura || '');
    }

    return '<a class="feed-linha aviso' + (nova ? ' aviso-novo' : '') + '" href="' +
      destino + '">' +
      '<span class="feed-avatar" aria-hidden="true">' +
        esc(nome.trim().charAt(0).toUpperCase()) + '</span>' +
      '<div class="feed-corpo">' +
        '<p class="feed-frase">' + frase + '</p>' +
        '<div class="feed-acoes">' +
          (nova ? '<i class="marca-nova" role="img" aria-label="novo"></i>' : '') +
          '<time>' + esc(quandoFoi(a.criado_em)) + '</time>' +
        '</div>' +
      '</div>' +
    '</a>';
  }

  /* ---- o ponto na aba ----

     Ponto, não número. Isso não é só desenho: com ponto a consulta é
     `limit=1` ("tem alguma coisa mais nova?"), e contagem exigiria
     `Prefer: count=exact`, que pedir() nem sabe ler porque descarta a
     resposta e devolve só o corpo.

     A cor é --texto, e os três acentos foram recusados um a um: verde é "o que
     VOCÊ fez" e isto foi outra pessoa; laranja é "o que você gostou" e aqui é
     alguém gostando de você; azul é "onde você está" e num ícone inativo diria
     que aquela é a aba atual. --texto já tem precedente escrito no projeto — a
     marca da sua nota no histograma — com a mesma justificativa de não ser um
     quarto acento. */
  function pontoDeAvisos() {
    return document.getElementById('ponto-avisos');
  }

  function esconderPontoDeAvisos() {
    var p = pontoDeAvisos();
    if (!p) return;
    p.hidden = true;
    var link = p.closest('a');
    if (link) link.setAttribute('aria-label', 'Atividade');
  }

  /* Três momentos, e nenhum timer: abrir o app, a sessão mudar, e a aba voltar
     a aparecer. São os mesmos que o Sinc já escolheu — em PWA no iPhone um
     setInterval em segundo plano é congelado, e o único efeito seria gastar
     bateria quando ele descongela. */
  function conferirAvisos() {
    var p = pontoDeAvisos();
    if (!p) return;
    if (!Nuvem.ligada() || !Nuvem.entrou()) return esconderPontoDeAvisos();
    if (location.hash.indexOf('#/avisos') === 0) return;   /* está lendo agora */

    var marca = marcaDeAvisos();
    Nuvem.temAvisoNovo(marca && marca.visto).then(function (tem) {
      var alvo = pontoDeAvisos();
      if (!alvo) return;
      alvo.hidden = !tem;
      var link = alvo.closest('a');
      if (link) link.setAttribute('aria-label', tem ? 'Atividade, com novidade' : 'Atividade');
    }).catch(function () { /* sem número é melhor do que número errado */ });
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

  /* telaLeitura/desenhaLeitura viviam aqui: eram a MESMA resenha noutro
     endereço, com curtida e comentário mas sem editar, apagar ou compartilhar.
     Foram absorvidas por desenhaResenha, que agora é a tela única. */

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

      /* O nome da conta manda. Sem isto o perfil mostrava "Leitora" — o nome
         padrao do modo local — para quem estava entrada como outra pessoa, e
         o app dizia dois nomes diferentes para a mesma pessoa na mesma tela
         (o @ da conta embaixo de um nome que nao era o dela). */
      var nome = p.nome || p.usuario;
      var h1 = tela.querySelector('.perfil-nome');
      var av = tela.querySelector('.avatar');
      if (h1) h1.textContent = nome;
      if (av) av.textContent = nome.trim().charAt(0).toUpperCase();
      if (Dados.estado().perfil.nome !== nome) {
        Dados.estado().perfil.nome = nome;
        Dados.salvar();
      }
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
    /* 'leitura' esteve nesta lista por um commit: era a rota da página pública
       da resenha, que nascera fora dela. Ela não existe mais — 'resenha' é o
       endereço único, e já estava aqui desde o começo. */
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
    if (rota === 'resenhas') return telaResenhas(partes[1]);
    if (rota === 'estante') return telaEstante();
    if (rota === 'listas')  return telaListas();
    if (rota === 'lista')   return telaLista(partes[1]);
    if (rota === 'perfil')  return telaPerfil();
    if (rota === 'conta')   return telaConta();
    if (rota === 'atividade') return telaAtividade(partes[1]);
    if (rota === 'avisos')  return telaAvisos();
    if (rota === 'leitor')  return telaLeitor(decodeURIComponent(partes[1] || ''));
    if (rota === 'seguidores' || rota === 'seguindo')
      return telaGente(rota, decodeURIComponent(partes[1] || ''));
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

  /* Os três momentos do ponto de avisos, e nenhum timer. Ficam aqui, ao lado do
     Sinc.ligar(), porque são os mesmos instantes que ele já escolheu para
     acordar — e porque juntá-los deixa visível que são três, não uma sondagem. */
  conferirAvisos();
  Nuvem.aoMudar(conferirAvisos);
  window.addEventListener('online', conferirAvisos);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) conferirAvisos();
  });
  rotear();
})();

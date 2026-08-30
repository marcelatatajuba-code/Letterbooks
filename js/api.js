/* ============================================================================
   api.js — acesso ao acervo de livros.

   Fonte: Open Library (openlibrary.org), o catalogo aberto do Internet Archive.
   Sao mais de 40 milhoes de edicoes, com capas, autores, ano e sinopse, e a API
   e publica: nao exige chave nem cadastro. Por isso ela faz aqui o papel que o
   TMDB faz no Letterboxd.

   Tudo que sai deste modulo ja vem normalizado no formato interno de livro:

     { chave, titulo, autores[], ano, capa, capaGrande, paginas, edicoes }

   A "chave" e o identificador da obra na Open Library (ex.: "/works/OL45804W").
   E ela que amarra o livro aos seus logs, resenhas e listas.
   ========================================================================== */
var API = (function () {
  'use strict';

  var BUSCA     = 'https://openlibrary.org/search.json';
  var AUTORES   = 'https://openlibrary.org/search/authors.json';
  var TENDENCIA = 'https://openlibrary.org/trending/weekly.json';
  var CAPAS     = 'https://covers.openlibrary.org/b/id/';
  var CAMPOS    = 'key,title,author_name,author_key,first_publish_year,cover_i,' +
                  'number_of_pages_median,edition_count,subject';

  /* Cache em memoria: a mesma busca repetida na sessao nao vai de novo a rede. */
  var cache = {};

  function url(base, params) {
    var partes = [];
    for (var k in params) {
      if (params[k] === undefined || params[k] === null || params[k] === '') continue;
      partes.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    }
    return base + (partes.length ? '?' + partes.join('&') : '');
  }

  function pegar(endereco) {
    if (cache[endereco]) return Promise.resolve(cache[endereco]);
    return fetch(endereco, { headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('A Open Library respondeu ' + r.status + '.');
        return r.json();
      })
      .then(function (dados) { cache[endereco] = dados; return dados; });
  }

  /* URL da capa. Tamanhos da Open Library: S (pequena), M (media), L (grande). */
  function capa(idCapa, tamanho) {
    if (!idCapa) return null;
    return CAPAS + idCapa + '-' + (tamanho || 'M') + '.jpg';
  }

  /* Converte um registro cru da Open Library no formato interno. */
  function normalizar(cru) {
    if (!cru || !cru.key) return null;
    return {
      chave:      cru.key,
      titulo:     cru.title || 'Sem titulo',
      autores:    cru.author_name || cru.authors || [],
      autoresIds: cru.author_key || [],
      ano:        cru.first_publish_year || null,
      capa:       capa(cru.cover_i, 'M'),
      capaGrande: capa(cru.cover_i, 'L'),
      paginas:    cru.number_of_pages_median || null,
      edicoes:    cru.edition_count || null,
      assuntos:   limparAssuntos(cru.subject, 8)
    };
  }

  /* ------------------------------------------------------------------ busca */

  /* termo livre: titulo, autor, ISBN, o que a pessoa digitar.
     pagina comeca em 1. Devolve { livros, total, pagina }. */
  function buscar(termo, pagina) {
    termo = (termo || '').trim();
    if (!termo) return Promise.resolve({ livros: [], total: 0, pagina: 1 });
    pagina = pagina || 1;

    var so = somenteDigitos(termo);
    var params = { fields: CAMPOS, limit: 24, page: pagina };
    /* 10 ou 13 digitos: a pessoa colou um ISBN, entao busca pelo campo certo. */
    if (so.length === 10 || so.length === 13) params.isbn = so;
    else params.q = termo;

    return pegar(url(BUSCA, params)).then(function (d) {
      return {
        livros: (d.docs || []).map(normalizar).filter(Boolean),
        total:  d.numFound || 0,
        pagina: pagina
      };
    });
  }

  function somenteDigitos(s) { return String(s).replace(/[^0-9]/g, ''); }

  /* Livros em alta na semana — alimenta a tela inicial. */
  function emAlta(limite) {
    return pegar(url(TENDENCIA, { limit: limite || 12 }))
      .then(function (d) { return (d.works || []).map(normalizar).filter(Boolean); })
      .catch(function () {
        /* Se o endpoint de tendencia falhar, cai numa busca por classicos. */
        return buscar('classicos da literatura', 1).then(function (r) {
          return r.livros.slice(0, limite || 12);
        });
      });
  }

  /* Livros de um assunto (ex.: "fantasy", "brazilian literature"). */
  function porAssunto(assunto, limite) {
    return pegar(url(BUSCA, { subject: assunto, fields: CAMPOS, limit: limite || 12 }))
      .then(function (d) { return (d.docs || []).map(normalizar).filter(Boolean); });
  }

  /* ------------------------------------------------------------- assuntos */

  /* A lista de assuntos da Open Library vem suja: o mesmo conceito aparece em
     varias linguas, repetido com e sem acento, e com restos de codificacao
     quebrada. Um exemplo real, de "How to Win Friends and Influence People":

       Succès · Psychologie appliquée · Psychologie applique e. ·
       Applied Psychology · Succe s. · Success · Conduct of life · Éxito

     Sao dez etiquetas para quatro ideias, e tres delas ("Succe s.",
     "Psychologie applique e.") sao lixo de acento perdido, onde o "è" virou
     "e " e o resto virou um pedaco solto. Mostrar isso cru faz a ficha
     parecer despejo de banco de dados.

     A limpeza tem tres passos: marcar o lixo, agrupar o que e a mesma coisa
     e escolher a melhor grafia de cada grupo. */

  /* "Succe s." e "Psychologie applique e." terminam com letra solta e ponto.
     E a assinatura da codificacao quebrada, e nao existe assunto de verdade
     escrito assim. */
  function suspeito(s) { return /\s[a-z]\.\s*$/i.test(s); }

  /* Mojibake: texto UTF-8 lido como Latin-1 em algum ponto do caminho.
     "Ficcao" com cedilha volta como "FicÃ§Ã£o" — um A-til ou A-circunflexo
     seguido de SIMBOLO, nunca de letra. Nenhuma etiqueta de verdade tem essa
     sequencia, em lingua nenhuma, entao ela e lixo inteiro e nem entra na
     conta: agrupar por distancia de edicao nao resolve isto, porque a forma
     estragada fica a tres ou quatro caracteres da boa e vira um grupo so dela.
     A limpeza ja tirava a duplicata; a etiqueta ilegivel continuava na tela. */
  function mojibake(s) {
    return /[\u00C3\u00C2][\u0080-\u00BF]/.test(s);
  }

  /* Sem acento, sem pontuacao, tudo junto: "Succès" e "Success" viram
     "succes" e "success", que a distancia de edicao abaixo aproxima. */
  function chaveAssunto(s) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  /* Distancia de edicao com teto 1: so precisamos saber se duas grafias estao
     a um caractere de distancia, entao para no primeiro passo que estoura. */
  function pertoDe(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    var i = 0, j = 0, erros = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++erros > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else { i++; j++; }
    }
    return erros + (a.length - i) + (b.length - j) <= 1;
  }

  function limparAssuntos(lista, limite) {
    var grupos = [];
    (lista || []).forEach(function (cru) {
      var s = String(cru || '').trim();
      if (s.length < 2 || s.length > 40) return;
      if (mojibake(s)) return;
      var k = chaveAssunto(s);
      if (!k) return;
      var g = null;
      for (var i = 0; i < grupos.length; i++) {
        if (pertoDe(grupos[i].chave, k)) { g = grupos[i]; break; }
      }
      if (!g) { g = { chave: k, formas: [] }; grupos.push(g); }
      g.formas.push(s);
    });

    return grupos.map(function (g) {
      /* Dentro do grupo, a melhor grafia e a que nao e lixo; entre as boas,
         a mais curta, que costuma ser a sem parenteses de desambiguacao. */
      var boas = g.formas.filter(function (s) { return !suspeito(s); });
      var candidatas = boas.length ? boas : g.formas;
      return candidatas.sort(function (a, b) { return a.length - b.length; })[0];
    }).slice(0, limite || 8);
  }

  /* ----------------------------------------------------------- ficha da obra */

  /* Detalhes da obra: sinopse e assuntos. A chave e do tipo "/works/OL45804W". */
  function detalhe(chave) {
    return pegar('https://openlibrary.org' + chave + '.json').then(function (d) {
      return {
        sinopse:  textoDe(d.description),
        assuntos: limparAssuntos(d.subjects, 8),
        capaId:   (d.covers || [])[0] || null
      };
    }).catch(function () {
      return { sinopse: '', assuntos: [], capaId: null };
    });
  }

  /* -------------------------------------------------------------- explorar */
  /* Os recortes prontos da tela de busca. A Open Library aceita ordenacao em
     search.json: "readinglog" e quantas pessoas puseram na estante (o mais
     perto de popularidade que existe la), "rating" e a nota media, "new" e a
     data de publicacao. */

  var RECORTES = {
    populares:  { rotulo: 'Mais lidos',
                  descricao: 'O que mais gente guardou na estante.',
                  params: { q: '*', sort: 'readinglog' } },
    avaliados:  { rotulo: 'Melhor avaliados',
                  descricao: 'As notas mais altas do acervo.',
                  params: { q: '*', sort: 'rating' } },
    recentes:   { rotulo: 'Publicados recentemente',
                  descricao: 'O que saiu por último.',
                  params: { q: '*', sort: 'new' } },
    classicos:  { rotulo: 'Clássicos',
                  descricao: 'Publicados até 1950, dos mais lidos aos menos.',
                  params: { q: 'first_publish_year:[* TO 1950]', sort: 'readinglog' } },
    brasileira: { rotulo: 'Literatura brasileira',
                  descricao: 'De Machado a agora.',
                  params: { subject: 'brazilian literature', sort: 'readinglog' } },
    poesia:     { rotulo: 'Poesia',
                  descricao: 'Versos, do acervo inteiro.',
                  params: { subject: 'poetry', sort: 'readinglog' } }
  };

  /* A busca por AUTOR e o equivalente do "Cast, Crew or Studios" do original:
     o mesmo termo, outro indice. Devolve pessoas, nao obras. */
  function buscarAutores(termo, pagina) {
    termo = (termo || '').trim();
    if (!termo) return Promise.resolve({ autores: [], total: 0 });
    return pegar(url(AUTORES, { q: termo, limit: 20, offset: ((pagina || 1) - 1) * 20 }))
      .then(function (d) {
        return {
          autores: (d.docs || []).map(function (a) {
            return {
              chave:  a.key,
              nome:   a.name || 'Sem nome',
              obras:  a.work_count || 0,
              principal: a.top_work || '',
              anos:   [a.birth_date, a.death_date].filter(Boolean).join(' – ')
            };
          }),
          total: d.numFound || 0
        };
      });
  }

  function recortes() { return RECORTES; }

  function explorar(chave, pagina) {
    var r = RECORTES[chave];
    if (!r) return Promise.reject(new Error('Recorte desconhecido.'));
    var params = { fields: CAMPOS, limit: 24, page: pagina || 1 };
    for (var k in r.params) params[k] = r.params[k];
    return pegar(url(BUSCA, params)).then(function (d) {
      return {
        livros: (d.docs || []).map(normalizar).filter(Boolean),
        total:  d.numFound || 0,
        pagina: pagina || 1,
        recorte: r
      };
    });
  }

  /* ------------------------------------------------------------------ autor */
  /* O equivalente do "cast & crew" de um filme: quem escreveu, e o que mais
     essa pessoa escreveu. A chave e do tipo "OL33810A" ou "/authors/OL33810A". */

  function autor(chave) {
    var id = String(chave).replace('/authors/', '');
    return pegar('https://openlibrary.org/authors/' + id + '.json').then(function (d) {
      return {
        chave:   id,
        nome:    d.name || 'Autoria desconhecida',
        bio:     textoDe(d.bio),
        nascimento: d.birth_date || null,
        morte:      d.death_date || null,
        retrato: (d.photos || []).filter(function (n) { return n > 0; })[0] || null
      };
    });
  }

  /* As obras da pessoa. Vem num formato diferente do da busca — capa em
     "covers" e nao em "cover_i" — entao normaliza aqui tambem. */
  function obrasDo(chave, limite) {
    var id = String(chave).replace('/authors/', '');
    return pegar(url('https://openlibrary.org/authors/' + id + '/works.json',
                     { limit: limite || 48 })).then(function (d) {
      return (d.entries || []).map(function (o) {
        if (!o || !o.key) return null;
        var idCapa = (o.covers || []).filter(function (n) { return n > 0; })[0] || null;
        return {
          chave:      o.key,
          titulo:     o.title || 'Sem titulo',
          autores:    [],
          ano:        anoDe(o.first_publish_date),
          capa:       capa(idCapa, 'M'),
          capaGrande: capa(idCapa, 'L'),
          paginas:    null,
          edicoes:    null
        };
      }).filter(Boolean);
    });
  }

  /* A data de publicacao vem livre: "1899", "May 1899", "1899-05-01". */
  function anoDe(texto) {
    var m = /\d{4}/.exec(String(texto || ''));
    return m ? Number(m[0]) : null;
  }

  function retrato(idFoto, tamanho) {
    if (!idFoto) return null;
    return 'https://covers.openlibrary.org/a/id/' + idFoto + '-' + (tamanho || 'M') + '.jpg';
  }

  /* A sinopse as vezes vem como string, as vezes como { type, value }. */
  function textoDe(d) {
    if (!d) return '';
    var t = typeof d === 'string' ? d : (d.value || '');
    /* A Open Library costuma anexar a fonte no fim, separada por tracos. */
    return t.split(/\n----/)[0].split(/\n\(\[source/)[0].trim();
  }

  return {
    buscar: buscar,
    buscarAutores: buscarAutores,
    emAlta: emAlta,
    porAssunto: porAssunto,
    detalhe: detalhe,
    recortes: recortes,
    explorar: explorar,
    autor: autor,
    obrasDo: obrasDo,
    capa: capa,
    retrato: retrato,
    normalizar: normalizar
  };
})();

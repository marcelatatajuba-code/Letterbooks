/* ============================================================================
   sinc.js — manda para o banco o que voce registra no aparelho.

   A regra do app continua sendo: grava LOCAL primeiro, sempre. O que a pessoa
   escreveu tem que estar salvo antes de qualquer coisa depender da rede — no
   metro, no aviao, com o Supabase fora do ar. A nuvem e um espelho, nao o
   original.

   Entao cada mudanca vira um item numa FILA guardada no proprio aparelho, e a
   fila e esvaziada quando da. Se a rede cair no meio, o item fica la e vai na
   proxima. Se o app fechar, a fila sobrevive — e localStorage. E o que evita
   o caso feio: a pessoa escreve uma resenha no onibus, o 4G oscila, e a
   resenha some do feed sem ninguem saber por que.

   O que vai para a fila:
     leitura        uma leitura criada ou editada
     leitura-apagada
     marcador       quero ler / curtida / favorito, ligando ou desligando

   Guardado no aparelho:
     letterbooks:fila   [ {tipo, dado, tentativas, em} ]
   ========================================================================== */
var Sinc = (function () {
  'use strict';

  var CHAVE_FILA = 'letterbooks:fila';
  var MAX_TENTATIVAS = 5;
  var TIPO_MARCADOR = { querLer: 'quero', curtidas: 'curtida', favoritos: 'favorito' };

  var fila = ler();
  var rodando = false;
  var ouvintes = [];

  function ler() {
    try { return JSON.parse(localStorage.getItem(CHAVE_FILA) || '[]'); }
    catch (e) { return []; }
  }

  function gravar() {
    try { localStorage.setItem(CHAVE_FILA, JSON.stringify(fila)); } catch (e) {}
    avisar();
  }

  function pendentes() { return fila.length; }

  /* Tem alguma LEITURA deste livro esperando rede? A ficha do livro usa isto
     para dizer "sua nota entra quando a fila subir" e para refazer a consulta
     da comunidade exatamente quando ela sobe. Sem esta pergunta so restava
     pendentes(), e ai curtir ou marcar "quero ler" — que tambem passam pela
     fila e nao mudam avaliacao nenhuma — disparavam uma ida a rede por toque. */
  function esperandoLeitura(chave) {
    for (var i = 0; i < fila.length; i++) {
      if (fila[i].tipo === 'leitura' && fila[i].dado && fila[i].dado.chave === chave) return true;
    }
    return false;
  }
  function aoMudar(f) { ouvintes.push(f); return f; }
  function avisar() {
    for (var i = 0; i < ouvintes.length; i++) {
      try { ouvintes[i](fila.length); } catch (e) {}
    }
  }

  /* ------------------------------------------------------------ enfileirar */

  function enfileirar(tipo, dado) {
    if (!Nuvem.ligada() || !Nuvem.entrou()) return;

    /* Uma leitura editada tres vezes seguidas nao precisa de tres envios: o
       ultimo estado e o que vale. Marcador idem — ligar e desligar antes de
       sincronizar deveria virar nada, mas guardar o ultimo estado ja resolve,
       porque o envio e por estado, nao por movimento. */
    fila = fila.filter(function (it) { return !mesmoAlvo(it, tipo, dado); });
    fila.push({ tipo: tipo, dado: dado, tentativas: 0, em: Date.now() });
    gravar();
    empurrar();
  }

  function mesmoAlvo(item, tipo, dado) {
    if (tipo === 'leitura' || tipo === 'leitura-apagada') {
      return (item.tipo === 'leitura' || item.tipo === 'leitura-apagada') &&
             item.dado.id === dado.id;
    }
    if (tipo === 'marcador') {
      return item.tipo === 'marcador' &&
             item.dado.colecao === dado.colecao && item.dado.chave === dado.chave;
    }
    /* Trocar o nome da lista e depois por dois livros nela sao tres anuncios do
       MESMO alvo. Vale o ultimo estado, como na leitura: o envio e por estado,
       nao por movimento. */
    /* A meta tem UM alvo por conta, entao dois anuncios de meta sao sempre o
       mesmo alvo: quem mexe tres vezes manda uma. */
    if (tipo === 'meta') return item.tipo === 'meta';
    if (tipo === 'lista' || tipo === 'lista-apagada') {
      return (item.tipo === 'lista' || item.tipo === 'lista-apagada') &&
             item.dado.id === dado.id;
    }
    return false;
  }

  /* --------------------------------------------------------------- empurrar */

  /* Esvazia a fila, um item por vez e na ordem. Em ordem porque a leitura tem
     que existir antes da curtida dela, e o livro antes da leitura. */
  function empurrar() {
    if (rodando || !fila.length) return Promise.resolve(0);
    if (!Nuvem.ligada() || !Nuvem.entrou()) return Promise.resolve(0);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return Promise.resolve(0);
    }

    rodando = true;
    var feitos = 0;

    /* Tira POR IDENTIDADE, nunca por posicao. enfileirar() substitui o array
       inteiro (filter + push), entao entre um envio comecar e terminar o
       fila[0] pode ja ser OUTRO item: um shift() cego jogava fora justamente o
       que tinha acabado de entrar, sem nunca ter mandado. Perda de dado
       silenciosa — a fila zerava e a mudanca sumia.

       Quando o item ja saiu do array (porque uma versao mais nova dele o
       substituiu), isto nao faz nada, que e o certo: a versao nova continua na
       fila e sobe na volta seguinte. */
    function tirarDaFila(item) {
      var i = fila.indexOf(item);
      if (i >= 0) fila.splice(i, 1);
      return i >= 0;
    }

    function proximo() {
      if (!fila.length) return Promise.resolve();
      var item = fila[0];
      return enviar(item).then(function () {
        tirarDaFila(item); feitos++; gravar();
        return proximo();
      }, function (err) {
        item.tentativas++;
        item.erro = err.message;
        /* Erro de rede: para a rodada inteira e tenta de novo depois — insistir
           agora so gastaria bateria. Erro do servidor que nao vai mudar
           (a linha nao existe mais, o dado e invalido): descarta o item, senao
           ele trava a fila para sempre. */
        var deRede = /conex|sess/i.test(err.message);
        if (deRede || item.tentativas < MAX_TENTATIVAS) {
          /* Vai para o fim da fila para nao travar quem vem atras — mas so se
             ele ainda estiver la; se foi substituido, quem manda e a versao
             nova. */
          if (!deRede && tirarDaFila(item)) fila.push(item);
          gravar();
          return Promise.reject(err);
        }
        console.warn('Sinc: desisti deste item apos ' + item.tentativas +
                     ' tentativas:', item.tipo, item.erro);
        tirarDaFila(item); gravar();
        return proximo();
      });
    }

    return proximo().then(function () {
      rodando = false; return feitos;
    }, function () {
      rodando = false; return feitos;
    });
  }

  /* ----------------------------------------------------------------- enviar */

  function enviar(item) {
    if (item.tipo === 'leitura')         return enviarLeitura(item.dado);
    if (item.tipo === 'leitura-apagada') return apagarLeitura(item.dado);
    if (item.tipo === 'marcador')        return enviarMarcador(item.dado);
    if (item.tipo === 'lista')           return enviarLista(item.dado);
    if (item.tipo === 'lista-apagada')   return apagarLista(item.dado);
    if (item.tipo === 'meta')            return enviarMeta(item.dado);
    return Promise.reject(new Error('Tipo desconhecido na fila: ' + item.tipo));
  }

  /* O livro precisa existir no acervo comum antes da leitura apontar para ele
     — e o que a chave estrangeira exige. Vai junto, sempre, porque descobrir
     se ja esta la custaria outra ida a rede. */
  function garantirLivro(chave) {
    var b = Dados.livro(chave);
    if (!b) return Promise.reject(new Error('Livro fora do cache do aparelho.'));
    return Nuvem.salvarLivro(b);
  }

  function enviarLeitura(reg) {
    var atual = Dados.log(reg.id) || reg;
    return garantirLivro(atual.chave).then(function () {
      return Nuvem.salvarLeitura(atual);
    }).then(function (linha) {
      if (linha && linha.id) Dados.marcarRemoto(atual.id, linha.id);
      return linha;
    });
  }

  /* So as duas colunas da meta, nunca o perfil inteiro. `salvarPerfil` e a
     mesma funcao que grava `privado` e `usuario/nome/bio/local`: um corpo
     montado a partir de um retrato velho do perfil reabriria um diario
     fechado. Mandar so o que mudou e o que impede isso. */
  function enviarMeta(meta) {
    return Nuvem.salvarPerfil({ meta_ano: meta.ano, meta_total: meta.total });
  }

  /* Nada de `if (!reg.remoto) return`: quem registra e apaga em seguida nunca
     chega a saber o uuid, e a guarda transformava o apagar num no-op — a
     leitura sumia do aparelho e ficava no servidor. Apagar pelo id do aparelho
     funciona nos dois casos e nao quebra se ela nunca tiver subido. */
  function apagarLeitura(reg) {
    return Nuvem.apagarLeitura(reg.id);
  }

  /* A lista inteira sobe de uma vez: a linha e os itens. Os livros precisam
     existir no acervo comum antes — a chave estrangeira exige — e vao em
     sequencia, uma lista de 40 titulos faz 40 idas. E aceitavel porque
     acontece uma vez por lista, nao por abertura. */
  function enviarLista(reg) {
    var atual = Dados.lista(reg.id) || reg;
    var chaves = (atual.livros || []).filter(function (c) { return !!Dados.livro(c); });
    return chaves.reduce(function (antes, c) {
      return antes.then(function () { return garantirLivro(c); });
    }, Promise.resolve()).then(function () {
      return Nuvem.salvarLista({ id: atual.id, nome: atual.nome,
                                 descricao: atual.descricao, livros: chaves });
    }).then(function (linha) {
      if (linha && linha.id) Dados.marcarRemotoLista(atual.id, linha.id);
      return linha;
    });
  }

  function apagarLista(reg) {
    return Nuvem.apagarLista(reg.id);
  }

  function enviarMarcador(m) {
    var tipo = TIPO_MARCADOR[m.colecao];
    if (!tipo) return Promise.resolve();
    if (!m.ativo) return Nuvem.tirarMarcador(m.chave, tipo);
    return garantirLivro(m.chave).then(function () {
      return Nuvem.porMarcador(m.chave, tipo);
    });
  }

  /* ------------------------------------------------------------- descer ---

     A metade que faltava. Ate aqui a sincronizacao era de mao unica: subia o
     que voce escrevia e nunca trazia de volta. Entrar na conta num celular
     novo mostrava um diario vazio — a conta existia e nao servia para nada.

     Desce ANTES de subir, sempre. Se subisse primeiro, a fila mandaria as
     leituras deste aparelho como se fossem novidade, e so depois descobriria
     que metade ja estava la. */

  var descendo = false;

  function descer() {
    if (!Nuvem.ligada() || !Nuvem.entrou() || descendo) return Promise.resolve(null);
    descendo = true;

    return Promise.all([Nuvem.minhasLeituras(), Nuvem.meusMarcadores(),
                        /* Lista que nao desce nao serve: quem instala no
                           segundo aparelho encontraria a aba vazia. Falha aqui
                           nao derruba o resto da descida. */
                        Nuvem.minhasListas().catch(function () { return []; }),
                        /* O perfil desce junto por causa da META. Sem ele,
                           quem definiu 24 livros no computador abre o celular
                           novo e encontra 12 — o padrao do esquema — sem nada
                           dizendo que a meta se perdeu. Falha aqui nao derruba
                           a descida: a meta local continua valendo. */
                        Nuvem.meuPerfil().catch(function () { return null; })])
      .then(function (r) {
        var leituras = r[0] || [], marcadores = r[1] || [], listas = r[2] || [];
        aplicarMeta(r[3]);

        /* As fichas dos livros vem numa consulta so, em vez de uma ida a rede
           por linha: um diario de 200 leituras faria 200 chamadas. */
        var chaves = {};
        leituras.forEach(function (l) { chaves[l.livro] = 1; });
        marcadores.forEach(function (m) { chaves[m.livro] = 1; });
        listas.forEach(function (l) {
          (l.lista_itens || []).forEach(function (i) { chaves[i.livro] = 1; });
        });
        var faltando = Object.keys(chaves).filter(function (c) { return !Dados.livro(c); });

        return Nuvem.livrosPorChave(faltando).then(function (livros) {
          /* O mapa mora em Dados desde que as duas cópias divergiram — esta
             guardava sinopse e autores_ids, a do app.js não. */
          (livros || []).forEach(Dados.guardarLivroDaLinha);
          var contas = Dados.fundir(leituras, marcadores);
          var deListas = Dados.fundirListas(listas);
          contas.listas = deListas.vieram;
          contas.adotar = contas.adotar.concat(
            deListas.adotar.map(function (a) { return { tabela: 'listas', remoto: a.remoto,
                                                        cliente_id: a.cliente_id }; }));

          /* As linhas antigas que a fusao reconheceu por assinatura recebem o
             cliente_id no servidor. Falha aqui nao para a descida: o diario ja
             esta certo no aparelho, e a proxima abertura tenta de novo. */
          if (!contas.adotar.length) return contas;
          return Promise.all(contas.adotar.map(function (a) {
            return (a.tabela === 'listas'
              ? Nuvem.adotarLista(a.remoto, a.cliente_id)
              : Nuvem.adotarLeitura(a.remoto, a.cliente_id)).catch(function () {});
          })).then(function () { return contas; });
        });
      })
      .then(function (contagens) {
        descendo = false;
        return contagens;
      }, function (err) {
        descendo = false;
        /* Descida que falha nao e motivo para bloquear o app: o diario local
           continua inteiro e a proxima abertura tenta de novo. */
        console.warn('Sinc: nao consegui trazer o diario da conta:', err.message);
        return null;
      });
  }

  /* A meta que veio do servidor, com a UNICA excecao que importa: se ha item
     `meta` esperando na fila, o servidor NAO ganha.

     `descer()` roda antes de `empurrar()`, de proposito. Sem esta guarda, quem
     edita a meta no metro e abre o app com rede tem a edicao sobrescrita pela
     meta velha do servidor — e a fila entao sobe o valor sobrescrito. A
     edicao morre sem erro nenhum, que e a mesma classe de perda silenciosa que
     o `tirarDaFila` por identidade ja documenta neste arquivo.

     Fora isso o servidor ganha, e sem cerimonia: a meta e um escalar que a
     pessoa pos de proposito no lugar mais recente, e uma folha perguntando
     "12 ou 40?" seria a maior cerimonia do app sobre o menor dado dele.

     `meta_ano` menor que o ano corrente nao vira aqui: virar o ano e escrita
     como efeito de leitura, e cada aparelho que abrisse o perfil mandaria um
     PATCH. Quem grava o ano e a confirmacao da folha. */
  function aplicarMeta(perfil) {
    if (!perfil) return;
    if (perfil.meta_total === null || perfil.meta_total === undefined) return;
    if (fila.some(function (i) { return i.tipo === 'meta'; })) return;
    Dados.guardarMeta({ ano: perfil.meta_ano, total: perfil.meta_total });
  }

  /* ------------------------------------------------------------------ ligar */

  function ligar() {
    if (!Nuvem.ligada()) return;

    Dados.aoMudar(function (tipo, dado) { enfileirar(tipo, dado); });

    /* Tres momentos em que vale tentar esvaziar: ao abrir, ao voltar a ter
       rede, e ao voltar para a aba (que no celular e quando o app "acorda"). */
    /* Ao entrar na conta: primeiro traz o que esta la, depois manda o que
       esta aqui. A ordem importa — ver a nota anterior. */
    Nuvem.aoMudar(function (eu) { if (eu) descer().then(empurrar); });
    window.addEventListener('online', empurrar);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) empurrar();
    });
    if (Nuvem.entrou()) descer().then(empurrar);
  }

  /* Joga fora a fila inteira. Existe por causa de "Apagar tudo deste
     aparelho": `Dados.limpar()` zera `letterbooks:v1` e a fila mora noutra
     chave, então ela sobrevivia — e continuava empurrando para o servidor o
     que a pessoa tinha acabado de apagar. Pior, `enviarLista` usa
     `Dados.lista(reg.id) || reg` e cai no retrato guardado, ou seja, envia
     mesmo com o diário já vazio. A pessoa apagava tudo e o aparelho continuava
     publicando. */
  function esquecer() {
    fila = [];
    gravar();
    return true;
  }

  return {
    ligar:      ligar,
    descer:     descer,
    empurrar:   empurrar,
    pendentes:  pendentes,
    esperandoLeitura: esperandoLeitura,
    aoMudar:    aoMudar,
    enfileirar: enfileirar,
    esquecer:   esquecer
  };
})();

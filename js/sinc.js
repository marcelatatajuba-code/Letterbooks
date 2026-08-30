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

    function proximo() {
      if (!fila.length) return Promise.resolve();
      var item = fila[0];
      return enviar(item).then(function () {
        fila.shift(); feitos++; gravar();
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
          if (!deRede) { fila.shift(); fila.push(item); }
          gravar();
          return Promise.reject(err);
        }
        console.warn('Sinc: desisti deste item apos ' + item.tentativas +
                     ' tentativas:', item.tipo, item.erro);
        fila.shift(); gravar();
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

  function apagarLeitura(reg) {
    if (!reg.remoto) return Promise.resolve();   /* nunca chegou a subir */
    return Nuvem.apagarLeitura(reg.remoto);
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

    return Promise.all([Nuvem.minhasLeituras(), Nuvem.meusMarcadores()])
      .then(function (r) {
        var leituras = r[0] || [], marcadores = r[1] || [];

        /* As fichas dos livros vem numa consulta so, em vez de uma ida a rede
           por linha: um diario de 200 leituras faria 200 chamadas. */
        var chaves = {};
        leituras.forEach(function (l) { chaves[l.livro] = 1; });
        marcadores.forEach(function (m) { chaves[m.livro] = 1; });
        var faltando = Object.keys(chaves).filter(function (c) { return !Dados.livro(c); });

        return Nuvem.livrosPorChave(faltando).then(function (livros) {
          (livros || []).forEach(function (b) {
            Dados.guardarLivro({
              chave: b.chave, titulo: b.titulo, autores: b.autores || [],
              autoresIds: b.autores_ids || [], ano: b.ano, capa: b.capa,
              capaGrande: b.capa_grande, paginas: b.paginas, edicoes: b.edicoes,
              sinopse: b.sinopse
            });
          });
          var contas = Dados.fundir(leituras, marcadores);

          /* As linhas antigas que a fusao reconheceu por assinatura recebem o
             cliente_id no servidor. Falha aqui nao para a descida: o diario ja
             esta certo no aparelho, e a proxima abertura tenta de novo. */
          if (!contas.adotar.length) return contas;
          return Promise.all(contas.adotar.map(function (a) {
            return Nuvem.adotarLeitura(a.remoto, a.cliente_id).catch(function () {});
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

  return {
    ligar:      ligar,
    descer:     descer,
    empurrar:   empurrar,
    pendentes:  pendentes,
    esperandoLeitura: esperandoLeitura,
    aoMudar:    aoMudar,
    enfileirar: enfileirar
  };
})();

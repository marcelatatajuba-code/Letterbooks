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

  /* ------------------------------------------------------------------ ligar */

  function ligar() {
    if (!Nuvem.ligada()) return;

    Dados.aoMudar(function (tipo, dado) { enfileirar(tipo, dado); });

    /* Tres momentos em que vale tentar esvaziar: ao abrir, ao voltar a ter
       rede, e ao voltar para a aba (que no celular e quando o app "acorda"). */
    Nuvem.aoMudar(function (eu) { if (eu) empurrar(); });
    window.addEventListener('online', empurrar);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) empurrar();
    });
    if (Nuvem.entrou()) empurrar();
  }

  return {
    ligar:      ligar,
    empurrar:   empurrar,
    pendentes:  pendentes,
    aoMudar:    aoMudar,
    enfileirar: enfileirar
  };
})();

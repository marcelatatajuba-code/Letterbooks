/* Confere a trava da chave do Supabase.

   As duas chaves do painel ("anon public" e "service_role") sao textos
   parecidos, coladas do mesmo lugar, e trocar uma pela outra e o erro mais
   caro que da para cometer neste projeto: a service_role ignora TODAS as
   politicas de RLS. Este teste garante que o app se recusa a subir com ela.

   Rode com:  node docs/testar-chave.js
*/
var fs = require('fs');
var caminho = __dirname + '/../js/nuvem.js';
var falhas = 0;

function jwtDe(papel) {
  var b = function (o) { return Buffer.from(JSON.stringify(o)).toString('base64url'); };
  return b({ alg: 'HS256' }) + '.' + b({ iss: 'supabase', ref: 'x', role: papel }) + '.assin';
}

function comChave(chave) {
  var CONFIG = { supabaseUrl: 'https://x.supabase.co', supabaseChave: chave };
  var Nuvem;
  var localStorage = { getItem: function () { return null; },
                       setItem: function () {}, removeItem: function () {} };
  var atob = function (s) { return Buffer.from(s, 'base64').toString('binary'); };
  var avisou = false;
  var antes = console.error;
  console.error = function () { avisou = true; };
  try { eval(fs.readFileSync(caminho, 'utf8')); } finally { console.error = antes; }
  return { ligada: Nuvem.ligada(), avisou: avisou };
}

function ok(cond, msg) {
  console.log((cond ? '  ok    ' : '  FALHA ') + msg);
  if (!cond) falhas++;
}

var boa  = comChave(jwtDe('anon'));
var ruim = comChave(jwtDe('service_role'));
var estranha = comChave(jwtDe('postgres'));
var texto = comChave('isto-nao-e-um-jwt');
var vazia = comChave('');

ok(boa.ligada && !boa.avisou,        'a chave anon liga a nuvem, sem reclamar');
ok(!ruim.ligada,                     'a service_role NAO liga a nuvem');
ok(ruim.avisou,                      'e explica no console por que');
ok(!estranha.ligada,                 'papel desconhecido tambem nao liga');
ok(texto.ligada,                     'texto que nao e JWT segue (o servidor recusa)');
ok(!vazia.ligada,                    'sem chave, modo local');

process.exitCode = falhas ? 1 : 0;

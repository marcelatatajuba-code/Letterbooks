var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../js/api.js', 'utf8');
// pega o modulo inteiro e expoe as funcoes internas para o teste
eval(src.replace(/^  return \{$/m, '  return { _limpar: limparAssuntos, _perto: pertoDe,'));

var real = ['Succès','Psychologie appliquée','Psychologie applique e.','Applied Psychology',
            'Succe s.','Success','Conduct of life','Persuasion (Psychology)','Leadership','Éxito',
            'Relations humaines','Interpersonal relations'];
console.log('antes :', real.length, 'etiquetas');
var lim = API._limpar(real, 8);
console.log('depois:', lim.length, '->', JSON.stringify(lim));

function ok(c, m) { console.log((c ? '  ok   ' : '  FALHA ') + m); if (!c) process.exitCode = 1; }
ok(lim.indexOf('Succe s.') < 0, 'o lixo de acento sai');
ok(lim.indexOf('Psychologie applique e.') < 0, 'o outro lixo tambem');
ok(lim.indexOf('Success') >= 0 || lim.indexOf('Succès') >= 0, 'sobra uma grafia de "sucesso"');
ok(lim.filter(function (s) { return /^succ/i.test(s); }).length === 1, 'e so uma');
ok(lim.indexOf('Leadership') >= 0, 'os assuntos legitimos ficam');
ok(lim.length <= 8, 'no maximo oito');
ok(API._perto('succes', 'success'), 'succes ~ success');
ok(!API._perto('exito', 'success'), 'exito nao vira success');
ok(API._limpar([], 8).length === 0, 'lista vazia nao quebra');
ok(API._limpar(null, 8).length === 0, 'nulo nao quebra');
ok(API._limpar(['a', 'Ficção'], 8).length === 1, 'etiqueta de uma letra sai');

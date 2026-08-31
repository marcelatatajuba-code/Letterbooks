# -*- coding: utf-8 -*-
"""conferir.py — confere os números do LEIA-ME.md contra a fonte.

Existe porque a primeira versão daquele arquivo tinha TRÊS números errados:
contava achados do rastreador como asserção, somava o script de orquestração
como verificação, e atribuía à usuária um defeito que não foi ela quem viu.

Documento de métrica que não confere os próprios números não vale a leitura.
Rode depois de mexer no processo, no registro de defeitos ou nas suítes:

    python3 docs/processo/conferir.py
"""
import csv, os, re, subprocess, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
def sh(c): return subprocess.check_output(c, shell=True, cwd=RAIZ).decode()

doc = open(os.path.join(RAIZ, 'docs/processo/LEIA-ME.md'), encoding='utf-8').read()
defeitos = list(csv.DictReader(open(os.path.join(RAIZ, 'docs/processo/defeitos.csv'),
                                    encoding='utf-8')))

SUITES = ['docs/testar.py', 'docs/testar_nuvem.py', 'docs/testar_social.py',
          'docs/jornada_e2e.py']
# A suite de regressao nao tem `ok(` nem `checa(`: as assercoes dela sao dados,
# em dados_teste.CASOS. Contar por linha de codigo seria contar errado, entao
# ela e contada pelo numero de checagens dos casos.
REGRESSAO = 'docs/dados_teste.py'
VERIFICACAO = SUITES + ['docs/testar_regressao.py', 'docs/dados_teste.py',
                        'docs/rastreador.py', 'docs/fixtures.py',
                        'docs/testar-chave.js', 'docs/testar-assuntos.js',
                        'servidor/provar.sql', 'servidor/provar-v1.sql',
                        'servidor/provar-v2.sql', 'servidor/provar-v3.sql']
APP = ['js/api.js', 'js/app.js', 'js/config.js', 'js/dados.js', 'js/nuvem.js',
       'js/sinc.js', 'css/app.css', 'index.html', 'sw.js']

def linhas(arquivos):
    return sum(len(open(os.path.join(RAIZ, a), encoding='utf-8').read().splitlines())
               for a in arquivos if os.path.exists(os.path.join(RAIZ, a)))

def asseres():
    n = 0
    for s in SUITES:
        n += len(re.findall(r'^\s+(?:ok|checa)\(', open(os.path.join(RAIZ, s),
                                                        encoding='utf-8').read(), re.M))
    return n

def porFase(fase):
    d = [x for x in defeitos if x['fase'] == fase]
    return len(d), len([x for x in d if 'usuária' in x['detector']])

falhas = []
def confere(nome, esperado, achado):
    igual = str(esperado) == str(achado)
    print(('  ok    ' if igual else '  FALHA ') + '%-38s doc=%s  fonte=%s'
          % (nome, esperado, achado))
    if not igual: falhas.append(nome)

# o que o documento AFIRMA, lido dele mesmo
afirma_ass = re.search(r'\*\*(\d+) asserções\*\*', doc)
afirma_raz = re.search(r'razão de 0,(\d+)', doc)
afirma_def = re.search(r'os (\d+) defeitos', doc)

ver, app = linhas(VERIFICACAO), linhas(APP)
confere('asserções nas quatro suítes', afirma_ass.group(1) if afirma_ass else '?', asseres())
confere('razão verificação/app', '0,%s' % (afirma_raz.group(1) if afirma_raz else '?'),
        ('%.2f' % (ver / app)).replace('.', ','))
confere('defeitos registrados', afirma_def.group(1) if afirma_def else '?', len(defeitos))

for fase, rotulo in [('vibecoding', '3 de 10'), ('instrumentado', '4 de 13'),
                     ('time-hibrido', '4 de 57')]:
    total, daUsuaria = porFase(fase)
    confere('%s: achados pela usuária' % fase, rotulo, '%d de %d' % (daUsuaria, total))
    if ('**%s**' % rotulo) not in doc:
        falhas.append('%s: o documento não diz "%s"' % (fase, rotulo))
        print('  FALHA o documento não afirma "%s"' % rotulo)

# "N dos M ficaram latentes": latencia medida em HORAS — o defeito atravessou a
# fase em que nasceu. Minutos nao contam: sao defeitos vistos na mesma sessao
# que os escreveu, que e o contrario do que a frase quer dizer. O documento
# afirma isso em DOIS lugares, e afirmacao repetida apodrece em dobro.
hib = [x for x in defeitos if x['fase'] == 'time-hibrido']
latentes = len([x for x in hib if 'h' in x['latencia']])
frase = '**%d dos %d**' % (latentes, len(hib))
confere('defeitos latentes na última fase', frase, frase if doc.count(frase) == 2 else
        'o documento diz isso %d vez(es), esperava 2' % doc.count(frase))

# A cobertura de regressao: quantos defeitos ja registrados tem um caso que os
# prende. E o numero que responde "quanto do que ja quebrou nao volta calado".
import importlib, sys as _sys
_sys.path.insert(0, os.path.join(RAIZ, 'docs'))
dados_teste = importlib.import_module('dados_teste')
com, sem, tela = dados_teste.cobertura()
afirma_cob = re.search(r'\*\*(\d+) de (\d+) defeitos\*\* tem caso', doc)
confere('defeitos com caso de regressao',
        '%s de %s' % (afirma_cob.group(1), afirma_cob.group(2)) if afirma_cob else '?',
        '%d de %d' % (len(com), len(defeitos)))
if sem:
    falhas.append('defeitos sem caso e sem motivo: ' + ', '.join(sem))
    print('  FALHA %d defeito(s) sem caso e sem motivo escrito: %s'
          % (len(sem), ', '.join(sem)))

print()
if falhas:
    print('%d número(s) fora de sincronia com a fonte.' % len(falhas))
    sys.exit(1)
print('todos os números do LEIA-ME batem com a fonte.')

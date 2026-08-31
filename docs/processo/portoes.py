# -*- coding: utf-8 -*-
"""portoes.py — o ciclo para quando estes portões fecham, não quando o backlog acaba.

    python3 docs/processo/portoes.py

PORTÃO 1 — FIDELIDADE e PORTÃO 2 — SOLIDEZ são medidos aqui, sozinhos.
PORTÃO 3 — MERCADO não é, e o script diz isso em vez de fingir um número:
ele precisa de gente de verdade usando, e nenhuma volta de agente substitui.
"""
import collections, json, os, re, subprocess, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
def caminho(p): return os.path.join(RAIZ, p)
def ler(p): return open(caminho(p), encoding='utf-8').read()

VERDE, AMARELO, VERMELHO = '\033[32m', '\033[33m', '\033[31m', 
FIM = '\033[0m'
def pinta(cor, t): return (cor + t + FIM) if sys.stdout.isatty() else t

resultados = []

def criterio(portao, nome, alcancado, meta, ok, obs=''):
    resultados.append({'portao': portao, 'nome': nome, 'alcancado': alcancado,
                       'meta': meta, 'ok': ok, 'obs': obs})
    marca = pinta(VERDE, 'fechado') if ok else pinta(AMARELO, 'aberto ')
    print('   %s  %-34s %-14s meta: %s' % (marca, nome, alcancado, meta))
    if obs: print('              %s' % obs)

# ------------------------------------------------------ portão 1: fidelidade
print('\nPORTÃO 1 — FIDELIDADE  (o app faz o que o original faz)')

prod = json.load(open(caminho('docs/kb/produto.json'), encoding='utf-8'))
c = collections.Counter(f['estado'] for f in prod['features'])
comparaveis = sum(c.values()) - c['fora-de-escopo']
paridade = 100 * c['completo'] / comparaveis
criterio(1, 'paridade de features', '%.0f%% (%d/%d)' % (paridade, c['completo'], comparaveis),
         '≥ 90%', paridade >= 90,
         'parcial conta como não-feito: %d parciais, %d ausentes' % (c['parcial'], c['ausente']))

back = json.load(open(caminho('docs/kb/backlog.json'), encoding='utf-8'))
# "entregue" e o que ja esta no ar. Sem esse filtro o portao contava para
# sempre os mesmos itens e nunca poderia fechar.
fid_abertos = [x for x in back['backlog']
               if x['tipo'] == 'fidelidade' and not x.get('entregue')]
criterio(1, 'itens de fidelidade em aberto', str(len(fid_abertos)), '0', len(fid_abertos) == 0,
         'o primeiro é: ' + (fid_abertos[0]['titulo'] if fid_abertos else '—'))

try:
    rastreio = json.load(open(caminho('docs/rastreio.json'), encoding='utf-8'))
    cob = [x for x in rastreio['cobertura'] if x['alcancada'] is not None]
    alc = [x for x in cob if x['alcancada']]
    criterio(1, 'telas do original alcançadas', '%d de %d' % (len(alc), len(cob)),
             'todas', len(alc) == len(cob))
except FileNotFoundError:
    criterio(1, 'telas do original alcançadas', 'sem medida', 'todas', False,
             'rode docs/rastreador.py primeiro')

# --------------------------------------------------------- portão 2: solidez
print('\nPORTÃO 2 — SOLIDEZ  (o que existe não quebra nem corrompe)')

SUITES = ['docs/testar.py', 'docs/testar_nuvem.py', 'docs/testar_social.py',
          'docs/jornada_e2e.py']
asser = sum(len(re.findall(r'^\s+(?:ok|checa)\(', ler(s), re.M)) for s in SUITES)
criterio(2, 'asserções nas suítes', str(asser), '≥ 200', asser >= 200)

try:
    rastreio = json.load(open(caminho('docs/rastreio.json'), encoding='utf-8'))
    altas = [a for a in rastreio['achados'] if a['gravidade'] == 'alta']
    criterio(2, 'achados graves do rastreador', str(len(altas)), '0', len(altas) == 0)
except FileNotFoundError:
    criterio(2, 'achados graves do rastreador', 'sem medida', '0', False)

import sys as _sys
_sys.path.insert(0, caminho('docs'))
import dados_teste as _dt
_com, _sem, _tela = _dt.cobertura()
criterio(2, 'defeitos de dado com caso de regressão',
         '%d de %d' % (len(_com), len(_com) + len(_sem)), 'todos', not _sem,
         'os outros %d não são alcançáveis por dado e estão listados um a um '
         'em dados_teste.SO_DE_TELA' % len(_tela))

# Os defeitos que corrompem dado sao os unicos que nao podem esperar volta
# nenhuma: o resto incomoda, este apaga o que a pessoa escreveu. Este criterio
# passava por decreto — um `True` fixo, que e criterio que nao pode falhar e
# portanto nao mede nada. Agora ele pergunta uma coisa verificavel: cada
# defeito de corrupcao tem um caso de regressao que o prende?
import csv as _csv
_defeitos = list(_csv.DictReader(open(caminho('docs/processo/defeitos.csv'),
                                      encoding='utf-8')))
# Coluna, nao palavra-chave. A lista de palavras ('duplic', 'orf') ja tinha
# errado duas vezes: pegou "apaguei o workflow do Pages", que e publicacao e
# nao dado, e DEIXOU PASSAR tres defeitos de corrupcao seguidos porque nenhum
# deles usava as palavras da lista. Adivinhar o significado pelo texto e
# exatamente o que a regra "meca, nao olhe" existe para nao fazer.
_corrompe = [d for d in _defeitos if d.get('corrompe') == 'sim']
# Preso = tem caso de regressao OU tem motivo escrito de por que dado nao
# alcanca ele. A segunda saida nao afrouxa a regra: exige uma frase, e um
# defeito de corrupcao NOVO sem nenhuma das duas abre o portao.
_soltos = [d['id'] for d in _corrompe
           if d['id'] not in _com and d['id'] not in _dt.SO_DE_TELA]
criterio(2, 'defeitos de corrupção presos',
         '%d de %d' % (len(_corrompe) - len(_soltos), len(_corrompe)), 'todos',
         not _soltos, 'sem caso e sem motivo: ' + (', '.join(_soltos) or 'nenhum'))

def rodar_provas():
    """Roda TODO servidor/provar*.sql contra o Postgres local.

    Antes, este critério só conferia se os arquivos EXISTIAM — um portão que
    não tinha como fechar em vermelho. E ele passou verde enquanto o provar.sql
    morria na linha 133 e metade do arquivo nunca era executada: `ON_ERROR_STOP`
    parava o psql e devolvia status diferente de zero, e nada no processo olhava
    esse status. Arquivo existir não é prova; prova é o arquivo rodar até o fim.

    Postgres fora do ar NÃO é "passou": é "não deu para medir", e não fecha.
    """
    arquivos = sorted(f for f in os.listdir(caminho('servidor'))
                      if re.match(r'provar.*\.sql$', f))
    if not arquivos:
        return False, 'nenhum provar*.sql', ''
    falhas, medidos = [], 0
    for f in arquivos:
        db = 'portao_' + re.sub(r'[^a-z0-9]', '_', f[:-4])
        def psql(args, entrada=None):
            return subprocess.run(
                ['su', 'postgres', '-c',
                 'cd %s && psql -h /tmp -p 5433 %s' % (caminho('servidor'), args)],
                capture_output=True, text=True, timeout=180)
        try:
            r = psql("-c 'drop database if exists %s' -c 'create database %s'" % (db, db))
            if r.returncode != 0:
                return False, 'não deu para medir', 'Postgres local fora do ar: ' + \
                    (r.stderr or r.stdout).strip().split('\n')[-1][:90]
            psql('-d %s -q -f supabase-de-mentira.sql' % db)
            # provar.sql supõe o esquema já carregado; os outros o carregam sozinhos
            if f == 'provar.sql':
                psql('-d %s -q -f esquema.sql' % db)
            r = psql('-d %s -q -f %s' % (db, f))
            medidos += 1
            if r.returncode != 0:
                ultima = [l for l in (r.stderr or '').split('\n') if 'ERROR' in l]
                falhas.append('%s: %s' % (f, (ultima[-1] if ultima else 'saiu %d' % r.returncode)[:70]))
            psql("-c 'drop database if exists %s'" % db)
        except Exception as e:
            return False, 'não deu para medir', str(e)[:90]
    if falhas:
        return False, '%d de %d falharam' % (len(falhas), medidos), '; '.join(falhas[:2])
    return True, '%d de %d passam' % (medidos, medidos), \
        'rodados de ponta a ponta, não só conferidos se existem'

_ok_prova, _quanto, _obs = rodar_provas()
criterio(2, 'RLS provado em Postgres real', _quanto, 'todos passam', _ok_prova, _obs)

# O ÚNICO critério que mede o PROCESSO, e não o produto.
#
# Ele existe por causa do D54/D55: as entregas V5 e V6 saíram sem um único
# papel da squad acionado, e ninguém percebeu. O motivo é estrutural — os
# agentes de .claude/agents só se registram quando a sessão abre NESTE
# diretório; numa sessão aberta noutra pasta, `Agent(subagent_type: "design")`
# falha com "not found" EM SILÊNCIO, e a squad inteira fica invisível.
#
# Nenhuma das outras medições veria isso: elas olham o app, e o app dos dois
# itens estava certo. O que faltou foi o caminho até ele. Um harness que
# verifica o produto e não verifica a si mesmo tem esse ponto cego por
# construção, e foi por ele que passaram duas entregas inteiras.
#
# A prova de que a squad rodou é o rastro que ela deixa: uma especificação de
# design em docs/kb/especificacoes.json ligada ao item pelo campo `item`.
# Rastro é medível; boa intenção não é.
espec = json.load(open(caminho('docs/kb/especificacoes.json'), encoding='utf-8'))
_com_espec = set(x.get('item') for x in espec)
_entregues = [it for it in back['backlog'] if it.get('entregue')]
_sem_espec = [it for it in _entregues if it.get('ordem') not in _com_espec]
criterio(2, 'entregas com a squad acionada',
         '%d de %d' % (len(_entregues) - len(_sem_espec), len(_entregues)),
         'todas', not _sem_espec,
         ('sem especificação de design: ' + ', '.join(
             '"%s"' % it['titulo'][:38] for it in _sem_espec))
         if _sem_espec else 'cada entrega deixou o rastro da especificação')

# ---------------------------------------------------------- portão 3: mercado
print('\nPORTÃO 3 — MERCADO  (não medível daqui — precisa de gente usando)')
MERCADO = [
 ('alguém que não seja você usa uma semana sem pedir ajuda',
  'é o teste de que a interface se explica sozinha'),
 ('10 pessoas se cadastram e 3 voltam na semana seguinte',
  'retenção da primeira semana; abaixo disso o feed nunca enche'),
 ('cobertura do acervo em português medida em 50 títulos',
  'é a entrega 1 do item 12 do backlog, e o proxy daqui bloqueia a medição'),
 ('alguém compartilha um link de resenha por vontade própria',
  'o link público existe desde o começo e ninguém nunca usou'),
]
for nome, porque in MERCADO:
    print('   %s  %s' % (pinta(AMARELO, 'humano '), nome))
    print('              %s' % porque)

# ------------------------------------------------------------------- resumo
p1 = [r for r in resultados if r['portao'] == 1]
p2 = [r for r in resultados if r['portao'] == 2]
f1, f2 = all(r['ok'] for r in p1), all(r['ok'] for r in p2)

print('\n' + '-' * 68)
print('Portão 1 (fidelidade): %s   ·   Portão 2 (solidez): %s' %
      (pinta(VERDE, 'FECHADO') if f1 else pinta(AMARELO, 'ABERTO'),
       pinta(VERDE, 'FECHADO') if f2 else pinta(AMARELO, 'ABERTO')))

if not f1 or not f2:
    print('\nO ciclo continua. Próxima volta: /ciclo, depois o primeiro item do plano.')
else:
    print('\nOs dois portões que o código fecha estão fechados.')
    print('O ciclo de FEATURE acabou. O que decide competitividade agora é o')
    print('portão 3, e ele não se fecha com mais volta de agente — se fecha com')
    print('gente usando. A partir daqui o ciclo muda de combustível: sai do')
    print('backlog e entra no que as pessoas fizerem com o app.')

sys.exit(0 if (f1 and f2) else 1)

# -*- coding: utf-8 -*-
"""testar_regressao.py — roda todo caso de docs/dados_teste.py.

As outras quatro suítes provam FLUXOS. Esta prova FORMAS DE DADO: o livro sem
capa, a leitura órfã, o perfil que só tem @, a resenha de 520 caracteres. Cada
caso carrega o número do defeito que o motivou, e no fim o relatório diz quanto
do registro de defeitos está travado — que é a única pergunta que uma suíte de
regressão precisa responder.

    python3 docs/testar_regressao.py            # todos
    python3 docs/testar_regressao.py histograma # só os que casam com o texto

Um caso NOVO não precisa de código aqui: precisa de um dicionário em
dados_teste.CASOS.
"""
import os, sys, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fixtures, dados_teste as D
import testar_social as S          # o Supabase de mentira mora lá
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8899/index.html'
filtro = sys.argv[1] if len(sys.argv) > 1 else ''
falhas = []


def montar_banco(caso):
    """Enche o BANCO do mock com o que o caso pede, e só com isso."""
    S.zerar(vazio=True)
    for tabela, linhas in (caso.get('banco') or {}).items():
        S.BANCO.setdefault(tabela, [])
        S.BANCO[tabela].extend([dict(x) for x in linhas])
    # o mock guarda as contas por e-mail para o /auth; sem isto, entrar de novo
    # dentro de um caso criaria um segundo perfil para a mesma pessoa
    S.BANCO['_contas'] = {p['usuario'] + '@exemplo.com': p['id']
                          for p in S.BANCO.get('perfis', [])}


def rodar_caso(pw, caso):
    print('\n%s' % caso['nome'])
    marca = ', '.join(caso['defeitos']) if caso['defeitos'] else 'precipício conhecido'
    print('  (%s)' % marca)

    montar_banco(caso)
    estado = {}
    nav, ctx, pg = S.montar(pw, estado)
    # O acervo vem do fixtures, não do stub vazio da suíte social: a ficha pede
    # a sinopse e os assuntos à Open Library, e é justamente isso que dois casos
    # daqui medem. Tem que ser pg.route e DEPOIS do S.montar: rota de página
    # ganha de rota de contexto, e a última registrada ganha das anteriores.
    # Com ctx.route o stub vazio vencia em silêncio e o caso de assuntos sujos
    # media o localStorage semeado em vez do que a API devolve.
    pg.route('**openlibrary.org/**', fixtures.responder)
    if caso.get('largura'):
        pg.set_viewport_size({'width': caso['largura'], 'height': 844})

    estouros = []
    pg.on('pageerror', lambda e: estouros.append(str(e)[:160]))

    try:
        pg.goto(BASE, wait_until='networkidle')
        pg.evaluate("""(d) => {
          localStorage.clear();
          if (d.diario) localStorage.setItem('letterbooks:v1', JSON.stringify(d.diario));
          if (d.sessao) localStorage.setItem('letterbooks:sessao', JSON.stringify(d.sessao));
        }""", {'diario': caso.get('diario'),
               'sessao': D.sessao(caso['sessao']) if caso.get('sessao') else None})

        # Recarregar ANTES de navegar, nunca depois: telaLivro chama
        # Dados.guardarLivro, que grava o estado em memória — ainda vazio — por
        # cima do que acabou de ser semeado. (D36.)
        pg.reload(wait_until='networkidle')
        partes = caso['rota'].split('/', 2)
        alvo = '#/' + partes[1]
        if len(partes) > 2:
            alvo += '/' + urllib.parse.quote(partes[2], safe='')
        pg.goto(BASE + alvo, wait_until='networkidle')
        pg.wait_for_selector(caso['esperar'], timeout=15000)
        pg.wait_for_timeout(500)

        for nome, js in caso['checagens']:
            try:
                passou = pg.evaluate('() => !!(' + js + ')')
                detalhe = ''
            except Exception as e:
                passou, detalhe = False, str(e).split('\n')[0][:110]
            print(('  ok   ' if passou else '  FALHA ') + nome +
                  ((' — ' + detalhe) if detalhe else ''))
            if not passou:
                falhas.append('%s: %s' % (caso['nome'], nome))

        for nome, prova in caso.get('checagens_banco') or []:
            try:
                passou = bool(prova(S.BANCO))
                detalhe = ''
            except Exception as e:
                passou, detalhe = False, str(e)[:110]
            print(('  ok   ' if passou else '  FALHA ') + nome +
                  ((' — ' + detalhe) if detalhe else ''))
            if not passou:
                falhas.append('%s: %s' % (caso['nome'], nome))

        if caso.get('sem_estouro') or True:
            # Vale para TODO caso: exceção no callback de sucesso de um Promise
            # não aparece na tela, a página só para de responder. É de graça
            # medir, e foi assim que D25 passou despercebido.
            ok = not estouros
            print(('  ok   ' if ok else '  FALHA ') + 'nenhum estouro de javascript' +
                  ('' if ok else ' — ' + '; '.join(estouros[:2])))
            if not ok:
                falhas.append('%s: estouro de javascript' % caso['nome'])
    finally:
        nav.close()


with sync_playwright() as pw:
    escolhidos = [c for c in D.CASOS if filtro in c['nome']]
    if not escolhidos:
        print('nenhum caso casa com %r' % filtro)
        sys.exit(1)
    print('%d caso(s)' % len(escolhidos))
    for caso in escolhidos:
        rodar_caso(pw, caso)

print('\n' + '-' * 62)
com, sem, tela = D.cobertura()
total = len(com) + len(sem) + len(tela)
print('cobertura do registro de defeitos: %d de %d têm caso de regressão'
      % (len(com), total))
print('  %d não alcançáveis por dado (layout, CSS, mock, processo) — SO_DE_TELA'
      % len(tela))
if sem:
    print('  %d SEM caso e SEM motivo escrito: %s' % (len(sem), ', '.join(sem)))
    print('  → ou escreva o caso, ou registre o porquê em dados_teste.SO_DE_TELA')

if falhas:
    print('\n%d falha(s):' % len(falhas))
    for f in falhas:
        print('  · ' + f)
    sys.exit(1)
if sem:
    sys.exit(1)
print('\ntodos os casos de regressão passam')

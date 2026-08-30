# -*- coding: utf-8 -*-
"""A camada social contra um Supabase de mentira.

O que importa aqui nao e "a tela desenha": e que NADA se perca. O diario e da
pessoa; se a rede cair no meio de um envio, a leitura tem que continuar no
aparelho e voltar para a fila, nao sumir.
"""
import os, sys, json, time, urllib.parse
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8899/index.html'
NUVEM = 'https://nuvem.teste'
proxy = os.environ.get('HTTPS_PROXY')
erros = []
pedidos = []

SESSAO = {'token': 'tok', 'atualizar': 'ref',
          'expiraEm': int((time.time() + 3600) * 1000),
          'id': 'uid-1', 'email': 'marcela@exemplo.com'}

BANCO = {}   # tabela -> lista de linhas


def zerar(vazio=False):
    del pedidos[:]
    BANCO.clear()
    BANCO.update({'livros': [], 'leituras': [], 'marcadores': [], 'seguidores': [],
                  'curtidas': [], 'comentarios': [], '_contas': {}, 'perfis': [] if vazio else [
                      {'id': 'uid-1', 'usuario': 'marcela', 'nome': 'Marcela', 'bio': '', 'local': ''},
                      {'id': 'uid-2', 'usuario': 'bia', 'nome': 'Bia', 'bio': 'leio de tudo',
                       'local': 'Recife'}]})


def servir(rota, estado):
    r = rota.request
    p = urlparse(r.url); q = parse_qs(p.query)
    corpo = None
    try: corpo = json.loads(r.post_data) if r.post_data else None
    except Exception: pass
    pedidos.append((r.method, p.path, p.query, corpo))
    cab = {'access-control-allow-origin': '*'}

    def j(o, st=200):
        rota.fulfill(status=st, content_type='application/json', headers=cab, body=json.dumps(o))

    if estado.get('cair'):
        return rota.abort()          # rede fora

    if p.path.startswith('/auth/'):
        if p.path.endswith('/logout'):
            return rota.fulfill(status=204, headers=cab, body='')
        email = (corpo or {}).get('email') or 'marcela@exemplo.com'
        contas = BANCO.setdefault('_contas', {})
        if email not in contas:
            contas[email] = 'uid-%d' % (len(contas) + 1)
            # o gatilho ao_cadastrar: perfil nasce junto com a conta, com o @
            # tirado do e-mail e sufixo se ja estiver tomado
            base = email.split('@')[0].lower()
            usuario, n = base, 0
            while any(x['usuario'] == usuario for x in BANCO['perfis']):
                n += 1; usuario = base + str(n)
            BANCO['perfis'].append({'id': contas[email], 'usuario': usuario,
                                    'nome': (corpo or {}).get('data', {}).get('nome') or usuario,
                                    'bio': '', 'local': ''})
        uid = contas[email]
        return j({'access_token': 'tok-' + uid, 'refresh_token': 'ref-' + uid,
                  'expires_in': 3600, 'user': {'id': uid, 'email': email}})

    aut = r.headers.get('authorization', '')
    estado['quem'] = aut.replace('Bearer tok-', '') if 'tok-' in aut else None

    tab = p.path.rsplit('/', 1)[-1]
    linhas = BANCO.setdefault(tab, [])

    if r.method == 'GET':
        if tab == 'feed':
            saida = []
            for l in BANCO['leituras']:
                pf = next((x for x in BANCO['perfis'] if x['id'] == l['perfil']), {})
                lv = next((x for x in BANCO['livros'] if x['chave'] == l['livro']), {})
                saida.append(dict(l, usuario=pf.get('usuario'), perfil_nome=pf.get('nome'),
                                  titulo=lv.get('titulo', '?'), autores=lv.get('autores', []),
                                  ano=lv.get('ano'), capa=lv.get('capa'),
                                  curtidas=len([c for c in BANCO['curtidas'] if c['leitura'] == l['id']]),
                                  comentarios=len([c for c in BANCO['comentarios'] if c['leitura'] == l['id']])))
            if 'usuario' in q:
                alvo = q['usuario'][0].split('.', 1)[1]
                saida = [x for x in saida if x['usuario'] == alvo]
            if 'id' in q:
                alvo = q['id'][0].split('.', 1)[1]
                saida = [x for x in saida if x['id'] == alvo]
            if 'perfil' in q and q['perfil'][0].startswith('in.'):
                dentro = q['perfil'][0][4:-1].replace('"', '').split(',')
                saida = [x for x in saida if x['perfil'] in dentro]
            # A ficha do livro filtra por livro=eq.<chave>. Este ramo ignorava
            # qualquer filtro que não fosse usuario/id/perfil e devolvia a
            # tabela INTEIRA — o teste passaria verde mostrando o histograma de
            # todos os livros do acervo como se fosse o daquele livro. É a
            # quarta vez que este mock precisa aprender um filtro antes de o
            # teste valer alguma coisa.
            if 'livro' in q and q['livro'][0].startswith('eq.'):
                alvo = urllib.parse.unquote(q['livro'][0][3:])
                saida = [x for x in saida if x['livro'] == alvo]
            return j(saida)
        saida = linhas
        for campo, v in q.items():
            if campo in ('select', 'order', 'limit', 'offset', 'or'): continue
            if v[0].startswith('eq.'):
                alvo = v[0][3:]
                saida = [x for x in saida if str(x.get(campo)) == alvo]
            elif v[0].startswith('in.'):
                # o mock ignorava "in.(...)" e devolvia a tabela inteira. Isso
                # fez um teste ACUSAR o app de listar gente demais quando o
                # pedido dele estava certo — mock frouxo mente nos dois sentidos.
                dentro = [x.strip('"') for x in v[0][4:-1].split(',') if x]
                saida = [x for x in saida if str(x.get(campo)) in dentro]
        if tab == 'comentarios':
            saida = [dict(x, perfis={'usuario': 'bia', 'nome': 'Bia'}) for x in saida]
        return j(saida)

    if r.method == 'POST':
        novas = corpo if isinstance(corpo, list) else [corpo]
        prefer = r.headers.get('prefer', '')
        # on_conflect + merge-duplicates: mandar o mesmo item duas vezes tem que
        # ATUALIZAR, não criar outra linha. O mock ignorava isso, e então o
        # teste passaria verde enquanto a produção duplicava o diário. Foi
        # exatamente o aviso do tech lead, e é a segunda vez que mock frouxo
        # quase deixa passar defeito neste projeto.
        conflito = q.get('on_conflict', [None])[0]
        criadas = []
        for n in novas:
            n = dict(n)
            if conflito and 'merge-duplicates' in prefer:
                campos = conflito.split(',')
                igual = next((x for x in linhas
                              if all(x.get(c) == n.get(c) for c in campos)), None)
                if igual:
                    igual.update(n)
                    criadas.append(igual)
                    continue
            if tab == 'livros':
                linhas[:] = [x for x in linhas if x['chave'] != n['chave']]
            if tab in ('marcadores', 'curtidas', 'seguidores') and 'ignore-duplicates' in prefer:
                iguais = [x for x in linhas if all(x.get(k) == n.get(k) for k in n if k != 'criado_em')]
                if iguais: continue
            if 'id' not in n:
                n['id'] = '%s-%d' % (tab, len(linhas) + 1)
            n.setdefault('criado_em', '2026-08-30T00:00:00Z')
            linhas.append(n); criadas.append(n)
        return j(criadas if 'representation' in prefer else [], 201)

    if r.method == 'PATCH':
        alvo = q.get('id', ['eq.'])[0][3:]
        achou = [x for x in linhas if x.get('id') == alvo]
        for x in achou: x.update(corpo)
        return j(achou)

    if r.method == 'DELETE':
        antes = len(linhas)
        def bate(x):
            for campo, v in q.items():
                if not v[0].startswith('eq.'): continue
                if str(x.get(campo)) != v[0][3:]: return False
            return True
        linhas[:] = [x for x in linhas if not bate(x)]
        return rota.fulfill(status=204, headers=cab, body='')

    return j({}, 400)


def conf_js():
    return "var CONFIG = { supabaseUrl: '%s', supabaseChave: 'x.eyJyb2xlIjoiYW5vbiJ9.y' };" % NUVEM


def montar(pw, estado):
    nav = pw.chromium.launch(
        executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        proxy={'server': proxy, 'bypass': '127.0.0.1,localhost'} if proxy else None)
    ctx = nav.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
    pg = ctx.new_page()
    pg.route('**/js/config.js', lambda rt: rt.fulfill(
        status=200, content_type='application/javascript', body=conf_js()))
    pg.route(NUVEM + '/**', lambda rt: servir(rt, estado))
    pg.route('**openlibrary.org/**', lambda rt: rt.fulfill(
        status=200, content_type='application/json',
        headers={'access-control-allow-origin': '*'},
        body='{"works":[],"docs":[],"numFound":0}'))
    return nav, ctx, pg


def checa(nome, cond, det=''):
    print(('  ok   ' if cond else '  FALHA ') + nome + ((' — ' + det) if det else ''))
    if not cond: erros.append(nome + ' ' + det)


LIVRO = {'chave': '/works/OL1W', 'titulo': 'Dom Casmurro',
         'autores': ['Machado de Assis'], 'ano': 1899, 'capa': 'c.jpg', 'paginas': 256}


def semear(pg, logs=None, sessao=SESSAO):
    pg.evaluate("""(d) => {
      localStorage.clear();
      localStorage.setItem('letterbooks:v1', JSON.stringify({
        versao:1, perfil:{nome:'Marcela',bio:'',meta:{ano:2026,total:12}},
        livros:{'/works/OL1W': d.livro}, logs: d.logs||[],
        querLer:[], curtidas:[], favoritos:[], listas:[], buscas:[]}));
      if (d.sessao) localStorage.setItem('letterbooks:sessao', JSON.stringify(d.sessao));
    }""", {'livro': LIVRO, 'logs': logs or [], 'sessao': sessao})


def rodar():
    with sync_playwright() as pw:

        # ============================================ sincronizacao ==========
        print('\nsincronizacao: registrar sobe para o banco')
        zerar(); estado = {}
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.goto(BASE + '#/livro/' + '%2Fworks%2FOL1W', wait_until='networkidle')
        pg.reload(wait_until='networkidle')
        pg.wait_for_selector('[data-acao=rapida]', timeout=15000)
        pg.click('[data-acao=rapida]')
        pg.wait_for_selector('.folha-rapida .seletor-estrelas [data-pos="4"]')
        pg.click('.folha-rapida .seletor-estrelas [data-pos="4"]')
        pg.wait_for_timeout(1500)

        # A ordem que importa e a de ESCRITA: o livro tem que existir no acervo
        # antes da leitura apontar para ele, senao a chave estrangeira recusa.
        # A assercao olhava todos os pedidos, e passou a ver os GETs da descida
        # antes dos POSTs da subida — media a coisa certa pelo caminho errado.
        escritas = [p[1] for p in pedidos if p[0] == 'POST']
        checa('o livro subiu antes da leitura',
              escritas.index('/rest/v1/livros') < escritas.index('/rest/v1/leituras'),
              str(escritas))
        checa('a leitura chegou ao banco', len(BANCO['leituras']) == 1)
        checa('com a nota certa', BANCO['leituras'] and BANCO['leituras'][0]['nota'] == 4)
        local = pg.evaluate("JSON.parse(localStorage.getItem('letterbooks:v1')).logs")
        checa('e continua no aparelho', len(local) == 1)
        checa('com o id do servidor amarrado', local[0].get('remoto') == 'leituras-1',
              str(local[0].get('remoto')))
        checa('a fila esvaziou',
              json.loads(pg.evaluate("localStorage.getItem('letterbooks:fila')")) == [])

        print('\nsincronizacao: editar corrige, nao duplica')
        pg.click('.folha-rapida .seletor-estrelas [data-pos="5"]')
        pg.wait_for_timeout(1200)
        checa('continua UMA leitura no banco', len(BANCO['leituras']) == 1,
              '%d linhas' % len(BANCO['leituras']))
        checa('com a nota nova', BANCO['leituras'][0]['nota'] == 5)
        nav.close()

        # ============================================ rede caindo ============
        print('\nrede cai no meio: nada se perde')
        zerar(); estado = {'cair': True}
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.goto(BASE + '#/livro/' + '%2Fworks%2FOL1W', wait_until='networkidle')
        pg.reload(wait_until='networkidle')
        pg.wait_for_selector('[data-acao=rapida]', timeout=15000)
        pg.click('[data-acao=rapida]')
        pg.wait_for_selector('.folha-rapida .seletor-estrelas [data-pos="3"]')
        pg.click('.folha-rapida .seletor-estrelas [data-pos="3"]')
        pg.wait_for_timeout(1800)

        local = pg.evaluate("JSON.parse(localStorage.getItem('letterbooks:v1')).logs")
        checa('a leitura ficou no aparelho mesmo sem rede', len(local) == 1)
        checa('com a nota que a pessoa deu', local[0]['nota'] == 3)
        fila = json.loads(pg.evaluate("localStorage.getItem('letterbooks:fila')"))
        checa('e esperando na fila', len(fila) == 1 and fila[0]['tipo'] == 'leitura',
              str(fila))
        checa('nada chegou ao banco', len(BANCO['leituras']) == 0)

        print('\nrede volta: a fila esvazia sozinha')
        estado['cair'] = False
        pg.evaluate("window.dispatchEvent(new Event('online'))")
        pg.wait_for_timeout(1800)
        checa('agora a leitura chegou', len(BANCO['leituras']) == 1)
        checa('a fila zerou',
              json.loads(pg.evaluate("localStorage.getItem('letterbooks:fila')")) == [])
        checa('sem duplicar no aparelho',
              len(pg.evaluate("JSON.parse(localStorage.getItem('letterbooks:v1')).logs")) == 1)
        nav.close()

        # ============================================ a fila sobrevive =======
        print('\na fila sobrevive a fechar o app')
        zerar(); estado = {'cair': True}
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.evaluate("""() => {
          localStorage.setItem('letterbooks:fila', JSON.stringify([
            {tipo:'leitura', dado:{id:'a'}, tentativas:0, em:Date.now()}]));
          const d = JSON.parse(localStorage.getItem('letterbooks:v1'));
          d.logs = [{id:'a', chave:'/works/OL1W', nota:4.5, resenha:'guardada offline',
                     lidoEm:'2026-08-30', relido:false, spoiler:false,
                     criadoEm:'2026-08-30T00:00:00Z'}];
          localStorage.setItem('letterbooks:v1', JSON.stringify(d));
        }""")
        estado['cair'] = False
        pg.goto(BASE + '#/inicio', wait_until='networkidle')
        pg.reload(wait_until='networkidle')
        pg.wait_for_timeout(2000)
        checa('o que ficou da sessao anterior subiu ao abrir', len(BANCO['leituras']) == 1)
        checa('com a resenha inteira',
              BANCO['leituras'] and BANCO['leituras'][0]['resenha'] == 'guardada offline')
        nav.close()

        # ============================================ atividade ==============
        print('\naba de atividade')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        BANCO['leituras'].append({'id': 'L1', 'perfil': 'uid-2', 'livro': '/works/OL1W',
                                  'nota': 4.5, 'resenha': 'Capitu me pegou.',
                                  'lido_em': '2026-08-28', 'relido': False, 'spoiler': False,
                                  'criado_em': '2026-08-29T22:00:00Z'})
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.goto(BASE + '#/atividade/todos', wait_until='networkidle')
        pg.reload(wait_until='networkidle')
        pg.wait_for_selector('.feed-linha', timeout=10000)
        checa('a leitura da Bia aparece no feed', pg.locator('.feed-linha').count() == 1)
        frase = pg.inner_text('.feed-frase')
        checa('a frase diz quem, o que e a nota',
              'Bia' in frase and 'Dom Casmurro' in frase and '★' in frase, frase)
        checa('a resenha aparece', 'Capitu' in pg.inner_text('.feed-resenha'))

        print('\ncurtir')
        pg.click('[data-acao=curtir-leitura]')
        pg.wait_for_timeout(900)
        checa('a curtida foi para o banco', len(BANCO['curtidas']) == 1)
        checa('o coracao acendeu na hora',
              pg.locator('.feed-curtir').first.get_attribute('aria-pressed') == 'true')
        checa('e a conta subiu', pg.inner_text('.conta-curtidas').strip() == '1')
        pg.click('[data-acao=curtir-leitura]')
        pg.wait_for_timeout(900)
        checa('descurtir tira do banco', len(BANCO['curtidas']) == 0)
        checa('e a conta volta', pg.inner_text('.conta-curtidas').strip() == '0')

        print('\nseguir e o perfil de outra pessoa')
        pg.goto(BASE + '#/leitor/bia', wait_until='networkidle')
        pg.wait_for_selector('#botao-seguir:not([disabled])', timeout=10000)
        checa('abriu o perfil da Bia', 'Bia' in pg.inner_text('.perfil-nome'))
        checa('mostra o @ e o lugar', '@bia' in pg.inner_text('.perfil-bio'))
        # inner_text respeita o text-transform do CSS, e .botao e caixa alta:
        # o texto volta "SEGUIR". Compara sem ligar para a caixa.
        # As contagens sao <span> (nao levam a lugar nenhum). Ja saíram uma vez
        # sem formatacao nenhuma, coladas num texto so — "Leituras2Seguidores0".
        pg.wait_for_selector('#leitor-numeros > *', timeout=8000)
        alt = pg.eval_on_selector('#leitor-numeros > *', 'e => e.getBoundingClientRect().height')
        checa('as contagens viram linhas de verdade (%.0fpx)' % alt, alt > 30)
        checa('com rotulo e valor separados',
              pg.locator('#leitor-numeros .valor').count() == 3)

        checa('o botao comeca em "Seguir"',
              pg.inner_text('#botao-seguir').strip().lower() == 'seguir',
              pg.inner_text('#botao-seguir'))
        pg.click('#botao-seguir')
        pg.wait_for_function(
            "() => /seguindo/i.test(document.getElementById('botao-seguir').textContent)",
            timeout=8000)
        checa('seguir gravou no banco', len(BANCO['seguidores']) == 1)

        print('\nagora "Seguindo" mostra a leitura dela')
        pg.goto(BASE + '#/atividade/seguindo', wait_until='networkidle')
        pg.wait_for_selector('.feed-linha', timeout=10000)
        checa('o feed de quem eu sigo traz a Bia', pg.locator('.feed-linha').count() == 1)
        pg.click('#botao-seguir') if pg.locator('#botao-seguir').count() else None

        print('\nprocurar leitores')
        pg.goto(BASE + '#/buscar/bia/1/leitores', wait_until='networkidle')
        pg.wait_for_selector('.resultado', timeout=10000)
        checa('achou a Bia', pg.locator('.resultado').count() == 1)
        checa('mostra o @ e a bio', '@bia' in pg.inner_text('.resultado-texto span'))
        checa('a pilula de leitores existe',
              pg.locator('.escopos a').count() == 3)
        checa('nao me lista para mim mesma',
              'Marcela' not in pg.inner_text('.resultados'))
        pg.click('.resultado')
        pg.wait_for_selector('.perfil-nome', timeout=10000)
        checa('e leva ao perfil dela', 'Bia' in pg.inner_text('.perfil-nome'))

        print('\ncomentar')
        pg.goto(BASE + '#/leitura/L1', wait_until='networkidle')
        pg.wait_for_selector('#campo-comentario', timeout=10000)
        checa('a pagina da leitura abre', 'Dom Casmurro' in pg.inner_text('.resenha h1'))
        pg.fill('#campo-comentario', 'Também achei.')
        pg.click('#forma-comentario button[type=submit]')
        pg.wait_for_timeout(900)
        checa('o comentario foi para o banco', len(BANCO['comentarios']) == 1)
        checa('e apareceu na tela sem recarregar',
              'Também achei.' in pg.inner_text('#comentarios'))
        nav.close()

        # ====================== a comunidade na ficha do livro ===============
        # O defeito que este bloco tranca: a ficha desenhava Dados.estatisticas()
        # — as notas da PROPRIA leitora, de todos os livros — sob o rotulo
        # "Avaliacoes", igual em toda ficha do acervo. A nota local dela aqui e
        # 2,0 de proposito, e a comunidade da 4,0: sao numeros que nao podem ser
        # confundidos um com o outro.
        print('\nficha do livro: as notas sao do LIVRO, nao da leitora')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        BANCO['livros'].append({'chave': '/works/OL2W', 'titulo': 'A Hora da Estrela',
                                'autores': ['Clarice Lispector'], 'ano': 1977})
        BANCO['perfis'].append({'id': 'uid-3', 'usuario': 'ana', 'nome': 'Ana Prado',
                                'bio': '', 'local': ''})
        BANCO['perfis'].append({'id': 'uid-4', 'usuario': 'rui', 'nome': 'Rui', 'bio': '', 'local': ''})
        # tres leituras DESTE livro: 5,0 + 4,0 + 3,0 = media 4,0
        BANCO['leituras'] += [
            {'id': 'L1', 'perfil': 'uid-2', 'livro': '/works/OL1W', 'nota': 5.0,
             'resenha': 'Capitu me pegou.', 'lido_em': '2026-08-20', 'relido': False,
             'spoiler': False, 'criado_em': '2026-08-29T22:00:00Z'},
            {'id': 'L2', 'perfil': 'uid-3', 'livro': '/works/OL1W', 'nota': 4.0,
             'resenha': 'O narrador nao merece confianca.', 'lido_em': '2026-08-21',
             'relido': False, 'spoiler': False, 'criado_em': '2026-08-28T22:00:00Z'},
            {'id': 'L3', 'perfil': 'uid-4', 'livro': '/works/OL1W', 'nota': 3.0,
             'resenha': 'Nao terminei convencido.', 'lido_em': '2026-08-22', 'relido': False,
             'spoiler': False, 'criado_em': '2026-08-27T22:00:00Z'},
            # resenha SEM nota: entra na lista de resenhas e nao entra na media
            {'id': 'L5', 'perfil': 'uid-3', 'livro': '/works/OL1W', 'nota': None,
             'resenha': 'Reli sem avaliar.', 'lido_em': '2026-08-24', 'relido': True,
             'spoiler': False, 'criado_em': '2026-08-25T22:00:00Z'},
            # de OUTRO livro, com nota que destoa: se vazar, a media muda
            {'id': 'L4', 'perfil': 'uid-2', 'livro': '/works/OL2W', 'nota': 1.0,
             'resenha': '', 'lido_em': '2026-08-23', 'relido': False,
             'spoiler': False, 'criado_em': '2026-08-26T22:00:00Z'}]
        BANCO['seguidores'].append({'seguidor': 'uid-1', 'seguido': 'uid-2'})

        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg, logs=[{'id': 'meu', 'chave': '/works/OL1W', 'nota': 2.0, 'resenha': '',
                          'lidoEm': '2026-08-01', 'relido': False, 'spoiler': False,
                          'criadoEm': '2026-08-01T10:00:00Z'}])
        # Recarregar ANTES de abrir a ficha, e nao depois: telaLivro chama
        # Dados.guardarLivro, que grava o estado em memoria — ainda vazio —
        # por cima do localStorage recem-semeado, e a nota local sumiria.
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/livro/' + urllib.parse.quote('/works/OL1W', safe=''),
                wait_until='networkidle')
        pg.wait_for_selector('.avaliacoes-media', timeout=10000)

        media = pg.inner_text('.avaliacoes-media').strip()
        checa('a media e a da COMUNIDADE (5+4+3)/3 = 4,0, nao a nota 2,0 dela',
              media == '4,0', media)
        checa('tres colunas preenchidas, uma por avaliacao',
              pg.locator('.avaliacoes .histograma .col.tem').count() == 3)
        titulo = pg.locator('.avaliacoes .histograma .col.tem').first.get_attribute('title')
        checa('o title conta avaliacoes, nao livros',
              'avalia' in titulo and 'livro' not in titulo, titulo)
        # A marca .minha: 2,0 e a quarta faixa (0,5 1,0 1,5 2,0)
        idx = pg.evaluate("() => [...document.querySelectorAll('.avaliacoes .histograma .col')]"
                          ".findIndex(c => c.classList.contains('minha'))")
        checa('a sua nota fica marcada dentro da distribuicao, na faixa de 2,0',
              idx == 3, 'indice %s' % idx)
        checa('e o eixo diz o que a marca significa',
              'sua nota' in pg.inner_text('.histograma-eixo'))
        # o pedido saiu filtrado — sem isso o mock devolveria a tabela inteira
        pedido = [x for x in pedidos if x[1].endswith('/feed') and 'livro=eq.' in x[2]]
        checa('a consulta foi filtrada por livro no servidor', len(pedido) >= 1)

        checa('quem voce segue e leu aparece',
              pg.locator('.resultado').count() == 1)
        checa('e e a Bia, a unica que a Marcela segue',
              'Bia' in pg.inner_text('.resultado-texto'))
        checa('a ficha abre com tres resenhas, nao com as quatro',
              pg.locator('.avaliacoes ~ .secao .feed-linha').count() == 3)
        checa('a resenha leva para a pagina dela',
              pg.locator('a.feed-resenha').first.get_attribute('href') == '#/leitura/L1')
        checa('e ha o botao de ver mais', pg.locator('.rede-mais').count() == 1)
        antes_mais = len([x for x in pedidos if 'livro=eq.' in x[2]])
        pg.click('.rede-mais')
        pg.wait_for_timeout(400)
        checa('ver mais mostra a quarta',
              pg.locator('.avaliacoes ~ .secao .feed-linha').count() == 4)
        checa('sem ir ao servidor de novo — as linhas ja estavam em maos',
              len([x for x in pedidos if 'livro=eq.' in x[2]]) == antes_mais)
        checa('o sumico do botao e o sinal de fim', pg.locator('.rede-mais').count() == 0)
        checa('a resenha sem nota tambem tem lugar',
              'Reli sem avaliar' in pg.inner_text('#livro-rede'))
        checa('e a media continua sendo a das TRES notas',
              pg.inner_text('.avaliacoes-media').strip() == '4,0')
        # A linha nao repete o titulo do livro: o livro E a pagina.
        frase = pg.inner_text('.feed-frase')
        checa('a frase nao repete o titulo do livro', 'Dom Casmurro' not in frase, frase)

        # O outro livro tem a media DELE, nao a deste.
        pg.goto(BASE + '#/livro/' + urllib.parse.quote('/works/OL2W', safe=''),
                wait_until='networkidle')
        pg.wait_for_selector('.avaliacoes-media', timeout=10000)
        m2 = pg.inner_text('.avaliacoes-media').strip()
        checa('o outro livro mostra a media dele (1,0), nao a do anterior', m2 == '1,0', m2)
        checa('e nenhuma marca de nota sua, que nele nao existe',
              pg.locator('.avaliacoes .histograma .col.minha').count() == 0)

        # Repintura: tocar no coracao redesenha a ficha inteira. As linhas ja em
        # maos tem que voltar sem UMA requisicao nova — senao cada toque bate no
        # servidor e a lista de resenhas pisca.
        pg.goto(BASE + '#/livro/' + urllib.parse.quote('/works/OL1W', safe=''),
                wait_until='networkidle')
        pg.wait_for_selector('.avaliacoes-media', timeout=10000)
        antes = len([x for x in pedidos if 'livro=eq.' in x[2]])
        pg.set_viewport_size({'width': 1180, 'height': 900})   # o ♥ vive no painel
        pg.click('[data-acao=curtir]')
        pg.wait_for_timeout(700)
        depois = len([x for x in pedidos if 'livro=eq.' in x[2]])
        checa('curtir o livro nao refaz a consulta da comunidade',
              depois == antes, '%d -> %d' % (antes, depois))
        checa('e a media continua na tela depois da repintura',
              pg.inner_text('.avaliacoes-media').strip() == '4,0')
        checa('as resenhas tambem sobrevivem ao toque',
              pg.locator('.avaliacoes ~ .secao .feed-linha').count() == 3)
        nav.close()

        # Sem conta o histograma TEM que aparecer: e a parte da ficha que existe
        # justamente para quem ainda nao tem conta. Se as duas consultas fossem
        # um Promise.all, quemEuSigo (que rejeita sem sessao) derrubaria as duas.
        print('\nficha do livro sem conta: o histograma continua, a rede nao')
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg, logs=[{'id': 'meu', 'chave': '/works/OL1W', 'nota': 2.0, 'resenha': '',
                          'lidoEm': '2026-08-01', 'relido': False, 'spoiler': False,
                          'criadoEm': '2026-08-01T10:00:00Z'}], sessao=None)
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/livro/' + urllib.parse.quote('/works/OL1W', safe=''),
                wait_until='networkidle')
        pg.wait_for_selector('.avaliacoes-media', timeout=10000)
        checa('sem conta, a media da comunidade aparece igual',
              pg.inner_text('.avaliacoes-media').strip() == '4,0')
        checa('mas nao ha secao de quem voce segue', pg.locator('.resultado').count() == 0)
        checa('e o app avisa que a nota local nao entra na media',
              'so neste aparelho' in pg.inner_text('.fila-aviso')
              .replace('só', 'so').replace('ó', 'o'),
              pg.inner_text('.avaliacoes'))
        nav.close()

        # ============================================ sem conta =============
        print('\nquem chega sem conta')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        BANCO['leituras'].append({'id': 'L1', 'perfil': 'uid-2', 'livro': '/works/OL1W',
                                  'nota': 4.0, 'resenha': 'boa', 'lido_em': '2026-08-28',
                                  'relido': False, 'spoiler': False,
                                  'criado_em': '2026-08-29T22:00:00Z'})
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg, sessao=None)
        pg.goto(BASE + '#/leitor/bia', wait_until='networkidle')
        pg.reload(wait_until='networkidle')
        pg.wait_for_selector('.perfil-nome', timeout=10000)
        checa('o perfil publico abre sem conta', 'Bia' in pg.inner_text('.perfil-nome'))
        checa('sem botao de seguir', pg.locator('#botao-seguir').count() == 0)
        pg.goto(BASE + '#/leitura/L1', wait_until='networkidle')
        pg.wait_for_selector('.resenha', timeout=10000)
        checa('a leitura abre sem conta', 'Dom Casmurro' in pg.inner_text('.resenha h1'))
        checa('e convida a entrar para comentar',
              pg.locator('#forma-comentario').count() == 0 and
              'Entre na sua conta' in pg.inner_text('.secao'))
        pg.goto(BASE + '#/atividade', wait_until='networkidle')
        pg.wait_for_selector('.conta', timeout=8000)
        checa('a aba de atividade explica que precisa de conta',
              'Entre na sua conta' in pg.inner_text('.conta'))

        # O visitante que abre um link recebido tomava TypeError: ligarCurtidas
        # lia Nuvem.quemSou().id, que e null sem sessao — e a excecao nascia
        # DENTRO do callback de sucesso, onde o tratamento de erro do Promise
        # nao alcanca. Erro assim nao aparece na tela: a pagina so para.
        estouros = []
        pg.on('pageerror', lambda e: estouros.append(str(e)[:160]))
        pg.goto(BASE + '#/leitura/L1', wait_until='networkidle')
        pg.wait_for_selector('.resenha', timeout=10000)
        pg.wait_for_timeout(900)
        checa('sem conta, abrir uma leitura nao estoura javascript',
              not estouros, '; '.join(estouros[:2]))
        nav.close()

    print('\n' + '-' * 60)
    if erros:
        print('%d falha(s):' % len(erros))
        for e in erros: print('  · ' + e)
        sys.exit(1)
    print('tudo passou')


if __name__ == '__main__':
    rodar()

# -*- coding: utf-8 -*-
"""Testa a camada de conta contra um Supabase de mentira.

O container nao alcanca supabase.com — nenhum servidor externo, alias. Entao o
mock aqui NAO e conveniencia: e o unico jeito de exercitar este codigo antes de
ela ligar a chave. O que ele imita e o contrato: os caminhos do GoTrue e do
PostgREST, os cabecalhos Prefer, os codigos de erro. O que ele nao pode provar e
que o contrato esta certo — isso so a primeira conta de verdade diz.
"""
import os, sys, json, time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8899/index.html'
NUVEM = 'https://nuvem.teste'
proxy = os.environ.get('HTTPS_PROXY')
erros = []

TOKEN = {'n': 0}
pedidos = []          # (metodo, caminho, prefer, corpo)


def conf_js():
    return ("var CONFIG = { supabaseUrl: '%s', supabaseChave: 'chave-anon-de-teste' };"
            % NUVEM)


def token(expira=3600):
    TOKEN['n'] += 1
    return {
        'access_token': 'tok%d' % TOKEN['n'],
        'refresh_token': 'ref%d' % TOKEN['n'],
        'expires_in': expira,
        'user': {'id': 'uid-1', 'email': 'marcela@exemplo.com'},
    }


PERFIL = {'id': 'uid-1', 'usuario': 'marcela', 'nome': 'Marcela',
          'bio': '', 'local': '', 'meta_ano': 2026, 'meta_total': 12}


def servir_nuvem(rota, estado):
    r = rota.request
    p = urlparse(r.url)
    q = parse_qs(p.query)
    corpo = None
    try:
        corpo = json.loads(r.post_data) if r.post_data else None
    except Exception:
        corpo = r.post_data
    pedidos.append((r.method, p.path, r.headers.get('prefer', ''), corpo))

    cab = {'access-control-allow-origin': '*'}

    def j(o, status=200):
        rota.fulfill(status=status, content_type='application/json',
                     headers=cab, body=json.dumps(o))

    # --- autenticacao ------------------------------------------------------
    if p.path == '/auth/v1/signup':
        if estado.get('confirmar'):
            return j({'id': 'uid-1', 'email': corpo['email']})
        return j(token())
    if p.path == '/auth/v1/token':
        g = (q.get('grant_type') or [''])[0]
        if g == 'password':
            if corpo.get('password') != 'segredo123':
                return j({'error': 'invalid_grant',
                          'error_description': 'Invalid login credentials'}, 400)
            return j(token(estado.get('expira', 3600)))
        if g == 'refresh_token':
            estado['renovou'] = corpo.get('refresh_token')
            return j(token())
    if p.path == '/auth/v1/logout':
        return rota.fulfill(status=204, headers=cab, body='')
    if p.path == '/auth/v1/recover':
        return j({})

    # --- tabelas -----------------------------------------------------------
    if p.path == '/rest/v1/perfis':
        if r.method == 'GET':
            return j([dict(PERFIL, **estado.get('perfil', {}))])
        if r.method == 'PATCH':
            if corpo.get('usuario') == 'tomado':
                return j({'message': 'duplicate key value violates unique '
                                     'constraint "perfis_usuario_key"'}, 409)
            estado.setdefault('perfil', {}).update(corpo)
            return j([dict(PERFIL, **estado['perfil'])])
    if p.path == '/rest/v1/listas' and r.method == 'POST':
        return j([{'id': 'lista-uuid-1'}])
    if p.path.startswith('/rest/v1/'):
        tab = p.path.rsplit('/', 1)[-1]
        if estado.get('falhar') == tab:
            return j({'message': 'insert or update on table "leituras" violates '
                                 'foreign key constraint "leituras_livro_fkey"'}, 409)
        # Com Prefer: return=representation o PostgREST devolve as linhas
        # criadas, COM o id. Este mock devolvia sempre lista vazia — e com isso
        # a migração parecia funcionar enquanto deixava toda leitura órfã, que
        # é exatamente o defeito que ela precisa provar que não acontece mais.
        prefer = r.headers.get('prefer', '')
        if r.method == 'POST' and 'representation' in prefer:
            novas = corpo if isinstance(corpo, list) else [corpo]
            saida = []
            for k, n in enumerate(novas):
                estado['seq'] = estado.get('seq', 0) + 1
                saida.append(dict(n, id='%s-%d' % (tab, estado['seq'])))
            return j(saida, 201)
        return rota.fulfill(status=201, headers=cab, content_type='application/json',
                            body='[]')

    return j({'message': 'rota nao prevista: ' + p.path}, 404)


def montar(pw, estado):
    nav = pw.chromium.launch(
        executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        proxy={'server': proxy, 'bypass': '127.0.0.1,localhost'} if proxy else None)
    ctx = nav.new_context(viewport={'width': 900, 'height': 1000},
                          service_workers='block')
    pg = ctx.new_page()
    pg.route('**/js/config.js', lambda rt: rt.fulfill(
        status=200, content_type='application/javascript', body=conf_js()))
    pg.route(NUVEM + '/**', lambda rt: servir_nuvem(rt, estado))
    pg.route('**openlibrary.org/**', lambda rt: rt.fulfill(
        status=200, content_type='application/json', headers={'access-control-allow-origin': '*'},
        body='{"works":[],"docs":[],"numFound":0}'))
    pg.route('**covers.openlibrary.org/**', lambda rt: rt.abort())
    return nav, ctx, pg


def checa(nome, cond, detalhe=''):
    if cond:
        print('  ok   ' + nome)
    else:
        erros.append(nome + ((' — ' + detalhe) if detalhe else ''))
        print('  FALHA ' + nome + ((' — ' + detalhe) if detalhe else ''))


DIARIO = {
    'versao': 1,
    'perfil': {'nome': 'Marcela', 'bio': '', 'meta': {'ano': 2026, 'total': 12}},
    'livros': {
        '/works/OL1W': {'chave': '/works/OL1W', 'titulo': 'Grande Sertão',
                        'autores': ['Guimarães Rosa'], 'autoresIds': ['OLA1'],
                        'ano': 1956, 'capa': 'x', 'capaGrande': 'y',
                        'paginas': 624, 'edicoes': 30, 'assuntos': ['sertão']},
        '/works/OL2W': {'chave': '/works/OL2W', 'titulo': 'A Hora da Estrela',
                        'autores': ['Clarice Lispector'], 'ano': 1977},
    },
    'logs': [
        {'id': 'a', 'chave': '/works/OL1W', 'nota': 4.5, 'resenha': 'Enorme.',
         'lidoEm': '2026-01-10', 'relido': False, 'spoiler': False,
         'criadoEm': '2026-01-10T10:00:00Z'},
        {'id': 'b', 'chave': '/works/OL2W', 'nota': None, 'resenha': '',
         'lidoEm': '2026-02-01', 'relido': True, 'spoiler': False,
         'criadoEm': '2026-02-01T10:00:00Z'},
        {'id': 'c', 'chave': '/works/OL9W', 'nota': 3.0, 'resenha': '',
         'lidoEm': '2026-03-01', 'relido': False, 'spoiler': False,
         'criadoEm': '2026-03-01T10:00:00Z'},
    ],
    'querLer': ['/works/OL2W'],
    'curtidas': ['/works/OL1W'],
    'favoritos': ['/works/OL1W'],
    'listas': [{'id': 'L1', 'nome': 'Brasileiros', 'descricao': 'os daqui',
                'livros': ['/works/OL1W', '/works/OL2W'],
                'criadoEm': '2026-01-01T00:00:00Z'}],
    'buscas': [],
}


def semear(pg, diario=None, sessao=None, migrado=None):
    pg.evaluate("""(d) => {
      localStorage.clear();
      if (d.diario)  localStorage.setItem('letterbooks:v1', JSON.stringify(d.diario));
      if (d.sessao)  localStorage.setItem('letterbooks:sessao', JSON.stringify(d.sessao));
      if (d.migrado) localStorage.setItem('letterbooks:migrado:uid-1', d.migrado);
    }""", {'diario': diario, 'sessao': sessao, 'migrado': migrado})


SESSAO_VIVA = {'token': 'tok-viva', 'atualizar': 'ref-viva',
               'expiraEm': int((time.time() + 3600) * 1000),
               'id': 'uid-1', 'email': 'marcela@exemplo.com'}


def rodar():
    with sync_playwright() as pw:

        # ---------------------------------------------------------- desligado
        estado = {}
        nav, ctx, pg = montar(pw, estado)
        pg.unroute('**/js/config.js')
        pg.route('**/js/config.js', lambda rt: rt.fulfill(
            status=200, content_type='application/javascript',
            body="var CONFIG = { supabaseUrl: '', supabaseChave: '' };"))
        print('\nnuvem desligada')
        pg.goto(BASE + '#/conta', wait_until='networkidle')
        checa('mostra o modo local', 'modo local' in pg.inner_text('.conta'))
        checa('nao mostra formulario', pg.locator('#forma-conta').count() == 0)
        pg.goto(BASE + '#/perfil', wait_until='networkidle')
        pg.wait_for_selector('.secao')
        checa('perfil nao oferece conta',
              pg.locator('a[href="#/conta"]').count() == 0)
        nav.close()

        # ------------------------------------------------------------- entrar
        estado = {}
        del pedidos[:]
        nav, ctx, pg = montar(pw, estado)
        print('\nentrar')
        pg.goto(BASE + '#/conta', wait_until='networkidle')
        pg.wait_for_selector('#forma-conta')
        checa('abre em Entrar', pg.inner_text('.conta h1').strip() == 'Entrar')

        pg.fill('input[name=email]', 'marcela@exemplo.com')
        pg.fill('input[name=senha]', 'errada')
        pg.click('#forma-conta button[type=submit]')
        pg.wait_for_selector('#conta-erro:not([hidden])')
        checa('senha errada vira mensagem em portugues',
              'não conferem' in pg.inner_text('#conta-erro'),
              pg.inner_text('#conta-erro'))
        checa('botao volta a funcionar depois do erro',
              not pg.locator('#forma-conta button[type=submit]').is_disabled())

        pg.fill('input[name=senha]', 'segredo123')
        pg.click('#forma-conta button[type=submit]')
        pg.wait_for_selector('#forma-perfil')
        checa('entrou e carregou o perfil',
              pg.input_value('input[name=usuario]') == 'marcela')
        s = json.loads(pg.evaluate("localStorage.getItem('letterbooks:sessao')"))
        checa('gravou a sessao', s['id'] == 'uid-1' and s['token'].startswith('tok'))
        checa('gravou quando expira', s['expiraEm'] > time.time() * 1000)

        aut = [p for p in pedidos if p[1].startswith('/rest/v1/perfis')]
        # DOIS, e o numero e pinado de proposito em vez de virar >= 1. Ao
        # entrar ha dois consumidores independentes da mesma linha: o
        # contaDentro() busca o perfil para preencher o formulario, e o
        # Sinc.descer() busca de novo para trazer a META (V13). O custo e uma
        # ida a rede a mais no login, e ele esta aceito e escrito aqui.
        # Afrouxar para >= 1 esconderia um terceiro consumidor no dia em que
        # alguem acrescentasse um — que e exatamente como este virou dois.
        checa('o perfil veio do servidor, e exatamente duas vezes',
              len(aut) == 2, '%d idas a /rest/v1/perfis' % len(aut))

        # --------------------------------------------------------- criar conta
        print('\ncriar conta')
        pg.goto(BASE + '#/conta', wait_until='networkidle')
        pg.evaluate("localStorage.removeItem('letterbooks:sessao')")
        pg.reload(wait_until='networkidle')
        pg.wait_for_selector('#forma-conta')
        pg.click('[data-acao=modo-criar]')
        pg.wait_for_selector('input[name=nome]')
        pg.fill('input[name=email]', 'nova@exemplo.com')
        pg.fill('input[name=senha]', 'curta')
        pg.click('#forma-conta button[type=submit]')
        pg.wait_for_selector('#conta-erro:not([hidden])')
        checa('senha curta barrada antes de ir na rede',
              '6 caracteres' in pg.inner_text('#conta-erro'))
        checa('nao chamou o servidor a toa',
              not [p for p in pedidos if p[1] == '/auth/v1/signup'])

        pg.fill('input[name=senha]', 'segredo123')
        pg.click('#forma-conta button[type=submit]')
        pg.wait_for_selector('#forma-perfil')
        checa('criou a conta e entrou', pg.locator('#forma-perfil').count() == 1)
        nav.close()

        # ---------------------------------------------- confirmar e-mail ligado
        estado = {'confirmar': True}
        del pedidos[:]
        nav, ctx, pg = montar(pw, estado)
        print('\ncadastro com confirmacao de e-mail')
        pg.goto(BASE + '#/conta', wait_until='networkidle')
        pg.wait_for_selector('#forma-conta')
        pg.click('[data-acao=modo-criar]')
        pg.fill('input[name=email]', 'nova@exemplo.com')
        pg.fill('input[name=senha]', 'segredo123')
        pg.click('#forma-conta button[type=submit]')
        # Esperar por '.conta h1' casa com o titulo da tela ANTERIOR, que ainda
        # esta na pagina enquanto a resposta nao volta. A espera tem que ser
        # pelo texto novo, senao o teste le a tela velha e falha as vezes.
        pg.wait_for_selector('.conta h1:has-text("Confirme o e-mail")', timeout=10000)
        checa('pede a confirmacao em vez de entrar',
              'Confirme o e-mail' in pg.inner_text('.conta h1'))
        checa('nao inventou sessao',
              pg.evaluate("localStorage.getItem('letterbooks:sessao')") is None)
        nav.close()

        # ---------------------------------------------------------- migracao
        estado = {}
        del pedidos[:]
        nav, ctx, pg = montar(pw, estado)
        print('\nmigracao do diario local')
        pg.goto(BASE, wait_until='networkidle')
        semear(pg, diario=DIARIO, sessao=SESSAO_VIVA)
        pg.goto(BASE + '#/conta', wait_until='networkidle')
        pg.reload(wait_until='networkidle')
        pg.wait_for_selector('[data-acao=migrar]')
        texto = pg.inner_text('.conta')
        # O inventario agora diz o ESCOPO: nao "voce tem 3 leituras" (que
        # conta tambem o que ja esta na conta), e sim quantas so existem
        # aqui. Com o diario semeado e nada migrado, as tres sao locais.
        checa('conta as leituras que SO estao aqui', '3 só aqui' in texto, texto[:160])
        # .lower() porque o CSS deixa o botao em versalete: o inner_text
        # devolve "ENVIAR O QUE SO ESTA AQUI".
        checa('e o botao diz o escopo, nao "enviar para a conta"',
              'só está aqui' in pg.inner_text('[data-acao=migrar]').lower(),
              pg.inner_text('[data-acao=migrar]'))
        checa('promete nao apagar nada', 'nada é apagado' in texto)

        pg.click('[data-acao=migrar]')
        pg.wait_for_selector('.aviso-flutuante', timeout=5000)

        escritas = [p for p in pedidos if p[0] == 'POST' and p[1].startswith('/rest/')]
        ordem = [p[1].rsplit('/', 1)[-1] for p in escritas]
        checa('livros vao antes das leituras',
              ordem.index('livros') < ordem.index('leituras'), str(ordem))
        checa('itens vao depois da lista',
              ordem.index('listas') < ordem.index('lista_itens'), str(ordem))

        livros = [p for p in escritas if p[1].endswith('/livros')][0]
        checa('livros usam merge-duplicates', 'merge-duplicates' in livros[2], livros[2])
        checa('livro leva os campos do banco, nao os do app',
              set(livros[3][0]) >= {'chave', 'titulo', 'capa_grande', 'autores_ids'},
              str(sorted(livros[3][0])))
        checa('so sobem os livros que existem no cache', len(livros[3]) == 2,
              str(len(livros[3])))

        leituras = [p for p in escritas if p[1].endswith('/leituras')][0]
        checa('leitura sem livro no cache fica de fora', len(leituras[3]) == 2,
              str([l['livro'] for l in leituras[3]]))
        checa('nota vira numero ou nulo',
              leituras[3][0]['nota'] == 4.5 and leituras[3][1]['nota'] is None)
        checa('data usa o nome da coluna', leituras[3][0]['lido_em'] == '2026-01-10')
        checa('releitura preservada', leituras[3][1]['relido'] is True)
        checa('resenha vazia vira nulo', leituras[3][1]['resenha'] is None)

        marc = [p for p in escritas if p[1].endswith('/marcadores')][0]
        tipos = sorted(m['tipo'] for m in marc[3])
        checa('os tres tipos de marcador', tipos == ['curtida', 'favorito', 'quero'],
              str(tipos))
        checa('marcadores ignoram duplicata', 'ignore-duplicates' in marc[2])

        itens = [p for p in escritas if p[1].endswith('/lista_itens')][0]
        checa('itens usam o id que o banco devolveu',
              all(i['lista'] == 'lista-uuid-1' for i in itens[3]))
        checa('itens guardam a ordem', [i['ordem'] for i in itens[3]] == [0, 1])

        local = pg.evaluate("JSON.parse(localStorage.getItem('letterbooks:v1'))")
        checa('nao apagou o diario do aparelho', len(local['logs']) == 3)
        checa('marcou a data da migracao',
              pg.evaluate("localStorage.getItem('letterbooks:migrado:uid-1')") is not None)
        # A migracao mandava com return=minimal e nunca gravava o id do
        # servidor de volta. Toda leitura ficava orfa, e a proxima edicao
        # criava uma linha nova la em vez de corrigir a que existia. O defeito
        # ficava escondido ate alguem editar uma resenha.
        migradas = [l for l in local['logs'] if l['chave'] in local['livros']]
        checa('toda leitura migrada ficou amarrada ao servidor',
              migradas and all(l.get('remoto') for l in migradas),
              str([(l['id'], l.get('remoto')) for l in local['logs']]))

        pg.reload(wait_until='networkidle')
        pg.wait_for_selector('.conta')
        checa('botao de migrar some depois de migrar',
              pg.locator('[data-acao=migrar]').count() == 0)
        conta_txt = pg.inner_text('.conta')
        checa('mostra a data no lugar', 'enviado para a conta' in conta_txt, conta_txt[:160])
        # e a data DE VERDADE, nao so o rotulo: antes bastava a frase
        import re as _re
        checa('e a data aparece, formatada',
              bool(_re.search(r'\d{2}/\d{2}/\d{4}', conta_txt)), conta_txt[:160])
        nav.close()

        # ------------------------------------------------------- migracao ruim
        estado = {'falhar': 'leituras'}
        del pedidos[:]
        nav, ctx, pg = montar(pw, estado)
        print('\nmigracao que falha no meio')
        pg.goto(BASE, wait_until='networkidle')
        semear(pg, diario=DIARIO, sessao=SESSAO_VIVA)
        pg.goto(BASE + '#/conta', wait_until='networkidle')
        pg.reload(wait_until='networkidle')
        pg.wait_for_selector('[data-acao=migrar]')
        pg.click('[data-acao=migrar]')
        pg.wait_for_selector('#migrar-erro:not([hidden])')
        checa('conta o que deu errado', 'foreign key' in pg.inner_text('#migrar-erro'))
        checa('deixa tentar de novo',
              not pg.locator('[data-acao=migrar]').is_disabled())
        checa('NAO marcou como migrado',
              pg.evaluate("localStorage.getItem('letterbooks:migrado:uid-1')") is None)
        checa('diario local intacto',
              len(pg.evaluate("JSON.parse(localStorage.getItem('letterbooks:v1')).logs")) == 3)
        nav.close()

        # ------------------------------------------------------ token vencido
        estado = {}
        del pedidos[:]
        nav, ctx, pg = montar(pw, estado)
        print('\ntoken vencido')
        pg.goto(BASE, wait_until='networkidle')
        semear(pg, sessao=dict(SESSAO_VIVA, expiraEm=int((time.time() - 10) * 1000),
                               atualizar='ref-velha'))
        del pedidos[:]
        pg.goto(BASE + '#/conta', wait_until='networkidle')
        pg.reload(wait_until='networkidle')
        pg.wait_for_selector('#forma-perfil')
        checa('renovou antes de consultar', estado.get('renovou') == 'ref-velha')
        seq = [p[1] for p in pedidos]
        checa('renovacao veio antes do perfil',
              seq.index('/auth/v1/token') < seq.index('/rest/v1/perfis'), str(seq))
        s = json.loads(pg.evaluate("localStorage.getItem('letterbooks:sessao')"))
        checa('gravou o token novo', s['token'] != 'tok-viva')
        nav.close()

        # ------------------------------------------------- editar perfil e sair
        estado = {}
        del pedidos[:]
        nav, ctx, pg = montar(pw, estado)
        print('\neditar perfil e sair')
        pg.goto(BASE, wait_until='networkidle')
        semear(pg, diario=DIARIO, sessao=SESSAO_VIVA)
        pg.goto(BASE + '#/conta', wait_until='networkidle')
        pg.reload(wait_until='networkidle')
        pg.wait_for_selector('#forma-perfil')

        pg.fill('input[name=usuario]', 'MAIUSCULA!')
        pg.click('#forma-perfil button[type=submit]')
        pg.wait_for_selector('#perfil-erro:not([hidden])')
        checa('usuario invalido barrado antes da rede',
              'minúsculas' in pg.inner_text('#perfil-erro'))
        checa('nao mandou PATCH a toa',
              not [p for p in pedidos if p[0] == 'PATCH'])

        pg.fill('input[name=usuario]', 'tomado')
        pg.click('#forma-perfil button[type=submit]')
        pg.wait_for_selector('#perfil-erro:not([hidden])')
        checa('usuario tomado explicado em portugues',
              'já está em uso' in pg.inner_text('#perfil-erro'),
              pg.inner_text('#perfil-erro'))

        pg.fill('input[name=usuario]', 'marcela_2')
        pg.fill('input[name=nome]', 'Marcela T')
        pg.click('#forma-perfil button[type=submit]')
        pg.wait_for_selector('.aviso-flutuante')
        checa('salvou o usuario', pg.input_value('input[name=usuario]') == 'marcela_2')
        checa('espelhou o nome no perfil local',
              pg.evaluate("JSON.parse(localStorage.getItem('letterbooks:v1')).perfil.nome")
              == 'Marcela T')

        pg.click('[data-acao=sair]')
        pg.wait_for_selector('#forma-conta')
        checa('saiu de verdade',
              pg.evaluate("localStorage.getItem('letterbooks:sessao')") is None)
        checa('avisou o servidor',
              any(p[1] == '/auth/v1/logout' for p in pedidos))
        checa('diario do aparelho continua',
              len(pg.evaluate("JSON.parse(localStorage.getItem('letterbooks:v1')).logs")) == 3)
        nav.close()

        # ------------------------------------------- o app local nao regrediu
        estado = {}
        nav, ctx, pg = montar(pw, estado)
        print('\no app local segue igual')
        problemas = []
        pg.on('pageerror', lambda e: problemas.append(str(e)))
        pg.goto(BASE, wait_until='networkidle')
        semear(pg, diario=DIARIO)
        pg.reload(wait_until='networkidle')
        for rota in ['#/inicio', '#/diario', '#/estante', '#/listas', '#/perfil']:
            pg.goto(BASE + rota, wait_until='networkidle')
            pg.wait_for_timeout(200)
        checa('nenhum erro de javascript nas telas de sempre',
              not problemas, '; '.join(problemas[:3]))
        pg.goto(BASE + '#/perfil', wait_until='networkidle')
        pg.wait_for_selector('.secao')
        checa('perfil oferece a conta quando a nuvem esta ligada',
              pg.locator('a[href="#/conta"]').count() == 1)
        nav.close()

    print('\n' + ('-' * 60))
    if erros:
        print('%d falha(s):' % len(erros))
        for e in erros:
            print('  · ' + e)
        sys.exit(1)
    print('tudo passou')


if __name__ == '__main__':
    rodar()

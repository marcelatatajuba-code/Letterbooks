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

# O token TEM que ser 'tok-<uid>': e assim que o /auth do mock devolve (linha
# 68) e e assim que ele descobre quem esta pedindo. Com 'tok' seco, o
# estado['quem'] ficava None em toda requisicao semeada — e nenhum teste
# reparou porque nenhum dependia de identidade ate os avisos existirem. Mock que
# nao sabe quem esta falando nao consegue provar nada que dependa de "meu".
SESSAO = {'token': 'tok-uid-1', 'atualizar': 'ref',
          'expiraEm': int((time.time() + 3600) * 1000),
          'id': 'uid-1', 'email': 'marcela@exemplo.com'}

BANCO = {}   # tabela -> lista de linhas


def zerar(vazio=False):
    del pedidos[:]
    BANCO.clear()
    BANCO.update({'livros': [], 'leituras': [], 'marcadores': [], 'seguidores': [],
                  'listas': [], 'lista_itens': [], 'denuncias': [],
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

    # O servidor de verdade devolve 401 para JWT vencido. O mock nao sabia
    # recusar NADA, entao um teste de "token vencido" passava verde dos dois
    # lados — o que e o mesmo que nao ter teste. Token com a marca VENCIDO faz
    # o papel do JWT expirado; a chave anon (que nao tem 'tok-') passa, que e
    # justamente o caminho que o conserto usa.
    if 'VENCIDO' in aut:
        return j({'message': 'JWT expired', 'code': 'PGRST301'}, 401)

    estado['quem'] = aut.replace('Bearer tok-', '') if 'tok-' in aut else None

    tab = p.path.rsplit('/', 1)[-1]
    linhas = BANCO.setdefault(tab, [])

    # ---- o RLS da chave de privacidade, na medida em que um mock consegue ---
    #
    # Este mock NAO aplica RLS, e nunca vai aplicar: quem prova politica e o
    # servidor/provar-v4.sql, contra um Postgres real. O que ele faz aqui e
    # imitar o EFEITO das seis politicas — as linhas de quem fechou o diario
    # param de chegar — para que as assercoes de TELA meçam a tela.
    #
    # Sem isto, escrever primeiro o teste de tela daria verde enquanto a
    # producao vazava: o app desenharia "privado" so porque o perfil diz
    # privado, e ninguem teria verificado que as linhas somem. E a quinta vez
    # que este mock precisa aprender uma coisa antes de o teste medir alguma
    # coisa, e as outras quatro estao escritas neste mesmo arquivo.
    def fechado(perfil_id):
        if not perfil_id or perfil_id == estado.get('quem'):
            return False                     # o dono sempre ve o proprio diario
        pf = next((x for x in BANCO.get('perfis', []) if x['id'] == perfil_id), None)
        return bool(pf and pf.get('privado'))

    # ORDER, OFFSET e LIMIT. O laco generico PULAVA os tres ('select', 'order',
    # 'limit', 'offset') e o ramo do `feed` devolvia a saida inteira. Ou seja:
    # `leiturasDe(usuario, 40)` devolvia TUDO no mock, e a janela de 40 linhas
    # — o defeito que o item 14 existe para evitar — era invisivel para a
    # suite. Somar a distribuicao de notas a partir da janela passaria VERDE
    # nas quatro suites e sairia truncada no aparelho da usuaria.
    #
    # E a oitava vez que este mock precisa aprender uma coisa antes de o teste
    # medir alguma coisa, e a primeira em que o que ele nao sabia era o teto da
    # propria consulta. As outras sete estao escritas neste mesmo arquivo.
    def recortar(saida, q):
        ordem = q.get('order', [''])[0]
        if ordem:
            # `lido_em.desc`, `criado_em.desc.nullslast`, `ordem.asc`
            partes = ordem.split('.')
            campo = partes[0]
            desc = 'desc' in partes[1:]
            # None nunca compara com str: vira '' para a ordenacao, como o
            # PostgREST faz com nullslast no caminho descendente.
            saida = sorted(saida, key=lambda x: (x.get(campo) is None,
                                                 x.get(campo) or ''), reverse=desc)
        if 'offset' in q:
            saida = saida[int(q['offset'][0]):]
        if 'limit' in q:
            saida = saida[:int(q['limit'][0])]
        return saida

    def visivel(linha, tab_nome):
        """As mesmas seis portas do esquema, na mesma ordem."""
        if tab_nome in ('leituras', 'marcadores', 'listas'):
            return not fechado(linha.get('perfil'))
        if tab_nome == 'lista_itens':
            dona = next((x for x in BANCO.get('listas', []) if x['id'] == linha.get('lista')), None)
            return bool(dona) and not fechado(dona.get('perfil'))
        if tab_nome in ('curtidas', 'comentarios'):
            # a metade `perfil = auth.uid()` do predicado: quem escreveu
            # continua vendo o proprio texto
            if linha.get('perfil') and linha['perfil'] == estado.get('quem'):
                return True
            leit = next((x for x in BANCO.get('leituras', []) if x['id'] == linha.get('leitura')), None)
            return bool(leit) and not fechado(leit.get('perfil'))
        return True

    if r.method == 'GET':
        if tab == 'feed':
            saida = []
            for l in BANCO['leituras']:
                # a `feed` e security_invoker: ela nao e uma porta propria,
                # herda o RLS de `leituras`. Filtrar aqui e imitar isso.
                if not visivel(l, 'leituras'): continue
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
            return j(recortar(saida, q))
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
        saida = [x for x in saida if visivel(x, tab)]
        if tab == 'comentarios':
            saida = [dict(x, perfis={'usuario': 'bia', 'nome': 'Bia'}) for x in saida]

        # SELEÇÃO EMBUTIDA. O PostgREST devolve a tabela filha DENTRO da linha
        # quando o select pede `lista_itens(livro,ordem)` — é o que evita uma
        # ida à rede por lista. O mock não sabia disso e devolveria a lista sem
        # nenhum item: o teste passaria mostrando toda lista vazia, que é
        # exatamente o que ele existe para pegar. É a quinta vez neste projeto
        # que o mock precisa aprender uma coisa antes de o teste valer algo.
        sel = q.get('select', [''])[0]

        # A VIEW `avisos` nao existe para o mock: o ramo generico faria
        # BANCO.setdefault('avisos', []) e devolveria lista vazia PARA SEMPRE.
        # Toda assercao de "nao tem aviso" passaria verde sem medir nada, e so a
        # de "tem aviso" falharia — no lugar errado. Ela e montada aqui a partir
        # das tres tabelas de origem, com as mesmas regras da view de verdade:
        # nada de auto-aviso, e so o que aponta para quem esta pedindo.
        if tab == 'avisos':
            eu = estado.get('quem')
            porId = {x['id']: x for x in BANCO['leituras']}
            perfis = {x['id']: x for x in BANCO['perfis']}
            saida = []

            def quemE(pid):
                p = perfis.get(pid, {})
                return p.get('usuario'), p.get('nome')

            for c in BANCO.get('curtidas', []):
                l = porId.get(c['leitura'])
                if not l or l['perfil'] != eu or c['perfil'] == l['perfil']: continue
                u, n = quemE(c['perfil'])
                lv = next((b for b in BANCO['livros'] if b['chave'] == l['livro']), {})
                saida.append({'id': 'c:%s:%s' % (c['perfil'], c['leitura']),
                              'tipo': 'curtida', 'criado_em': c.get('criado_em'),
                              'quem': c['perfil'], 'usuario': u, 'quem_nome': n,
                              'leitura': l['id'], 'titulo': lv.get('titulo'),
                              'tem_resenha': bool(l.get('resenha')), 'livro': l['livro']})
            for m in BANCO.get('comentarios', []):
                l = porId.get(m['leitura'])
                if not l or l['perfil'] != eu or m['perfil'] == l['perfil']: continue
                u, n = quemE(m['perfil'])
                lv = next((b for b in BANCO['livros'] if b['chave'] == l['livro']), {})
                saida.append({'id': 'm:%s' % m['id'], 'tipo': 'comentario',
                              'criado_em': m.get('criado_em'), 'quem': m['perfil'],
                              'usuario': u, 'quem_nome': n, 'leitura': l['id'],
                              'titulo': lv.get('titulo'),
                              'tem_resenha': bool(l.get('resenha')), 'livro': l['livro']})
            for g in BANCO.get('seguidores', []):
                if g['seguido'] != eu: continue
                u, n = quemE(g['seguidor'])
                saida.append({'id': 's:%s:%s' % (g['seguidor'], g['seguido']),
                              'tipo': 'seguidor', 'criado_em': g.get('criado_em'),
                              'quem': g['seguidor'], 'usuario': u, 'quem_nome': n,
                              'leitura': None, 'titulo': None,
                              'tem_resenha': False, 'livro': None})

            # A marca d'agua: `criado_em=gt.<ts>`. O laco generico so entende
            # `eq.` e `in.` e IGNORA todo o resto em silencio — sem esta linha o
            # teste de "o ponto some depois de abrir" passaria verde com a marca
            # nunca aplicada, que e o defeito exato que ele existe para pegar.
            if 'criado_em' in q and q['criado_em'][0].startswith('gt.'):
                corte = q['criado_em'][0][3:]
                saida = [x for x in saida if (x.get('criado_em') or '') > corte]

            saida.sort(key=lambda x: x.get('criado_em') or '', reverse=True)
            lim = int(q.get('limit', ['50'])[0])
            return j(saida[:lim])

        # A VIEW `distribuicao_de_notas` nao existe para o mock: o ramo
        # generico faria BANCO.setdefault('distribuicao_de_notas', []) e
        # devolveria lista vazia PARA SEMPRE. Toda assercao de "nao desenha
        # histograma" passaria verde sem medir nada, e so a de "desenha"
        # falharia — no lugar errado. E a nona vez que este mock precisa
        # aprender uma coisa antes de o teste valer alguma coisa.
        #
        # Ela e montada a partir de BANCO['leituras'] com o MESMO visivel()
        # que imita as seis politicas, porque a view de verdade e
        # security_invoker e herda o RLS de `leituras`: um diario fechado
        # chega ao group by com zero linhas. Imitar o efeito aqui e o que faz
        # a assercao de "diario fechado nao tem distribuicao" medir algo.
        #
        # A linha de `nota` nula forma o proprio grupo, como na view: e dela
        # que sai o total exato de leituras da pessoa.
        if tab == 'distribuicao_de_notas':
            alvo = None
            if 'perfil' in q and q['perfil'][0].startswith('eq.'):
                alvo = q['perfil'][0][3:]
            conta = {}
            for l in BANCO.get('leituras', []):
                if alvo and l.get('perfil') != alvo: continue
                if not visivel(l, 'leituras'): continue
                chave = (l.get('perfil'), l.get('nota'))
                conta[chave] = conta.get(chave, 0) + 1
            return j([{'perfil': k[0], 'nota': k[1], 'qtd': v}
                      for k, v in conta.items()])

        if tab == 'listas':
            if 'lista_itens' in sel:
                saida = [dict(x, lista_itens=sorted(
                    [{'livro': i['livro'], 'ordem': i.get('ordem', 0)}
                     for i in BANCO.get('lista_itens', []) if i['lista'] == x['id']],
                    key=lambda i: i['ordem'])) for x in saida]
            if 'perfis' in sel:
                saida = [dict(x, perfis=next(
                    (dict(usuario=p['usuario'], nome=p['nome'])
                     for p in BANCO['perfis'] if p['id'] == x['perfil']), {})) for x in saida]
        return j(recortar(saida, q))

    # ---- a RPC de apagar a conta, com o cascateamento do esquema -----------
    #
    # O `on delete cascade` esta escrito no esquema.sql e provado no
    # provar-v4.sql; aqui ele e imitado a mao para a TELA poder ser testada.
    # A ordem das tabelas nao importa (nao ha chave estrangeira num dict), mas
    # a lista SIM: se uma tabela faltar aqui, o teste de tela passa verde e o
    # que ficou orfao so aparece em producao.
    if p.path.endswith('/rpc/apagar_minha_conta'):
        quem = estado.get('quem')
        if not quem:
            return j({'message': 'permission denied'}, 401)
        minhas = [l['id'] for l in BANCO.get('leituras', []) if l.get('perfil') == quem]
        BANCO['perfis']     = [x for x in BANCO.get('perfis', [])     if x.get('id') != quem]
        BANCO['leituras']   = [x for x in BANCO.get('leituras', [])   if x.get('perfil') != quem]
        BANCO['marcadores'] = [x for x in BANCO.get('marcadores', []) if x.get('perfil') != quem]
        listas_minhas = [x['id'] for x in BANCO.get('listas', []) if x.get('perfil') == quem]
        BANCO['listas']      = [x for x in BANCO.get('listas', [])      if x.get('perfil') != quem]
        BANCO['lista_itens'] = [x for x in BANCO.get('lista_itens', []) if x.get('lista') not in listas_minhas]
        BANCO['seguidores']  = [x for x in BANCO.get('seguidores', [])
                                if x.get('seguidor') != quem and x.get('seguido') != quem]
        # os dois lados: o que EU curti/comentei, e o que curtiram/comentaram
        # nas MINHAS leituras. O primeiro e o efeito colateral que a folha
        # precisa dizer em voz alta.
        BANCO['denuncias']   = [x for x in BANCO.get('denuncias', [])
                                if x.get('leitura') not in minhas]
        BANCO['curtidas']    = [x for x in BANCO.get('curtidas', [])
                                if x.get('perfil') != quem and x.get('leitura') not in minhas]
        BANCO['comentarios'] = [x for x in BANCO.get('comentarios', [])
                                if x.get('perfil') != quem and x.get('leitura') not in minhas]
        # a conta em si — e o que separa "apagar a conta" de "apagar o perfil"
        BANCO['_contas'] = {e: i for e, i in BANCO.get('_contas', {}).items() if i != quem}
        return rota.fulfill(status=204, headers=cab, body='')

    if r.method == 'POST':
        novas = corpo if isinstance(corpo, list) else [corpo]
        prefer = r.headers.get('prefer', '')

        # ---- o que este mock passou a RECUSAR, e por que cada recusa ------
        #
        # Setima vez que ele precisa aprender antes de o teste medir alguma
        # coisa (D18, D30, D31, D33, D58, D61 estao comentados neste arquivo).
        # Ate aqui um POST para /rest/v1/qualquercoisa com corpo {} devolvia
        # 201: `linhas = BANCO.setdefault(tab, [])` inventa tabela por nome de
        # rota. Um teste escrito contra isso mede o proprio mock.
        if tab == 'denuncias':
            quem = estado.get('quem')
            for n in novas:
                # (a) a politica `with check (auth.uid() = autor)`. Era o buraco
                #     de verdade: dava para assinar denuncia no nome de outra
                #     pessoa. Se o mock nao recusar, o teste da politica passa
                #     verde contra um servidor que aceita a forja.
                if not quem or n.get('autor') != quem:
                    return j({'code': '42501',
                              'message': 'new row violates row-level security '
                                         'policy for table "denuncias"'}, 403)
                # (b) o check (leitura is not null or comentario is not null)
                if not n.get('leitura') and not n.get('comentario'):
                    return j({'code': '23514',
                              'message': 'new row for relation "denuncias" violates '
                                         'check constraint "denuncias_check"'}, 400)
                # (c) coluna que nao existe — pega `corpo[alvo.tipo]` com tipo
                #     errado, que era como a funcao da nuvem quebrava
                for campo in n:
                    if campo not in ('autor', 'leitura', 'comentario', 'motivo'):
                        return j({'code': 'PGRST204',
                                  'message': "Could not find the '%s' column of "
                                             "'denuncias' in the schema cache" % campo}, 400)
                # (d) a chave estrangeira do autor: conta viva SEM perfil
                if not any(x['id'] == n['autor'] for x in BANCO.get('perfis', [])):
                    return j({'code': '23503',
                              'message': 'insert or update on table "denuncias" violates '
                                         'foreign key constraint "denuncias_autor_fkey"'}, 400)

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
            # lista_itens tem chave (lista, livro) e NENHUM id: sem isto o mock
            # aceitaria o mesmo livro duas vezes na mesma lista, e o teste de
            # "reenviar não duplica" passaria verde contra um banco que duplica.
            if tab == 'lista_itens':
                iguais = [x for x in linhas
                          if x['lista'] == n['lista'] and x['livro'] == n['livro']]
                if iguais:
                    iguais[0].update(n)
                    continue
                linhas.append(n); criadas.append(n)
                continue
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
                # not.in.(...) é como a subida tira da lista o livro que saiu.
                # Sem isto o mock apagaria TUDO que casasse com o `lista=eq.`,
                # ou seja, esvaziaria a lista a cada envio — e o teste diria que
                # está tudo bem.
                if v[0].startswith('not.in.'):
                    fora = [y.strip('"') for y in v[0][8:-1].split(',') if y]
                    if str(x.get(campo)) in fora: return False
                    continue
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
        pg.goto(BASE + '#/resenha/L1', wait_until='networkidle')
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
              pg.locator('a.feed-resenha').first.get_attribute('href') == '#/resenha/L1')
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

        # ======================= a fila nao perde o que entra no meio ==========
        # enfileirar() substitui o array inteiro (filter + push) quando uma
        # mudanca nova supera uma que ja estava na fila. O empurrar() tirava o
        # item enviado com fila.shift() — por POSICAO. Se a substituicao
        # acontecesse enquanto o envio estava no ar, o shift jogava fora
        # justamente a mudanca nova, sem nunca ter mandado: a fila zerava e a
        # alteracao sumia, sem um erro na tela.
        #
        # POR QUE ESTE CAMINHO, e nao "editar a resenha duas vezes": naquele,
        # enviarLeitura guarda uma REFERENCIA ao log e so le o conteudo quando
        # a promessa anterior resolve — entao a segunda edicao pega carona no
        # primeiro envio e o defeito fica invisivel. Aqui nao ha carona: apagar
        # e outra operacao, e se o item cair, a leitura fica apagada no
        # aparelho e VIVA no servidor. O aparelho e o servidor discordam, que e
        # a unica classe de defeito que nao da para desfazer.
        print('\nfila: apagar logo depois de registrar nao se perde')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.reload(wait_until='networkidle')
        pg.evaluate("""() => {
          const r = Dados.registrar({chave:'/works/OL1W', nota:4.0,
                                     resenha:'vai e volta', lidoEm:'2026-08-20'});
          Dados.apagarLog(r.id);
        }""")
        pg.wait_for_timeout(2200)
        checa('a fila esvaziou', pg.evaluate('() => Sinc.pendentes()') == 0)
        checa('o aparelho ficou sem a leitura',
              pg.evaluate("() => JSON.parse(localStorage.getItem('letterbooks:v1')).logs.length") == 0)
        checa('e o servidor tambem — nao ficou uma leitura fantasma la',
              len(BANCO['leituras']) == 0, '%d linhas no banco' % len(BANCO['leituras']))
        nav.close()

        # ============================ avisos ==================================
        # Curtir, comentar e seguir funcionavam e NINGUEM do outro lado ficava
        # sabendo. A unica forma de descobrir um comentario era reabrir aquela
        # resenha por acaso.
        print('\navisos: quem curtiu, quem comentou, quem comecou a seguir')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        BANCO['livros'].append({'chave': '/works/OL2W', 'titulo': 'Vidas Secas',
                                'autores': ['Graciliano Ramos'], 'ano': 1938})
        # duas leituras MINHAS: uma com resenha, outra so com nota
        BANCO['leituras'] += [
            {'id': 'L1', 'perfil': 'uid-1', 'livro': '/works/OL1W', 'nota': 5.0,
             'resenha': 'Capitu me pegou.', 'lido_em': '2026-08-20', 'relido': False,
             'spoiler': False, 'criado_em': '2026-08-20T10:00:00Z', 'cliente_id': 'a1'},
            {'id': 'L2', 'perfil': 'uid-1', 'livro': '/works/OL2W', 'nota': 4.0,
             'resenha': '', 'lido_em': '2026-08-21', 'relido': False, 'spoiler': False,
             'criado_em': '2026-08-21T10:00:00Z', 'cliente_id': 'a2'},
            # e uma da Bia, para provar que os avisos dela nao vazam para mim
            {'id': 'L3', 'perfil': 'uid-2', 'livro': '/works/OL1W', 'nota': 3.0,
             'resenha': '', 'lido_em': '2026-08-22', 'relido': False, 'spoiler': False,
             'criado_em': '2026-08-22T10:00:00Z', 'cliente_id': 'b1'}]
        BANCO['curtidas'] += [
            {'perfil': 'uid-2', 'leitura': 'L1', 'criado_em': '2026-08-29T10:00:00Z'},
            {'perfil': 'uid-2', 'leitura': 'L2', 'criado_em': '2026-08-28T10:00:00Z'},
            {'perfil': 'uid-1', 'leitura': 'L1', 'criado_em': '2026-08-27T10:00:00Z'},  # eu mesma
            {'perfil': 'uid-1', 'leitura': 'L3', 'criado_em': '2026-08-26T10:00:00Z'}]  # da Bia
        BANCO['comentarios'].append({'id': 'M1', 'leitura': 'L1', 'perfil': 'uid-2',
                                     'texto': 'Tambem quero ler.',
                                     'criado_em': '2026-08-30T10:00:00Z'})
        BANCO['seguidores'].append({'seguidor': 'uid-2', 'seguido': 'uid-1',
                                    'criado_em': '2026-08-25T10:00:00Z'})

        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.reload(wait_until='networkidle')
        pg.wait_for_timeout(1200)
        checa('o ponto aparece na aba quando ha novidade',
              pg.locator('#ponto-avisos:not([hidden])').count() == 1)
        checa('e o link diz isso em voz alta, nao so em cor',
              'novidade' in pg.locator('.abas-pe a[href="#/atividade"]')
              .get_attribute('aria-label'))

        pg.goto(BASE + '#/avisos', wait_until='networkidle')
        pg.wait_for_selector('.aviso', timeout=10000)
        checa('quatro avisos: duas curtidas, um comentario, uma seguidora',
              pg.locator('.aviso').count() == 4, '%d' % pg.locator('.aviso').count())
        texto = pg.inner_text('#avisos')
        checa('a curtida na leitura COM resenha diz "sua resenha"',
              'curtiu sua resenha de' in texto)
        checa('e na leitura so com nota diz "seu registro"',
              'curtiu seu registro de' in texto)
        checa('o comentario tem a concordancia certa',
              'comentou na sua resenha de' in texto)
        checa('a seguidora nao fala de livro nenhum',
              'comecou a seguir voce' in texto.replace('ç','c').replace('ê','e').replace('ó','o'))
        checa('curtir a PROPRIA leitura nao vira aviso',
              texto.count('Marcela') == 0, texto[:200])
        checa('e o que eu fiz na leitura da Bia nao aparece aqui',
              'Vidas Secas' in texto and texto.count('Dom Casmurro') == 2)
        checa('a linha da seguidora nao desenha capa',
              pg.locator('.aviso .capa').count() == 0)
        checa('a curtida leva ao endereco da resenha',
              pg.locator('.aviso').first.get_attribute('href').startswith('#/resenha/'))
        # D05 de novo: <a> dentro de <a> e HTML invalido e o navegador parte a
        # linha em fragmentos. Foi assim que o contador deu 12 em vez de 4 — e a
        # contagem so denunciou porque ela compara com o que a API devolveu.
        checa('nenhuma ancora aninhada dentro da linha',
              pg.evaluate("() => document.querySelectorAll('.aviso a').length") == 0)

        print('\navisos: abrir apaga o ponto, e ele nao volta sozinho')
        checa('todas nasceram marcadas como novas',
              pg.locator('.aviso-novo').count() == 4)
        checa('o ponto sumiu depois de pintar',
              pg.locator('#ponto-avisos[hidden]').count() == 1)
        marca = pg.evaluate("() => JSON.parse(localStorage.getItem('letterbooks:avisos:uid-1'))")
        checa('a marca guardada e um horario de SERVIDOR, o do mais novo',
              marca and marca['visto'] == '2026-08-30T10:00:00Z', str(marca))
        pg.goto(BASE + '#/inicio', wait_until='networkidle')
        pg.wait_for_timeout(1200)
        checa('e voltando ao app o ponto continua apagado',
              pg.locator('#ponto-avisos[hidden]').count() == 1)

        print('\navisos: coisa nova depois da marca acende o ponto de novo')
        BANCO['comentarios'].append({'id': 'M2', 'leitura': 'L1', 'perfil': 'uid-2',
                                     'texto': 'Reli e continua bom.',
                                     'criado_em': '2026-08-31T10:00:00Z'})
        # Reabrir o app, nao navegar por dentro dele. O ponto e conferido em TRES
        # momentos — abrir, a sessao mudar, e a aba voltar a aparecer — e nao a
        # cada tela pintada: isso seria uma ida a rede por navegacao. Consequencia
        # assumida: quem esta com o app aberto so ve o ponto na proxima vez que
        # voltar a ele. Num diario de leitura, em que o evento e uma curtida por
        # dia, a diferenca entre "na hora" e "quando voce volta" nao existe.
        pg.reload(wait_until='networkidle')
        pg.wait_for_timeout(1400)
        checa('reabrindo o app, o ponto voltou',
              pg.locator('#ponto-avisos:not([hidden])').count() == 1)
        pg.goto(BASE + '#/avisos', wait_until='networkidle')
        pg.wait_for_selector('.aviso', timeout=10000)
        checa('so o novo esta marcado como novo',
              pg.locator('.aviso-novo').count() == 1,
              '%d marcados' % pg.locator('.aviso-novo').count())
        nav.close()

        print('\navisos: sem conta e sem nuvem, a tela explica em vez de mentir')
        zerar(); estado = {}
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg, sessao=None)
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/avisos', wait_until='networkidle')
        pg.wait_for_selector('.conta', timeout=8000)
        checa('sem conta, convida a entrar',
              'Entre na sua conta' in pg.inner_text('.conta'))
        checa('e nao acende ponto nenhum',
              pg.locator('#ponto-avisos[hidden]').count() == 1)
        nav.close()

        # ============ o 💬 da resenha nao pode jogar a pessoa na home =========
        # Entrou na V4 e passou por SEIS suites. O rastreador so clica em
        # href^="#/" (rastreador.py:66), e a jornada clica neste mesmo seletor a
        # partir do FEED, onde ele e rota de verdade. Duas suites passando por
        # cima do mesmo defeito, cada uma pelo seu ponto cego.
        print('\no 💬 da resenha rola ate os comentarios, nao troca de tela')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        BANCO['leituras'].append({'id': 'L1', 'perfil': 'uid-2', 'livro': '/works/OL1W',
                                  'nota': 5.0, 'resenha': 'Capitu me pegou.',
                                  'lido_em': '2026-08-20', 'relido': False, 'spoiler': False,
                                  'criado_em': '2026-08-29T22:00:00Z', 'cliente_id': 'c1'})
        BANCO['comentarios'].append({'id': 'M1', 'leitura': 'L1', 'perfil': 'uid-1',
                                     'texto': 'Tambem quero ler.',
                                     'criado_em': '2026-08-30T10:00:00Z'})
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/resenha/L1', wait_until='networkidle')
        pg.wait_for_selector('.resenha', timeout=10000)
        pg.click('.resenha .feed-comentar')
        pg.wait_for_timeout(800)
        checa('o endereco continua o da resenha',
              pg.evaluate('location.hash') == '#/resenha/L1', pg.evaluate('location.hash'))
        checa('a resenha continua na tela', pg.locator('.resenha').count() == 1)
        checa('e os comentarios entraram no campo de visao',
              pg.evaluate("""() => { const s = document.getElementById('comentarios');
                if (!s) return false; const r = s.getBoundingClientRect();
                return r.top < innerHeight && r.bottom > 0; }"""))
        nav.close()

        # ============ sessao vencida nao pode quebrar leitura PUBLICA =========
        # publico() mandava o token mesmo vencido, e o servidor devolvia 401 numa
        # consulta cujo dado e publico. A pessoa lia "Sua sessao expirou" numa
        # ficha de livro que teria carregado com a chave anon.
        print('\nsessao vencida: a leitura publica cai para anon, nao para erro')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        BANCO['leituras'].append({'id': 'L1', 'perfil': 'uid-2', 'livro': '/works/OL1W',
                                  'nota': 4.0, 'resenha': 'boa', 'lido_em': '2026-08-20',
                                  'relido': False, 'spoiler': False,
                                  'criado_em': '2026-08-29T22:00:00Z', 'cliente_id': 'c1'})
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        # Sessao que o APARELHO julga boa (expiraEm no futuro) e o SERVIDOR
        # recusa. E o caso que o relogio nao pega: celular adiantado, token
        # revogado, relogios discordando. So a resposta do servidor revela.
        vencida = dict(SESSAO)
        vencida['token'] = 'tok-VENCIDO'
        semear(pg, sessao=vencida)
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/livro/' + urllib.parse.quote('/works/OL1W', safe=''),
                wait_until='networkidle')
        pg.wait_for_selector('.avaliacoes-media', timeout=10000)
        checa('a media da comunidade carrega com o token vencido',
              pg.inner_text('.avaliacoes-media').strip() == '4,0',
              pg.inner_text('.avaliacoes'))
        checa('e a tela nao fala em sessao expirada',
              'expirou' not in pg.inner_text('.pagina').lower())
        # a consulta publica tem que ter saido SEM Authorization de sessao
        pub = [x for x in pedidos if x[1].endswith('/feed') and 'livro=eq.' in x[2]]
        checa('a consulta publica saiu', len(pub) >= 1)
        nav.close()

        # ===================== a aba Resenhas e da REDE =======================
        # Ela mostrava Dados.logs() filtrado por resenha: exatamente o que ja
        # estava no Diario, com outro desenho. Quem abria esperando ler os
        # outros encontrava a si mesma. No original, Reviews e onde voce le
        # gente.
        print('\naba Resenhas: mostra quem voce segue, nao voce mesma')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        BANCO['seguidores'].append({'seguidor': 'uid-1', 'seguido': 'uid-2'})
        BANCO['leituras'] += [
            {'id': 'R1', 'perfil': 'uid-2', 'livro': '/works/OL1W', 'nota': 5.0,
             'resenha': 'A RESENHA DA BIA, que eu quero ler.', 'lido_em': '2026-08-20',
             'relido': False, 'spoiler': False, 'criado_em': '2026-08-29T22:00:00Z',
             'cliente_id': 'c1'},
            # sem resenha: entra no feed e NAO pode entrar nesta aba
            {'id': 'R2', 'perfil': 'uid-2', 'livro': '/works/OL1W', 'nota': 3.0,
             'resenha': '', 'lido_em': '2026-08-19', 'relido': False, 'spoiler': False,
             'criado_em': '2026-08-28T22:00:00Z', 'cliente_id': 'c2'}]
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg, logs=[{'id': 'meu', 'chave': '/works/OL1W', 'nota': 4.0,
                          'resenha': 'a minha, que ja esta no Diario',
                          'lidoEm': '2026-08-01', 'relido': False, 'spoiler': False,
                          'criadoEm': '2026-08-01T10:00:00Z'}])
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/resenhas', wait_until='networkidle')
        pg.wait_for_selector('.feed-linha', timeout=10000)
        checa('a aba abre na Rede quando ha conta',
              pg.locator('.segmentos-2 a.ativa').inner_text() == 'Rede')
        checa('e mostra a resenha de quem eu sigo',
              'RESENHA DA BIA' in pg.inner_text('#feed-resenhas'))
        checa('leitura SEM resenha nao entra nesta aba',
              pg.locator('.feed-linha').count() == 1,
              '%d linhas' % pg.locator('.feed-linha').count())
        checa('a linha leva ao endereco da resenha',
              pg.locator('a.feed-resenha').first.get_attribute('href') == '#/resenha/R1')

        print('\naba Resenhas: o recorte "Suas" continua existindo')
        pg.click('.segmentos-2 a[href="#/resenhas/suas"]')
        pg.wait_for_selector('.cartao-resenha', timeout=8000)
        checa('e o cartao com a capa, como sempre foi',
              'ja esta no Diario' in pg.inner_text('.cartao-resenha'))
        checa('so a sua, sem as da rede',
              pg.locator('.cartao-resenha').count() == 1)

        print('\naba Resenhas: sem seguir ninguem, "Todas" tem o que ler')
        BANCO['seguidores'][:] = []
        pg.goto(BASE + '#/resenhas/rede', wait_until='networkidle')
        pg.wait_for_selector('.vazio', timeout=10000)
        # .botao e versalete por CSS: comparar sem normalizar mede a folha de
        # estilo, nao o que a tela oferece. Ja tropecei nisto na secao 9b.
        checa('a Rede vazia explica, e oferece o caminho',
              'ver todas' in pg.inner_text('.vazio').lower(), pg.inner_text('.vazio'))
        pg.click('.vazio a[href="#/resenhas/todas"]')
        pg.wait_for_selector('.feed-linha', timeout=10000)
        checa('e Todas tem a resenha da Bia mesmo sem eu seguir ela',
              'RESENHA DA BIA' in pg.inner_text('#feed-resenhas'))
        nav.close()

        # Sem nuvem a aba nao pode fingir que existe rede.
        print('\naba Resenhas: em modo local, abre nas suas e sem segmentos')
        zerar(); estado = {}
        nav, ctx, pg = montar(pw, estado)
        pg.route('**/js/config.js', lambda rt: rt.fulfill(
            status=200, content_type='application/javascript',
            body="var CONFIG = { supabaseUrl: '', supabaseChave: '' };"))
        pg.goto(BASE, wait_until='networkidle')
        semear(pg, logs=[{'id': 'meu', 'chave': '/works/OL1W', 'nota': 4.0,
                          'resenha': 'so minha mesmo', 'lidoEm': '2026-08-01',
                          'relido': False, 'spoiler': False,
                          'criadoEm': '2026-08-01T10:00:00Z'}], sessao=None)
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/resenhas', wait_until='networkidle')
        pg.wait_for_selector('.cartao-resenha', timeout=8000)
        checa('sem nuvem nao ha segunda fileira de segmentos',
              pg.locator('.segmentos-2').count() == 0)
        checa('e a aba mostra o que existe: as suas',
              'so minha mesmo' in pg.inner_text('.cartao-resenha'))
        nav.close()

        # ============================ listas na nuvem =========================
        # Ate aqui as tabelas listas/lista_itens so recebiam dado UMA VEZ na
        # vida, dentro de Nuvem.migrar. Lista criada depois disso morria no
        # aparelho e sumia se a pessoa limpasse o navegador — uma das tres abas
        # do topo do original estava, na pratica, offline.
        print('\nlistas: criar, editar e mexer sobem para o banco')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        BANCO['livros'].append({'chave': '/works/OL2W', 'titulo': 'A Hora da Estrela',
                                'autores': ['Clarice Lispector'], 'ano': 1977})
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.evaluate("""(l) => { const d = JSON.parse(localStorage.getItem('letterbooks:v1'));
          d.livros['/works/OL2W'] = l;
          localStorage.setItem('letterbooks:v1', JSON.stringify(d)); }""",
          {'chave': '/works/OL2W', 'titulo': 'A Hora da Estrela',
           'autores': ['Clarice Lispector'], 'ano': 1977})
        pg.reload(wait_until='networkidle')

        pg.evaluate("() => { const l = Dados.criarLista('Brasileiros', 'os daqui');"
                    "  Dados.alternarNaLista(l.id, '/works/OL1W'); }")
        pg.wait_for_timeout(1400)
        checa('a lista subiu para o banco', len(BANCO['listas']) == 1,
              '%d listas' % len(BANCO['listas']))
        if BANCO['listas']:
            checa('com nome e descricao', BANCO['listas'][0]['nome'] == 'Brasileiros' and
                  BANCO['listas'][0]['descricao'] == 'os daqui')
            # A coluna que nao existia: sem ela, editar depois de migrar criava
            # uma lista NOVA no servidor. E o D27, na outra tabela.
            checa('e com o id do aparelho junto, que e o que evita duplicar',
                  bool(BANCO['listas'][0].get('cliente_id')))
        checa('e o livro entrou como item', len(BANCO['lista_itens']) == 1,
              str(BANCO['lista_itens']))

        print('\nlistas: editar NAO cria uma segunda')
        pg.evaluate("() => { const l = Dados.estado().listas[0];"
                    "  Dados.editarLista(l.id, {nome: 'Brasileiros de sempre'}); }")
        pg.wait_for_timeout(1200)
        checa('continua UMA lista no banco', len(BANCO['listas']) == 1,
              '%d listas' % len(BANCO['listas']))
        checa('com o nome novo', BANCO['listas'][0]['nome'] == 'Brasileiros de sempre')

        print('\nlistas: tirar um livro tira so ele')
        pg.evaluate("() => { const l = Dados.estado().listas[0];"
                    "  Dados.alternarNaLista(l.id, '/works/OL2W'); }")
        pg.wait_for_timeout(1200)
        checa('dois livros na lista', len(BANCO['lista_itens']) == 2,
              str([i['livro'] for i in BANCO['lista_itens']]))
        pg.evaluate("() => { const l = Dados.estado().listas[0];"
                    "  Dados.alternarNaLista(l.id, '/works/OL1W'); }")
        pg.wait_for_timeout(1200)
        checa('sobra so o que ficou', [i['livro'] for i in BANCO['lista_itens']] == ['/works/OL2W'],
              str([i['livro'] for i in BANCO['lista_itens']]))

        print('\nlistas: apagar leva do banco tambem')
        pg.evaluate("() => { const l = Dados.estado().listas[0]; Dados.apagarLista(l.id); }")
        pg.wait_for_timeout(1200)
        checa('a lista saiu do banco', len(BANCO['listas']) == 0)
        nav.close()

        # A outra metade: descer. Quem instala no segundo aparelho encontrava a
        # aba Listas vazia, porque nada nunca desceu.
        print('\nlistas: descem para um aparelho zerado')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        BANCO['listas'].append({'id': 'LST-1', 'perfil': 'uid-1', 'cliente_id': 'cli-1',
                                'nome': 'Para reler', 'descricao': 'os que valem',
                                'criado_em': '2026-08-20T10:00:00Z'})
        BANCO['lista_itens'].append({'lista': 'LST-1', 'livro': '/works/OL1W', 'ordem': 0})
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)              # aparelho sem lista nenhuma
        pg.reload(wait_until='networkidle')
        pg.wait_for_timeout(1600)
        local = pg.evaluate("() => JSON.parse(localStorage.getItem('letterbooks:v1')).listas")
        checa('a lista desceu para o aparelho', len(local) == 1, str(local))
        if local:
            checa('com o nome e a descricao', local[0]['nome'] == 'Para reler')
            checa('com o livro dentro', local[0]['livros'] == ['/works/OL1W'], str(local[0]['livros']))
            checa('e ja amarrada ao servidor', local[0].get('remoto') == 'LST-1')
        pg.goto(BASE + '#/listas', wait_until='networkidle')
        pg.wait_for_timeout(700)
        checa('e a aba Listas DESENHA ela', 'Para reler' in pg.inner_text('.pagina'))

        print('\nlistas: descer duas vezes nao duplica')
        pg.evaluate("() => Sinc.descer()")
        pg.wait_for_timeout(1400)
        local = pg.evaluate("() => JSON.parse(localStorage.getItem('letterbooks:v1')).listas")
        checa('continua uma so', len(local) == 1, '%d listas' % len(local))
        checa('e o livro nao entrou duas vezes',
              local and local[0]['livros'] == ['/works/OL1W'], str(local and local[0]['livros']))
        nav.close()

        # A lista de OUTRA pessoa: publica por politica, entao abre sem conta.
        print('\nlistas: a lista alheia tem tela, e abre sem conta')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        BANCO['listas'].append({'id': 'LST-2', 'perfil': 'uid-2', 'cliente_id': 'cli-2',
                                'nome': 'O que a Bia indica', 'descricao': 'pegue um',
                                'criado_em': '2026-08-20T10:00:00Z'})
        BANCO['lista_itens'].append({'lista': 'LST-2', 'livro': '/works/OL1W', 'ordem': 0})
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg, sessao=None)
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/leitor/bia', wait_until='networkidle')
        pg.wait_for_selector('#listas-do-leitor:not([hidden])', timeout=10000)
        checa('o perfil da Bia mostra as listas dela',
              'O que a Bia indica' in pg.inner_text('#listas-do-leitor'))
        pg.click('#listas-do-leitor a')
        pg.wait_for_selector('.lista-cabecalho', timeout=10000)
        checa('a lista alheia abre sem conta',
              'O que a Bia indica' in pg.inner_text('.titulo-pagina'))
        checa('com o nome de quem criou', 'Bia' in pg.inner_text('.lista-autoria'))
        checa('e o livro aparece', 'Dom Casmurro' in pg.inner_text('.pagina'))
        textos = [t.lower() for t in pg.locator('.linha-botoes .botao').all_inner_texts()]
        checa('sem botao de apagar a lista de outra pessoa',
              not any('apagar' in t for t in textos), str(textos))
        checa('mas com compartilhar, porque o endereco e publico',
              any('compartilhar' in t for t in textos), str(textos))
        nav.close()

        # ================== um endereco so para a resenha =====================
        # O achado: a mesma resenha tinha DOIS enderecos. #/resenha/<id local>
        # lia o id gerado no aparelho — que so existe no localStorage de quem
        # escreveu, entao o link mandado para outra pessoa caia em "Esta
        # resenha nao existe mais". #/leitura/<uuid> abria para todo mundo mas
        # nao tinha editar, apagar nem compartilhar. A ponte ja estava no dado:
        # log.remoto.
        print('\nresenha: o apelido local redireciona para o endereco publico')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        BANCO['leituras'].append({'id': 'UUID-1', 'perfil': 'uid-1', 'livro': '/works/OL1W',
                                  'nota': 4.5, 'resenha': 'O narrador nao merece confianca.',
                                  'lido_em': '2026-08-20', 'relido': False, 'spoiler': False,
                                  'criado_em': '2026-08-21T10:00:00Z',
                                  'cliente_id': 'meu-log'})
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg, logs=[{'id': 'meu-log', 'chave': '/works/OL1W', 'nota': 4.5,
                          'resenha': 'O narrador nao merece confianca.',
                          'lidoEm': '2026-08-20', 'relido': False, 'spoiler': False,
                          'criadoEm': '2026-08-21T10:00:00Z', 'remoto': 'UUID-1'}])
        pg.reload(wait_until='networkidle')

        # Abrir pelo APELIDO, que e o que o glifo do diario e o cartao montam.
        pg.goto(BASE + '#/resenha/meu-log', wait_until='networkidle')
        pg.wait_for_selector('.resenha', timeout=10000)
        checa('o apelido local leva ao endereco publico',
              pg.evaluate('location.hash') == '#/resenha/UUID-1',
              pg.evaluate('location.hash'))
        # replace e nao assign: o apelido nao pode ficar no historico, senao o
        # botao voltar devolve a pessoa para ele e o app pinga entre os dois.
        pg.go_back()
        pg.wait_for_timeout(700)
        checa('e voltar NAO cai de novo no apelido',
              'meu-log' not in pg.evaluate('location.hash'),
              pg.evaluate('location.hash'))

        pg.goto(BASE + '#/resenha/UUID-1', wait_until='networkidle')
        pg.wait_for_selector('.resenha-estado', timeout=10000)
        checa('a autora ve, escrito, que a resenha esta no ar',
              'no ar' in pg.inner_text('.resenha-estado').lower())
        textos = [t.lower() for t in pg.locator('.resenha-botoes .botao').all_inner_texts()]
        checa('e a zona de acao tem as quatro: compartilhar, editar, ver, apagar',
              all(x in ' '.join(textos) for x in
                  ('compartilhar', 'editar', 'ver o livro', 'apagar')), str(textos))
        checa('com o coracao e os comentarios, que so existem porque ha linha no servidor',
              pg.locator('.resenha .feed-curtir').count() == 1 and
              pg.locator('#comentarios').count() == 1)

        # A folha de compartilhar: o link vem PRIMEIRO e a imagem por ultimo,
        # ao contrario do que o app fazia — ate aqui "Compartilhar" so sabia
        # mandar uma imagem do LIVRO, e nao havia `url` em lugar nenhum.
        pg.locator('[data-acao=compartilhar-resenha]').click()
        pg.wait_for_selector('.folha', timeout=5000)
        linhas = pg.locator('.folha .linhas button').all_inner_texts()
        checa('a folha oferece o link antes da imagem',
              'link' in linhas[0].lower() and 'imagem' in linhas[-1].lower(), str(linhas))
        checa('e o endereco mostrado e o publico, nao o apelido',
              'UUID-1' in pg.inner_text('.folha .valor') or
              'uuid-1' in pg.inner_text('.folha .valor').lower(),
              pg.inner_text('.folha .valor'))
        pg.locator('.folha-rodape .botao').click()
        pg.wait_for_timeout(300)
        checa('fechar fecha', pg.locator('.folha').count() == 0)
        nav.close()

        # Servidor apagou, aparelho nao. A resenha esta INTACTA no localStorage
        # e nao pode ficar inalcancavel a partir do proprio diario de quem
        # escreveu — cair no estado vazio seria perder o texto de vista.
        print('\nresenha: apagada no servidor, intacta no aparelho')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)          # o banco NAO tem a leitura
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg, logs=[{'id': 'meu-log', 'chave': '/works/OL1W', 'nota': 4.5,
                          'resenha': 'Continua aqui.', 'lidoEm': '2026-08-20',
                          'relido': False, 'spoiler': False,
                          'criadoEm': '2026-08-21T10:00:00Z', 'remoto': 'UUID-1'}])
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/resenha/UUID-1', wait_until='networkidle')
        pg.wait_for_selector('.resenha', timeout=10000)
        checa('a resenha aparece do aparelho, e nao "nao achei"',
              'Continua aqui' in pg.inner_text('.resenha-texto'))
        checa('e o texto nao fica inalcancavel a partir do diario',
              pg.locator('.vazio').count() == 0)
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
        pg.goto(BASE + '#/resenha/L1', wait_until='networkidle')
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
        pg.goto(BASE + '#/resenha/L1', wait_until='networkidle')
        pg.wait_for_selector('.resenha', timeout=10000)
        pg.wait_for_timeout(900)
        checa('sem conta, abrir uma leitura nao estoura javascript',
              not estouros, '; '.join(estouros[:2]))
        nav.close()

        # ================================ privacidade do diario ==============
        #
        # ATENCAO AO QUE ESTAS ASSERCOES PROVAM E AO QUE NAO PROVAM. Elas
        # provam a TELA: o que o app desenha quando as linhas nao chegam. Quem
        # prova as POLITICAS e servidor/provar-v4.sql, contra um Postgres real
        # — este mock nao aplica RLS, ele imita o efeito das seis portas.
        # Escrever so estas e achar que a privacidade esta testada seria a
        # ilusao que o cabecalho do provar-v3.sql ja descreve.
        print('\nprivacidade: o diario fechado da outra pessoa')
        zerar(); estado = {}
        BANCO['perfis'][1]['privado'] = True          # a Bia fecha o diario
        BANCO['livros'].append(LIVRO)
        BANCO['leituras'].append({'id': 'L9', 'perfil': 'uid-2', 'livro': '/works/OL1W',
                                  'nota': 5, 'resenha': 'Adorei.', 'lido_em': '2026-08-20',
                                  'criado_em': '2026-08-20T00:00:00Z', 'cliente_id': 'b1'})
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/leitor/bia', wait_until='networkidle')
        pg.wait_for_selector('.perfil-topo', timeout=10000)
        pg.wait_for_timeout(900)
        texto = pg.inner_text('body')
        checa('o perfil de quem fechou diz que esta FECHADO', 'está fechado' in texto)
        # A assercao que importa: "Ainda sem leituras registradas" AFIRMA que a
        # pessoa nao leu nada. Para um diario fechado isso e falso, e passa a
        # ser o estado mais comum desta tela.
        checa('e NAO diz "ainda sem leituras", que seria mentira',
              'Ainda sem leituras' not in texto)
        checa('a resenha dela nao aparece', 'Adorei.' not in texto)
        checa('o botao de seguir continua', pg.locator('#botao-seguir').count() == 1)
        # O numero de leituras e conteudo do diario: mostra-lo vazaria o
        # TAMANHO do que esta fechado.
        checa('e a contagem de Leituras nao e desenhada',
              'Leituras' not in pg.inner_text('#leitor-numeros'))
        nav.close()

        print('\nprivacidade: a ficha do livro e o link antigo')
        zerar(); estado = {}
        BANCO['perfis'][1]['privado'] = True
        BANCO['livros'].append(LIVRO)
        BANCO['leituras'].append({'id': 'L9', 'perfil': 'uid-2', 'livro': '/works/OL1W',
                                  'nota': 5, 'resenha': 'Adorei.', 'lido_em': '2026-08-20',
                                  'criado_em': '2026-08-20T00:00:00Z', 'cliente_id': 'b1'})
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/livro/' + '%2Fworks%2FOL1W', wait_until='networkidle')
        pg.wait_for_timeout(1500)
        checa('a nota de quem fechou sai da media da comunidade',
              'Adorei.' not in pg.inner_text('body'))
        # A ambiguidade e deliberada: distinguir "apagada" de "escondida"
        # exigiria que o servidor respondesse coisas diferentes nos dois casos,
        # e essa diferenca de resposta E o vazamento.
        pg.goto(BASE + '#/resenha/L9', wait_until='networkidle')
        pg.wait_for_timeout(1200)
        t = pg.inner_text('body')
        checa('um link antigo de resenha fechada nao abre', 'Adorei.' not in t)
        checa('e a frase cobre os DOIS casos, sem dizer qual foi',
              'apagada' in t and 'fechou o diário' in t)
        nav.close()

        print('\nprivacidade: a minha chave, e as frases que ela muda')
        zerar(); estado = {}
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/privacidade', wait_until='networkidle')
        pg.wait_for_selector('.linhas [role=radio]', timeout=10000)
        pg.wait_for_timeout(800)
        checa('a tela abre em Publico',
              pg.locator('[data-valor=publico]').get_attribute('aria-checked') == 'true')
        # .lower(): o .rotulo e uppercase por CSS e inner_text devolve o texto
        # RENDERIZADO, nao o do HTML. Comparar com a forma escrita no fonte
        # falharia por causa do estilo, que nao e o que esta assercao mede.
        checa('o espelho mostra o que o visitante ve',
              'como outra pessoa vê você' in pg.inner_text('#espelho').lower())
        pg.locator('[data-valor=fechado]').click()
        pg.wait_for_timeout(1200)
        checa('fechar grava na hora, sem botao de salvar',
              any(m == 'PATCH' and '/perfis' in c for m, c, _, _ in pedidos))
        checa('e o banco recebeu privado=true',
              BANCO['perfis'][0].get('privado') is True)
        checa('o espelho passa a mostrar o vazio que o visitante le',
              'está fechado' in pg.inner_text('#espelho'))
        pg.goto(BASE + '#/perfil', wait_until='networkidle')
        pg.wait_for_timeout(700)
        checa('o meu perfil ganha a marca de diario fechado',
              pg.locator('.estado-exposicao').count() == 1)
        pg.goto(BASE + '#/conta', wait_until='networkidle')
        pg.wait_for_timeout(1000)
        checa('e a linha da conta diz Fechado', 'Fechado' in pg.inner_text('.linhas'))
        nav.close()

        print('\nconta sem perfil: o PATCH que nao casa linha nenhuma')
        zerar(vazio=True); estado = {}
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/conta', wait_until='networkidle')
        pg.wait_for_selector('.conta', timeout=10000)
        pg.wait_for_timeout(800)
        checa('a tela diz que a conta esta sem perfil',
              'não tem um perfil' in pg.inner_text('.conta'))
        # O PostgREST devolve 200 com lista VAZIA quando o PATCH nao casa nada.
        # Antes isso virava null e a tela dizia "Perfil salvo." repintando com o
        # perfil velho: o unico rotulo que mente pior que um vazio e um "salvo"
        # sobre coisa nenhuma.
        r = pg.evaluate("() => Nuvem.salvarPerfil({nome:'x'})"
                        ".then(() => 'ACEITOU', e => 'recusou: ' + e.message)")
        checa('e salvar sem perfil RECUSA, em vez de dizer que salvou',
              r.startswith('recusou'), r)
        nav.close()

        # ================================ apagar a conta =====================
        print('\napagar a conta: a folha diz o que some, e some')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        BANCO['leituras'].append({'id': 'L1', 'perfil': 'uid-1', 'livro': '/works/OL1W',
                                  'nota': 5, 'resenha': 'Minha resenha.', 'lido_em': '2026-08-20',
                                  'criado_em': '2026-08-20T00:00:00Z', 'cliente_id': 'a1'})
        # o comentario que EU escrevi na resenha de OUTRA pessoa: e o efeito
        # colateral que ninguem espera, e o que a folha tem que dizer em voz alta
        BANCO['leituras'].append({'id': 'L2', 'perfil': 'uid-2', 'livro': '/works/OL1W',
                                  'nota': 4, 'lido_em': '2026-08-21',
                                  'criado_em': '2026-08-21T00:00:00Z', 'cliente_id': 'b1'})
        BANCO['comentarios'].append({'id': 'c1', 'leitura': 'L2', 'perfil': 'uid-1',
                                     'texto': 'Concordo.', 'criado_em': '2026-08-22T00:00:00Z'})
        BANCO['seguidores'].append({'seguidor': 'uid-2', 'seguido': 'uid-1'})
        BANCO['_contas']['marcela@exemplo.com'] = 'uid-1'
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.reload(wait_until='networkidle')
        # A fila entra SEMEADA de propósito. Sem uma fila de verdade aqui, a
        # asserção da limpeza passava dos dois lados: não havia nada para
        # sobrar. Foi o teste-desfeito que mostrou isso — o `migrado` ficava
        # vermelho e a `fila` continuava verde, medindo o vazio.
        pg.evaluate("""() => {
          localStorage.setItem('letterbooks:migrado:uid-1', '2026-08-01');
          localStorage.setItem('letterbooks:fila', JSON.stringify(
            [{tipo:'leitura', dado:{cliente_id:'a1'}, tentativas:0, em:1}]));
        }""")
        pg.goto(BASE + '#/conta', wait_until='networkidle')
        pg.wait_for_selector('[data-acao=apagar-conta]', timeout=10000)
        pg.locator('[data-acao=apagar-conta]').click()
        pg.wait_for_selector('.folha', timeout=8000)
        pg.wait_for_timeout(1200)
        folha = pg.inner_text('.folha')
        checa('a folha diz QUAL conta, com o @', '@marcela' in folha)
        checa('e diz que os comentarios nas resenhas alheias somem junto',
              'resenhas de outras pessoas' in folha)
        checa('e que o diario deste aparelho fica', 'continua aqui' in folha)
        checa('oferece exportar antes',
              pg.locator('[data-acao=exportar-antes]').count() == 1)
        botao = pg.locator('[data-acao=confirmar-apagar-conta]')
        checa('o Apagar comeca DESLIGADO', botao.is_disabled())
        pg.fill('#confirma-usuario', 'marcel')
        pg.wait_for_timeout(250)
        checa('e continua desligado com o @ pela metade', botao.is_disabled())
        pg.fill('#confirma-usuario', '@marcela')
        pg.wait_for_timeout(250)
        checa('liga quando o @ confere', not botao.is_disabled())
        botao.click()
        pg.wait_for_timeout(1800)
        checa('a conta sumiu do servidor',
              not [x for x in BANCO['perfis'] if x['id'] == 'uid-1'])
        checa('o e-mail e a senha foram junto — nao so o perfil',
              'uid-1' not in BANCO.get('_contas', {}).values())
        checa('as minhas leituras sumiram',
              not [x for x in BANCO['leituras'] if x['perfil'] == 'uid-1'])
        checa('o comentario que escrevi na resenha de outra pessoa sumiu',
              not BANCO['comentarios'])
        checa('e quem me seguia deixou de seguir', not BANCO['seguidores'])
        checa('a leitura da outra pessoa continua intacta',
              len([x for x in BANCO['leituras'] if x['perfil'] == 'uid-2']) == 1)
        # Sem esta limpeza a fila volta a empurrar leituras para um perfil que
        # nao existe mais: erro de chave estrangeira que nao casa com
        # /conex|sess/, cinco tentativas e descarte com console.warn. O diario
        # local para de subir para sempre, sem uma linha de erro na tela. E a
        # marca de migrado esconderia o botao de migrar para sempre.
        sobrou = pg.evaluate("() => [localStorage.getItem('letterbooks:fila'), localStorage.getItem('letterbooks:migrado:uid-1'), localStorage.getItem('letterbooks:sessao')]")
        checa('a fila, a marca de migrado e a sessao foram limpas do aparelho',
              not any(sobrou), str(sobrou))
        checa('mas o diario deste aparelho continua aqui',
              pg.evaluate("() => !!localStorage.getItem('letterbooks:v1')"))
        nav.close()

        # ================================ denunciar ==========================
        #
        # A REGRA destas assercoes, e ela vem do tech lead: afirmar contra
        # BANCO['denuncias'], nunca contra a folha dizer "registrada". A folha
        # pinta sucesso a partir do que a nuvem devolve, e mock frouxo devolve
        # sucesso para qualquer coisa — foi assim seis vezes.
        print('\ndenunciar: a resenha de outra pessoa')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        BANCO['leituras'].append({'id': 'L9', 'perfil': 'uid-2', 'livro': '/works/OL1W',
                                  'nota': 5, 'resenha': 'Resenha da Bia.',
                                  'lido_em': '2026-08-20',
                                  'criado_em': '2026-08-20T00:00:00Z', 'cliente_id': 'b1'})
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/resenha/L9', wait_until='networkidle')
        pg.wait_for_selector('.resenha', timeout=10000)
        pg.wait_for_timeout(900)
        checa('a resenha alheia oferece denunciar',
              pg.locator('[data-acao=denunciar-resenha]').count() == 1)
        pg.locator('[data-acao=denunciar-resenha]').click()
        pg.wait_for_selector('.folha', timeout=8000)
        folha = pg.inner_text('.folha')
        checa('a folha diz de quem e', '@bia' in folha)
        checa('e nao promete analise nem prazo',
              'analis' not in folha.lower() and 'prazo' not in folha.lower()
              and '24 horas' not in folha)
        checa('quatro motivos, sem caixa de texto',
              pg.locator('[data-acao=enviar-denuncia]').count() == 4
              and pg.locator('.folha textarea').count() == 0)
        pg.locator('[data-acao=enviar-denuncia][data-motivo=ataque]').click()
        pg.wait_for_timeout(1200)
        # a assercao que importa: contra o BANCO, e comparando com a fonte
        d = BANCO['denuncias']
        checa('gravou UMA denuncia no banco', len(d) == 1, str(d))
        checa('com o motivo em codigo, nao a frase da tela',
              d and d[0].get('motivo') == 'ataque', str(d[:1]))
        checa('apontando para a leitura, e nao para comentario',
              d and d[0].get('leitura') == 'L9' and not d[0].get('comentario'))
        checa('e assinada por QUEM denunciou',
              d and d[0].get('autor') == 'uid-1')
        confirma = pg.inner_text('.folha')
        checa('a confirmacao diz que nao ha moderacao',
              'não tem equipe de moderação' in confirma)
        checa('e que o efeito e so neste aparelho', 'neste aparelho' in confirma)
        nav.close()

        print('\ndenunciar: some das listas, e a pagina continua abrindo')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        for n in (1, 2):
            BANCO['leituras'].append({'id': 'L%d' % n, 'perfil': 'uid-2',
                                      'livro': '/works/OL1W', 'nota': 5,
                                      'resenha': 'Resenha %d.' % n, 'lido_em': '2026-08-2%d' % n,
                                      'criado_em': '2026-08-2%dT00:00:00Z' % n,
                                      'cliente_id': 'b%d' % n})
        BANCO['seguidores'].append({'seguidor': 'uid-1', 'seguido': 'uid-2'})
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/atividade/todos', wait_until='networkidle')
        pg.wait_for_timeout(1200)
        antes = pg.locator('.feed-linha').count()
        # compara com a FONTE, nao com "existe pelo menos um"
        checa('o feed mostra as duas que a API tem',
              antes == len(BANCO['leituras']), '%d na tela, %d na API' % (antes, len(BANCO['leituras'])))
        pg.goto(BASE + '#/resenha/L1', wait_until='networkidle')
        pg.wait_for_selector('.resenha', timeout=10000)
        pg.locator('[data-acao=denunciar-resenha]').click()
        pg.wait_for_selector('.folha', timeout=8000)
        pg.locator('[data-acao=enviar-denuncia][data-motivo=spam]').click()
        pg.wait_for_timeout(1200)
        pg.locator('.folha [data-fechar=ok]').click()
        pg.wait_for_timeout(600)
        pg.goto(BASE + '#/atividade/todos', wait_until='networkidle')
        pg.wait_for_timeout(1200)
        depois = pg.locator('.feed-linha').count()
        checa('a denunciada some do feed, e so ela',
              depois == antes - 1, '%d -> %d' % (antes, depois))
        checa('mas a API continua com as duas: esconder nao apaga',
              len(BANCO['leituras']) == 2)
        # recarregar o app inteiro: o esconder tem que sobreviver
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/atividade/todos', wait_until='networkidle')
        pg.wait_for_timeout(1200)
        checa('e continua escondida depois de recarregar',
              pg.locator('.feed-linha').count() == antes - 1)
        # a pagina propria continua abrindo, com o corpo coberto
        pg.goto(BASE + '#/resenha/L1', wait_until='networkidle')
        pg.wait_for_selector('.resenha', timeout=10000)
        pg.wait_for_timeout(600)
        checa('a pagina da resenha denunciada continua abrindo',
              pg.locator('.resenha').count() == 1)
        checa('com o texto coberto, nao sumido',
              'Resenha 1.' not in pg.inner_text('body')
              and 'denunciou esta resenha' in pg.inner_text('body'))
        checa('e o botao de denunciar virou uma frase',
              pg.locator('[data-acao=denunciar-resenha]').count() == 0)
        # a volta atras
        pg.goto(BASE + '#/privacidade', wait_until='networkidle')
        pg.wait_for_timeout(1000)
        checa('privacidade oferece desfazer o esconder',
              pg.locator('[data-acao=mostrar-denunciados]').count() == 1)
        pg.locator('[data-acao=mostrar-denunciados]').click()
        pg.wait_for_timeout(800)
        pg.goto(BASE + '#/atividade/todos', wait_until='networkidle')
        pg.wait_for_timeout(1200)
        checa('e desfazer traz as duas de volta',
              pg.locator('.feed-linha').count() == antes)
        checa('sem apagar a denuncia do banco', len(BANCO['denuncias']) == 1)
        nav.close()

        print('\ndenunciar: o que NAO pode aparecer')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        BANCO['leituras'].append({'id': 'M1', 'perfil': 'uid-1', 'livro': '/works/OL1W',
                                  'nota': 5, 'resenha': 'Minha resenha.',
                                  'lido_em': '2026-08-20',
                                  'criado_em': '2026-08-20T00:00:00Z', 'cliente_id': 'a1'})
        BANCO['comentarios'].append({'id': 'c1', 'leitura': 'M1', 'perfil': 'uid-2',
                                     'texto': 'Comentario da Bia.',
                                     'criado_em': '2026-08-21T00:00:00Z'})
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/resenha/M1', wait_until='networkidle')
        pg.wait_for_selector('.resenha', timeout=10000)
        pg.wait_for_timeout(900)
        checa('na MINHA resenha nao ha como me denunciar',
              pg.locator('[data-acao=denunciar-resenha]').count() == 0)
        checa('mas o comentario de outra pessoa pode ser denunciado',
              pg.locator('[data-acao=denunciar-comentario]').count() == 1)
        # o achado do GPM: o RLS ja deixava a dona apagar, e a tela nao oferecia
        checa('e a DONA da resenha pode apagar o comentario alheio',
              pg.locator('.comentario [data-acao=apagar-comentario]').count() == 1)
        pg.locator('[data-acao=denunciar-comentario]').click()
        pg.wait_for_selector('.folha', timeout=8000)
        pg.locator('[data-acao=enviar-denuncia][data-motivo=spoiler]').click()
        pg.wait_for_timeout(1200)
        d = BANCO['denuncias']
        checa('a denuncia do comentario aponta para comentario, nao leitura',
              len(d) == 1 and d[0].get('comentario') == 'c1' and not d[0].get('leitura'),
              str(d))
        nav.close()

        print('\ndenunciar: sem conta, e quando a rede cai')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        BANCO['leituras'].append({'id': 'L9', 'perfil': 'uid-2', 'livro': '/works/OL1W',
                                  'nota': 5, 'resenha': 'Resenha da Bia.',
                                  'lido_em': '2026-08-20',
                                  'criado_em': '2026-08-20T00:00:00Z', 'cliente_id': 'b1'})
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg, sessao=None)
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/resenha/L9', wait_until='networkidle')
        pg.wait_for_selector('.resenha', timeout=10000)
        pg.wait_for_timeout(800)
        pg.locator('[data-acao=denunciar-resenha]').click()
        pg.wait_for_selector('.folha', timeout=8000)
        checa('sem conta, a folha convida a entrar em vez de esconder o botao',
              'Entrar ou criar conta' in pg.inner_text('.folha'))
        checa('e nenhuma denuncia foi feita', not BANCO['denuncias'])
        nav.close()

        # A REDE CAI: o pior defeito possivel aqui e esconder sem ter
        # denunciado — a pessoa acreditaria que denunciou e nao denunciou.
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        BANCO['leituras'].append({'id': 'L9', 'perfil': 'uid-2', 'livro': '/works/OL1W',
                                  'nota': 5, 'resenha': 'Resenha da Bia.',
                                  'lido_em': '2026-08-20',
                                  'criado_em': '2026-08-20T00:00:00Z', 'cliente_id': 'b1'})
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/resenha/L9', wait_until='networkidle')
        pg.wait_for_selector('.resenha', timeout=10000)
        pg.locator('[data-acao=denunciar-resenha]').click()
        pg.wait_for_selector('.folha', timeout=8000)
        estado['cair'] = True
        pg.locator('[data-acao=enviar-denuncia][data-motivo=ataque]').click()
        pg.wait_for_timeout(1500)
        estado['cair'] = False
        checa('rede fora: nada no banco', not BANCO['denuncias'])
        guardado = pg.evaluate("() => localStorage.getItem('letterbooks:denunciados')")
        checa('rede fora: NADA escondido no aparelho', not guardado, str(guardado))
        checa('rede fora: a folha continua aberta, dizendo o que houve',
              pg.locator('.folha').count() == 1
              and not pg.locator('#denuncia-erro').is_hidden())
        nav.close()

        # ============================ a estante de outra pessoa ==============
        #
        # DUAS coisas que este bloco faz de propósito, e as duas vêm de furos
        # que o tech lead achou no mock:
        #
        # 1. Semeia BANCO['marcadores']. Ele nascia vazio em zerar() e NADA nas
        #    1706 linhas do arquivo punha linha lá. Um teste escrito sem semear
        #    passaria verde contra o nada.
        # 2. Usa um SEGUNDO livro (/works/OL2W) que existe só no BANCO. Toda
        #    cena de conteúdo alheio usava /works/OL1W — o mesmo que semear()
        #    grava no localStorage —, então o aparelho já tinha a ficha,
        #    completarLivros pulava e livrosPorChave NUNCA rodava. O caminho de
        #    resolução de capa nunca foi exercitado nesta casa, nem hoje.
        print('\nperfil alheio: os favoritos e a estante')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        BANCO['livros'].append({'chave': '/works/OL2W', 'titulo': 'Vidas Secas',
                                'autores': ['Graciliano Ramos'], 'ano': 1938,
                                'capa': 'c2.jpg', 'paginas': 176,
                                # sem estes dois a asserção do D94 mediria o vazio
                                'autores_ids': ['/authors/OL1A'],
                                'sinopse': 'A família de Fabiano atravessa o sertão.'})
        BANCO['marcadores'] += [
            {'perfil': 'uid-2', 'livro': '/works/OL2W', 'tipo': 'favorito',
             'criado_em': '2026-08-20T00:00:00Z'},
            {'perfil': 'uid-2', 'livro': '/works/OL1W', 'tipo': 'quero',
             'criado_em': '2026-08-21T00:00:00Z'},
            {'perfil': 'uid-2', 'livro': '/works/OL2W', 'tipo': 'curtida',
             'criado_em': '2026-08-22T00:00:00Z'},
            # Aponta para um livro que NÃO existe nem no aparelho nem no
            # servidor: livrosPorChave não vai resolvê-lo nunca. É o caso
            # permanente, e é o que prende o defeito — `livroDe` devolve
            # `titulo: 'Livro'` para o que não chegou, e sem o filtro a
            # prateleira desenhava um cartão dizendo "Livro", para sempre.
            {'perfil': 'uid-2', 'livro': '/works/OL_FANTASMA', 'tipo': 'quero',
             'criado_em': '2026-08-23T00:00:00Z'},
        ]
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        # O APARELHO precisa ter marcado os MESMOS livros, senão a asserção do
        # selo passa dos dois lados: htmlCartao só emite `.selos` quando EU
        # marquei, e um diário local vazio não emite nada nem com o cartão
        # errado. Descobri isso desfazendo o conserto — a suíte continuou
        # verde, que é o mesmo que não ter teste.
        pg.evaluate("""() => {
          var e = JSON.parse(localStorage.getItem('letterbooks:v1'));
          e.curtidas = ['/works/OL2W'];
          e.querLer  = ['/works/OL1W'];
          e.favoritos = ['/works/OL2W'];
          localStorage.setItem('letterbooks:v1', JSON.stringify(e));
        }""")
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/leitor/bia', wait_until='networkidle')
        pg.wait_for_selector('.perfil-topo', timeout=10000)
        pg.wait_for_timeout(1500)

        checa('os favoritos aparecem, e acima das contagens',
              not pg.locator('#favoritos-do-leitor').is_hidden())
        # compara com a FONTE, não com "existe pelo menos um"
        favs_api = len([m for m in BANCO['marcadores']
                        if m['perfil'] == 'uid-2' and m['tipo'] == 'favorito'])
        checa('e a vitrine mostra o mesmo número que a API tem',
              pg.locator('#favoritos-do-leitor .cartao').count() == favs_api,
              '%d na tela, %d na API' % (pg.locator('#favoritos-do-leitor .cartao').count(), favs_api))
        ordem = pg.evaluate("""() => {
          var f = document.getElementById('favoritos-do-leitor');
          var n = document.getElementById('leitor-numeros');
          return f.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING ? 'antes' : 'depois';
        }""")
        checa('a vitrine vem ANTES do bloco de contagens', ordem == 'antes', ordem)

        texto = pg.inner_text('#estante-do-leitor')
        checa('a estante tem Quero ler e Curtidos',
              'Quero ler' in texto and 'Curtidos' in texto)
        checa('e NÃO tem uma prateleira "Lidos" — isso já é "Leu recentemente"',
              'Lidos' not in texto)
        # o furo nº 2: este livro só existe no BANCO, então a capa TEVE que ser
        # resolvida pela rede para o título aparecer
        checa('o livro que só existe no servidor foi resolvido e tem título',
              'Vidas Secas' in pg.inner_text('body'))
        # D94: as duas cópias do mapa snake→camel tinham divergido, e a do
        # app.js descartava sinopse e autores_ids. Agora há uma cópia só, em
        # Dados.guardarLivroDaLinha — esta asserção é o que prende a volta dela.
        guardado = pg.evaluate(
            "() => (JSON.parse(localStorage.getItem('letterbooks:v1')).livros||{})['/works/OL2W']")
        checa('e chegou COMPLETO no aparelho, com sinopse e ids de autoria',
              bool(guardado) and 'sinopse' in guardado and 'autoresIds' in guardado,
              str(sorted(guardado.keys()) if guardado else None))

        # o achado do GPM e do tech lead: htmlCartao carimba os MEUS marcadores
        # o aparelho marcou os dois livros logo acima, então um cartão errado
        # AQUI carimbaria — é o que faz esta asserção valer alguma coisa
        checa('nenhum cartão diz "Livro" — o que não chegou não é desenhado',
              pg.evaluate("""() => [...document.querySelectorAll(
                '#estante-do-leitor .cartao, #favoritos-do-leitor .cartao')]
                .every(c => c.getAttribute('aria-label') !== 'Livro')"""))
        # o aparelho marcou os dois livros logo acima, então um cartão errado
        # AQUI carimbaria — é o que faz esta asserção valer alguma coisa
        checa('nenhum cartão da estante alheia carimba selo meu',
              pg.locator('#estante-do-leitor .selos').count() == 0
              and pg.locator('#favoritos-do-leitor .selos').count() == 0)
        checa('nem o trilho "Leu recentemente" do perfil alheio',
              pg.evaluate("""() => {
                var s = [...document.querySelectorAll('.secao')].find(
                  x => x.querySelector('h2') && /Leu recentemente/.test(x.querySelector('h2').innerText));
                return !s || s.querySelectorAll('.selos').length === 0;
              }"""))
        nav.close()

        print('\nperfil alheio: estante vazia e diário fechado')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/leitor/bia', wait_until='networkidle')
        pg.wait_for_selector('.perfil-topo', timeout=10000)
        pg.wait_for_timeout(1200)
        corpo = pg.inner_text('body')
        checa('sem marcador nenhum, as seções não são desenhadas',
              pg.locator('#estante-do-leitor').is_hidden()
              and pg.locator('#favoritos-do-leitor').is_hidden())
        # os vazios da estante são instrução em SEGUNDA pessoa dirigida ao dono
        checa('e nenhum texto manda o visitante arrumar a prateleira alheia',
              'Marque' not in corpo and 'Escolha até' not in corpo)
        nav.close()

        zerar(); estado = {}
        BANCO['perfis'][1]['privado'] = True
        BANCO['livros'].append(LIVRO)
        BANCO['marcadores'].append({'perfil': 'uid-2', 'livro': '/works/OL1W',
                                    'tipo': 'favorito', 'criado_em': '2026-08-20T00:00:00Z'})
        nav, ctx, pg = montar(pw, estado)
        pedidos_marcadores = []
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.reload(wait_until='networkidle')
        pg.on('request', lambda r: pedidos_marcadores.append(r.url)
              if '/rest/v1/marcadores' in r.url else None)
        pg.goto(BASE + '#/leitor/bia', wait_until='networkidle')
        pg.wait_for_selector('.perfil-topo', timeout=10000)
        pg.wait_for_timeout(1500)
        checa('com o diário fechado, a estante nem é pedida à rede',
              not pedidos_marcadores, str(pedidos_marcadores[:1]))
        checa('e as seções continuam escondidas',
              pg.locator('#estante-do-leitor').is_hidden())
        checa('a frase "está fechado" aparece UMA vez, não uma por seção',
              pg.inner_text('body').count('está fechado') == 1)
        nav.close()

        # ============ item 14: o histograma e o diário do perfil alheio ====
        #
        # 57 leituras, e o número É o teste: MAIS que o limite de 40 de
        # leiturasDe. É ele que separa "a distribuição veio do servidor" de "a
        # distribuição veio da janela que a tela já tinha em mãos". Com um
        # fixture de 5 linhas as duas implementações passam iguais — que é o
        # mesmo que não ter teste.
        print('\nperfil alheio: o histograma vem da vida inteira, não da janela')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        BANCO['livros'].append({'chave': '/works/OL2W', 'titulo': 'Vidas Secas',
                                'autores': ['Graciliano Ramos'], 'ano': 1938,
                                'capa': 'c2.jpg'})
        for i in range(57):
            BANCO['leituras'].append({
                'id': 'L%02d' % i, 'perfil': 'uid-2',
                'livro': '/works/OL1W' if i % 2 else '/works/OL2W',
                'nota': [5.0, 4.0, 3.5][i % 3],
                'resenha': None, 'spoiler': False, 'relido': False,
                # as mais ANTIGAS são as de nota 3,5 — se a tela somar só as 40
                # mais recentes, é essa faixa que encolhe
                'lido_em': '2026-%02d-%02d' % (i // 28 + 1, i % 28 + 1),
                'criado_em': '2026-01-01T00:00:00Z', 'cliente_id': 'c%d' % i})
        # uma leitura SEM nota: não entra em barra nenhuma, mas TEM que entrar
        # no total da linha "Leituras"
        BANCO['leituras'].append({
            'id': 'Lsem', 'perfil': 'uid-2', 'livro': '/works/OL1W', 'nota': None,
            'resenha': None, 'spoiler': False, 'relido': False,
            'lido_em': '2025-01-01', 'criado_em': '2025-01-01T00:00:00Z',
            'cliente_id': 'csem'})
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/leitor/bia', wait_until='networkidle')
        pg.wait_for_selector('#notas-do-leitor .histograma', timeout=10000)

        # A FONTE: a contagem por nota que a API tem, não a que a tela mostrou.
        fonte = {}
        for l in BANCO['leituras']:
            if l['perfil'] == 'uid-2' and l['nota'] is not None:
                fonte[l['nota']] = fonte.get(l['nota'], 0) + 1
        total_api = sum(fonte.values())

        na_tela = pg.evaluate("""() => {
          var h = document.querySelector('#notas-do-leitor .histograma');
          if (!h) return -1;
          return [].slice.call(h.querySelectorAll('.col')).reduce(function (s, c) {
            var m = (c.getAttribute('title') || '').match(/— (\\d+)/);
            return s + (m ? parseInt(m[1], 10) : 0);
          }, 0);
        }""")
        checa('o histograma alheio soma o que a API tem, não as 40 da janela',
              na_tela == total_api,
              '%d na tela, %d na API (leiturasDe traz no máximo 40)' % (na_tela, total_api))

        # total certo com baldes trocados também é errado
        baldes = pg.evaluate("""() => {
          var o = {};
          [].slice.call(document.querySelectorAll('#notas-do-leitor .col'))
            .forEach(function (c) {
              var m = (c.getAttribute('title') || '').match(/^([\\d,]+) — (\\d+)/);
              if (m) o[m[1]] = parseInt(m[2], 10);
            });
          return o;
        }""")
        # O rótulo da coluna sai de nota1(), que é String(n) do JS: lá
        # String(4.0) é "4", não "4.0". Normalizo do mesmo jeito, senão a
        # asserção falha por causa do zero à direita do Python e não por
        # causa do app — foi o que aconteceu na primeira execução.
        def rotulo(n):
            return (str(int(n)) if float(n) == int(n) else str(n)).replace('.', ',')
        esperado = dict((rotulo(k), v) for k, v in fonte.items())
        checa('e cada meia-estrela bate com a contagem da API',
              all(baldes.get(k, 0) == v for k, v in esperado.items()),
              '%s vs %s' % (baldes, esperado))

        checa('a linha "Leituras" mostra o total honesto, e não o tamanho da janela',
              '58' in pg.inner_text('#leitor-numeros'),
              pg.inner_text('#leitor-numeros').replace('\n', ' | '))

        # o D28/D33 numa tela nova: a distribuição é DELA, não minha
        checa('nenhuma coluna do histograma alheio marca a MINHA nota',
              pg.locator('#notas-do-leitor .col.minha').count() == 0)
        checa('e a legenda diz de QUEM é a distribuição',
              '@bia' in (pg.get_attribute('#notas-do-leitor .histograma', 'aria-label') or ''),
              pg.get_attribute('#notas-do-leitor .histograma', 'aria-label'))
        nav.close()

        # ---- o piso de cinco --------------------------------------------
        print('\nperfil alheio: abaixo de cinco notas o gráfico não afirma nada')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        for i in range(3):
            BANCO['leituras'].append({
                'id': 'P%d' % i, 'perfil': 'uid-2', 'livro': '/works/OL1W',
                'nota': 4.0, 'resenha': None, 'spoiler': False, 'relido': False,
                'lido_em': '2026-03-0%d' % (i + 1),
                'criado_em': '2026-03-01T00:00:00Z', 'cliente_id': 'p%d' % i})
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/leitor/bia', wait_until='networkidle')
        pg.wait_for_selector('.perfil-topo', timeout=10000)
        pg.wait_for_timeout(1500)
        # htmlHistograma normaliza pela coluna mais cheia: UMA nota 4 sai
        # idêntica a QUATROCENTAS notas 4. Abaixo de cinco não há forma.
        checa('com 3 avaliações a seção do histograma não é desenhada',
              pg.locator('#notas-do-leitor').is_hidden()
              and pg.locator('#notas-do-leitor .histograma').count() == 0)
        checa('mas a linha "Leituras" continua contando as 3',
              '3' in pg.inner_text('#leitor-numeros'))
        nav.close()

        # ---- diário fechado: nem pede, nem desenha -----------------------
        print('\nperfil alheio: diário fechado não tem distribuição')
        zerar(); estado = {}
        BANCO['perfis'][1]['privado'] = True
        BANCO['livros'].append(LIVRO)
        for i in range(9):
            BANCO['leituras'].append({
                'id': 'F%d' % i, 'perfil': 'uid-2', 'livro': '/works/OL1W',
                'nota': 5.0, 'resenha': None, 'spoiler': False, 'relido': False,
                'lido_em': '2026-04-0%d' % (i + 1),
                'criado_em': '2026-04-01T00:00:00Z', 'cliente_id': 'f%d' % i})
        nav, ctx, pg = montar(pw, estado)
        pedidos_dist = []
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.reload(wait_until='networkidle')
        pg.on('request', lambda r: pedidos_dist.append(r.url)
              if '/rest/v1/distribuicao_de_notas' in r.url else None)
        pg.goto(BASE + '#/leitor/bia', wait_until='networkidle')
        pg.wait_for_selector('.perfil-topo', timeout=10000)
        pg.wait_for_timeout(1500)
        checa('com o diário fechado, a distribuição nem é pedida à rede',
              not pedidos_dist, str(pedidos_dist[:1]))
        checa('e nenhum histograma é desenhado no perfil privado',
              pg.locator('#notas-do-leitor .histograma').count() == 0)
        nav.close()

        # ---- o diário completo alheio ------------------------------------
        print('\nperfil alheio: o diário completo, paginado')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        # um livro que só existe no SERVIDOR: se a tabela usar livroDe() em vez
        # do título da linha, ele sai como "Livro"
        BANCO['livros'].append({'chave': '/works/OL9W', 'titulo': 'Grande Sertão',
                                'autores': ['Guimarães Rosa'], 'ano': 1956,
                                'capa': 'c9.jpg'})
        for i in range(57):
            BANCO['leituras'].append({
                'id': 'D%02d' % i, 'perfil': 'uid-2',
                'livro': '/works/OL9W' if i % 3 else '/works/OL1W',
                'nota': 4.0, 'resenha': 'Gostei.' if i == 0 else None,
                'spoiler': False, 'relido': False,
                'lido_em': '2026-%02d-%02d' % (i // 28 + 1, i % 28 + 1),
                'criado_em': '2026-01-01T00:00:00Z', 'cliente_id': 'd%d' % i})
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        # EU curti o livro que ela também leu — sem isto a asserção do coração
        # passa dos dois lados, que é o mesmo que não ter teste
        pg.evaluate("""() => {
          var e = JSON.parse(localStorage.getItem('letterbooks:v1'));
          e.curtidas = ['/works/OL1W', '/works/OL9W'];
          localStorage.setItem('letterbooks:v1', JSON.stringify(e));
        }""")
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/leitor/bia/diario', wait_until='networkidle')
        pg.wait_for_selector('.tabela-diario', timeout=10000)

        def linhas_na_tela():
            return pg.evaluate("""() => document.querySelectorAll(
              '.tabela-diario tbody tr:not(.faixa-mes):not(.linha-resenha)').length""")

        checa('a primeira página do diário alheio traz 50 linhas',
              linhas_na_tela() == 50, str(linhas_na_tela()))
        checa('e o subtítulo não afirma que são todas',
              'mais recentes' in pg.inner_text('.sub-pagina'),
              pg.inner_text('.sub-pagina'))
        checa('nenhuma linha do diário alheio traz "editar" ou "apagar"',
              pg.locator('.tabela-diario [data-acao=editar-log]').count() == 0
              and pg.locator('.tabela-diario [data-acao=apagar-log]').count() == 0)
        checa('e nenhuma linha carimba a MINHA curtida no diário dela',
              pg.locator('.tabela-diario .cel-marca i.on').count() == 0,
              str(pg.locator('.tabela-diario .cel-marca i.on').count()))
        checa('os títulos saem da linha do servidor, não de livroDe()',
              'Grande Sertão' in pg.inner_text('.tabela-diario')
              and 'Livro' not in [c.strip() for c in
                                  pg.locator('.tabela-diario .cel-livro').all_inner_texts()])
        checa('a tela tem saída, e ela é a tira de atalhos',
              pg.locator('.perfil-atalhos a[href="#/leitor/bia"]').count() == 1)

        pg.click('[data-acao=mais]')
        pg.wait_for_timeout(1500)
        total_api = len([l for l in BANCO['leituras'] if l['perfil'] == 'uid-2'])
        checa('"Ver mais" traz o resto, e a contagem bate com a API',
              linhas_na_tela() == total_api,
              '%d na tela, %d na API' % (linhas_na_tela(), total_api))
        checa('e o botão "Ver mais" some quando acabou',
              pg.locator('[data-acao=mais]').count() == 0)
        checa('e aí o subtítulo passa a afirmar o total',
              'registradas' in pg.inner_text('.sub-pagina'),
              pg.inner_text('.sub-pagina'))
        nav.close()

        # ---- o diário alheio fechado, e o meu próprio ---------------------
        print('\ndiário alheio: fechado, e o desvio quando sou eu')
        zerar(); estado = {}
        BANCO['perfis'][1]['privado'] = True
        BANCO['livros'].append(LIVRO)
        BANCO['leituras'].append({
            'id': 'X1', 'perfil': 'uid-2', 'livro': '/works/OL1W', 'nota': 5.0,
            'resenha': None, 'spoiler': False, 'relido': False,
            'lido_em': '2026-05-01', 'criado_em': '2026-05-01T00:00:00Z',
            'cliente_id': 'x1'})
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.reload(wait_until='networkidle')
        pg.goto(BASE + '#/leitor/bia/diario', wait_until='networkidle')
        pg.wait_for_selector('.perfil-atalhos', timeout=10000)
        pg.wait_for_timeout(1200)
        corpo = pg.inner_text('body')
        checa('o diário fechado diz que está fechado',
              'está fechado' in corpo)
        checa('e NÃO diz que a pessoa não registrou nada',
              'ainda não registrou' not in corpo)
        checa('e não desenha tabela nenhuma',
              pg.locator('.tabela-diario').count() == 0)
        checa('e mesmo fechado a tela tem saída',
              pg.locator('.perfil-atalhos a[href="#/leitor/bia"]').count() == 1)

        # sou eu: o endereço alheio do MEU diário desvia para o de verdade
        pg.goto(BASE + '#/leitor/marcela/diario', wait_until='networkidle')
        pg.wait_for_timeout(1500)
        checa('o meu @ no endereço alheio desvia para o meu diário',
              pg.evaluate("() => location.hash") == '#/diario',
              pg.evaluate("() => location.hash"))
        nav.close()

        # ---- desistir da folha de listas NÃO pode criar a lista ------------
        print('\nfolha de listas: tocar no escuro é desistir, não criar')
        zerar(); estado = {}
        BANCO['livros'].append(LIVRO)
        nav, ctx, pg = montar(pw, estado)
        pg.goto(BASE, wait_until='networkidle')
        semear(pg)
        pg.reload(wait_until='networkidle')
        # o painel lateral da ficha não existe em 390px — alargo só aqui
        pg.set_viewport_size({'width': 1180, 'height': 900})
        pg.goto(BASE + '#/livro/' + '%2Fworks%2FOL1W', wait_until='networkidle')
        pg.wait_for_timeout(1200)
        pg.locator('[data-acao=listas]').first.click()
        pg.wait_for_selector('#nova-lista', timeout=8000)
        pg.fill('#nova-lista', 'Lista que eu desisti')
        antes = pg.evaluate("() => Dados.estado().listas.length")
        # toca no FUNDO escuro, que é o gesto de desistir
        pg.locator('.folha-fundo').click(position={'x': 8, 'y': 8})
        pg.wait_for_timeout(800)
        checa('desistir no fundo escuro NÃO cria a lista',
              pg.evaluate("() => Dados.estado().listas.length") == antes,
              '%d -> %d' % (antes, pg.evaluate("() => Dados.estado().listas.length")))
        nav.close()

    print('\n' + '-' * 60)



    if erros:
        print('%d falha(s):' % len(erros))
        for e in erros: print('  · ' + e)
        sys.exit(1)
    print('tudo passou')


if __name__ == '__main__':
    rodar()

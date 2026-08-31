# -*- coding: utf-8 -*-
"""A jornada inteira, com DUAS pessoas, do cadastro ao comentário.

Cada suíte anterior testa uma peça. Esta anda o caminho que a Marcela anda:
Ana cria conta e registra uma leitura; Bruno cria conta, acha a Ana, segue,
vê no feed, curte e comenta; e os dois perfis têm que refletir isso — o de
quem foi seguido E o de quem seguiu.

O último ponto é o que ela relatou quebrado: "segui e apareceu no outro
perfil mas no meu não".
"""
import sys, json, time
import testar_social as S
from playwright.sync_api import sync_playwright

BASE = S.BASE
erros = []


def checa(nome, cond, det=''):
    print(('  ok   ' if cond else '  FALHA ') + nome + ((' — ' + det) if det else ''))
    if not cond: erros.append(nome + (' — ' + det if det else ''))


def limpar(pg):
    pg.evaluate("() => localStorage.clear()")


def criarConta(pg, email, senha='segredo123', nome=''):
    pg.goto(BASE + '#/conta', wait_until='networkidle')
    pg.reload(wait_until='networkidle')
    pg.wait_for_selector('#forma-conta', timeout=10000)
    pg.click('[data-acao=modo-criar]')
    pg.wait_for_selector('input[name=nome]')
    if nome: pg.fill('input[name=nome]', nome)
    pg.fill('input[name=email]', email)
    pg.fill('input[name=senha]', senha)
    pg.click('#forma-conta button[type=submit]')
    pg.wait_for_selector('#forma-perfil', timeout=12000)


def registrarLeitura(pg, chave, estrela, resenha=None):
    pg.goto(BASE + '#/livro/' + chave, wait_until='networkidle')
    pg.wait_for_selector('[data-acao=rapida]', timeout=15000)
    pg.click('[data-acao=rapida]')
    pg.wait_for_selector('.folha-rapida .seletor-estrelas [data-pos="%d"]' % estrela)
    pg.click('.folha-rapida .seletor-estrelas [data-pos="%d"]' % estrela)
    pg.wait_for_timeout(500)
    if resenha:
        pg.click('.folha-rapida [data-r=registrar]')
        pg.wait_for_selector('#campo-resenha', timeout=8000)
        pg.fill('#campo-resenha', resenha)
        pg.click('.folha-rodape .botao.destaque')
    else:
        pg.click('.folha-rapida [data-fechar=ok]')
    pg.wait_for_timeout(1600)


def rodar():
    S.zerar(vazio=True)
    S.BANCO['livros'].append(S.LIVRO)
    estado = {}

    with sync_playwright() as pw:
        nav, ctx, pg = S.montar(pw, estado)
        pg.set_viewport_size({'width': 390, 'height': 844})
        pg.goto(BASE, wait_until='networkidle')

        # -------------------------------------------------------- ANA -------
        print('\n1. Ana cria conta')
        limpar(pg)
        pg.evaluate("""(l) => { localStorage.setItem('letterbooks:v1', JSON.stringify({
            versao:1, perfil:{nome:'Ana',bio:'',meta:{ano:2026,total:12}},
            livros:{'/works/OL1W': l}, logs:[], querLer:[], curtidas:[],
            favoritos:[], listas:[], buscas:[]})); }""", S.LIVRO)
        criarConta(pg, 'ana@x.com', nome='Ana')
        checa('a conta nasceu com um @', pg.input_value('input[name=usuario]') == 'ana',
              pg.input_value('input[name=usuario]'))
        checa('e o perfil existe no banco', len(S.BANCO['perfis']) == 1)

        print('\n2. Ana registra uma leitura com resenha')
        # A ordem importa: dar a estrela e DEPOIS escrever a resenha ja criou
        # duas leituras do mesmo livro. O teste anda exatamente por esse
        # caminho, que e o que qualquer pessoa faz.
        registrarLeitura(pg, '%2Fworks%2FOL1W', 5, 'O melhor que li este ano.')
        checa('a leitura chegou ao banco', len(S.BANCO['leituras']) == 1,
              '%d linhas' % len(S.BANCO['leituras']))
        if S.BANCO['leituras']:
            checa('com a resenha', S.BANCO['leituras'][0]['resenha'] == 'O melhor que li este ano.')
            checa('e a nota', S.BANCO['leituras'][0]['nota'] == 5)

        print('\n3. o perfil da Ana mostra a leitura')
        pg.goto(BASE + '#/perfil', wait_until='networkidle')
        pg.wait_for_selector('.perfil-nome', timeout=8000)
        checa('conta 1 leitura', '1' in pg.inner_text('#leitor-numeros, .linhas-conta'))

        # -------------------------------------------------------- BRUNO -----
        print('\n3b. editar depois de migrar NAO duplica (era o defeito mais caro)')
        # migrar() mandava com return=minimal e nunca gravava o id do servidor.
        # Depois disso toda leitura local ficava orfa, e salvarLeitura sem
        # remoto fazia POST — entao a primeira edicao de resenha nascia como
        # linha NOVA no banco. O diario duplicava sozinho, em silencio.
        antes = len(S.BANCO['leituras'])
        pg.goto(BASE + '#/livro/%2Fworks%2FOL1W', wait_until='networkidle')
        pg.wait_for_selector('[data-acao=rapida]', timeout=15000)
        pg.click('[data-acao=rapida]')
        pg.wait_for_selector('.folha-rapida [data-r=registrar]', timeout=8000)
        pg.click('.folha-rapida [data-r=registrar]')
        pg.wait_for_selector('#campo-resenha', timeout=8000)
        pg.fill('#campo-resenha', 'Reescrevi depois de pensar melhor.')
        pg.click('.folha-rodape .botao.destaque')
        pg.wait_for_timeout(1800)
        checa('continua UMA leitura no banco depois de editar',
              len(S.BANCO['leituras']) == antes,
              '%d linhas, era %d' % (len(S.BANCO['leituras']), antes))
        checa('e com o texto novo',
              any(l.get('resenha') == 'Reescrevi depois de pensar melhor.'
                  for l in S.BANCO['leituras']))
        local = pg.evaluate("JSON.parse(localStorage.getItem('letterbooks:v1')).logs")
        checa('toda leitura local tem o id do servidor amarrado',
              all(l.get('remoto') for l in local),
              str([(l['id'], l.get('remoto')) for l in local]))

        print('\n4. Bruno cria conta no mesmo aparelho')
        pg.goto(BASE + '#/conta', wait_until='networkidle')
        pg.wait_for_selector('[data-acao=sair]', timeout=8000)
        pg.click('[data-acao=sair]')
        pg.wait_for_selector('#forma-conta', timeout=8000)
        limpar(pg)
        criarConta(pg, 'bruno@x.com', nome='Bruno')
        checa('o @ do Bruno', pg.input_value('input[name=usuario]') == 'bruno')
        checa('duas contas no banco', len(S.BANCO['perfis']) == 2)

        print('\n5. Bruno procura a Ana e segue')
        pg.goto(BASE + '#/buscar/ana/1/leitores', wait_until='networkidle')
        pg.wait_for_selector('.resultado', timeout=10000)
        checa('achou a Ana', pg.locator('.resultado').count() == 1)
        pg.click('.resultado')
        pg.wait_for_selector('#botao-seguir:not([disabled])', timeout=10000)
        # O passo 3b reescreve a resenha; procurar o texto original aqui seria
        # o teste medindo um estado que ele mesmo mudou.
        checa('o perfil dela mostra a resenha',
              'Reescrevi' in pg.inner_text('.feed-resenha'),
              pg.inner_text('.feed-resenha')[:60])
        pg.click('#botao-seguir')
        pg.wait_for_function(
            "() => /seguindo/i.test(document.getElementById('botao-seguir').textContent)",
            timeout=8000)
        checa('seguir gravou', len(S.BANCO['seguidores']) == 1)

        print('\n6. o perfil da Ana passa a mostrar 1 seguidor')
        pg.reload(wait_until='networkidle')
        pg.wait_for_selector('#leitor-numeros .valor', timeout=10000)
        numeros = pg.inner_text('#leitor-numeros')
        checa('"Seguidores 1" no perfil dela',
              'Seguidores' in numeros and '1' in numeros, numeros.replace('\n', ' | '))

        print('\n7. E NO PERFIL DO BRUNO? (o que a Marcela viu quebrado)')
        pg.goto(BASE + '#/perfil', wait_until='networkidle')
        pg.wait_for_selector('.perfil-nome', timeout=8000)
        pg.wait_for_timeout(1200)
        meu = pg.inner_text('.pagina')
        checa('o meu perfil diz que eu sigo alguem', 'Seguindo' in meu,
              'nao aparece "Seguindo" em lugar nenhum do meu perfil')
        checa('o meu perfil mostra o meu @', '@bruno' in meu,
              'o @ so existe na tela de conta')
        # Ja mostrou "@bruno" embaixo do nome "Leitora" — o padrao do modo
        # local. Dois nomes para a mesma pessoa, na mesma tela.
        checa('e o nome e o da conta, nao o padrao local',
              'Bruno' in pg.inner_text('.perfil-nome'),
              pg.inner_text('.perfil-nome'))

        print('\n7b. e a contagem abre a lista de quem eu sigo')
        pg.click('#meu-numeros a[href^="#/seguindo"], .linhas a[href^="#/seguindo"]')
        pg.wait_for_selector('.resultado', timeout=10000)
        checa('a lista traz a Ana', pg.locator('.resultado').count() == 1)
        checa('com o @ dela', '@ana' in pg.inner_text('.resultado-texto'))
        pg.click('.resultado')
        pg.wait_for_selector('.perfil-nome', timeout=10000)
        checa('e leva ao perfil dela', 'Ana' in pg.inner_text('.perfil-nome'))

        print('\n8. a leitura da Ana aparece no feed do Bruno')
        pg.goto(BASE + '#/atividade/seguindo', wait_until='networkidle')
        pg.wait_for_selector('.feed-linha', timeout=10000)
        checa('o feed de "Seguindo" traz a Ana', pg.locator('.feed-linha').count() == 1)
        checa('com a frase certa', 'Ana' in pg.inner_text('.feed-frase') and
              'Dom Casmurro' in pg.inner_text('.feed-frase'))

        print('\n9. Bruno curte e comenta')
        pg.click('[data-acao=curtir-leitura]')
        pg.wait_for_timeout(900)
        checa('curtida gravada', len(S.BANCO['curtidas']) == 1)
        pg.click('.feed-comentar')
        pg.wait_for_selector('#campo-comentario', timeout=10000)
        enderecoDoBruno = pg.evaluate('location.hash')
        pg.fill('#campo-comentario', 'Também quero ler.')
        pg.click('#forma-comentario button[type=submit]')
        pg.wait_for_timeout(900)
        checa('comentario gravado', len(S.BANCO['comentarios']) == 1)
        checa('e aparece na hora', 'Também quero ler' in pg.inner_text('#comentarios'))

        print('\n10. Ana volta e ve o que aconteceu com a resenha dela')
        pg.goto(BASE + '#/conta', wait_until='networkidle')
        pg.wait_for_selector('[data-acao=sair]', timeout=8000)
        pg.click('[data-acao=sair]')
        pg.wait_for_selector('#forma-conta', timeout=8000)
        pg.fill('input[name=email]', 'ana@x.com')
        pg.fill('input[name=senha]', 'segredo123')
        pg.click('#forma-conta button[type=submit]')
        pg.wait_for_selector('#forma-perfil', timeout=12000)
        # A Ana chega pelo DIARIO dela, com o id local — o apelido. O Bruno
        # chegou pelo feed, com o uuid. Se o endereco nao for o mesmo no fim, a
        # resenha volta a ter dois enderecos e o item nao aconteceu.
        pg.goto(BASE + '#/diario', wait_until='networkidle')
        pg.wait_for_selector('.cel-marca a', timeout=10000)
        apelido = pg.locator('.cel-marca a').first.get_attribute('href')
        pg.locator('.cel-marca a').first.click()
        pg.wait_for_selector('.resenha', timeout=10000)
        checa('a Ana entra pelo apelido do diario', '/resenha/' in apelido, apelido)
        checa('e chega no MESMO endereco que o Bruno abriu',
              pg.evaluate('location.hash') == enderecoDoBruno,
              '%s vs %s' % (pg.evaluate('location.hash'), enderecoDoBruno))
        checa('a resenha dela tem 1 curtida',
              pg.inner_text('.conta-curtidas').strip() == '1')
        checa('e o comentario do Bruno', 'Também quero ler' in pg.inner_text('#comentarios'))
        checa('ela ve que a resenha esta no ar',
              'no ar' in pg.inner_text('.resenha-estado').lower())
        checa('e pode compartilhar, editar e apagar dali mesmo',
              pg.locator('[data-acao=compartilhar-resenha]').count() == 1 and
              pg.locator('[data-acao=editar-log]').count() == 1 and
              pg.locator('[data-acao=apagar-resenha]').count() == 1)
        pg.goto(BASE + '#/perfil', wait_until='networkidle')
        pg.wait_for_selector('.perfil-nome', timeout=8000)
        pg.wait_for_timeout(1200)
        checa('o perfil da Ana mostra 1 seguidor', 'Seguidores' in pg.inner_text('.pagina'),
              'o proprio perfil nao mostra seguidores')

        # A ESTANTE tambem tem que descer, e ate aqui NENHUMA suite exercitava
        # esse caminho. `Sinc.descer()` pede Nuvem.meusMarcadores() e
        # Dados.fundir os despeja nas tres colecoes locais pelo mapa COLECAO
        # (quero->querLer, curtida->curtidas, favorito->favoritos) — codigo de
        # verdade, sem uma linha de teste. Marco um livro aqui, no aparelho
        # velho, para o passo 11 poder conferir que ele reaparece no novo.
        #
        # Sem isto, "Trazer da nuvem" seria dado como completo com um dos tres
        # caminhos (leituras, listas, marcadores) nunca provado — e a regra que
        # o GPM propos, e que eu aceito, e que feature so vira `completo`
        # quando a evidencia aponta para uma assercao com nome.
        # A marca entra pelo BANCO e nao por clique, de proposito: o que esta
        # sendo provado e a DESCIDA, nao o gesto de marcar (que a testar.py ja
        # cobre). E o botao [data-acao=quero] vive no painel lateral, que nao
        # existe a 390px — clicar nele aqui exigiria alargar a janela no meio
        # de uma jornada que e toda de celular.
        S.BANCO['marcadores'].append({'perfil': 'uid-1', 'livro': '/works/OL1W',
                                      'tipo': 'quero',
                                      'criado_em': '2026-08-25T00:00:00Z'})

        print('\n11. CELULAR NOVO: a Ana entra num aparelho zerado')
        # O item que fazia a conta nao significar nada. Ate agora a
        # sincronizacao era de mao unica: subia e nunca trazia de volta.
        # Trocar de celular mostrava um diario vazio.
        limpar(pg)
        pg.goto(BASE, wait_until='networkidle')
        pg.evaluate("() => localStorage.clear()")
        pg.reload(wait_until='networkidle')
        vazio = pg.evaluate("() => localStorage.getItem('letterbooks:v1')")
        checa('o aparelho comeca mesmo zerado', not vazio)

        pg.goto(BASE + '#/conta', wait_until='networkidle')
        pg.wait_for_selector('#forma-conta', timeout=10000)
        pg.fill('input[name=email]', 'ana@x.com')
        pg.fill('input[name=senha]', 'segredo123')
        pg.click('#forma-conta button[type=submit]')
        pg.wait_for_selector('#forma-perfil', timeout=12000)
        pg.wait_for_timeout(2500)

        logs = pg.evaluate("() => { const d = localStorage.getItem('letterbooks:v1');"
                           "return d ? JSON.parse(d).logs : []; }")
        checa('o diario desceu para o aparelho novo', len(logs) >= 1,
              '%d leituras' % len(logs))
        if logs:
            checa('com a resenha inteira',
                  any('Reescrevi' in (l.get('resenha') or '') for l in logs),
                  str([l.get('resenha') for l in logs]))
            checa('e ja amarrada ao servidor', all(l.get('remoto') for l in logs))
        checa('a ficha do livro veio junto, com titulo',
              pg.evaluate("() => { const d = JSON.parse(localStorage.getItem('letterbooks:v1'));"
                          "return (d.livros['/works/OL1W']||{}).titulo; }") == 'Dom Casmurro')

        pg.goto(BASE + '#/diario', wait_until='networkidle')
        pg.wait_for_timeout(900)
        checa('e o diario DESENHA a leitura no aparelho novo',
              pg.locator('.tabela-diario tbody tr').count() >= 1)

        # O terceiro caminho da descida, que nao tinha teste nenhum.
        checa('a ESTANTE tambem desceu: o "quero ler" veio junto',
              pg.evaluate("() => Dados.estado().querLer.length") >= 1,
              str(pg.evaluate("() => Dados.estado().querLer")))
        pg.goto(BASE + '#/estante', wait_until='networkidle')
        pg.wait_for_timeout(900)
        # A prateleira "Quero ler" ESPECIFICAMENTE, e nao um .cartao
        # qualquer: #/estante tem quatro secoes e a de "Lidos" e montada a
        # partir dos logs, entao `.grade .cartao >= 1` passava mesmo com os
        # marcadores NAO tendo descido. Descobri desfazendo o conserto: a
        # assercao de cima ficou vermelha e esta continuou verde — que e o
        # mesmo que nao ter teste, e foi exatamente o D98.
        naQueroLer = pg.evaluate("() => { var s = [].slice.call(document.querySelectorAll('.secao')).find(function (x) { var h = x.querySelector('h2'); return h && /Quero ler/.test(h.innerText); }); return s ? s.querySelectorAll('.cartao').length : -1; }")
        checa('e a prateleira "Quero ler" DESENHA o livro no aparelho novo',
              naQueroLer >= 1, '%d cartoes na secao Quero ler' % naQueroLer)

        # O CONVITE MENTE NO APARELHO NOVO (D116). #/conta oferece "Enviar o
        # diario deste aparelho para a conta" com base em
        # `quanto = logs + listas + marcacoes`, e depois que a V1 criou o
        # descer() esse numero conta justamente o que ACABOU DE VIR da
        # conta. Aparelho zerado que entra numa conta cheia recebe 200
        # leituras e e convidado a mandar as 200 de volta.
        pg.goto(BASE + '#/conta', wait_until='networkidle')
        pg.wait_for_timeout(1500)
        checa('o aparelho novo NAO e convidado a enviar o que veio da conta',
              pg.locator('[data-acao=migrar]').count() == 0,
              'o convite apareceu num aparelho que nao tem nada proprio')

        print('\n12. e nao duplicou nada ao descer')
        checa('o banco continua com uma leitura so',
              len(S.BANCO['leituras']) == 1, '%d linhas' % len(S.BANCO['leituras']))
        pg.evaluate("() => Sinc.descer()")
        pg.wait_for_timeout(1800)
        logs2 = pg.evaluate("() => JSON.parse(localStorage.getItem('letterbooks:v1')).logs")
        checa('descer duas vezes nao duplica no aparelho', len(logs2) == len(logs),
              '%d -> %d' % (len(logs), len(logs2)))

        nav.close()

    print('\n' + '-' * 62)
    if erros:
        print('%d falha(s) na jornada:' % len(erros))
        for e in erros: print('  · ' + e)
        sys.exit(1)
    print('a jornada inteira funciona')


if __name__ == '__main__':
    rodar()

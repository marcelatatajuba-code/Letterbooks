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
        checa('o perfil dela mostra a resenha',
              'melhor que li' in pg.inner_text('.feed-resenha'))
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
        idL = S.BANCO['leituras'][0]['id']
        pg.goto(BASE + '#/leitura/' + idL, wait_until='networkidle')
        pg.wait_for_selector('.resenha', timeout=10000)
        checa('a resenha dela tem 1 curtida',
              pg.inner_text('.conta-curtidas').strip() == '1')
        checa('e o comentario do Bruno', 'Também quero ler' in pg.inner_text('#comentarios'))
        pg.goto(BASE + '#/perfil', wait_until='networkidle')
        pg.wait_for_selector('.perfil-nome', timeout=8000)
        pg.wait_for_timeout(1200)
        checa('o perfil da Ana mostra 1 seguidor', 'Seguidores' in pg.inner_text('.pagina'),
              'o proprio perfil nao mostra seguidores')

        nav.close()

    print('\n' + '-' * 62)
    if erros:
        print('%d falha(s) na jornada:' % len(erros))
        for e in erros: print('  · ' + e)
        sys.exit(1)
    print('a jornada inteira funciona')


if __name__ == '__main__':
    rodar()

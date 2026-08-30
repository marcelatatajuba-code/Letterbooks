# -*- coding: utf-8 -*-
import os, sys, json, re, urllib.parse
from urllib.parse import urlparse, parse_qs
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fixtures
from playwright.sync_api import sync_playwright

BASE  = 'http://127.0.0.1:8899/index.html'
proxy = os.environ.get('HTTPS_PROXY')
erros = []


def responder(rota):
    p = urlparse(rota.request.url); q = parse_qs(p.query)
    def j(o): rota.fulfill(status=200, content_type='application/json',
                           headers={'access-control-allow-origin': '*'}, body=json.dumps(o))
    if 'covers.' in p.netloc:
        m = re.search(r'/[ab]/id/(\d+)-', p.path)
        idc = int(m.group(1)) if m else 1
        t = next((l[1] for l in fixtures.LIVROS if l[4] == idc), '')
        return rota.fulfill(status=200, content_type='image/jpeg',
                            headers={'access-control-allow-origin': '*'},
                            body=fixtures.capa_png(idc, t))
    if p.path.endswith('/trending/weekly.json'): return j(fixtures.tendencia())
    if p.path.endswith('/search.json'):
        return j(fixtures.busca((q.get('q') or q.get('subject') or q.get('isbn') or [''])[0],
                                int((q.get('page') or ['1'])[0])))
    if p.path.startswith('/works/'): return j(fixtures.obra(p.path[:-5]))
    if p.path.startswith('/authors/'):
        if p.path.endswith('/works.json'): return j(fixtures.obras_do(p.path.split('/')[2]))
        return j(fixtures.autor(p.path.split('/')[2].replace('.json', '')))
    rota.fulfill(status=404, body='')


def ok(cond, msg):
    if not cond: raise AssertionError(msg)
    print('   ok:', msg)


with sync_playwright() as pw:
    nav = pw.chromium.launch(
        executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        proxy={'server': proxy, 'bypass': '127.0.0.1,localhost'} if proxy else None,
        args=['--ignore-certificate-errors', '--no-sandbox'])
    ctx = nav.new_context(viewport={'width': 1180, 'height': 900}, locale='pt-BR',
                          accept_downloads=True)
    ctx.route('**openlibrary.org/**', responder)
    pg = ctx.new_page()
    pg.on('console', lambda m: erros.append((m.type, m.text)) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: erros.append(('pageerror', str(e))))

    print('1. inicio')
    pg.goto(BASE, wait_until='networkidle', timeout=45000)
    pg.wait_for_selector('#secao-alta .cartao', timeout=20000)
    ok(pg.locator('#secao-alta .cartao').count() == 12, '12 capas em alta')
    ok(pg.locator('#secao-alta .trilho').count() == 1, 'a home usa trilho, não grade')
    ok(pg.locator('.secao > h2').first.evaluate(
        "e => getComputedStyle(e).textTransform") == 'none',
       'título de seção em caixa normal, não versalete')
    ok(pg.locator('.trilho').first.evaluate(
        "e => e.scrollWidth > e.clientWidth") is True, 'o trilho rola de lado')

    print('2. busca como tela propria (o icone da lupa)')
    pg.goto(BASE + '#/buscar', wait_until='networkidle')
    pg.wait_for_selector('#busca-grande-campo', timeout=8000)
    ok(pg.locator('.titulo-pagina').inner_text() == 'Buscar', 'tela de busca, nao redireciona')
    ok(pg.locator('.linha-diretorio').count() == 6, 'o diretório "Explorar por" tem seis recortes')
    pg.wait_for_selector('#secao-alta .cartao', timeout=20000)
    ok(pg.locator('#secao-alta .cartao').count() == 12, 'sugestoes carregam na busca vazia')

    # o recorte leva a uma seleção de verdade
    pg.click('.linha-diretorio')
    pg.wait_for_selector('.grade .cartao', timeout=20000)
    ok(pg.locator('.titulo-pagina').inner_text() == 'Mais lidos', 'o recorte abre com seu nome')
    ok(pg.locator('.grade .cartao').count() > 0, 'o recorte traz livros')
    pg.go_back()
    pg.wait_for_selector('.linha-diretorio', timeout=8000)
    pg.fill('#busca-grande-campo', 'machado de assis')
    pg.press('#busca-grande-campo', 'Enter')
    pg.wait_for_selector('.sub-pagina:has-text("resultados")', timeout=20000)
    # A busca deixou de ser grade de capas e virou lista, como no app: capa
    # pequena, titulo em negrito e "ano, de Fulano" embaixo.
    ok(pg.locator('.resultado').count() == 3, '3 resultados')
    ok(pg.locator('.resultado-texto b').first.inner_text() == 'Dom Casmurro',
       'o resultado mostra o titulo')
    ok('Machado de Assis' in pg.locator('.resultado-texto span').first.inner_text(),
       'e a autoria, como no app')
    # A terceira pilula ("Leitores") so existe com a nuvem ligada — sem banco
    # nao ha gente para procurar. Este teste roda contra o config.js de
    # verdade, entao o numero certo depende de ela estar ligada ou nao.
    naNuvem = pg.evaluate("() => Nuvem.ligada()")
    esperado = 3 if naNuvem else 2
    ok(pg.locator('.escopos a').count() == esperado,
       'pilulas de escopo: %d (nuvem %s)' % (esperado, 'ligada' if naNuvem else 'desligada'))

    print('3. ficha e autoria clicavel')
    pg.locator('.resultado').first.click()
    pg.wait_for_selector('.livro-titulo', timeout=20000)
    pg.wait_for_selector('.sinopse', timeout=10000)
    ok(pg.locator('.livro-titulo').inner_text() == 'Dom Casmurro', 'abriu Dom Casmurro')
    ok(pg.locator('.autoria a').count() == 1, 'o nome do autor virou link')
    ok(pg.locator('.fichas').count() == 0, 'a ficha não tem mais abas: tudo empilhado')
    ok(pg.locator('.assunto').count() == 4, 'assuntos visíveis sem precisar trocar de aba')
    ok(pg.locator('.detalhes tr').count() == 4, 'detalhes visíveis na mesma página')
    ok(pg.locator('.sinopse.recolhida').count() == 1, 'a sinopse longa vem recolhida')
    ok(pg.locator('.sinopse').first.evaluate(
        "e => getComputedStyle(e).maskImage !== 'none' || "
        "getComputedStyle(e).webkitMaskImage !== 'none'") is True,
       'e esmaece no fim em vez de cortar seco')
    pg.click('[data-acao="expandir"]')
    pg.wait_for_timeout(250)
    ok(pg.locator('.sinopse.recolhida').count() == 0, 'expandir solta a sinopse inteira')

    print('4. pagina do autor (o equivalente ao cast & crew)')
    pg.locator('.autoria a').first.click()
    pg.wait_for_selector('.autor-topo', timeout=20000)
    ok(pg.locator('.autor-topo .titulo-pagina').inner_text() == 'Machado de Assis', 'abriu o autor')
    ok('1839' in pg.locator('.autor-topo .sub-pagina').inner_text(), 'datas de vida')
    ok(pg.locator('#bio').count() == 1, 'biografia presente')
    ok(pg.locator('.secao .cartao').count() == 3, '3 obras do autor')
    pg.locator('.secao .cartao').first.click()
    pg.wait_for_selector('.livro-titulo', timeout=20000)
    ok(pg.locator('.livro-titulo').inner_text() == 'Dom Casmurro', 'volta para o livro pela obra')

    print('5. registro pelo painel')
    pg.click('.painel [data-acao="registrar"]')
    pg.wait_for_selector('#seletor', timeout=5000)
    pg.locator('.seletor-estrelas .est').nth(4).click(position={'x': 5, 'y': 15})
    ok(pg.locator('#seletor').get_attribute('aria-valuenow') == '4.5', 'meia estrela na metade esquerda')
    pg.fill('#campo-resenha', 'Bentinho é um narrador que não merece confiança.')
    pg.check('#campo-spoiler')
    pg.fill('#campo-data', '2026-08-21')
    pg.click('[data-fechar="salvar"]')
    pg.wait_for_timeout(1000)
    pg.click('.painel [data-acao="favorito"]')   # alimenta a fileira de favoritos
    pg.wait_for_timeout(400)

    print('6. compartilhar gera imagem no proprio aparelho')
    with pg.expect_download(timeout=20000) as dl:
        pg.click('.painel [data-acao="compartilhar"]')
    arquivo = dl.value
    ok(arquivo.suggested_filename.startswith('letterbooks-'), 'nome do arquivo: ' + arquivo.suggested_filename)
    caminho = arquivo.path()
    tamanho = os.path.getsize(caminho)
    cabecalho = open(caminho, 'rb').read(8)
    ok(cabecalho == b'\x89PNG\r\n\x1a\n', 'o arquivo é um PNG de verdade')
    ok(tamanho > 20000, 'imagem com conteúdo (%d bytes)' % tamanho)

    print('7. lista no padrao do original')
    pg.click('.painel [data-acao="listas"]')
    pg.wait_for_selector('#nova-lista', timeout=5000)
    pg.fill('#nova-lista', 'Clássicos brasileiros')
    pg.click('[data-fechar="ok"]')
    pg.wait_for_timeout(700)
    pg.goto(BASE + '#/listas', wait_until='networkidle')
    pg.wait_for_selector('.cartao-lista', timeout=8000)
    pg.locator('.cartao-lista').first.click()
    pg.wait_for_selector('.lista-cabecalho', timeout=8000)
    ok(pg.locator('.lista-autoria').count() == 1, 'cabeçalho traz a autoria da lista')
    ok(pg.locator('.heroi-imagem').count() == 1, 'fundo formado pela capa')
    ok(pg.locator('.ordem').count() == 1, 'pôster numerado')
    ok(pg.locator('.ordem').first.inner_text() == '1', 'a numeração começa em 1')

    print('8. perfil como eixo')
    pg.goto(BASE + '#/perfil', wait_until='networkidle')
    pg.wait_for_selector('.perfil-atalhos', timeout=8000)
    ok(pg.locator('.perfil-atalhos a').count() == 4, 'controle segmentado com quatro abas')
    ok(pg.locator('.perfil-atalhos a.ativa').inner_text() == 'Perfil', 'a aba atual fica marcada')
    ordem = pg.evaluate(
        "() => [...document.querySelectorAll('.perfil-atalhos, .perfil-topo, .bloco')]"
        ".map(e => e.className.split(' ')[0])")
    ok(ordem[:2] == ['perfil-atalhos', 'perfil-topo'],
       'as abas vêm antes do avatar, como no original')
    # Medido no quadro t084 do video: retrato redondo de ~76px, centralizado,
    # com o nome logo abaixo. (Eu ja errei isto uma vez comparando com um
    # quadro rolado; por isso a verificacao mede o tamanho E o centro.)
    cx = pg.locator('.avatar').first.bounding_box()
    caixa = pg.locator('.perfil-topo').first.bounding_box()
    ok(66 <= cx['width'] <= 86, 'o avatar tem ~76px (%.0f)' % cx['width'])
    meio_av = cx['x'] + cx['width']/2
    meio_cx = caixa['x'] + caixa['width']/2
    ok(abs(meio_av - meio_cx) < 8, 'o avatar fica centralizado, como no app')
    nm = pg.locator('.perfil-nome').first.bounding_box()
    ok(nm['y'] > cx['y'] + cx['height'] - 4, 'o nome vem abaixo do retrato')
    ok(pg.locator('.fileira').count() == 2, 'duas fileiras: favoritos e atividade recente')
    ok(pg.locator('.fileira').first.evaluate(
        "e => getComputedStyle(e).gridTemplateColumns.split(' ').length") == 4,
       'a fileira é fixa em quatro colunas')
    ok(pg.locator('.atividade-marcas').count() == 1, 'a atividade traz nota e marcadores')
    ok('★★★★½' in pg.locator('.atividade-marcas .estrelas').inner_text(),
       'a nota aparece sob a capa da atividade')
    ok(pg.locator('.linha-mais').count() == 1, 'a linha "Mais atividade" existe')
    # Regressao: o glifo de resenha era um <a> dentro de outro <a>; o navegador
    # fechava o de fora e o glifo escapava do cartao para a celula seguinte.
    ok(pg.locator('.fileira .cartao').count() == pg.locator('.fileira > *').count(),
       'nada escapa do cartão para fora dele na fileira')
    ok(pg.locator('.atividade .atividade-marcas').count() ==
       pg.locator('.atividade').count(), 'os marcadores ficam dentro do cartão')
    pg.locator('.perfil-atalhos a[href="#/estante"]').click()
    pg.wait_for_timeout(700)
    ok(pg.locator('.titulo-pagina').inner_text() == 'Estante', 'atalho leva à estante')

    print('8b. avaliações no corpo da ficha')
    pg.goto(BASE + '#/livro/' + fixtures.LIVROS[0][0].replace('/', '%2F'),
            wait_until='networkidle')
    pg.wait_for_selector('.livro-titulo', timeout=20000)
    pg.wait_for_timeout(600)
    ok(pg.locator('.avaliacoes-media').count() == 1, 'a média sai grande ao lado do histograma')
    ok(pg.locator('.painel .histograma').count() == 0, 'o histograma saiu do painel lateral')

    print('8c. abas do topo e tela de resenhas')
    pg.goto(BASE + '#/inicio', wait_until='networkidle')
    pg.wait_for_timeout(700)
    ok(pg.locator('.segmentos a').count() == 3, 'três abas no topo: livros, resenhas, listas')
    ok(pg.locator('.segmentos a.ativa').inner_text() == 'Livros', 'a aba atual fica marcada')
    pg.click('.segmentos a[href="#/resenhas"]')
    pg.wait_for_selector('.cartao-resenha', timeout=8000)
    ok(pg.locator('.cartao-resenha').count() == 1, 'a resenha escrita aparece na aba')
    ok('spoiler' in pg.locator('.cartao-resenha-texto').inner_text().lower(),
       'resenha com spoiler não vaza no cartão')
    pg.click('.cartao-resenha')
    pg.wait_for_selector('.resenha-titulo', timeout=8000)
    ok('Dom Casmurro' in pg.locator('.resenha-titulo').inner_text(),
       'o cartão leva à página da resenha')

    print('9. diario em tabela')
    pg.goto(BASE + '#/diario', wait_until='networkidle')
    pg.wait_for_selector('.tabela-diario', timeout=8000)
    colspans = pg.locator('.linha-resenha td').evaluate_all("els => els.map(e => e.colSpan)")
    ok(colspans == [7], 'linha de resenha atravessa 7 colunas')
    ok(pg.locator('.spoiler-aviso').count() == 1, 'resenha com spoiler coberta')

    print('9b. resenha em pagina propria')
    ok(pg.locator('.cel-marca a').count() == 1, 'o glifo ≡ marca a linha que tem resenha')
    pg.locator('.cel-marca a').first.click()
    pg.wait_for_selector('.resenha', timeout=8000)
    ok('Dom Casmurro' in pg.locator('.resenha-titulo').inner_text(), 'resenha abre no livro certo')
    ok('★★★★½' in pg.locator('.resenha-linha').inner_text(), 'a nota aparece na resenha')
    ok('Lido em 21 ago 2026' in pg.locator('.resenha-data').inner_text(), 'data da leitura')
    ok('spoiler' in pg.locator('.resenha-corpo').inner_text().lower(), 'aviso de spoiler')
    ok('narrador' in pg.locator('.resenha-texto').inner_text(), 'o texto inteiro, sem cobrir')
    ok('/resenha/' in pg.evaluate('location.hash'), 'a resenha tem endereço próprio')

    print('10. barra do celular no desenho do original')
    pg.set_viewport_size({'width': 390, 'height': 844})
    pg.goto(BASE + '#/inicio', wait_until='networkidle')
    pg.wait_for_timeout(900)
    ok(pg.locator('.abas-pe').is_visible(), 'barra inferior aparece')
    ok(not pg.locator('.topo-nav').is_visible(), 'nav do topo se recolhe')
    ok(pg.locator('.abas-pe a').count() == 4, 'quatro destinos na barra')
    ok(pg.locator('.abas-pe a svg').count() == 4, 'cada um com ícone')
    ok(pg.locator('#aba-mais').is_visible(), 'o "+" central existe')
    caixa = pg.locator('#aba-mais').bounding_box()
    centro = caixa['x'] + caixa['width'] / 2
    ok(abs(centro - 195) < 8, 'o "+" está no centro (x=%.0f)' % centro)
    ok(pg.locator('.abas-pe a[href="#/estante"]').count() == 0,
       'estante NÃO fica na barra — vive no perfil, como no original')
    pg.click('#aba-mais')
    pg.wait_for_selector('#escolha-termo', timeout=5000)
    ok(True, 'o "+" abre a busca para registrar')
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(300)
    larg = pg.evaluate("() => document.documentElement.scrollWidth")
    ok(larg <= 390, 'sem rolagem horizontal (scrollWidth=%d)' % larg)

    print('10c. barra de ação e cartão rápido no celular')
    pg.goto(BASE + '#/livro/' + fixtures.LIVROS[0][0].replace('/', '%2F'),
            wait_until='networkidle')
    pg.wait_for_selector('.livro-titulo', timeout=20000)
    pg.wait_for_timeout(700)
    ok(not pg.locator('.painel').is_visible(), 'o painel lateral some no celular')
    ok(pg.locator('.barra-acao').is_visible(), 'a barra de ação fixa aparece')
    pg.click('.barra-acao button')
    pg.wait_for_selector('.folha-rapida', timeout=5000)
    ok(pg.locator('.rapida-acao').count() == 4, 'quatro ações no cartão rápido')
    antes = pg.locator('.rapida-acao[data-r="curtir"]').get_attribute('class')
    pg.click('.rapida-acao[data-r="curtir"]')
    pg.wait_for_timeout(300)
    depois = pg.locator('.rapida-acao[data-r="curtir"]').get_attribute('class')
    ok('ativa' in depois and 'ativa' not in antes, 'curtir alterna dentro do cartão')
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(400)

    print('10b. diario no celular: faixa de mes')
    pg.goto(BASE + '#/diario', wait_until='networkidle')
    pg.wait_for_selector('.tabela-diario', timeout=8000)
    pg.wait_for_timeout(400)
    ok(pg.locator('.faixa-mes').first.is_visible(), 'o mês vira faixa de largura inteira')
    ok('AGO' in pg.locator('.faixa-mes').first.inner_text().upper(), 'a faixa nomeia o mês')
    ok(not pg.locator('.cel-mes').first.is_visible(), 'a coluna do mês some no celular')
    larg2 = pg.evaluate("() => document.documentElement.scrollWidth")
    ok(larg2 <= 390, 'diário sem rolagem lateral no celular (scrollWidth=%d)' % larg2)

    print('10d. buscas recentes no cartão de adicionar')
    pg.goto(BASE + '#/inicio', wait_until='networkidle')
    pg.wait_for_timeout(800)
    pg.click('#aba-mais')
    pg.wait_for_selector('#escolha-termo', timeout=5000)
    ok(pg.locator('.recente').count() >= 1, 'as buscas anteriores ficam guardadas')
    ok(pg.locator('.recente').first.inner_text() == 'machado de assis',
       'a mais recente vem primeiro')
    pg.click('.recente')
    pg.wait_for_selector('[data-escolher]', timeout=10000)
    ok(pg.locator('[data-escolher]').count() == 3, 'tocar numa recente refaz a busca')
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(300)

    print('12. escala de aplicativo (medida nos quadros do app)')
    # Estes numeros nao sao gosto: saem de medir o app no video. Sem eles a
    # tela volta devagar a escala de site — foi o que aconteceu tres vezes.
    pg.set_viewport_size({'width': 384, 'height': 848})
    pg.goto(BASE + '#/inicio')
    pg.wait_for_selector('.trilho .cartao', timeout=15000)
    pg.wait_for_timeout(500)

    alt = lambda sel: pg.locator(sel).first.bounding_box()['height']
    ok(alt('.topo') <= 48, 'cabecalho de 46px, como o app (%.0f)' % alt('.topo'))
    ok(alt('.segmentos') <= 33, 'abas de ~29px, nao 48 (%.0f)' % alt('.segmentos'))
    ok(alt('.abas-pe') <= 58, 'barra de baixo enxuta (%.0f)' % alt('.abas-pe'))
    # O rotulo continua no HTML para leitor de tela; o que ele nao pode fazer e
    # ocupar altura, entao a medida certa e a caixa, nao a visibilidade.
    rot = pg.locator('.abas-pe a span').first.bounding_box()
    ok(rot['height'] <= 2, 'a barra de baixo nao rotula os icones, como o app')

    # A prova de densidade: o app cabe TRES secoes antes da dobra.
    acima = pg.evaluate(
        "() => [...document.querySelectorAll('.secao > h2')]"
        ".filter(h => h.getBoundingClientRect().top < 848).length")
    ok(acima >= 3, 'pelo menos tres secoes acima da dobra (%d)' % acima)
    ok(pg.locator('.titulo-pagina').count() == 0,
       'a home abre no conteudo, sem chamada de capa')
    ok(pg.locator('.secao > h2 a.seta').count() >= 3,
       'cada secao leva ao seu recorte, pelo chevron')

    # Ficha do livro: imagem ate o topo, sem cabecalho, com o chevron por cima.
    pg.goto(BASE + '#/livro/' + urllib.parse.quote('/works/OL1917719W', safe=''))
    pg.wait_for_selector('.livro-titulo', timeout=15000)
    pg.wait_for_timeout(400)
    ok(not pg.locator('.topo').is_visible(), 'a ficha esconde o cabecalho da marca')
    ok(pg.locator('.voltar').count() == 1, 'e poe o chevron de voltar sobre a imagem')
    capa = pg.locator('.livro-capa').bounding_box()
    tit  = pg.locator('.livro-titulo').bounding_box()
    ok(tit['x'] < capa['x'], 'titulo a esquerda, capa a direita, como no app')
    ok(pg.evaluate("() => document.documentElement.scrollWidth") <= 384,
       'ficha sem rolagem lateral')

    print('13. capas de verdade (do print da Marcela)')
    # Capa de livro nao e poster de cinema: a Open Library devolve quadrada,
    # alta e larga. Forcar tudo em 2:3 com cover cortava a borda, que numa capa
    # e onde mora o titulo. A capa vai inteira sobre uma copia desfocada.
    pg.set_viewport_size({'width': 384, 'height': 848})
    pg.goto(BASE + '#/inicio')
    pg.wait_for_selector('.trilho .cartao .capa-imagem', timeout=15000)
    pg.wait_for_timeout(600)
    est = pg.evaluate("""() => [...document.querySelectorAll('.trilho .capa')].slice(0,6)
        .map(c => { const cx = c.getBoundingClientRect();
                    const b = c.querySelector('.capa-imagem').getBoundingClientRect();
                    return b.width <= cx.width + 1 && b.height <= cx.height + 1; })""")
    ok(len(est) > 0 and all(est), 'nenhuma capa estoura a caixa (%d conferidas)' % len(est))
    ok(pg.locator('.trilho .capa .capa-fundo').count() > 0,
       'a copia desfocada preenche o que a capa inteira nao ocupa')
    ok(pg.eval_on_selector('.capa-imagem', "e => getComputedStyle(e).objectFit") == 'contain',
       'a capa de verdade usa contain, nao cover')

    print('11. persistencia')
    d = json.loads(pg.evaluate("() => localStorage.getItem('letterbooks:v1')"))
    ok(len(d['logs']) == 1 and d['logs'][0]['nota'] == 4.5, 'registro gravado com 4,5')
    ok(len(d['listas']) == 1 and len(d['listas'][0]['livros']) == 1, 'lista gravada com o livro')

    nav.close()

print('\n=== console ===')
print('   nenhum erro ou aviso' if not erros else '')
for t, m in erros[:20]:
    print('  ', t, '|', m[:180])

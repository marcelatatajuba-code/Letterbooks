# -*- coding: utf-8 -*-
import os, sys, json, re, urllib.parse
from urllib.parse import urlparse, parse_qs
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fixtures
from playwright.sync_api import sync_playwright

BASE  = 'http://127.0.0.1:8899/index.html'
proxy = os.environ.get('HTTPS_PROXY')
erros = []


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
    ctx.route('**openlibrary.org/**', fixtures.responder)
    # A ficha do livro agora consulta a comunidade. Esta suite e a do app
    # LOCAL: o servidor cai de proposito, e a secao 8b afirma o que a tela faz
    # quando ele cai. Sem esta rota o teste dependeria do tempo do proxy.
    ctx.route('**supabase.co/**', lambda rt: rt.abort())
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

    # o recorte leva a uma seleção de verdade.
    # Esperar por '.grade .cartao' NAO serve de sinal: a propria tela de busca
    # ja desenha #secao-alta com data-forma="grade" (js/app.js:470), entao o
    # seletor casa com a tela ANTERIOR e a assercao corre contra a repintura.
    # E a segunda vez que uma espera casa com a tela de tras neste projeto — o
    # sinal tem que ser algo que so o destino tem.
    pg.click('.linha-diretorio')
    pg.wait_for_selector('.titulo-pagina:has-text("Mais lidos")', timeout=20000)
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

    # ---- ISBN-10 terminado em X (D122) --------------------------------
    # O digito verificador do ISBN-10 vale de 0 a 10, e o 10 se escreve X.
    # `somenteDigitos` fazia replace(/[^0-9]/) e o comia: '850101254X' virava
    # nove caracteres, o teste de tamanho falhava, o app NAO mandava
    # params.isbn e caia numa busca de texto livre. Um em cada onze ISBN-10.
    #
    # O fixture carrega um ISBN com X de proposito — sem ele esta assercao nao
    # tem como ficar vermelha.
    r = pg.evaluate("""async () => {
      const a = await API.buscar('850101254X');
      const b = await API.buscar('850-101-254-x');
      const c = await API.buscar('XXXXXXXXXX');
      return { comX: a.livros.map(x => x.titulo), n: a.total,
               hifen: b.livros.map(x => x.titulo),
               dezX: c.total };
    }""")
    ok(r['comX'] == ['Grande Sertão: Veredas'],
       'ISBN-10 terminado em X acha o livro certo: %s' % r['comX'])
    ok(r['hifen'] == ['Grande Sertão: Veredas'],
       'e com hifen e em minuscula tambem: %s' % r['hifen'])
    # dez letras X nao sao ISBN: o X so vale na ultima casa. Cai em busca de
    # texto, que no fixture devolve o acervo inteiro — o importante e que NAO
    # devolveu a resposta exata de um ISBN.
    ok(r['dezX'] != 1, 'dez letras X nao viram consulta por ISBN (total=%s)' % r['dezX'])

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

    print('8b. o bloco Avaliações é da comunidade, e cala quando não sabe')
    # Ate aqui a ficha desenhava Dados.estatisticas() — as notas da PROPRIA
    # leitora, de todos os livros do acervo, iguais em toda ficha, sob o rotulo
    # "Avaliacoes". Nao era ausencia, era rotulo mentindo. O bloco agora vem da
    # nuvem, e aqui a nuvem esta abortada de proposito: o que se afirma e que
    # ele NAO inventa nada no lugar.
    pg.goto(BASE + '#/livro/' + fixtures.LIVROS[0][0].replace('/', '%2F'),
            wait_until='networkidle')
    pg.wait_for_selector('.livro-titulo', timeout=20000)
    pg.wait_for_selector('.avaliacoes-nota', timeout=15000)
    ok(pg.locator('.avaliacoes').count() == 1, 'o bloco Avaliações continua no corpo da ficha')
    # A REGRESSAO que este item conserta, travada por assercao: a leitora tem
    # nota 4,5 em Dom Casmurro registrada na secao 5 e o perfil dela desenha um
    # histograma com ela. Se ele voltar a aparecer AQUI, e a mentira de volta.
    ok(pg.locator('.avaliacoes .histograma').count() == 0,
       'sem resposta do servidor, nenhum histograma é desenhado')
    ok(pg.locator('.avaliacoes-media').count() == 0,
       'e nenhuma média é inventada com a nota da própria leitora')
    ok('comunidade' in pg.locator('.avaliacoes-nota').inner_text(),
       'a tela diz, em português, que não conseguiu trazer as notas')
    ok(pg.locator('.painel .histograma').count() == 0, 'o histograma segue fora do painel lateral')
    # O que e da pessoa continua sendo dela: a nota local nao sumiu junto.
    ok('★★★★½' in pg.locator('.painel-nota .estrelas').inner_text(),
       'a nota dela continua no painel, onde sempre esteve')
    # "Tentar de novo" refaz so esta consulta, sem repintar a ficha inteira.
    titulo_antes = pg.locator('.livro-titulo').inner_text()
    pg.locator('.avaliacoes-nota .mais').click()
    pg.wait_for_timeout(900)
    ok(pg.locator('.livro-titulo').inner_text() == titulo_antes,
       'tentar de novo não repinta a ficha')
    ok(pg.locator('.avaliacoes-nota').count() == 1, 'e volta a dizer o mesmo, sem quebrar')
    # O bloco e o unico controle do bloco tem alvo de dedo de verdade.
    alvo = pg.locator('.avaliacoes-nota .mais').first.evaluate(
        "e => { const r = e.getBoundingClientRect();"
        "       const p = getComputedStyle(e, '::after');"
        "       const i = Math.abs(parseFloat(p.inset || p.top || '0'));"
        "       return [r.width + 2*i, r.height + 2*i]; }")
    ok(alvo[1] >= 40, 'o botão de repetir tem %.0fpx de altura de toque' % alvo[1])
    ok(pg.evaluate("() => document.documentElement.scrollWidth <= "
                   "document.documentElement.clientWidth + 1"),
       'e a área de toque não cria rolagem lateral')

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
    # FACE B da tela única: é minha e ainda NÃO subiu (sem log.remoto — aqui a
    # nuvem está abortada, então nada subiu). O endereço público não existe
    # ainda, e um botão que promete link e entrega nada é a pior variante desta
    # tela: Compartilhar não pode ser desenhado.
    ok(pg.locator('.resenha .fila-aviso').count() == 1,
       'a resenha ainda só local diz por que não dá para compartilhar')
    ok('só existe neste aparelho' in pg.locator('.resenha .fila-aviso').inner_text() or
       'na fila' in pg.locator('.resenha .fila-aviso').inner_text(),
       'e diz qual dos dois motivos é')
    # .botao usa text-transform: uppercase — comparar sem normalizar mediria a
    # folha de estilo, não o que a tela oferece.
    textos = [t.lower() for t in pg.locator('.resenha-botoes .botao').all_inner_texts()]
    ok(not any('compartilhar' in t for t in textos),
       'sem endereço, sem botão de compartilhar — %r' % textos)
    ok(any('editar' in t for t in textos) and any('apagar' in t for t in textos),
       'mas editar e apagar continuam, que são ações locais')
    ok(pg.locator('.resenha-estado').count() == 0, 'e nada diz "no ar", porque não está')
    # Num app roteado por hash, href="#alguma-coisa" NÃO é âncora: o roteador lê
    # a raiz e cai na home. Trava para toda a tela, não só para o 💬 que já
    # tropeçou nisso.
    ancoras = pg.evaluate(
        "() => [...document.querySelectorAll('.resenha a[href^=\"#\"]')]"
        ".map(a => a.getAttribute('href')).filter(h => !h.startsWith('#/'))")
    ok(ancoras == [], 'nenhuma âncora crua de hash na resenha — %r' % ancoras)
    # Sem linha no servidor não há o que curtir nem comentar. Coração morto é
    # pior do que coração nenhum.
    ok(pg.locator('.resenha .feed-curtir').count() == 0, 'nem coração')
    ok(pg.locator('#comentarios').count() == 0, 'nem caixa de comentários')

    # A folha de apagar substitui o confirm() do navegador, que não diz o que
    # se perde, não carrega o tema e sai branco num app escuro.
    pg.locator('.resenha-botoes .botao.perigo').click()
    pg.wait_for_selector('.folha', timeout=5000)
    ok('Apagar esta resenha?' in pg.locator('.folha h2').inner_text(), 'a folha pergunta antes')
    ok('somem daqui' in pg.locator('.folha-sub').inner_text(), 'e diz o que se perde')
    corDoApagar = pg.locator('.folha .botao.perigo').evaluate(
        "e => getComputedStyle(e).color")
    corDaCurtida = pg.evaluate(
        "() => getComputedStyle(document.documentElement).getPropertyValue('--curtida').trim()")
    ok(corDoApagar != corDaCurtida,
       'e "Apagar" não é mais pintado na cor de "eu curti" (%s)' % corDoApagar)
    pg.locator('.folha-rodape .botao').first.click()   # Cancelar
    pg.wait_for_timeout(300)
    ok(pg.locator('.folha').count() == 0, 'cancelar fecha a folha')
    ok(pg.locator('.resenha').count() == 1, 'e a resenha continua lá')

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

    print('14. livro sem capa nao prende a pessoa na tela')
    # A rota da ficha e imersiva: o cabecalho da marca sai. O chevron de voltar
    # mora dentro do heroi, e o heroi so era desenhado quando havia capa —
    # entao livro sem capa era tela sem NENHUM caminho de volta.
    pg.goto(BASE + '#/livro/' + urllib.parse.quote('/works/OL_SEM_CAPA', safe=''))
    pg.wait_for_timeout(1500)
    ok(pg.locator('.voltar').count() == 1, 'o chevron de voltar existe mesmo sem capa')
    ok(pg.locator('.heroi-imagem').count() == 0, 'e nao ha imagem de fundo para desenhar')
    cx = pg.locator('.voltar').first.bounding_box()
    ok(cx and cx['width'] >= 36, 'o chevron tem caixa de verdade (%.0fpx)' % (cx['width'] if cx else 0))

    print('11. persistencia')
    d = json.loads(pg.evaluate("() => localStorage.getItem('letterbooks:v1')"))
    ok(len(d['logs']) == 1 and d['logs'][0]['nota'] == 4.5, 'registro gravado com 4,5')
    ok(len(d['listas']) == 1 and len(d['listas'][0]['livros']) == 1, 'lista gravada com o livro')

    print('12. as portas que deixaram de ser do navegador')
    # ZERO assercao de interface existia nestas 12 portas — e foi por isso que
    # elas sobreviveram nove entregas. Nenhum dialogo nativo deve mais existir:
    # se algum voltar, este bloco trava esperando um selector que nunca aparece.
    dialogos = []
    pg.on('dialog', lambda dg: (dialogos.append(dg.message), dg.dismiss()))

    # --- apagar leitura: a folha nomeia o que some -------------------------
    # Pela folha de REGISTRO, que era a pior das 12: um confirm() do sistema
    # empilhado POR CIMA de uma folha do app ja aberta. Agora ela fecha e abre
    # a de apagar — uma folha por vez, sem pilha e sem estado a restaurar.
    # (A coluna de acoes do #/diario e `display:none` abaixo de 720px, entao
    # naquele viewport ela nao e a porta que a pessoa usa.)
    # A coluna de acoes do diario e `display:none` abaixo de 720px — ela e a
    # porta de quem usa no computador. Alargo so para este bloco.
    pg.set_viewport_size({'width': 1180, 'height': 900})
    antes = pg.evaluate("() => Dados.estado().logs.length")
    ok(antes >= 1, 'ha pelo menos uma leitura para apagar')
    pg.goto(BASE + '#/diario', wait_until='networkidle')
    pg.wait_for_timeout(800)
    # Pela folha de REGISTRO, que era a pior das 12: um confirm() do sistema
    # empilhado POR CIMA de uma folha do app ja aberta. Agora ela fecha e abre
    # a de apagar — uma folha por vez, sem pilha e sem estado a restaurar.
    pg.locator('[data-acao=editar-log]').first.click()
    pg.wait_for_selector('.folha [data-fechar=apagar]', timeout=6000)
    pg.locator('.folha [data-fechar=apagar]').click()
    pg.wait_for_selector('[data-acao=confirmar-apagar]', timeout=6000)
    ok(pg.locator('.folha-fundo').count() == 1,
       'uma folha por vez: a de registro fechou antes de a de apagar abrir')
    txt = pg.inner_text('.folha')
    ok('Apagar' in txt, 'apagar leitura abre folha do app, nao dialogo do sistema')
    ok(not dialogos, 'e nenhum dialogo do navegador foi disparado')
    # sem conta e sem `remoto`, a folha NAO pode falar de servidor
    ok('servidor' not in txt, 'sem conta, a folha nao promete apagar do servidor')
    ok('endereço' not in txt, 'nem promete que um endereco para de abrir')
    pg.locator('.folha [data-fechar=ok]').click()
    pg.wait_for_timeout(400)
    ok(pg.evaluate("() => Dados.estado().logs.length") == antes,
       'cancelar nao apaga nada')

    # --- criar lista pela folha de uma pergunta ----------------------------
    pg.goto(BASE + '#/listas', wait_until='networkidle')
    pg.wait_for_timeout(600)
    quantasAntes = pg.evaluate("() => Dados.estado().listas.length")
    pg.locator('[data-acao=nova-lista]').first.click()
    pg.wait_for_selector('#campo-pergunta', timeout=6000)
    ok(pg.locator('.folha-fundo.com-campo').count() == 1,
       'a folha com campo ancora no topo, por causa do teclado virtual')
    # o botao nasce travado enquanto o campo estiver vazio
    ok(pg.locator('[data-acao=confirmar-pergunta]').is_disabled(),
       'sem nome, o botao de criar esta travado')
    ok(pg.inner_text('#aviso-pergunta').strip() != '',
       'e a razao do travamento esta escrita na tela')
    pg.fill('#campo-pergunta', 'Para reler')
    pg.wait_for_timeout(200)
    ok(not pg.locator('[data-acao=confirmar-pergunta]').is_disabled(),
       'com nome, destrava')
    pg.locator('[data-acao=confirmar-pergunta]').click()
    pg.wait_for_timeout(800)
    ok(pg.evaluate("() => Dados.estado().listas.length") == quantasAntes + 1,
       'a lista foi criada')

    # --- a assimetria: nome vazio invalido, descricao vazia VALIDA ---------
    idLista = pg.evaluate("() => Dados.estado().listas[Dados.estado().listas.length-1].id")
    pg.evaluate("(id) => Dados.editarLista(id, {descricao: 'tinha descricao'})", idLista)
    pg.goto(BASE + '#/lista/' + idLista, wait_until='networkidle')
    pg.wait_for_timeout(700)
    pg.locator('[data-acao=descrever]').first.click()
    pg.wait_for_selector('#campo-pergunta', timeout=6000)
    pg.fill('#campo-pergunta', '')
    pg.wait_for_timeout(200)
    ok(not pg.locator('[data-acao=confirmar-pergunta]').is_disabled(),
       'descricao VAZIA e valida: e como se tira uma descricao')
    pg.locator('[data-acao=confirmar-pergunta]').click()
    pg.wait_for_timeout(700)
    ok(pg.evaluate("(id) => !Dados.lista(id).descricao", idLista),
       'e a descricao foi removida de verdade')
    pg.goto(BASE + '#/lista/' + idLista, wait_until='networkidle')
    pg.wait_for_timeout(600)
    pg.locator('[data-acao=renomear]').first.click()
    pg.wait_for_selector('#campo-pergunta', timeout=6000)
    pg.fill('#campo-pergunta', '   ')
    pg.wait_for_timeout(200)
    ok(pg.locator('[data-acao=confirmar-pergunta]').is_disabled(),
       'mas nome vazio continua INVALIDO — a assimetria sobreviveu')
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(300)
    ok(pg.locator('.folha').count() == 0, 'Escape fecha a folha de uma pergunta')

    # --- o defeito da bio apagada -----------------------------------------
    pg.evaluate("""() => {
      var e = Dados.estado();
      e.perfil.nome = 'Marcela'; e.perfil.bio = 'lendo devagar';
      Dados.salvar();
    }""")
    pg.goto(BASE + '#/perfil/editar', wait_until='networkidle')
    pg.wait_for_selector('#forma-perfil-local', timeout=6000)
    pg.fill('#forma-perfil-local input[name=nome]', 'Outro nome')
    pg.locator('#forma-perfil-local a.botao').click()   # Cancelar
    pg.wait_for_timeout(700)
    perfil = pg.evaluate("() => Dados.estado().perfil")
    # ESTE e o defeito: antes, cancelar o segundo prompt gravava o nome E
    # apagava a bio, porque prompt cancelado devolve null e (null||'').trim()
    # e string vazia.
    ok(perfil['bio'] == 'lendo devagar', 'cancelar NAO apaga a bio')
    ok(perfil['nome'] == 'Marcela', 'e nao grava o nome pela metade')

    # --- meta: letra nunca aparece, e o app diz o que quer ------------------
    pg.goto(BASE + '#/perfil', wait_until='networkidle')
    pg.wait_for_timeout(600)
    pg.locator('[data-acao=editar-meta]').first.click()
    pg.wait_for_selector('#campo-pergunta', timeout=6000)
    pg.fill('#campo-pergunta', 'abc')
    pg.wait_for_timeout(200)
    ok(pg.input_value('#campo-pergunta') == '',
       'letra nao chega a entrar no campo da meta')
    ok(pg.inner_text('#aviso-pergunta').strip() != '',
       'e o app DIZ o que quer, em vez de nao fazer nada calado')
    pg.fill('#campo-pergunta', '24')
    pg.wait_for_timeout(200)
    pg.locator('[data-acao=confirmar-pergunta]').click()
    pg.wait_for_timeout(700)
    ok(pg.evaluate("() => Dados.estado().perfil.meta.total") == 24, 'a meta gravou 24')

    # --- a regua de 44 dos .botao, medida no COMPUTADO (D123) ----------------
    # A V13 pos a regra dentro de um @media que fica ANTES da declaracao base
    # `.botao { min-height: 34px }` — mesma especificidade, e a de baixo vence.
    # A regra nunca aplicou, e os tres remendos que funcionavam tinham sido
    # apagados junto. Nenhuma suite media isso, e o rastreador classifica alvo
    # miudo como gravidade MEDIA, que o portao nao conta.
    #
    # Mede o CSS computado, e nao um elemento especifico de uma tela: assim a
    # assercao vale para todo .botao do app, inclusive os que ainda nao existem.
    # A LARGURA IMPORTA e por pouco isto virou uma assercao errada: o bloco 8
    # deixa a janela em 1180px, onde 34px e o certo. A regra e do celular, entao
    # a medicao tem que ser no celular — mede nos DOIS e afirma os dois, senao
    # alguem "conserta" tirando o @media e o desktop passa a ter botao gordo.
    _mede = """() => {
      const b = document.createElement('button');
      b.className = 'botao'; b.textContent = 'X';
      document.body.appendChild(b);
      const h = getComputedStyle(b).minHeight;
      b.remove();
      return h;
    }"""
    _antes = pg.viewport_size
    pg.set_viewport_size({'width': 390, 'height': 844})
    noCelular = pg.evaluate(_mede)
    pg.set_viewport_size({'width': 1180, 'height': 900})
    noComputador = pg.evaluate(_mede)
    pg.set_viewport_size(_antes)
    ok(noCelular == '44px',
       'todo .botao tem min-height de 44px no celular (deu %s)' % noCelular)
    ok(noComputador == '34px',
       'e continua compacto no computador, onde nao ha dedo (deu %s)' % noComputador)

    # --- 16a: o CSV para fora -----------------------------------------------
    # ANTES do bloco de apagar tudo, de proposito: depois dele o Dados.limpar()
    # ja rodou e o diario esta vazio — um CSV so com cabecalho passaria em
    # metade das assercoes sem provar nada.
    #
    # A forma de dado que faz este teste valer: UMA resenha com os tres
    # perigos ao mesmo tempo (aspa, virgula e quebra de linha). Sem ela, uma
    # implementacao que so junta com virgula passa.
    pg.evaluate("""() => {
      const e = Dados.estado();
      e.livros['/works/OL45804W'] = {chave:'/works/OL45804W', titulo:'Dom Casmurro',
                                     autores:['Machado de Assis'], ano:1899};
      e.logs = [
        {id:'a', chave:'/works/OL45804W', nota:4.5, lidoEm:'2026-08-01', relido:false,
         spoiler:false, resenha:'Ela disse "sim", e virou a página.'
                                + String.fromCharCode(10) + 'Depois calou.'},
        {id:'b', chave:'/works/OL45804W', nota:null, lidoEm:'2026-08-02', relido:true,
         spoiler:false, resenha:''},
        {id:'c', chave:'/works/OL_SEM_FICHA', nota:3.0, lidoEm:'2026-08-03', relido:false,
         spoiler:false, resenha:''}
      ];
      Dados.salvar();
    }""")
    pg.goto(BASE + '#/perfil', wait_until='networkidle')
    pg.wait_for_timeout(600)
    pg.locator('[data-acao=exportar]').first.click()
    pg.wait_for_selector('.folha', timeout=6000)
    fx = pg.inner_text('.folha')
    ok('não traz de volta' in fx or 'não traz' in fx,
       'a folha DIZ que a planilha nao restaura tudo')
    with pg.expect_download() as baixa:
        pg.locator('[data-acao=exportar-csv]').click()
    arq = baixa.value
    ok(re.match(r'^letterbooks-\d{4}-\d{2}-\d{2}\.csv$', arq.suggested_filename) is not None,
       'nome do arquivo: %s' % arq.suggested_filename)
    bruto = open(arq.path(), 'rb').read()

    ok(bruto[:3] == b'\xef\xbb\xbf', 'o CSV comeca com BOM UTF-8')
    ok(bruto[3:].split(b'\r\n')[0] ==
       'Título,Autoria,Ano,Chave,Nota,Lido em,Relido,Spoiler,Resenha'.encode('utf-8'),
       'cabecalho legivel, na ordem, terminado em CRLF')
    # Tirados todos os CRLF, nao pode sobrar LF nem CR solto — pega troca de
    # fim de linha em QUALQUER posicao, inclusive dentro de campo aspado.
    sem = bruto.replace(b'\r\n', b'')
    ok(b'\n' not in sem and b'\r' not in sem, 'nao ha LF nem CR soltos no arquivo')
    esperado = '"Ela disse ""sim"", e virou a página.\r\nDepois calou."'.encode('utf-8')
    ok(esperado in bruto, 'aspa dobrada e CRLF dentro do campo aspado')
    # CONTROLE: a forma CRUA nao pode existir no arquivo
    ok('disse "sim", e virou'.encode('utf-8') not in bruto,
       'o campo cru nao vazou sem escape')
    # `Título` e a PRIMEIRA coluna, entao um campo sem perigo aparece no
    # comeco da linha, sem virgula antes. E logs() ordena por data decrescente,
    # entao nao da para supor qual linha e a primeira.
    corpo = bruto[3:].split(b'\r\n')
    ok(any(l.startswith('Dom Casmurro,'.encode('utf-8')) for l in corpo),
       'campo sem perigo sai SEM aspas')

    # E um parser que nao e o nosso: prova a promessa "abre noutro app".
    import csv as _csv, io as _io
    linhas = list(_csv.reader(_io.StringIO(bruto.decode('utf-8-sig'), newline='')))
    ok(len(linhas) == 4, 'cabecalho + 3 leituras: a quebra interna nao virou linha (%d)' % len(linhas))
    porChave = {l[3]: l for l in linhas[1:]}
    a1 = porChave['/works/OL45804W']
    ok(a1[3] == '/works/OL45804W', 'a chave sai inteira')
    notas = sorted(l[4] for l in linhas[1:])
    ok('4.5' in notas, 'nota com ponto, nao 4,5 nem 4.50: %s' % notas)
    ok('' in notas, 'nota ausente e VAZIO, nao "null" nem 0: %s' % notas)
    semFicha = porChave['/works/OL_SEM_FICHA']
    ok(semFicha[0] == '', 'ficha ausente sai com titulo vazio, nunca "Livro"')
    ok(any(l[6] == 'sim' for l in linhas[1:]), 'relido em portugues, como o cabecalho')

    # --- apagar tudo: inventario, e a fila que sobrevivia -------------------
    pg.evaluate("""() => localStorage.setItem('letterbooks:fila',
      JSON.stringify([{tipo:'leitura', dado:{cliente_id:'x'}, tentativas:0, em:1}]))""")
    pg.goto(BASE + '#/perfil', wait_until='networkidle')
    pg.wait_for_timeout(600)
    pg.locator('[data-acao=limpar]').first.click()
    pg.wait_for_selector('.folha', timeout=6000)
    f = pg.inner_text('.folha')
    ok('Leituras' in f and 'Listas' in f, 'a folha mostra o inventario do que some')
    ok('cópia' in f or 'conta não é apagada' in f,
       'e diz se ha copia em algum lugar')
    ok(pg.locator('[data-acao=exportar-antes]').count() == 1, 'oferece exportar antes')
    # E CLICA NELE — as duas suites so contavam o botao, e nenhuma clicava.
    # `exportarArquivo` e chamado DIRETO daqui e da folha de apagar a conta, e
    # `camada.innerHTML` e substituicao total: se ele passasse a abrir a folha
    # de exportar, este clique destruiria a folha de apagar (e, na outra, o @
    # que a pessoa acabou de digitar para confirmar). A regressao entraria
    # verde sem esta linha.
    with pg.expect_download() as baixaAntes:
        pg.locator('[data-acao=exportar-antes]').click()
    ok(baixaAntes.value.suggested_filename.endswith('.json'),
       'exportar antes baixa o JSON, que e o que restaura: %s'
       % baixaAntes.value.suggested_filename)
    ok('Apagar tudo deste aparelho' in pg.inner_text('.folha'),
       'e a folha de apagar CONTINUA aberta depois de exportar')
    pg.locator('[data-acao=confirmar-apagar-tudo]').click()
    pg.wait_for_timeout(1000)
    ok(pg.evaluate("() => Dados.estado().logs.length") == 0, 'o diario foi apagado')
    ok(not pg.evaluate("() => localStorage.getItem('letterbooks:fila')")
       or pg.evaluate("() => JSON.parse(localStorage.getItem('letterbooks:fila')||'[]').length") == 0,
       'e a FILA foi junto: o aparelho para de publicar o que foi apagado')

    ok(not dialogos, 'nenhum dialogo do navegador em todo o bloco 12')
    pg.set_viewport_size({'width': 390, 'height': 844})

    nav.close()

print('\n=== console ===')
print('   nenhum erro ou aviso' if not erros else '')
for t, m in erros[:20]:
    print('  ', t, '|', m[:180])

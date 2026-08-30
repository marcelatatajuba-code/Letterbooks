# -*- coding: utf-8 -*-
"""rastreador.py — anda o app sozinho, sem roteiro, e relata o que achou.

TRES tecnicas, e vale dizer o que cada uma e de verdade:

1. RASTREIO AUTONOMO (crawling). Nenhuma lista de telas escrita a mao. O
   rastreador olha a tela, enumera o que da para tocar (links de rota, botoes
   com data-acao, envios de formulario), toca, e repete. Descobre a jornada em
   vez de conferir uma jornada que eu ja tinha escrito — que e o problema de
   todo teste que eu mesmo escrevo: ele so olha onde eu ja estava olhando.

2. LOCALIZADOR QUE SE CURA (self-healing). Cada elemento e guardado com QUATRO
   descricoes: papel + nome acessivel, data-acao, texto, e seletor CSS. Na hora
   de tocar de novo, tenta na ordem ate uma resolver. Quando a primeira falha e
   outra funciona, isso e REGISTRADO — porque um seletor que precisou de cura e
   um aviso de que a tela mudou de forma sem ninguem perceber.

3. CONFERENCIA CONTRA O ORIGINAL. As telas descobertas sao cruzadas com o mapa
   das 24 telas do app de verdade (docs/mapa_dados.py), tirado quadro a quadro
   do video. Assim a cobertura nao e "quantas telas eu testei", e sim "quanto
   da jornada do original o Letterbooks alcanca".

O que ele checa em CADA tela, sem eu dizer o que procurar:
   · erro de JavaScript no console
   · rolagem horizontal (o app e de celular; rolar de lado e defeito)
   · alvo de toque menor que 40px (o minimo que o dedo acerta)
   · botao ou link sem nome acessivel (leitor de tela le "botao")
   · imagem que nao carregou
   · tela que ficou vazia depois de um toque (beco sem saida)
   · foco que some (navegacao por teclado)
"""
import os, sys, json, time, re, hashlib
from playwright.sync_api import sync_playwright
import testar_social as S

BASE = S.BASE
MAX_ESTADOS = 90
# 14 cortava a lista de ajustes do perfil no meio, e o rastreador nunca
# chegava em #/conta — reprovava a cobertura por limitacao MINHA, nao do app.
MAX_ACOES_POR_TELA = 26

achados = []      # {gravidade, tipo, onde, detalhe}
visitadas = {}    # assinatura -> {rota, titulo, acoes}
curas = []        # onde o localizador precisou se curar
rotas = set()


def achado(gravidade, tipo, onde, detalhe):
    achados.append({'gravidade': gravidade, 'tipo': tipo, 'onde': onde, 'detalhe': detalhe})


# ---------------------------------------------------------------- descrever --

JS_DESCREVER = """
() => {
  const vis = el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const nomeDe = el =>
    (el.getAttribute('aria-label') || el.innerText || el.value ||
     el.getAttribute('title') || '').trim().replace(/\\s+/g, ' ').slice(0, 60);

  const alvos = [...document.querySelectorAll(
    'main a[href^="#/"], main [data-acao], main button, main [data-r], main [data-escolher], ' +
    'nav.segmentos a, nav.perfil-atalhos a, nav.escopos a, .abas-pe a, .topo-nav a')]
    .filter(vis);

  const seen = new Set();
  const acoes = [];
  for (const el of alvos) {
    const r = el.getBoundingClientRect();
    const d = {
      papel: el.tagName === 'A' ? 'link' : 'button',
      nome: nomeDe(el),
      acao: el.getAttribute('data-acao') || el.getAttribute('data-r') || '',
      href: el.getAttribute('href') || '',
      css: (() => { let p = el, s = []; while (p && p.tagName !== 'MAIN' && s.length < 4) {
              let t = p.tagName.toLowerCase();
              if (p.className && typeof p.className === 'string')
                t += '.' + p.className.trim().split(/\\s+/).slice(0,2).join('.');
              s.unshift(t); p = p.parentElement; } return s.join(' > '); })(),
      l: Math.round(r.width), a: Math.round(r.height)
    };
    const k = d.papel + '|' + d.nome + '|' + d.acao + '|' + d.href;
    if (seen.has(k)) continue;
    seen.add(k);
    acoes.push(d);
  }
  return acoes;
}
"""

JS_SAUDE = """
() => {
  const out = { largura: document.documentElement.scrollWidth,
                viewport: window.innerWidth, semNome: [], miudos: [], imagens: [],
                vazia: (document.querySelector('main')||{}).innerText?.trim().length < 12 };
  const vis = el => { const r = el.getBoundingClientRect();
                      return r.width > 0 && r.height > 0; };
  // A area de toque de verdade inclui o ::after invisivel, que o
  // getBoundingClientRect NAO enxerga. Entao a medida honesta e sondar:
  // dispara elementFromPoint em volta do centro e ve ate onde o toque ainda
  // cai no controle. Medir so a caixa acusaria de miudo um alvo ja consertado.
  // E preciso tirar o elemento de baixo das barras FIXAS (.abas-pe, 64px, e a
  // .barra-acao da ficha) antes de sondar: la embaixo o elementFromPoint devolve
  // a barra, a sonda falha no primeiro passo e QUALQUER controle e acusado de
  // miudo. Foi assim que o ♥ das resenhas apareceu como 25x19 tendo os 44 do
  // ::after. Medir onde o dedo alcanca, e nao onde a rolagem por acaso parou.
  const alcance = el => {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const pega = (x, y) => { const t = document.elementFromPoint(x, y);
                             return t && (t === el || el.contains(t) || t.contains(el)); };
    let l = 0, a = 0;
    for (let d = 2; d <= 24; d += 2) { if (pega(cx - d, cy) && pega(cx + d, cy)) l = d * 2; else break; }
    for (let d = 2; d <= 24; d += 2) { if (pega(cx, cy - d) && pega(cx, cy + d)) a = d * 2; else break; }
    return { l: Math.max(l, r.width), a: Math.max(a, r.height) };
  };

  for (const el of document.querySelectorAll('main button, main a, .abas-pe a, .abas-pe button')) {
    if (!vis(el)) continue;
    const nome = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '').trim();
    if (!nome) out.semNome.push(el.outerHTML.slice(0, 90));
    // Link DENTRO de um texto corrido e palavra, nao botao: aumentar a area
    // dele estragaria a frase. O original faz igual — o nome de quem postou e
    // um link pequeno no meio da frase.
    const dentroDeFrase = el.tagName === 'A' && el.parentElement &&
      ['P','SPAN','LI','TIME'].includes(el.parentElement.tagName) &&
      el.parentElement.innerText.trim().length > el.innerText.trim().length + 3;
    if (dentroDeFrase) continue;
    const t = alcance(el);
    if (t.a < 40 && t.l < 40) out.miudos.push({ nome: nome.slice(0,40),
      l: Math.round(t.l), a: Math.round(t.a) });
  }
  for (const im of document.querySelectorAll('main img')) {
    if (im.complete && im.naturalWidth === 0) out.imagens.push(im.getAttribute('src') || '?');
  }
  return out;
}
"""


def assinatura(pg):
    """Identidade da tela: rota + esqueleto do DOM. Duas telas com o mesmo
       esqueleto e conteudo diferente contam como a mesma — e o certo, senao o
       rastreador ficaria preso abrindo os 40 livros da grade."""
    rota = pg.evaluate("() => (location.hash || '#/inicio').split('/').slice(0,2).join('/')")
    ossos = pg.evaluate("""() => [...document.querySelectorAll('main *')].slice(0, 120)
        .map(e => e.tagName + '.' + (typeof e.className === 'string'
             ? e.className.trim().split(/\\s+/)[0] : '')).join('|')""")
    return rota + '#' + hashlib.md5(ossos.encode()).hexdigest()[:8], rota


# ------------------------------------------------------- localizador curavel --

def localizar(pg, d):
    """Tenta quatro estrategias, na ordem do mais estavel para o mais fragil.
       Devolve (locator, estrategia) ou (None, None)."""
    tentativas = []
    if d['acao']:
        tentativas.append(('data-acao', 'main [data-acao="%s"], main [data-r="%s"]'
                           % (d['acao'], d['acao'])))
    if d['href']:
        tentativas.append(('href', '[href="%s"]' % d['href'].replace('"', '\\"')))
    if d['nome']:
        tentativas.append(('nome', None))
    if d['css']:
        tentativas.append(('css', d['css']))

    for estrategia, sel in tentativas:
        try:
            if estrategia == 'nome':
                loc = pg.get_by_role(d['papel'], name=d['nome'], exact=False).first
            else:
                loc = pg.locator(sel).first
            if loc.count() and loc.is_visible():
                return loc, estrategia
        except Exception:
            continue
    return None, None


def rastrear():
    S.zerar(vazio=True)
    S.BANCO['livros'].append(S.LIVRO)
    estado = {}
    erros_console = []

    with sync_playwright() as pw:
        nav, ctx, pg = S.montar(pw, estado)
        pg.set_viewport_size({'width': 390, 'height': 844})
        pg.on('pageerror', lambda e: erros_console.append(('pageerror', str(e)[:200])))
        def deConsole(m):
            if m.type != 'error': return
            t = m.text[:200]
            # 404 de IMAGEM nao e defeito: a capa que falha vira lombada, de
            # proposito e com teste proprio. Erro e 404 de script ou de dado.
            if 'status of 404' in t and re.search(r'\.(jpg|jpeg|png|webp|gif)\b',
                                                  m.location.get('url', '') if m.location else ''):
                return
            erros_console.append(('console', t))
        pg.on('console', deConsole)

        # confirm()/alert() travam o clique ate alguem responder. O rastreador
        # aceita, para conseguir andar pelos caminhos destrutivos — e por isso
        # ele roda contra um banco de mentira, nunca contra o seu.
        pg.on('dialog', lambda d: d.accept())

        pg.goto(BASE, wait_until='networkidle')
        pg.evaluate("""(l) => { localStorage.clear();
            localStorage.setItem('letterbooks:v1', JSON.stringify({
            versao:1, perfil:{nome:'Ana',bio:'',meta:{ano:2026,total:12}},
            livros:{'/works/OL1W': l}, logs:[], querLer:[], curtidas:[],
            favoritos:[], listas:[], buscas:[]})); }""", S.LIVRO)

        # --- login, para o rastreador ver o app inteiro e nao so a parte publica
        print('login…')
        import jornada_e2e as J
        J.criarConta(pg, 'ana@x.com', nome='Ana')
        J.registrarLeitura(pg, '%2Fworks%2FOL1W', 5, 'Uma resenha para o rastreador achar.')
        print('  entrou como @ana, com uma leitura registrada')

        fila = ['#/inicio']
        while fila and len(visitadas) < MAX_ESTADOS:
            destino = fila.pop(0)
            try:
                pg.goto(BASE + destino, wait_until='domcontentloaded')
                pg.wait_for_timeout(700)
            except Exception as e:
                achado('alta', 'rota-quebrada', destino, str(e)[:120])
                continue

            antes = len(erros_console)
            sig, rota = assinatura(pg)
            if sig in visitadas:
                continue
            rotas.add(rota)

            saude = pg.evaluate(JS_SAUDE)
            onde = destino

            if saude['largura'] > saude['viewport'] + 1:
                achado('alta', 'rolagem-lateral', onde,
                       'a página tem %dpx numa tela de %dpx' % (saude['largura'], saude['viewport']))
            if saude['vazia']:
                achado('alta', 'tela-vazia', onde, 'a tela não renderizou conteúdo nenhum')
            for h in saude['semNome'][:3]:
                achado('media', 'sem-nome', onde, 'controle sem nome acessível: ' + h)
            for m in saude['miudos'][:3]:
                achado('media', 'alvo-miudo', onde,
                       '"%s" tem %dx%dpx (mínimo confortável: 40)' % (m['nome'], m['l'], m['a']))
            for i in saude['imagens'][:3]:
                achado('baixa', 'imagem-quebrada', onde, i)

            acoes = pg.evaluate(JS_DESCREVER)[:MAX_ACOES_POR_TELA]
            visitadas[sig] = {'rota': rota, 'destino': destino, 'acoes': len(acoes)}
            print('  %-34s %2d ações' % (destino[:34], len(acoes)))

            for d in acoes:
                if d['href'].startswith('#/'):
                    if d['href'] not in [x['destino'] for x in visitadas.values()] and \
                       d['href'] not in fila:
                        fila.append(d['href'])
                    continue
                # botao: aciona e ve o que acontece
                try:
                    pg.goto(BASE + destino, wait_until='domcontentloaded')
                    pg.wait_for_timeout(400)
                except Exception:
                    continue
                loc, estrategia = localizar(pg, d)
                if not loc:
                    achado('media', 'sumiu', onde,
                           'o controle "%s" (%s) existia ao mapear e não ao acionar'
                           % (d['nome'][:40], d['acao'] or d['css'][:30]))
                    continue
                if estrategia != ('data-acao' if d['acao'] else 'nome'):
                    curas.append({'onde': onde, 'alvo': d['nome'][:40] or d['acao'],
                                  'curou_com': estrategia})
                marca = len(erros_console)
                try:
                    loc.click(timeout=3000)
                    pg.wait_for_timeout(600)
                except Exception as e:
                    achado('media', 'clique-falhou', onde,
                           '"%s": %s' % (d['nome'][:40] or d['acao'], str(e).split('\n')[0][:90]))
                    continue
                novos = erros_console[marca:]
                for tipo, txt in novos[:2]:
                    achado('alta', 'erro-js', onde + ' → ' + (d['nome'][:30] or d['acao']), txt)
                s2, r2 = assinatura(pg)
                if s2 not in visitadas and r2 != rota:
                    fila.append(pg.evaluate("() => location.hash"))

            for tipo, txt in erros_console[antes:]:
                achado('alta', 'erro-js', onde, txt)

        nav.close()
    return erros_console


# ------------------------------------------- cobertura contra o app original --

# Cada tela do mapa do app de verdade e a rota do Letterbooks que a cumpre.
# Sai de docs/mapa_dados.py, que foi tirado quadro a quadro do video.
EQUIVALENTES = {
    'Films — início':            '#/inicio',
    'Reviews':                   '#/resenhas',
    'Lists':                     '#/listas',
    'Popular This Week — grade': '#/explorar',
    'Ficha do filme':            '#/livro',
    'Resenha':                   '#/resenha',
    'Buscar — Explorar por':     '#/buscar',
    'Resultados':                '#/buscar',
    'Perfil':                    '#/perfil',
    'Contagens do perfil':       '#/perfil',
    'Diário':                    '#/diario',
    'Quero ver / Estante':       '#/estante',
    'Ajustes':                   '#/conta',
    'Atividade — Amigos':        '#/atividade',
}


def cobertura():
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
    import importlib.util
    caminho = '/home/user/letterbooks/docs/mapa_dados.py'
    spec = importlib.util.spec_from_file_location('mapa_dados', caminho)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

    linhas = []
    for tid, grupo, nome, rota, marcado, _txt in m.TELAS:
        esperada = EQUIVALENTES.get(nome)
        if not esperada:
            linhas.append((grupo, nome, marcado, 'sem equivalente', None))
            continue
        alcancada = any(r.startswith(esperada) for r in rotas)
        linhas.append((grupo, nome, marcado, esperada, alcancada))
    return linhas


def relatar(erros_console):
    print('\n' + '=' * 66)
    print('RASTREIO AUTONOMO — %d telas distintas, %d rotas' % (len(visitadas), len(rotas)))
    print('=' * 66)

    print('\nrotas alcancadas sozinho, sem roteiro:')
    for r in sorted(rotas):
        print('   ' + r)

    print('\n--- cobertura da jornada do app original ---')
    linhas = cobertura()
    ok = [l for l in linhas if l[4] is True]
    nao = [l for l in linhas if l[4] is False]
    fora = [l for l in linhas if l[4] is None]
    for grupo, nome, marcado, rota, alcancada in linhas:
        simbolo = {True: 'alcancada ', False: 'NAO CHEGOU', None: '(sem par)  '}[alcancada]
        print('   %-11s %-28s %s' % (simbolo, nome[:28], rota))
    print('   ----------------------------------------------------------')
    print('   %d de %d telas com par alcancadas pelo rastreador'
          % (len(ok), len(ok) + len(nao)))

    print('\n--- localizador: onde precisou se curar ---')
    if not curas:
        print('   nenhuma cura: todo controle foi achado pela estrategia mais estavel')
    for c in curas[:12]:
        print('   %s → "%s" so resolveu por %s' % (c['onde'], c['alvo'], c['curou_com']))

    print('\n--- achados ---')
    if not achados:
        print('   nada')
    for g in ('alta', 'media', 'baixa'):
        doGrau = [a for a in achados if a['gravidade'] == g]
        if not doGrau: continue
        print('\n   [%s] %d' % (g.upper(), len(doGrau)))
        vistos = set()
        for a in doGrau:
            k = (a['tipo'], a['detalhe'][:60])
            if k in vistos: continue
            vistos.add(k)
            print('     · %-18s %s' % (a['tipo'], a['onde']))
            print('       %s' % a['detalhe'][:150])

    json.dump({'telas': list(visitadas.values()), 'rotas': sorted(rotas),
               'achados': achados, 'curas': curas,
               'cobertura': [{'grupo': l[0], 'tela': l[1], 'rota': l[3],
                              'alcancada': l[4]} for l in linhas]},
              open('rastreio.json', 'w'), indent=1, ensure_ascii=False)
    print('\n(detalhe completo em rastreio.json)')
    return len([a for a in achados if a['gravidade'] == 'alta'])


if __name__ == '__main__':
    t0 = time.time()
    erros = rastrear()
    graves = relatar(erros)
    print('\n%.0fs · %d achado(s) de gravidade alta' % (time.time() - t0, graves))

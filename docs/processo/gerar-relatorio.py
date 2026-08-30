# -*- coding: utf-8 -*-
import csv, html
D = '/home/user/letterbooks/docs/processo/'
defeitos = list(csv.DictReader(open(D + 'defeitos.csv', encoding='utf-8')))
def esc(t): return html.escape(str(t))

MODOS = [
 ('vibecoding', 'Vibecoding', '29/08 22:48 – 30/08 00:45',
  'Eu improvisando direto no código, com você olhando o resultado. Campo aberto: o primeiro commit tem 2.420 linhas.',
  9, 3447, 0, 173, 10, 3),
 ('instrumentado', 'Instrumentado', '30/08 01:48 – 05:59',
  'Mesma frente, agora medindo contra os quadros do vídeo e escrevendo suíte junto com o código. Nasce o rastreador autônomo.',
  12, 2861, 1465, 203, 13, 4),
 ('time-hibrido', 'Time híbrido', '30/08 06:11 – 15:39',
  'Catorze agentes em fases de SDLC produzem especificação; eu implemento em série. Nasce o harness do projeto.',
  3, 252, 1187, 2279, 9, 0),
]

FASES_SDLC = [
 ('Requisitos', 'inventário do Letterboxd contra o que o app faz', 'agente <b>produto</b>', 'kb/produto.json'),
 ('Mercado', 'concorrentes e oportunidades, com procedência declarada', 'agente <b>mercado</b>', 'kb/mercado.json'),
 ('Priorização', 'backlog único; fidelidade ganha de novidade', 'orquestrador de <b>curadoria</b>', 'kb/backlog.json'),
 ('Design', 'história, DoR, DoD, casos de uso, spec de tela', 'agentes <b>gpm</b> + <b>design</b>', 'kb/especificacoes.json'),
 ('Arquitetura', 'viabilidade, ordem de execução, colisões de arquivo', 'agente <b>tech-lead</b>', 'kb/plano-tecnico.json'),
 ('Plano de teste', 'casos escritos antes de existir código', 'agente <b>qa</b>', 'fase Revisão'),
 ('Implementação', 'uma frente só, em série', '<b>eu</b>', 'commits'),
 ('Verificação', 'quatro suítes, rastreador, prova em Postgres', 'ferramenta', '/verificar'),
 ('Publicação', 'push; o Pages publica sozinho', 'ferramenta', '—'),
]

CAVEATS = [
 ('As fases não fazem o mesmo trabalho',
  'A primeira era campo aberto — 3.447 linhas de app. A última é endurecimento e correção, com 252. Linha por hora não compara nada aqui.'),
 ('“Defeitos por fase” mede DETECÇÃO, não injeção',
  'Cinco dos nove defeitos da última fase nasceram nas duas primeiras e ficaram latentes de 1h20 a 5h30. O time híbrido não os evitou — ele os tornou visíveis. Ler a tabela como “a última fase teve menos defeitos” é ler ao contrário.'),
 ('Hora de parede não é esforço',
  'A última fase abrange 9,5 horas de relógio, incluindo 73 minutos de agentes rodando e um intervalo longo sem trabalho nenhum. Não divida nada por essas horas.'),
 ('Uma amostra de 32 defeitos e um projeto',
  'Isto descreve o que aconteceu neste projeto, com esta pessoa, neste ambiente. Não é evidência de que o método funciona em geral.'),
]

def chip(det):
    if 'usuária' in det: return 'chip critica'
    if 'agente' in det: return 'chip agente'
    if 'rastreador' in det or 'jornada' in det or 'suíte' in det or 'Postgres' in det: return 'chip suite'
    return 'chip eu'

linhas_modo = ''.join(
 '<tr><td class="modo"><b>%s</b><span>%s</span></td>'
 '<td>%d</td><td>%s</td><td>%s</td><td>%s</td><td>%d</td>'
 '<td class="%s">%d de %d</td></tr>'
 % (esc(nome), esc(quando), commits, f'{app:,}'.replace(',', '.'),
    f'{ver:,}'.replace(',', '.') if ver else '<span class="zero">0</span>',
    f'{con:,}'.replace(',', '.'), defs,
    'destaque bom' if usu == 0 else 'destaque',
    usu, defs)
 for _, nome, quando, _desc, commits, app, ver, con, defs, usu in MODOS)

cards_modo = ''.join(
 '<div class="cartao-modo"><h3>%s</h3><p class="quando">%s</p><p>%s</p></div>'
 % (esc(nome), esc(quando), esc(desc))
 for _, nome, quando, desc, *_ in MODOS)

linhas_sdlc = ''.join(
 '<tr><td><b>%s</b></td><td>%s</td><td>%s</td><td><code>%s</code></td></tr>'
 % (esc(f), esc(o), e, esc(a)) for f, o, e, a in FASES_SDLC)

linhas_caveat = ''.join(
 '<div class="caveat"><h3>%s</h3><p>%s</p></div>' % (esc(t), esc(d)) for t, d in CAVEATS)

linhas_def = ''.join(
 '<tr><td class="id">%s</td><td>%s</td><td><span class="%s">%s</span></td>'
 '<td class="lat">%s</td></tr>'
 % (esc(d['id']), esc(d['defeito']), chip(d['detector']), esc(d['detector']), esc(d['latencia']))
 for d in defeitos)

CSS = """
:root{
  --fundo:#14181c; --painel:#1a2027; --alto:#232c35; --regua:#2b3742;
  --texto:#dfe9f2; --meio:#a3b4c2; --fraco:#7d8fa0;
  --bom:#00e054; --atencao:#ff8000; --critico:#ff5c5c; --azul:#40bcf4;
  --display:'Bricolage Grotesque','Trebuchet MS',sans-serif;
  --corpo:'Source Serif 4',Georgia,'Times New Roman',serif;
  --dado:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--fundo);color:var(--texto);
     font:16px/1.65 var(--corpo);-webkit-font-smoothing:antialiased}
.envolve{max-width:1000px;margin:0 auto;padding:0 24px 96px}
.abre{padding:70px 0 26px}
.eyebrow{font:600 12px/1 var(--display);letter-spacing:.16em;text-transform:uppercase;
         color:var(--azul);margin:0 0 18px}
h1{font:700 clamp(32px,5.6vw,50px)/1.05 var(--display);letter-spacing:-.025em;
   margin:0 0 18px;text-wrap:balance}
.abre p{margin:0 0 14px;max-width:66ch;color:var(--meio);font-size:17px}
h2{font:700 26px/1.15 var(--display);letter-spacing:-.02em;margin:62px 0 6px}
.sub{margin:0 0 22px;color:var(--fraco);font-size:15px;max-width:70ch}

.achado{margin:34px 0 0;padding:26px 28px;background:var(--painel);
        border:1px solid var(--regua);border-radius:10px}
.achado .rot{font:600 11px/1 var(--display);letter-spacing:.12em;text-transform:uppercase;
             color:var(--fraco);margin:0 0 16px}
.trio{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
.trio div{text-align:center;padding:14px 8px;background:var(--alto);border-radius:8px}
.trio b{display:block;font:700 34px/1 var(--display);font-variant-numeric:tabular-nums;
        letter-spacing:-.03em}
.trio span{display:block;margin-top:8px;font:600 10.5px/1.3 var(--display);
           letter-spacing:.08em;text-transform:uppercase;color:var(--fraco)}
.trio .a b{color:var(--critico)} .trio .b b{color:var(--atencao)} .trio .c b{color:var(--bom)}
.achado p{margin:0;color:var(--meio);font-size:15.5px;max-width:74ch}
.achado strong{color:var(--texto);font-weight:600}

.rolagem{overflow-x:auto;margin-top:6px}
table{border-collapse:collapse;width:100%;min-width:660px}
th{text-align:left;font:600 10.5px/1.3 var(--display);letter-spacing:.09em;
   text-transform:uppercase;color:var(--fraco);padding:0 14px 11px 0;
   border-bottom:1px solid var(--regua);white-space:nowrap}
td{padding:14px 14px 14px 0;border-bottom:1px solid var(--regua);
   font-size:15px;color:var(--meio);font-variant-numeric:tabular-nums}
td b{color:var(--texto);font-weight:600}
.modo span{display:block;font:11.5px var(--dado);color:var(--fraco);margin-top:3px}
.zero{color:var(--critico);font-weight:700}
.destaque{font-weight:700;color:var(--atencao)}
.destaque.bom{color:var(--bom)}
td code{font:12.5px var(--dado);color:var(--fraco)}

.modos{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;
       margin-top:20px}
.cartao-modo{background:var(--painel);border:1px solid var(--regua);border-radius:9px;
             padding:16px 18px}
.cartao-modo h3{font:600 17px/1.2 var(--display);margin:0 0 4px}
.cartao-modo .quando{font:11.5px var(--dado);color:var(--fraco);margin:0 0 10px}
.cartao-modo p{margin:0;font-size:14.5px;color:var(--meio)}

.caveats{display:grid;gap:12px;margin-top:6px}
.caveat{background:var(--painel);border-left:3px solid var(--atencao);
        border-radius:0 9px 9px 0;padding:16px 20px}
.caveat h3{font:600 16.5px/1.3 var(--display);margin:0 0 6px;letter-spacing:-.01em}
.caveat p{margin:0;color:var(--meio);font-size:15px;max-width:76ch}

.chip{font:600 10.5px/1 var(--display);letter-spacing:.07em;text-transform:uppercase;
      padding:5px 9px;border-radius:999px;white-space:nowrap;display:inline-block}
.chip.critica{background:rgba(255,92,92,.13);color:var(--critico);border:1px solid rgba(255,92,92,.3)}
.chip.agente{background:rgba(64,188,244,.12);color:var(--azul);border:1px solid rgba(64,188,244,.3)}
.chip.suite{background:rgba(0,224,84,.12);color:var(--bom);border:1px solid rgba(0,224,84,.3)}
.chip.eu{background:rgba(160,180,200,.09);color:var(--fraco);border:1px solid rgba(160,180,200,.22)}
.id{font:12px var(--dado);color:var(--fraco);width:44px}
.lat{font:12.5px var(--dado);color:var(--fraco);white-space:nowrap}

.fecho{margin-top:60px;padding-top:24px;border-top:1px solid var(--regua)}
.fecho h3{font:600 17px/1.3 var(--display);margin:0 0 8px}
.fecho p{margin:0 0 16px;color:var(--meio);max-width:76ch}
.fecho b{color:var(--texto);font-weight:600}
.fecho code{font:13px var(--dado);background:var(--painel);padding:2px 7px;border-radius:4px}

@media (max-width:640px){
  .envolve{padding:0 18px 64px}
  .abre{padding-top:46px}
  .trio{grid-template-columns:1fr;gap:8px}
  .trio div{display:flex;align-items:baseline;gap:12px;text-align:left}
  .trio span{margin-top:0}
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
"""

HTML = """<title>Vibecoding contra time híbrido</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap">
<style>%s</style>
<div class="envolve">

<header class="abre">
  <p class="eyebrow">Letterbooks · 24 commits · 32 defeitos registrados</p>
  <h1>O que mudou quando o time deixou de ser só eu</h1>
  <p>Três modos de execução no mesmo projeto, no mesmo dia. Tudo aqui saiu de <code>git log</code> e das próprias suítes — nenhum número foi estimado, e onde a medida é fraca está escrito que é fraca.</p>

  <div class="achado">
    <p class="rot">O achado, e é um só</p>
    <div class="trio">
      <div class="a"><b>3 de 10</b><span>vibecoding</span></div>
      <div class="b"><b>4 de 13</b><span>instrumentado</span></div>
      <div class="c"><b>0 de 9</b><span>time híbrido</span></div>
    </div>
    <p><strong>Defeitos que você teve que encontrar.</strong> Na primeira fase, você era o detector: três rodadas de “o layout está ruim” antes de eu medir o original. Na última, nenhum defeito chegou até você — os nove foram achados por agente ou por suíte antes de você abrir o app.</p>
  </div>
</header>

<h2>Os três modos</h2>
<p class="sub">O mesmo projeto, o mesmo dia, o mesmo par de mãos escrevendo o código.</p>
<div class="modos">%s</div>

<div class="rolagem">
<table>
  <thead><tr><th>Modo</th><th>Commits</th><th>App</th><th>Verificação</th><th>Conhecimento</th><th>Defeitos</th><th>Achados por você</th></tr></thead>
  <tbody>%s</tbody>
</table>
</div>

<h2>Como ler isto sem se enganar</h2>
<p class="sub">Estes quatro pontos têm o mesmo peso que o achado acima. Uma tabela de métrica sem eles vira propaganda.</p>
<div class="caveats">%s</div>

<h2>Por que não é Scrum</h2>
<p class="sub">Story point, velocity e burndown supõem que o recurso escasso é hora de gente. Aqui não é.</p>
<div class="caveats">
  <div class="caveat"><h3>Ponto cego</h3><p>O ambiente não alcança a Open Library nem o Supabase. Três rodadas de retrabalho de layout saíram daí, e três defeitos só apareceram num print do seu celular. Nenhum burndown mostra isso.</p></div>
  <div class="caveat"><h3>Colisão de arquivo</h3><p><code>js/app.js</code> tem cerca de 3.000 linhas e quase toda tela passa por ele. Isso limita o paralelismo mais do que qualquer capacidade de time — é por isso que a implementação fica fora do ciclo de agentes.</p></div>
  <div class="caveat"><h3>Capacidade de detecção</h3><p>Defeito existe desde que foi escrito; o que muda é quando alguém consegue vê-lo. As métricas aqui medem quem detectou e quanto tempo ficou latente, e não esforço.</p></div>
</div>

<h2>As fases do SDLC, e quem executa cada uma</h2>
<p class="sub">O ciclo é orientado a especificação: nada vira código antes de ter caso de uso e critério de aceite.</p>
<div class="rolagem">
<table>
  <thead><tr><th>Fase</th><th>O que é aqui</th><th>Executor</th><th>Artefato</th></tr></thead>
  <tbody>%s</tbody>
</table>
</div>

<h2>Os 32 defeitos, e quem achou cada um</h2>
<p class="sub">A coluna de detector é a espinha deste documento. A latência é quanto tempo o defeito ficou vivo antes de alguém vê-lo.</p>
<div class="rolagem">
<table>
  <thead><tr><th>#</th><th>Defeito</th><th>Detector</th><th>Latência</th></tr></thead>
  <tbody>%s</tbody>
</table>
</div>

<footer class="fecho">
  <h3>Três números deste documento estavam errados</h3>
  <p>Na primeira versão: <b>251 asserções</b> contava os achados do rastreador como asserção, <b>0,55</b> somava o script de orquestração como verificação, e <b>“4 de 10”</b> atribuía a você um defeito que fui eu quem viu. Os três foram conferidos contra a fonte depois de escritos, e corrigidos.</p>
  <p>Por isso existe <code>docs/processo/conferir.py</code>: ele lê os números afirmados no documento e confere contra o CSV e as suítes. Documento de métrica que não confere os próprios números não vale a leitura.</p>

  <h3>O que nenhuma métrica daqui alcança</h3>
  <p><b>Se o app está bonito.</b> O rastreador mede estrutura, alcance do dedo, nome acessível e erro de execução. Julgamento de desenho continua sendo trabalho de olhar — e o print do seu celular vale mais que qualquer suíte.</p>
  <p><b>Se o contrato com o Supabase está certo.</b> Os mocks imitam o formato do PostgREST, não o comportamento. Três vezes um mock frouxo quase deixou passar defeito, e uma dessas vezes ele acusou o app de um erro que não existia.</p>
  <p><b>Quanto custou.</b> Não meço horas de gente nem dinheiro. O que existe é o consumo do ciclo: <b>14 agentes, 1,95 milhão de tokens, 73 minutos</b>.</p>
</footer>
</div>
""" % (CSS, cards_modo, linhas_modo, linhas_caveat, linhas_sdlc, linhas_def)

open('processo.html', 'w', encoding='utf-8').write(HTML)
print('%.1f KB' % (len(HTML.encode())/1024))

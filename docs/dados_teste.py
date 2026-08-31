# -*- coding: utf-8 -*-
"""dados_teste.py — o conjunto de dados dos testes de regressão.

QUAL É A IDEIA. As quatro suítes provam FLUXOS: registrar sobe, seguir grava,
a jornada com duas contas fecha. Este arquivo prova FORMAS: o livro sem capa,
a leitura órfã, o perfil que só tem @, a resenha de 241 caracteres. São coisas
diferentes, e a segunda é a que apodrece calada — um fluxo quebrado aparece na
primeira execução, uma forma de dado esquisita fica esperando alguém tropeçar.

A REGRA DESTE ARQUIVO: cada caso aqui existe porque um defeito real aconteceu,
e traz o número dele. Um caso sem `defeitos` preenchido é um caso sem motivo,
e caso sem motivo vira ruído que ninguém tem coragem de apagar depois. Onde o
caso cobre um precipício conhecido que ainda não virou defeito, isso está
escrito em `porque` com todas as letras.

COMO ACRESCENTAR UM CASO. Corrigiu um defeito? Some uma entrada em CASOS com
o id dele, a rota, e as checagens que teriam pegado. Rode
`python3 docs/testar_regressao.py`. O `cobertura()` daqui diz quais defeitos
do `docs/processo/defeitos.csv` ainda não têm caso — e é ele que responde
"quanto do que já quebrou está travado", que é a única pergunta que importa
numa suíte de regressão.

O QUE ESTE ARQUIVO NÃO É. Não é gerador aleatório. Datas, ids e notas são
fixos de propósito: teste que muda de dado a cada execução falha por motivo
diferente do que você está investigando, e aí você deixa de acreditar nele.
"""
import fixtures

# Uma data congelada. "Hoje" nos testes é sempre este dia — quandoFoi() diz
# "3d" ou "2sem" a partir daqui, e assertion sobre texto de tempo só é estável
# se o tempo for.
HOJE = '2026-08-30'


def dias(n):
    """AAAA-MM-DD de n dias antes de HOJE (agosto/2026 cabe inteiro no mês)."""
    d = 30 - n
    return '2026-08-%02d' % d if d >= 1 else '2026-07-%02d' % (31 + d)


def quando(n):
    return dias(n) + 'T12:00:00Z'


# ------------------------------------------------------------------ o elenco

# @ segue a restrição real do banco: ^[a-z0-9_]{3,20}$ (esquema.sql:19). O
# nome é texto livre, e é lá que moram acento e emoji — testar @ acentuado
# seria testar um banco que não pode existir.
ELENCO = {
    'marcela': {'id': 'uid-1', 'usuario': 'marcela', 'nome': 'Marcela',
                'bio': 'lendo devagar', 'local': 'Salvador'},
    'bia':     {'id': 'uid-2', 'usuario': 'bia', 'nome': 'Bia',
                'bio': 'leio de tudo', 'local': 'Recife'},
    'ana':     {'id': 'uid-3', 'usuario': 'ana', 'nome': 'Ana Prado',
                'bio': '', 'local': ''},
    'rui':     {'id': 'uid-4', 'usuario': 'rui', 'nome': 'Rui', 'bio': '', 'local': ''},
    # D17: o perfil dizia "Leitora" — o nome padrão local — com o @ de outra
    # pessoa embaixo. Perfil sem nome tem que cair no @, nunca no padrão.
    'semnome': {'id': 'uid-5', 'usuario': 'semnome', 'nome': None,
                'bio': '', 'local': ''},
    # A inicial do avatar vem de nome.trim().charAt(0) — com acento e com
    # emoji isso já é surrogate pair em JS, e cortar no meio de um par produz
    # o losango de substituição.
    'ines':    {'id': 'uid-6', 'usuario': 'ines', 'nome': 'Ângela “Nê” 📚',
                'bio': '', 'local': ''},
    # 20 caracteres é o teto do @ no banco; o nome longo mede a coluna.
    'usuario_bem_comprido': {'id': 'uid-7', 'usuario': 'usuario_bem_comprido',
                             'nome': 'Maria Aparecida de Nazaré dos Santos Albuquerque',
                             'bio': '', 'local': ''},
}


def perfil(*apelidos):
    return [dict(ELENCO[a]) for a in apelidos]


# ------------------------------------------------------------------ o acervo

def _livro(l):
    """Uma linha de fixtures.LIVROS no formato da tabela `livros`."""
    chave, titulo, autores, ano, capa, paginas, edicoes, assuntos = l
    return {'chave': chave, 'titulo': titulo, 'autores': autores, 'ano': ano,
            'capa': ('https://covers.openlibrary.org/b/id/%d-M.jpg' % capa) if capa else None,
            'capaGrande': ('https://covers.openlibrary.org/b/id/%d-L.jpg' % capa) if capa else None,
            'paginas': paginas, 'edicoes': edicoes, 'assuntos': assuntos}


# O acervo dos testes é o mesmo da suíte local: mesma chave, mesmo título. Até
# aqui `/works/OL1W` era "Grande Sertão" na suíte de nuvem e "Dom Casmurro" na
# social — a mesma chave nomeando dois livros diferentes em duas suítes que
# leem o mesmo código.
ACERVO = {l[0]: _livro(l) for l in fixtures.LIVROS}
CASMURRO   = fixtures.LIVROS[0][0]     # tem capa, sinopse longa e assuntos
BRAS_CUBAS = fixtures.LIVROS[1][0]
SERTAO     = fixtures.LIVROS[2][0]
TORTO      = fixtures.LIVROS[8][0]     # o único de fixtures SEM capa (capa None)

# Livros que só existem para medir os limites. Não entram no acervo geral: um
# título de 180 caracteres na busca estragaria toda asserção de layout das
# outras suítes.
SEM_CAPA = {'chave': '/works/OLSEMCAPAW', 'titulo': 'Obra sem capa registrada',
            'autores': ['Autoria Desconhecida'], 'ano': None, 'capa': None,
            'capaGrande': None, 'paginas': None, 'edicoes': None, 'assuntos': []}

# D11: a Open Library devolve 10 etiquetas para 4 ideias, com mojibake e
# variações de caixa. A limpeza é testada em testar-assuntos.js; aqui o que se
# mede é a TELA — o bloco não pode virar um muro de pílulas repetidas.
ASSUNTOS_SUJOS = {
    'chave': '/works/OLSUJOW', 'titulo': 'Livro de assuntos repetidos',
    'autores': ['Alguém'], 'ano': 1990, 'capa': None, 'capaGrande': None,
    'paginas': 100, 'edicoes': 1,
    'assuntos': ['Brazilian literature', 'brazilian literature',
                 'Brazilian Literature -- History and criticism',
                 'FiÃ§Ã£o brasileira', 'Ficção brasileira', 'Fiction',
                 'fiction', 'Fiction, general', 'Literatura brasileira',
                 'Accessible book', 'Protected DAISY', 'In library'],
}

# D08 e D23: rolagem lateral. Título sem espaço não quebra linha, e autoria
# com cinco nomes estoura a coluna de 244px da ficha.
TEXTO_LONGO = {
    'chave': '/works/OLLONGOW',
    'titulo': 'Antologia Contemporânea de Contos Reunidos e Comentados por Diversos '
              'Autores Brasileiros Vivos — Volume Terceiro, Edição Revista e Ampliada',
    'autores': ['Maria Aparecida de Nazaré dos Santos', 'João Carlos Ferreira Mendes',
                'Ana Beatriz Villaça do Amaral Rocha', 'Sebastião Rodrigues Neto',
                'Luiz Fernando de Albuquerque Junior'],
    'ano': 2024, 'capa': None, 'capaGrande': None, 'paginas': 900, 'edicoes': 1,
    'assuntos': ['Antologia'],
}

EXTRAS = {l['chave']: l for l in (SEM_CAPA, ASSUNTOS_SUJOS, TEXTO_LONGO)}

# E o mock da Open Library aprende a servi-las. Isto não é detalhe: semear
# localStorage com assunto sujo testaria um estado que o app NUNCA produz,
# porque limparAssuntos roda em API.detalhe (js/api.js:191), na entrada. Dado
# torto tem que entrar por onde o torto entra de verdade.
for _l in EXTRAS.values():
    fixtures.registrar_obra(_l['chave'], _l['titulo'], subjects=_l['assuntos'])


# ------------------------------------------------------------ peças do diário

def log(id, chave, nota=None, resenha='', lido=1, relido=False, spoiler=False,
        remoto=None, hora=12):
    """Uma leitura no formato do localStorage (camelCase, como js/dados.js).

    `hora` existe para o caso de duas leituras no MESMO dia: sem criadoEm
    diferente não há desempate, e a asserção passaria a medir a estabilidade do
    sort do navegador em vez do comportamento do app.
    """
    d = {'id': id, 'chave': chave, 'nota': nota, 'resenha': resenha,
         'lidoEm': dias(lido), 'relido': relido, 'spoiler': spoiler,
         'criadoEm': dias(lido) + 'T%02d:00:00Z' % hora}
    if remoto:
        d['remoto'] = remoto
    return d


def diario(logs=None, livros=None, querLer=None, curtidas=None, favoritos=None,
           listas=None, nome='Marcela'):
    return {'versao': 1,
            'perfil': {'nome': nome, 'bio': '', 'meta': {'ano': 2026, 'total': 12}},
            'livros': {c: dict(ACERVO.get(c) or EXTRAS[c]) for c in (livros or [])},
            'logs': logs or [], 'querLer': querLer or [], 'curtidas': curtidas or [],
            'favoritos': favoritos or [], 'listas': listas or [], 'buscas': []}


def leitura(id, quem, chave, nota=None, resenha='', dia=1, relido=False,
            spoiler=False, cliente_id='auto'):
    """Uma linha da tabela `leituras` (snake_case, como o PostgREST devolve)."""
    d = {'id': id, 'perfil': ELENCO[quem]['id'], 'livro': chave, 'nota': nota,
         'resenha': resenha, 'lido_em': dias(dia), 'relido': relido,
         'spoiler': spoiler, 'criado_em': quando(dia)}
    # cliente_id=None é a LINHA ÓRFÃ de propósito (D27/D31): antes da V1 toda
    # leitura migrada ficava assim, e editar a resenha depois criava uma
    # segunda linha no banco em vez de atualizar a primeira.
    d['cliente_id'] = ('cli-' + id) if cliente_id == 'auto' else cliente_id
    return d


def sessao(quem):
    u = ELENCO[quem]
    return {'token': 'tok-' + u['id'], 'atualizar': 'ref-' + u['id'],
            'expiraEm': 4102444800000,     # 2100, para nunca renovar no meio
            'id': u['id'], 'email': u['usuario'] + '@exemplo.com'}


# ==================================================================== os casos

# Cada caso: dados + a rota + as invariantes, como expressões JS que devolvem
# true. A invariante mora JUNTO do dado porque separá-los foi o que fez o mock
# do feed ignorar `livro=eq.` sem ninguém notar — quem lê o dado tem que ler,
# na mesma tela, o que ele deveria provar.

CASOS = [
    {
        'nome': 'livro-sem-capa',
        'defeitos': ['D09', 'D24'],
        'porque': 'A ficha é imersiva: o cabeçalho com a marca some e o chevron de '
                  'voltar mora DENTRO do herói. Enquanto o herói só era desenhado '
                  'quando havia capa, livro sem capa era tela sem nenhum caminho de '
                  'volta — a pessoa ficava presa.',
        'banco': {'livros': [SEM_CAPA], 'perfis': perfil('marcela')},
        'diario': diario(livros=[SEM_CAPA['chave']]),
        'sessao': None,
        'rota': '#/livro/' + SEM_CAPA['chave'],
        'esperar': '.livro-titulo',
        'checagens': [
            ('o chevron de voltar existe mesmo sem capa',
             "document.querySelectorAll('.voltar').length === 1"),
            ('e não há imagem de fundo para desenhar',
             "document.querySelectorAll('.heroi-imagem').length === 0"),
            ('a lombada com o título ocupa o lugar da capa',
             "document.querySelector('.livro-capa').innerText.trim().length > 0"),
        ],
    },
    {
        'nome': 'assuntos-sujos',
        'defeitos': ['D11', 'D41'],
        'porque': 'A Open Library devolve 12 etiquetas para 4 ideias, com mojibake '
                  '("FiÃ§Ã£o") e a mesma palavra em três caixas. Sem limpeza o bloco '
                  'Assuntos vira um muro de pílulas repetidas.',
        'banco': {'livros': [ASSUNTOS_SUJOS], 'perfis': perfil('marcela')},
        'diario': diario(livros=[ASSUNTOS_SUJOS['chave']]),
        'sessao': None,
        'rota': '#/livro/' + ASSUNTOS_SUJOS['chave'],
        'esperar': '.livro-titulo',
        'checagens': [
            ('nenhuma etiqueta com mojibake sobrevive',
             "!/Ã|Â/.test(document.body.innerText)"),
            ('nem duas etiquetas iguais ignorando caixa',
             "(() => { const a = [...document.querySelectorAll('.assunto')]"
             ".map(e => e.innerText.trim().toLowerCase());"
             "  return new Set(a).size === a.length; })()"),
        ],
    },
    {
        'nome': 'texto-longo-em-tudo',
        'defeitos': ['D08', 'D23'],
        'porque': 'Título de 150 caracteres sem quebra natural, cinco autorias e um @ '
                  'de 20 letras. Rolagem lateral no celular custa a página inteira, e '
                  'já apareceu duas vezes — a segunda foi a MINHA correção de área de '
                  'toque, que vazou 4px para fora da tela.',
        'banco': {'livros': [TEXTO_LONGO],
                  'perfis': perfil('marcela', 'usuario_bem_comprido'),
                  'leituras': [leitura('LG1', 'usuario_bem_comprido', TEXTO_LONGO['chave'],
                                       nota=4.0, resenha='Denso, mas vale.', dia=3)]},
        'diario': diario(livros=[TEXTO_LONGO['chave']],
                         logs=[log('lg', TEXTO_LONGO['chave'], nota=3.5,
                                   resenha='Li em três meses.')]),
        'sessao': 'marcela',
        'rota': '#/livro/' + TEXTO_LONGO['chave'],
        'esperar': '.livro-titulo',
        'largura': 390,
        'checagens': [
            ('a ficha não rola de lado',
             "document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"),
            ('o título quebra dentro da coluna',
             "document.querySelector('.livro-titulo').getBoundingClientRect().right <= 391"),
            ('e a autoria também',
             "document.querySelector('.autoria').getBoundingClientRect().right <= 391"),
        ],
    },
    {
        'nome': 'perfil-sem-nome',
        'defeitos': ['D17'],
        'porque': 'O nome padrão do modo local é "Leitora". Quando a conta não tem '
                  'nome, a tela mostrava esse padrão com o @ de outra pessoa embaixo '
                  '— o app dizia dois nomes diferentes para a mesma pessoa na mesma '
                  'tela. Sem nome, quem manda é o @.',
        'banco': {'livros': [ACERVO[CASMURRO]], 'perfis': perfil('marcela', 'semnome'),
                  'leituras': [leitura('SN1', 'semnome', CASMURRO, nota=4.0, dia=2)]},
        'diario': diario(),
        'sessao': None,
        'rota': '#/leitor/semnome',
        'esperar': '.perfil-nome',
        'checagens': [
            ('a tela não inventa "Leitora"',
             "!document.body.innerText.includes('Leitora')"),
            ('e usa o @ como nome',
             "document.querySelector('.perfil-nome').innerText.trim() === 'semnome'"),
        ],
    },
    {
        'nome': 'nome-com-acento-e-emoji',
        'defeitos': ['D19'],
        'porque': 'A inicial do avatar sai de nome.charAt(0). Em JS isso corta no meio '
                  'de um par substituto quando o nome começa por emoji, e o resultado '
                  'é o losango de substituição. Aqui o nome tem acento, aspas curvas e '
                  'emoji para medir os três.',
        'banco': {'livros': [ACERVO[CASMURRO]], 'perfis': perfil('marcela', 'ines'),
                  'leituras': [leitura('IN1', 'ines', CASMURRO, nota=5.0,
                                       resenha='Reli e continua novo.', dia=2)]},
        'diario': diario(),
        'sessao': None,
        'rota': '#/livro/' + CASMURRO,
        'esperar': '.feed-linha',
        'checagens': [
            ('a inicial do avatar é o Â de Ângela, não um losango',
             "document.querySelector('.feed-avatar').innerText.trim() === 'Â'"),
            ('o nome inteiro aparece na linha',
             "document.querySelector('.feed-frase').innerText.includes('Nê')"),
            ('e nenhum caractere de substituição na tela',
             "!document.body.innerText.includes('\\uFFFD')"),
        ],
    },
    {
        'nome': 'estrela-e-resenha-no-mesmo-dia',
        'defeitos': ['D15'],
        'porque': 'Dar estrela e depois escrever resenha do mesmo livro no mesmo dia '
                  'criava DUAS leituras — o diário mostrava a mesma obra duas vezes e '
                  'a média da comunidade contava a nota em dobro.',
        'banco': {'livros': [ACERVO[CASMURRO]], 'perfis': perfil('marcela')},
        'diario': diario(livros=[CASMURRO],
                         logs=[log('um', CASMURRO, nota=4.5,
                                   resenha='O narrador não merece confiança.')]),
        'sessao': None,
        'rota': '#/livro/' + CASMURRO,
        'esperar': '.livro-titulo',
        'checagens': [
            ('uma linha de leitura na ficha, não duas',
             "document.querySelectorAll('.tabela-diario tbody tr:not(.linha-resenha)')"
             ".length === 1"),
            ('e o painel diz "1 leitura registrada"',
             "document.querySelector('.painel-botao').innerText.includes('1 leitura')"),
        ],
    },
    {
        'nome': 'releitura-no-mesmo-dia',
        'defeitos': [],
        'porque': 'PRECIPÍCIO CONHECIDO, ainda sem defeito: o backfill da V1 casa as '
                  'linhas órfãs por (perfil, livro, lido_em). Duas leituras do MESMO '
                  'livro no MESMO dia deixam esse casamento ambíguo. O comportamento '
                  'travado aqui é o da tela: as duas continuam sendo duas.',
        'banco': {'livros': [ACERVO[SERTAO]], 'perfis': perfil('marcela')},
        'diario': diario(livros=[SERTAO],
                         logs=[log('r1', SERTAO, nota=4.0, lido=5, hora=9),
                               log('r2', SERTAO, nota=5.0, lido=5, relido=True, hora=21)]),
        'sessao': None,
        'rota': '#/livro/' + SERTAO,
        'esperar': '.livro-titulo',
        'checagens': [
            ('duas leituras continuam sendo duas',
             "document.querySelector('.painel-botao').innerText.includes('2 leituras')"),
            ('a nota que vale é a da releitura, registrada mais tarde no mesmo dia',
             "document.querySelector('.painel-nota').innerText.includes('★★★★★')"),
            ('e as duas linhas aparecem no diário da ficha',
             "document.querySelectorAll('.tabela-diario tbody tr:not(.linha-resenha)')"
             ".length === 2"),
        ],
    },
    {
        'nome': 'leitura-orfa-no-banco',
        'defeitos': ['D27', 'D31', 'D40'],
        'porque': 'Antes da V1, migrar deixava toda leitura sem cliente_id no servidor '
                  'e sem .remoto no aparelho. Editar a resenha depois criava uma '
                  'SEGUNDA linha em vez de atualizar a primeira. Este caso põe a linha '
                  'órfã no banco e a mesma leitura no aparelho: descer não pode virar '
                  'duas.',
        'banco': {'livros': [ACERVO[BRAS_CUBAS]], 'perfis': perfil('marcela'),
                  'leituras': [leitura('OR1', 'marcela', BRAS_CUBAS, nota=4.0,
                                       resenha='Do túmulo, com humor.', dia=6,
                                       cliente_id=None)]},
        'diario': diario(livros=[BRAS_CUBAS],
                         logs=[log('orfa', BRAS_CUBAS, nota=4.0,
                                   resenha='Do túmulo, com humor.', lido=6)]),
        'sessao': 'marcela',
        'rota': '#/diario',
        'esperar': '.tabela-diario',
        'checagens': [
            ('o diário mostra uma leitura, não duas',
             "document.querySelectorAll('.tabela-diario .cel-capa').length === 1"),
            ('e o localStorage também guarda uma só',
             "JSON.parse(localStorage.getItem('letterbooks:v1')).logs"
             ".filter(l => l.chave === '%s').length === 1" % BRAS_CUBAS),
        ],
        # A outra metade do conserto acontece no SERVIDOR: a linha antiga é
        # adotada, recebe o cliente_id, e a partir daí o upsert normal encontra
        # ela sozinho. Sem isto o aparelho ficaria certo e a próxima subida
        # criaria a segunda linha lá.
        'checagens_banco': [
            ('a linha antiga foi adotada e ganhou cliente_id no servidor',
             lambda b: len(b['leituras']) == 1 and b['leituras'][0]['cliente_id'] == 'orfa'),
        ],
    },
    {
        'nome': 'histograma-e-do-livro',
        'defeitos': ['D28', 'D33'],
        'porque': 'O bloco "Avaliações" desenhava Dados.estatisticas() — as notas da '
                  'PRÓPRIA leitora, iguais em toda ficha do acervo. Aqui a leitora tem '
                  '1,0 neste livro e 5,0 em outro; a comunidade dá 3,0. Se a média da '
                  'tela for 1,0 ou 3,0 por acidente, o número denuncia qual.',
        'banco': {'livros': [ACERVO[CASMURRO], ACERVO[SERTAO]],
                  'perfis': perfil('marcela', 'bia', 'ana', 'rui'),
                  'leituras': [
                      leitura('H1', 'bia', CASMURRO, nota=2.0, dia=4),
                      leitura('H2', 'ana', CASMURRO, nota=3.0, dia=5),
                      leitura('H3', 'rui', CASMURRO, nota=4.0, dia=6),
                      leitura('H4', 'bia', SERTAO, nota=5.0, dia=7)]},
        'diario': diario(livros=[CASMURRO, SERTAO],
                         logs=[log('m1', CASMURRO, nota=1.0),
                               log('m2', SERTAO, nota=5.0, lido=2)]),
        'sessao': None,
        'rota': '#/livro/' + CASMURRO,
        'esperar': '.avaliacoes-media',
        'checagens': [
            ('a média é a da comunidade (2+3+4)/3 = 3,0',
             "document.querySelector('.avaliacoes-media').innerText.trim() === '3,0'"),
            ('três faixas preenchidas, uma por avaliação',
             "document.querySelectorAll('.avaliacoes .histograma .col.tem').length === 3"),
            ('a nota do outro livro não vazou para cá',
             "!document.querySelector('.avaliacoes .histograma .col:nth-child(10)')"
             ".classList.contains('tem')"),
            ('e a nota dela fica marcada na faixa de 1,0, a segunda',
             "[...document.querySelectorAll('.avaliacoes .histograma .col')]"
             ".findIndex(c => c.classList.contains('minha')) === 1"),
        ],
    },
    {
        'nome': 'livro-no-teto-da-consulta',
        'defeitos': [],
        'porque': 'PRECIPÍCIO CONHECIDO: a consulta da ficha traz no máximo 200 '
                  'leituras e a média é somada no cliente. Acima disso o número seria '
                  'a média das 200 mais recentes chamada de "a média". O comportamento '
                  'travado é que a tela DIZ o corte em vez de esconder.',
        'banco': {'livros': [ACERVO[TORTO]], 'perfis': perfil('marcela', 'bia'),
                  'leituras': [leitura('T%03d' % i, 'bia', TORTO,
                                       nota=(1.0 if i < 100 else 5.0), dia=(i % 20) + 1)
                               for i in range(210)]},
        'diario': diario(livros=[TORTO]),
        'sessao': None,
        'rota': '#/livro/' + TORTO,
        'esperar': '.avaliacoes-media',
        'checagens': [
            ('a tela declara que está somando um recorte',
             "document.querySelector('.avaliacoes-nota') && "
             "document.querySelector('.avaliacoes-nota').innerText.includes('mais recentes')"),
            ('e mesmo assim desenha o histograma',
             "document.querySelectorAll('.avaliacoes .histograma .col.tem').length >= 1"),
        ],
    },
    {
        'nome': 'resenha-no-limite-do-recorte',
        'defeitos': [],
        'porque': 'PRECIPÍCIO CONHECIDO: recortar() corta em 240 caracteres e volta '
                  'até o espaço anterior. Em 239 tem que sair inteira, em 400 tem que '
                  'sair com reticências — e nunca cortando uma palavra ao meio.',
        'banco': {'livros': [ACERVO[CASMURRO]], 'perfis': perfil('marcela', 'bia', 'ana'),
                  'leituras': [
                      leitura('C1', 'bia', CASMURRO, nota=4.0, dia=2,
                              resenha='curta ' * 39 + 'fim'),          # 237 chars
                      leitura('C2', 'ana', CASMURRO, nota=4.0, dia=3,
                              resenha='palavralonga ' * 40)]},          # 520 chars
        'diario': diario(livros=[CASMURRO]),
        'sessao': None,
        'rota': '#/livro/' + CASMURRO,
        'esperar': '.feed-resenha',
        'checagens': [
            ('a resenha curta sai inteira, sem reticências',
             "document.querySelectorAll('.feed-resenha')[0].innerText.trim().endsWith('fim')"),
            ('a longa sai cortada com reticências',
             "document.querySelectorAll('.feed-resenha')[1].innerText.trim().endsWith('…')"),
            ('e o corte cai num limite de palavra do texto original',
             "(() => { const t = document.querySelectorAll('.feed-resenha')[1]"
             ".innerText.trim().replace(/…$/, '');"
             "  return 'palavralonga '.repeat(40).startsWith(t) && !t.endsWith(' '); })()"),
        ],
    },
    {
        'nome': 'visitante-sem-conta-numa-resenha',
        'defeitos': ['D25', 'D39', 'D44', 'D45'],
        'porque': 'Quem abre um link recebido não tem sessão. ligarCurtidas lia '
                  'quemSou().id — null — e o TypeError nascia DENTRO do callback de '
                  'sucesso, onde o tratamento de erro do Promise não alcança: a página '
                  'não mostra nada, só para. Desde a V4 este é o endereço único da '
                  'resenha, e é por ele que todo link compartilhado entra.',
        'banco': {'livros': [ACERVO[CASMURRO]], 'perfis': perfil('marcela', 'bia'),
                  'leituras': [leitura('V1', 'bia', CASMURRO, nota=5.0, dia=2,
                                       resenha='Vale cada página.')]},
        'diario': diario(),
        'sessao': None,
        'rota': '#/resenha/V1',
        'esperar': '.resenha',
        'largura': 390,
        'sem_estouro': True,
        'checagens': [
            ('a resenha abre sem conta',
             "document.querySelector('.resenha').innerText.includes('Vale cada página')"),
            ('a tela é imersiva: a barra da marca sai',
             "document.body.classList.contains('imersiva')"),
            ('e o chevron de voltar existe',
             "document.querySelectorAll('.voltar').length === 1"),
            ('convida a entrar em vez de mostrar o formulário',
             "!document.getElementById('forma-comentario')"),
        ],
    },
    {
        'nome': 'conta-sem-perfil',
        'defeitos': ['D66'],
        'porque': 'Conta viva e perfil inexistente. `meuPerfil()` devolve null SEM erro '
                  'e a tela desenhava o formulário em branco, sem uma frase dizendo o '
                  'que houve — a pessoa reescrevia o @ para receber um erro no Salvar. '
                  'Hoje isso só acontece se o gatilho ao_cadastrar falhar; depois que '
                  '"apagar a conta" existe, passa a ser o caminho NORMAL de quem apagou '
                  'e entrou de novo com o mesmo e-mail.',
        'banco': {'perfis': []},
        'diario': diario(),
        'sessao': 'marcela',
        'rota': '#/conta',
        'esperar': '.conta',
        'checagens': [
            ('a tela DIZ que a conta está sem perfil',
             "/não tem um perfil/.test(document.body.innerText)"),
            ('e oferece criar, em vez do formulário em branco',
             "document.querySelectorAll('[data-acao=criar-perfil]').length === 1"),
            ('nenhum campo de @ vazio esperando ser preenchido à toa',
             "document.querySelectorAll('#forma-perfil').length === 0"),
        ],
    },
    {
        'nome': 'diario-fechado-de-outra-pessoa',
        'defeitos': ['D71'],
        'porque': 'É a FORMA DE DADO que a chave de privacidade cria e que apodrece '
                  'calada: perfil com privado=true e zero leituras voltando do servidor. '
                  'O vazio genérico AFIRMA "ainda sem leituras registradas", que para um '
                  'diário fechado é falso — e passa a ser o estado mais comum da tela.',
        # `privado` entra AQUI e não no ELENCO: o elenco é compartilhado por
        # treze casos, e marcar a Bia como privada lá dentro mudaria todos eles.
        'banco': {'perfis': [perfil('marcela')[0],
                             dict(perfil('bia')[0], privado=True)], 'leituras': []},
        'diario': diario(),
        'sessao': 'marcela',
        'rota': '#/leitor/bia',
        'esperar': '.perfil-topo',
        'checagens': [
            ('não afirma que a pessoa nunca leu nada',
             "!/Ainda sem leituras/.test(document.body.innerText)"),
        ],
    },
]


# ------------------------------------------------------------------ cobertura

def cobertura(caminho_csv=None):
    """Quais defeitos do registro já têm caso de regressão, e quais não têm.

    Devolve (com_caso, sem_caso, so_de_tela). "so_de_tela" são os defeitos que
    um caso de DADO não pega — layout medido em pixel, CSS, workflow do Pages —
    e que continuam sendo trabalho das outras suítes. Estão listados para que
    "sem caso" não seja lido como "sem verificação".
    """
    import csv, os
    caminho_csv = caminho_csv or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), 'processo', 'defeitos.csv')
    registro = [x['id'] for x in csv.DictReader(open(caminho_csv, encoding='utf-8'))]
    cobertos = set()
    for c in CASOS:
        cobertos.update(c['defeitos'])
    com = [d for d in registro if d in cobertos]
    sem = [d for d in registro if d not in cobertos and d not in SO_DE_TELA]
    return com, sem, [d for d in registro if d in SO_DE_TELA]


# Defeitos que nenhum caso de dado alcança, com o motivo. Lista explícita de
# propósito: "não coberto" sem motivo escrito vira dívida invisível.

SO_DE_TELA = {
    'D01': 'escala de layout — medida em pixel contra os quadros do vídeo',
    'D02': 'tipografia — idem',
    'D03': 'escala de layout — idem',
    'D04': 'workflow do GitHub Pages, fora do app',
    'D05': '<a> dentro de <a> — estrutura de DOM, não dado',
    'D06': 'colspan da tabela — estrutura de DOM',
    'D07': 'scroll-snap — CSS',
    'D10': 'erro meu de leitura do vídeo, não do app',
    'D12': 'cor da capa desfocada — pixel',
    'D13': 'proporção da capa — pixel',
    'D14': 'security_invoker da view — provado em Postgres real (servidor/provar.sql)',
    'D16': 'contagens do próprio perfil — fluxo, coberto por testar_social',
    'D18': 'defeito do mock, não do app',
    'D20': 'área de toque — medida pelo rastreador',
    'D21': 'área de toque — idem',
    'D22': 'área de toque — idem',
    'D26': 'área de toque — idem',
    'D29': 'a suíte não estava no repositório — processo, não código',
    'D30': 'defeito do mock, não do app',
    'D32': 'defeito de uma asserção, não do app',
    'D35': 'defeito de uma espera de teste, não do app',
    'D36': 'defeito da semeadura de um teste, não do app',
    'D37': 'defeito da sonda do rastreador, não do app',
    'D38': 'área de toque — medida pelo rastreador',
    'D46': 'token de cor — medido em testar.py, seção 9b',
    'D47': 'defeito da sonda do rastreador, não do app',
    'D48': 'fluxo de fila e de descida — coberto por testar_social, bloco listas',
    'D49': 'corrida entre fila e envio — só reproduz com o servidor de mentira,\n            em testar_social ("a fila nao perde o que entra no meio")',
    'D50': 'idem — testar_social, "apagar logo depois de registrar"',
    'D51': 'identidade no banco — provado em servidor/provar-v2.sql',
    'D52': 'fluxo de feed — coberto por testar_social, bloco aba Resenhas',
    'D53': 'estrutura de DOM — idem',
    'D54': 'registro de agente na sessão — processo, não código do app',
    'D55': 'leitura errada de uma regra do processo, não código do app',
    'D56': 'âncora de hash — estrutura de DOM; travado em testar.py 9b e testar_social',
    'D57': 'credencial recusada pelo servidor — coberto por testar_social',
    'D58': 'defeito do mock, não do app',
    'D59': 'fluxo social — coberto por testar_social, bloco avisos',
    'D60': 'estrutura de DOM (âncora aninhada) — travado em testar_social',
    'D61': 'defeito do mock, não do app',
    'D62': 'defeito do portão, não do app — o critério agora roda os provar*.sql\n            e lê o status de saída; provado que fica vermelho quebrando um deles',
    'D63': 'defeito de um arquivo de prova, não do app — travado pelo portão novo',
    'D64': 'defeito do Supabase de mentira, não do app',
    'D67': 'área de toque — CSS; medida pelo rastreador, que não abre folha',
    'D68': 'sequência de pintura de tela — achado e travado pelo rastreador',
    'D69': 'defeito do rastreador, não do app',
    'D70': 'defeito do rastreador, não do app',
    'D65': 'resposta vazia do PostgREST — travado em testar_social\n            ("salvar sem perfil RECUSA, em vez de dizer que salvou")',
    'D72': 'forma do esquema num banco que já existe — provado em\n            servidor/provar-v5.sql, que fica vermelho se o drop sair',
    'D73': 'buraco de cobertura das provas, não do app — fechado pelo provar-v5.sql',
    'D74': 'política de RLS — provada em servidor/provar-v6.sql, seção 4',
    'D75': 'política de RLS — provada em servidor/provar-v6.sql, seção 5',
    'D76': 'contrato da camada de nuvem — travado em testar_social,\n            bloco denunciar (motivo em código, alvo certo)',
    'D77': 'fluxo social — travado em testar_social ("a DONA da resenha pode\n            apagar o comentário alheio")',
    'D78': 'tecla Escape — não alcançável por forma de dado',
    'D79': 'área de toque — CSS; medida pelo rastreador',
    'D80': 'defeito de uma asserção da prova, não do app',
    'D81': 'ausência de política de delete — fixada em provar-v6.sql, seção 9',
    'D82': 'fluxo de tela — travado em testar.py bloco 12\n            ("cancelar NAO apaga a bio")',
    'D83': 'fila do Sinc — travado em testar.py bloco 12 ("a FILA foi junto")',
    'D84': 'defeito do rastreador, não do app — a sonda de diálogo virou achado',
    'D85': 'ordem de execução dentro do try — não alcançável por forma de dado',
    'D86': 'duplicação de tela — travado por a linha virar link para #/conta',
    'D87': 'sombreamento de variável, não forma de dado',
    'D88': 'estado do <input type=file> — não alcançável por forma de dado',
    'D89': 'caminho de erro do FileReader — não alcançável por forma de dado',
    'D90': 'teclado virtual — CSS; medido pelo design contra a faixa do iPhone SE',
    'D91': 'área de toque — CSS; medida pelo rastreador, que agora olha dentro da folha',
    'D92': 'texto de rótulo — travado em testar.py ("diz se ha copia em algum lugar")',
    'D93': 'descrição desatualizada no produto.json — não é código do app;\n            o portão mede paridade a partir deste arquivo',
    'D42': 'defeito do runner desta suíte, não do app',
    'D43': 'defeito de nomenclatura entre suítes, não do app',
}

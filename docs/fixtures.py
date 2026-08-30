# -*- coding: utf-8 -*-
"""Respostas de mentira no formato exato da Open Library, para testar o app
sem rede (a politica do conteiner bloqueia openlibrary.org)."""
import io, json, random
from PIL import Image, ImageDraw

LIVROS = [
    ("/works/OL1917719W", "Dom Casmurro", ["Machado de Assis"], 1899, 8225261, 256, 214,
     ["Brazilian literature", "Jealousy", "Fiction", "Classic literature"]),
    ("/works/OL2745271W", "Memórias Póstumas de Brás Cubas", ["Machado de Assis"], 1881, 7891234, 208, 143,
     ["Brazilian literature", "Satire", "Fiction"]),
    ("/works/OL3140834W", "Grande Sertão: Veredas", ["João Guimarães Rosa"], 1956, 6612345, 624, 88,
     ["Brazilian literature", "Sertão", "Fiction"]),
    ("/works/OL5719203W", "A Hora da Estrela", ["Clarice Lispector"], 1977, 9911223, 96, 76,
     ["Brazilian literature", "Fiction", "Women"]),
    ("/works/OL8814093W", "Vidas Secas", ["Graciliano Ramos"], 1938, 5544332, 176, 61,
     ["Brazilian literature", "Drought", "Fiction"]),
    ("/works/OL1024755W", "Capitães da Areia", ["Jorge Amado"], 1937, 4433221, 280, 97,
     ["Brazilian literature", "Bahia", "Fiction"]),
    ("/works/OL7712344W", "O Cortiço", ["Aluísio Azevedo"], 1890, 3322110, 224, 54,
     ["Brazilian literature", "Naturalism"]),
    ("/works/OL9911002W", "Quarto de Despejo", ["Carolina Maria de Jesus"], 1960, 2211009, 192, 41,
     ["Brazilian literature", "Diaries", "Poverty"]),
    ("/works/OL6612001W", "Torto Arado", ["Itamar Vieira Junior"], 2019, None, 264, 22,
     ["Brazilian literature", "Fiction"]),
    ("/works/OL5510992W", "O Alienista", ["Machado de Assis"], 1882, 1100998, 96, 66,
     ["Brazilian literature", "Satire"]),
    ("/works/OL4409881W", "Iracema", ["José de Alencar"], 1865, 9988771, 144, 73,
     ["Brazilian literature", "Romanticism"]),
    ("/works/OL3308770W", "Macunaíma", ["Mário de Andrade"], 1928, 8877660, 208, 49,
     ["Brazilian literature", "Modernism"]),
]

SINOPSES = {
    "/works/OL1917719W":
        "Bento Santiago, já velho e sozinho, resolve escrever a história de sua vida para "
        "\"atar as duas pontas da vida\". O que sai é a reconstrução de um casamento e de um "
        "ciúme: Capitu, os olhos de ressaca, a semelhança de Ezequiel com o amigo Escobar.\n\n"
        "O romance nunca responde se houve traição — e essa recusa é o ponto. O leitor recebe "
        "apenas a versão de um narrador interessado, e precisa decidir o quanto acredita nele.",
}


# Cada autoria tem um id na Open Library, que e o que abre a pagina do autor.
AUTORES = {
    "Machado de Assis":       ("OL33810A", "Escritor brasileiro, fundador da Academia Brasileira de Letras. Levou o romance nacional do romantismo ao realismo e inventou narradores em que nao se pode confiar.", "1839-06-21", "1908-09-29", 6642341),
    "Clarice Lispector":      ("OL29610A", "Escritora nascida na Ucrania e criada no Recife. A frase dela desmonta a sintaxe para caber o que nao cabe.", "1920-12-10", "1977-12-09", None),
    "Jo\u00e3o Guimar\u00e3es Rosa": ("OL41220A", "Medico, diplomata e escritor mineiro. Reinventou o portugues do sertao numa lingua que so existe nos livros dele.", "1908-06-27", "1967-11-19", None),
    "Gracialiano Ramos":      ("OL55501A", "", None, None, None),
}


def _doc(l, completo=True):
    chave, titulo, autores, ano, capa, paginas, edicoes, assuntos = l
    d = {"key": chave, "title": titulo, "author_name": autores,
         "author_key": [AUTORES.get(a, ("OL%dA" % (abs(hash(a)) % 900000),))[0] for a in autores],
         "first_publish_year": ano, "number_of_pages_median": paginas,
         "edition_count": edicoes}
    if capa:
        d["cover_i"] = capa
    if completo:
        d["subject"] = assuntos
    return d


def busca(termo, pagina=1):
    t = (termo or "").lower()
    achados = [l for l in LIVROS
               if t in l[1].lower() or any(t in a.lower() for a in l[2])
               or any(t in s.lower() for s in l[7])]
    if not achados:
        achados = LIVROS
    return {"numFound": len(achados) * 3, "start": (pagina - 1) * 24,
            "numFoundExact": True, "docs": [_doc(l) for l in achados]}


def tendencia():
    return {"query": "", "works": [_doc(l) for l in LIVROS[:12]]}


def obra(chave):
    l = [x for x in LIVROS if x[0] == chave]
    if not l:
        return {"key": chave, "title": "Obra"}
    l = l[0]
    resp = {"key": chave, "title": l[1], "subjects": l[7]}
    if l[4]:
        resp["covers"] = [l[4]]
    if chave in SINOPSES:
        resp["description"] = {"type": "/type/text", "value": SINOPSES[chave] +
                               "\n----------\nDescrição vinda da Open Library."}
    else:
        resp["description"] = ("Um dos livros centrais da literatura brasileira, "
                               "reeditado incontáveis vezes desde a primeira publicação.")
    return resp


PALETA = [(120, 62, 48), (52, 74, 96), (96, 74, 40), (58, 84, 62),
          (86, 52, 88), (40, 62, 78), (110, 84, 44), (70, 48, 62)]


def capa_png(idcapa, titulo="", largura=300):
    """Gera uma capa plausivel para o teste, na proporcao 2:3."""
    random.seed(idcapa)
    alt = int(largura * 1.5)
    cor = PALETA[idcapa % len(PALETA)]
    img = Image.new("RGB", (largura, alt), cor)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, int(largura * 0.055), alt], fill=tuple(int(c * 0.65) for c in cor))
    m = int(largura * 0.14)
    d.rectangle([m, int(alt * 0.12), largura - m // 2, int(alt * 0.125)], fill=(235, 228, 220))
    palavras = (titulo or "Livro").split()
    y = int(alt * 0.2)
    for p in palavras[:5]:
        d.text((m, y), p[:14].upper(), fill=(240, 234, 226))
        y += 16
    d.rectangle([m, int(alt * 0.86), largura - m * 2, int(alt * 0.865)], fill=(200, 190, 180))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=82)
    return buf.getvalue()


def autor(chave):
    """Resposta de /authors/OLxxxA.json."""
    for nome, dados in AUTORES.items():
        if dados[0] == chave:
            resp = {"key": "/authors/" + chave, "name": nome,
                    "birth_date": dados[2], "death_date": dados[3]}
            if dados[1]:
                resp["bio"] = {"type": "/type/text", "value": dados[1]}
            if dados[4]:
                resp["photos"] = [dados[4]]
            return resp
    return {"key": "/authors/" + chave, "name": "Autoria desconhecida"}


def obras_do(chave):
    """Resposta de /authors/OLxxxA/works.json."""
    nome = next((n for n, d in AUTORES.items() if d[0] == chave), None)
    entradas = []
    for l in LIVROS:
        if nome and nome in l[2]:
            e = {"key": l[0], "title": l[1],
                 "first_publish_date": str(l[3]) if l[3] else None}
            if l[4]:
                e["covers"] = [l[4]]
            entradas.append(e)
    return {"size": len(entradas), "entries": entradas}

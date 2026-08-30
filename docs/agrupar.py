# -*- coding: utf-8 -*-
"""Agrupa os 383 quadros em TELAS distintas.

Duas assinaturas por quadro: a faixa de cima (cabecalho + abas, que identifica
em que tela voce esta) e um histograma do corpo (que separa conteudos
diferentes dentro da mesma tela). Rolagem na mesma tela mantem a faixa de cima
e muda pouco o histograma — e o que queremos colapsar.
"""
import cv2, numpy as np, json, os, shutil

fr = json.load(open('jornada/indice.json'))
print(len(fr), 'quadros')

def assinatura(f):
    im = cv2.imread(f)
    topo = cv2.resize(im[56:130], (64, 16)).astype(np.float32).ravel()
    pe   = cv2.resize(im[790:840], (64, 10)).astype(np.float32).ravel()
    corpo = im[130:790]
    hist = np.concatenate([cv2.calcHist([corpo],[c],None,[16],[0,256]).ravel()
                           for c in range(3)])
    hist = hist/ (hist.sum() or 1)
    return topo/255.0, pe/255.0, hist

sigs = [assinatura(x['arquivo']) for x in fr]

grupos = []            # cada grupo: {'rep': idx, 'membros': [...]}
for i, s in enumerate(sigs):
    achou = None
    for g in grupos:
        t0, p0, h0 = sigs[g['rep']]
        dt = np.abs(s[0]-t0).mean()
        dp = np.abs(s[1]-p0).mean()
        dh = np.abs(s[2]-h0).sum()
        # mesma tela: topo e barra de baixo iguais E conteudo parecido
        if dt < .045 and dp < .05 and dh < .35:
            achou = g; break
    if achou: achou['membros'].append(i)
    else: grupos.append({'rep': i, 'membros': [i]})

print(len(grupos), 'telas distintas')
os.makedirs('telas-app', exist_ok=True)
for f in os.listdir('telas-app'): os.remove('telas-app/'+f)
mapa = []
for k, g in enumerate(grupos):
    src = fr[g['rep']]['arquivo']
    t0 = fr[g['membros'][0]]['t']; t1 = fr[g['membros'][-1]]['t']
    dst = 'telas-app/t%03d_%05.1f-%05.1f.png' % (k, t0, t1)
    shutil.copy(src, dst)
    mapa.append({'i': k, 'arquivo': dst, 'de': t0, 'ate': t1, 'quadros': len(g['membros'])})
json.dump(mapa, open('telas-app/mapa.json','w'), indent=1)

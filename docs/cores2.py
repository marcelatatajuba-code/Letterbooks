# -*- coding: utf-8 -*-
"""Acha os acentos varrendo o quadro inteiro por matiz, nao por coordenada."""
import cv2, numpy as np, glob, collections

def acentos(f):
    im = cv2.imread(f)
    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[:,:,0].astype(int), hsv[:,:,1].astype(int), hsv[:,:,2].astype(int)
    forte = (s > 140) & (v > 140)
    out = {}
    faixas = {'verde': (55, 95), 'azul': (95, 115), 'laranja': (5, 25), 'amarelo': (25, 40)}
    for nome, (a, b) in faixas.items():
        m = forte & (h >= a) & (h < b)
        if m.sum() < 20: continue
        cores = im[m].reshape(-1, 3)
        c = collections.Counter(map(tuple, cores))
        (bb, g, r), q = c.most_common(1)[0]
        out[nome] = ('#%02x%02x%02x' % (r, g, bb), int(m.sum()))
    return out

for f in ['jornada/j000-0000.0s.png'] + sorted(glob.glob('telas-app/t07[3-6]*'))[:3] \
         + sorted(glob.glob('telas-app/t05[5-6]*'))[:2]:
    print(f.split('/')[-1][:18], acentos(f))

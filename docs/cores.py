# -*- coding: utf-8 -*-
"""Tira as cores do app dos proprios pixels, em vez de olhar e adivinhar."""
import cv2, numpy as np, collections

def px(f, x, y):
    im = cv2.imread(f); b,g,r = im[y, x]; return '#%02x%02x%02x' % (r,g,b)

def dominante(f, x0,y0,x1,y1, n=4):
    im = cv2.imread(f)[y0:y1, x0:x1].reshape(-1,3)
    c = collections.Counter(map(tuple, im))
    return [('#%02x%02x%02x' % (r,g,bb), q) for (bb,g,r), q in c.most_common(n)]

def viva(f, x0,y0,x1,y1):
    """A cor mais saturada da regiao — serve para achar os acentos."""
    im = cv2.imread(f)[y0:y1, x0:x1]
    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
    m = (hsv[:,:,1].astype(int) * hsv[:,:,2].astype(int))
    y, x = np.unravel_index(m.argmax(), m.shape)
    b,g,r = im[y,x]; return '#%02x%02x%02x' % (r,g,b)

H = 'jornada/j000-0000.0s.png'          # home
print('== fundos ==')
print(' fundo da pagina   ', dominante(H, 10, 300, 374, 320, 2))
print(' faixa do PRO      ', dominante(H, 10, 160, 374, 200, 2))
print(' barra de baixo    ', dominante(H, 200, 820, 300, 845, 2))
print(' cabecalho         ', dominante(H, 150, 60, 240, 70, 2))
print(' trilho das abas   ', dominante(H, 20, 100, 360, 108, 3))
print(' pilula da aba ativa', dominante(H, 20, 118, 90, 126, 2))

print('\n== acentos ==')
print(' + verde da barra  ', viva(H, 178, 826, 206, 848))
print(' azul da aba ativa ', viva(H, 22, 826, 50, 848))
print(' laranja do PRO    ', viva(H, 12, 168, 40, 188))

A = 'telas-app/t074_139.0-139.0.png'
import glob
cand = sorted(glob.glob('telas-app/t074*')) or sorted(glob.glob('telas-app/t075*'))
if cand:
    A = cand[0]
    print(' estrela (atividade)', viva(A, 250, 100, 330, 118))

L = sorted(glob.glob('telas-app/t086*'))
if L:
    print(' coracao curtido   ', viva(L[0], 250, 110, 300, 130))

print('\n== textos ==')
print(' titulo de secao   ', dominante(H, 20, 208, 150, 218, 3))
print(' texto secundario  ', dominante(H, 86, 160, 300, 172, 3))

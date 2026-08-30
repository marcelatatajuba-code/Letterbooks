# -*- coding: utf-8 -*-
"""Extrai a jornada inteira do video: um quadro sempre que a tela MUDA.

Amostrar de N em N segundos perde telas curtas e repete telas paradas. Aqui
o corte e por diferenca de conteudo entre quadros consecutivos, ignorando a
barra de status do iOS (que muda de relogio sozinha) e a faixa do teclado.
"""
import cv2, numpy as np, os, json

V = 'o-video-do-app.mp4'   # aponte para o arquivo que voce baixou
SAIDA = 'jornada'
cap = cv2.VideoCapture(V)
fps = cap.get(cv2.CAP_PROP_FPS) or 30
total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
print('video %dx%d  %.1f fps  %d quadros  %.1f s' % (w, h, fps, total, total/fps))

passo = max(1, int(round(fps/4)))     # olha 4 vezes por segundo
y0, y1 = int(h*0.07), int(h*0.94)     # fora: barra de status e barra de gestos

ant = None; guardados = []; i = 0
while True:
    cap.set(cv2.CAP_PROP_POS_FRAMES, i)
    ok, q = cap.read()
    if not ok: break
    peq = cv2.resize(q[y0:y1], (96, 208)).astype(np.float32)
    if ant is None:
        dif = 999
    else:
        dif = float(np.abs(peq - ant).mean())
    if dif > 6.0:
        t = i/fps
        nome = '%s/j%03d-%06.1fs.png' % (SAIDA, len(guardados), t)
        cv2.imwrite(nome, q, [cv2.IMWRITE_PNG_COMPRESSION, 6])
        guardados.append({'arquivo': nome, 't': round(t,1), 'dif': round(dif,1)})
        ant = peq
    elif ant is not None:
        ant = peq * 0.3 + ant * 0.7    # acompanha deriva lenta sem disparar
    i += passo

cap.release()
json.dump(guardados, open(SAIDA+'/indice.json','w'), indent=1)
print('%d telas guardadas' % len(guardados))

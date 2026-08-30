# Como o layout foi medido

Nada nesta pasta roda em produção. São as ferramentas que transformaram o
vídeo do aplicativo original em números — e é para cá que se volta quando
alguém quiser saber de onde saiu uma medida.

O caminho, na ordem:

1. **`extrair.py`** — corta um quadro do vídeo sempre que a tela *muda*.
   Amostrar de N em N segundos perde tela curta e repete tela parada; a
   diferença de conteúdo entre quadros pega as duas coisas. A barra de status
   do iOS fica de fora do cálculo, senão o relógio dispara um corte por minuto
   sozinho. Dos 12.985 quadros saíram 383 cortes.

2. **`agrupar.py`** — junta os 383 em telas distintas. Cada quadro vira três
   assinaturas: a faixa de cima (diz em que tela você está), a barra de baixo
   (diz qual aba) e um histograma do corpo (separa conteúdos diferentes na
   mesma tela). Rolagem mantém as duas primeiras e mexe pouco na terceira —
   é exatamente o que queremos colapsar. Sobraram 115.

3. **`cores.py` e `cores2.py`** — tiram a paleta dos pixels. O primeiro lê
   cores em regiões conhecidas; o segundo varre o quadro inteiro por matiz,
   que é como se acham os acentos sem depender de acertar a coordenada. Daí
   vieram `#14181c` (fundo), `#00e054` (verde), `#40bcf4` (azul) e `#ff8000`
   (laranja) — hoje o `:root` de `css/app.css`.

4. **`mapa_dados.py`** — as 24 telas da jornada, o que cada uma faz e como
   está no Letterbooks. É a fonte do mapa publicado.

## Por que isso existe

Três vezes seguidas eu ajustei o layout no olho e errei, e a terceira vez foi
a mesma coisa da primeira: peça grande demais, folga demais, densidade de
site num aplicativo. Medir foi o que resolveu, e as verificações em
`testar.py` (seção 12) prendem os números para a tela não voltar sozinha.

Uma medida errada também apareceu por aqui: eu comparei o perfil com um
quadro que já estava rolado para baixo do retrato e concluí que o app não
centraliza o avatar. O quadro `t084` mostra que centraliza. Quando um número
contrariar o que você lembra da tela, confira *qual* quadro está na mesa.

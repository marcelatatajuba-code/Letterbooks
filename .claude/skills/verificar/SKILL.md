---
name: verificar
description: Roda o ciclo completo de verificação do Letterbooks — as quatro suítes de ponta a ponta, o rastreador autônomo e as duas verificações de nó — na ordem certa, com o servidor local de pé. Use antes de todo commit, ou quando quiser saber se algo quebrou.
---

# Verificar o Letterbooks

Sobe o servidor local, roda tudo na ordem, e para na primeira falha.

## 1. Servidor

As suítes falam com `http://127.0.0.1:8899`. Se já houver um de pé, reaproveite.

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8899/index.html \
  || (cd /home/user/letterbooks && nohup python3 -m http.server 8899 --bind 127.0.0.1 >/dev/null 2>&1 & sleep 1.5)
```

## 2. As suítes, nesta ordem

A ordem é de dependência, não de importância: a local não precisa de conta, as
de nuvem precisam do mock, e a jornada precisa das duas coisas.

```bash
cd /home/user/letterbooks/docs
python3 testar.py          # ~100 verificações da parte local
python3 testar_nuvem.py    # conta, sessão, migração
python3 testar_social.py   # fila de sincronização, feed, seguir, curtir
python3 jornada_e2e.py     # a jornada inteira, com duas contas
python3 rastreador.py      # anda o app sozinho: cobertura e acessibilidade
node testar-chave.js       # a trava da chave do Supabase
node testar-assuntos.js    # limpeza dos assuntos da Open Library
```

## 3. Ao ler o resultado

- **Falha na `jornada_e2e` vale mais que as outras.** As demais provam que cada
  peça funciona; ela prova que funcionam juntas.
- **Antes de acusar o app, desconfie do teste.** Já aconteceu quatro vezes
  aqui: mock que ignorava filtro, espera que casava com a tela anterior,
  `inner_text` em maiúsculas por `text-transform`, e medida de alvo que não
  enxergava pseudo-elemento.
- **O rastreador achando alvo miúdo** costuma ser real: ele mede a área que o
  dedo encontra, com `elementFromPoint`, não a caixa do elemento.
- **Nada aqui prova o contrato com o Supabase.** Os mocks imitam o formato do
  PostgREST, não o comportamento. Só a conta de verdade prova.

## 4. Depois de mexer em CSS ou JS

Suba a versão do cache, senão o navegador serve a versão velha:

```bash
grep -n "var CACHE" /home/user/letterbooks/sw.js
```

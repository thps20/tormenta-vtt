# Testar com amigos fora da sua rede

Como deixar o VTT que roda na sua máquina acessível pela internet para uma sessão de
teste, sem deploy, sem conta em serviço nenhum e sem mexer no roteador.

## Como funciona

```
navegador do jogador ──HTTPS──▶ *.trycloudflare.com ──túnel──▶ Vite (:5173) ──proxy──▶ server (:3000)
                                                                   │
                                                                   └─ serve o frontend
```

- O `cloudflared` (binário da Cloudflare, baixado para `.tools/` na primeira vez) abre um
  **quick tunnel**: uma URL `https://<palavras-aleatorias>.trycloudflare.com` que aponta
  para a porta 5173 da sua máquina. Não precisa de conta nem de token.
- Só **uma** URL é exposta, a do Vite. O Vite faz proxy de `/api`, `/uploads`, `/health` e
  `/socket.io` (inclusive websocket) para o server em `localhost:3000`
  (`apps/web/vite.config.ts`). O navegador do jogador nunca fala direto com o server.
- O frontend usa a **mesma origem da página** (`window.location.origin`) para API, socket e
  imagens (`apps/web/src/config.ts`). Por isso funciona igual em `localhost:5173` e na URL
  do túnel, sem trocar nada.
- Como tudo é mesma origem, o CORS do server (`CORS_ORIGIN` no `.env`) não entra em jogo
  pelo túnel. Ele só importa se alguém preencher `VITE_SERVER_URL` para falar direto com o
  server.

## Passo a passo

Você precisa de **três terminais** abertos na raiz do projeto.

1. **Banco**
   ```
   make up
   ```
2. **App** (web + server com hot reload)
   ```
   make dev
   ```
   Confira que `http://localhost:5173` abre no seu navegador.
3. **Túnel**
   ```
   make tunnel
   ```
   A saída mostra a URL pública:
   ```
   Abrindo túnel (Cloudflare quick tunnel)... Ctrl+C encerra.

     URL pública: https://sophisticated-fleece-earrings-fuel.trycloudflare.com
     Mande este link para os jogadores (muda a cada execução).

     túnel conectado
   ```
4. **Abra a URL pública no seu navegador e crie a sala por ela.** O link de convite que o
   app mostra (e o botão de copiar na barra superior) é montado a partir do endereço da
   página, então ele já sai com a URL do túnel. Mande esse link para os jogadores.

   Se você criou a sala em `http://localhost:5173`, também funciona: troque
   `http://localhost:5173` pela URL pública, mantendo o resto. Exemplo:
   `http://localhost:5173/room/ABC123` vira
   `https://sophisticated-fleece-earrings-fuel.trycloudflare.com/room/ABC123`.
   O link do mestre (com `?gm=...`) é só seu; não mande para os jogadores.

Para encerrar, `Ctrl+C` no terminal do túnel. A URL morre na hora.

## O que esperar

- **A URL leva uns 20 segundos para começar a responder** depois de aparecer na tela
  (é o DNS do `trycloudflare.com` propagando). Se o jogador vir "não foi possível
  encontrar o servidor", é só esperar e recarregar.
- **A URL muda a cada `make tunnel`.** Mande o link novo toda vez que reiniciar o túnel.
- A primeira execução baixa o `cloudflared` (~40 MB) para `.tools/cloudflared`. A pasta
  está no `.gitignore`.
- Latência: o tráfego passa pelos servidores da Cloudflare. É bom o bastante para jogar,
  mas não é a mesma coisa que rede local.
- Rodar em produção não é o objetivo disto. É para sessões de teste enquanto o servidor
  de desenvolvimento está aberto no seu terminal.

## O que foi verificado pelo túnel

Testado em 2026-09-06, tudo pela URL pública:

| O quê | Como | Resultado |
|---|---|---|
| Página do Vite | `GET /` | HTML do app, com `/@vite/client` e `/src/main.tsx` |
| Server via proxy | `GET /health` | `{"status":"ok","db":"ok"}` |
| Socket.io só websocket | `socket.io-client` com `transports: ["websocket"]` | conecta |
| Socket.io só polling | `transports: ["polling"], upgrade: false` | conecta |
| Socket.io padrão | polling → upgrade para websocket | conecta e faz o upgrade |
| Upload de mapa | `POST /api/upload` multipart com PNG | `201` com `{url,width,height}` |
| Download do mapa | `GET /uploads/<arquivo>.png` | `200 image/png`, bytes idênticos |
| Hot reload do Vite | websocket `vite-hmr` na raiz | recebe `{"type":"connected"}` |

## Problemas comuns

**"Vite não está no ar em :5173"** ao rodar `make tunnel`
: O `make dev` não está rodando (ou caiu). Suba-o em outro terminal e tente de novo.

**Página abre mas fica "conectando…" / mapa não carrega**
: Confira que `VITE_SERVER_URL` está **vazio** no `.env`. Se estiver `http://localhost:3000`,
  o navegador do jogador vai tentar falar com o `localhost` *dele*. Depois de mudar o
  `.env`, reinicie o `make dev` (o Vite só lê o `.env` ao subir).

**"Blocked request. This host (...) is not allowed"**
: O Vite bloqueia hosts desconhecidos. O `vite.config.ts` já libera `.trycloudflare.com`;
  se você usar outro serviço de túnel, adicione o domínio dele em `server.allowedHosts`.

**Erro ao baixar o `cloudflared`**
: Apague `.tools/cloudflared` e rode `make tunnel` de novo. O download vem do GitHub
  releases da Cloudflare (`cloudflared-linux-amd64` ou `arm64`, conforme a máquina).

## Cenário de teste

`make seed-test` monta (ou remonta do zero) uma sala fixa chamada **"Mesa de Teste"**, direto no
banco via Prisma (`apps/server/scripts/seed-test.ts`, rodado com `tsx`) — sem passar pelos eventos
socket. Serve para não precisar recriar sala/mapa/fichas/tokens na mão toda vez que for testar uma
mudança com alguém.

```
make up          # banco no ar
make dev          # web + server, noutro terminal
make seed-test    # monta a "Mesa de Teste"
```

**Idempotente**: a primeira coisa que o script faz é apagar a sala "Mesa de Teste" anterior (pelo
nome) e recriar tudo do zero — pode rodar de novo a qualquer momento para voltar ao estado
inicial. Nenhuma outra sala é tocada.

### O que a sala tem

- **Convite fixo**: código `TESTE1`, GM "Mestre" e jogadora "Ana", com `sessionToken` fixo cada um
  (para reconectar sempre como o mesmo participante, em vez de criar um novo a cada teste).
- **Três mapas**: "Taverna" (ativo, célula 70px, com uma imagem placeholder gerada na hora),
  "Estrada" (célula 100px, ponto de chegada definido — para testar "Levar para o mapa") e "Cripta"
  (névoa ligada, metade do mapa revelada).
- **Duas fichas**: "Kael" (PC de Ana — Humano Guerreiro nível 3, com espada longa, arco curto e
  couro batido equipados, um poder ativo e duas magias do compêndio, uma com área esfera e outra
  com área cone) e "Thorin" (NPC do GM — Anão, para validar que o deslocamento por turno sai 6m em
  vez do padrão 9m da raça humana, §9.11 do SPEC).
- **Sete tokens na Taverna**: Kael, Thorin, três goblins do compêndio (um deles invisível, outro
  sangrando), um Ogro grande (token 2×2 células) caído, e uma "Carroça" sem ficha (cenário, fora do
  combate).
- **Handouts**: uma imagem e um texto na biblioteca, com a imagem também fixada como um pino no
  mapa da Taverna.
- **Combate não iniciado** (para testar o fluxo de "Iniciar combate" do zero); PV/PM de Kael e
  Thorin cheios (as criaturas do compêndio já vêm assim).

### Abrindo como Mestre ou como Ana

O script termina imprimindo os links prontos — os dois já entram direto, sem pedir nickname:

- **Mestre**: a URL com `?gm=<segredo>` já reconecta como "Mestre".
- **Ana** (dona da Kael): a URL com `?session=<token>` reconecta pelo `sessionToken` fixo dela.

`?session=<token>` (`apps/web/src/lib/router.ts#consumeSessionParam`) grava o token no
`localStorage` (mesma chave de sempre, `tvtt:session:<código>:<gm|player>` — o papel é "gm" se a
URL também tiver `?gm=`, senão "player") e some da URL sozinho assim que a página carrega
(`history.replaceState`, sem recarregar) — não fica pendurado se alguém copiar o link depois.
Funciona pra qualquer sala, não só a de teste; o próprio `join` (`store/room.ts`) não mudou nada,
só passou a encontrar o token já salvo.

Sem `?session=`, abrir o link puro (`/room/TESTE1`) também funciona, mas pede nickname e cria uma
jogadora nova — que não é dona dos tokens da Kael.

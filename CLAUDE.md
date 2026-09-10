# Tormenta VTT

VTT (Virtual Tabletop) para RPG de mesa online. Primeiro sistema: Tormenta20. Arquitetura agnóstica de sistema.
Escopo atual: **somente o MVP** descrito em `docs/SPEC.md`. Não adicionar features fora dele sem o dono do projeto pedir.

O dono do projeto é iniciante em React/TypeScript/Node: **explique brevemente cada decisão importante** ao propor ou implementar algo.

## Regra número 1: regras de sistema em JSON

- Tudo que é regra de RPG (atributos, perícias, recursos, fórmulas de teste, bônus por nível) vive em `packages/shared/systems/<id>.json`, validado por `SystemDefinitionSchema` (`packages/shared/src/schemas/system.ts`).
- O código **nunca** referencia uma chave concreta de sistema (`"for"`, `"percepcao"`, `1d20 + metade do nível`). Ele lê a definição e trabalha com `attributes[]`, `skills[]`, `rolls.skillCheck` etc.
- Fórmulas usam placeholders `{attr.<key>}`, `{skill.<key>}`, `{level}`, `{halfLevel}`, `{trained}`; após substituição viram uma fórmula de dado genérica (`1d20+5`) processada pelo parser em `packages/shared`.
- Se precisar de algo novo do sistema, **amplie o schema + o JSON**, não hardcode.
- Teste `packages/shared/src/test/systems.test.ts` valida todos os JSONs em `systems/`. Deve continuar passando.

## Stack (não mudar sem consultar o dono)

| Camada | Tecnologia |
|---|---|
| Monorepo | pnpm workspaces (`apps/*`, `packages/*`) |
| `apps/web` | React 18, TypeScript, Vite, Tailwind v4 (`@tailwindcss/vite`), Zustand, react-konva |
| `apps/server` | Node 22, TypeScript, Fastify 5, Socket.io 4, Prisma 6, PostgreSQL 16 |
| `packages/shared` | Tipos TS + schemas Zod + contrato de eventos socket + JSONs de sistema |
| Infra | Docker Compose (só o Postgres), Makefile |

## Comandos

```
make up          # sobe o Postgres (docker compose) e espera ficar saudável
make dev         # web (http://localhost:5173) + server (http://localhost:3000) com hot reload
make down        # derruba o Postgres (dados ficam no volume)
make db-migrate  # prisma migrate dev (cria/aplica migrations)
make db-reset    # recria o banco do zero
make db-studio   # GUI do banco
make tunnel      # URL pública (Cloudflare quick tunnel) para jogadores fora da rede; exige make dev aberto
make test        # vitest em todos os pacotes
make typecheck   # tsc --noEmit em todos os pacotes
make help        # lista tudo
```

Config em `.env` na raiz (copiado de `.env.example` pelo `make`). Server lê via `--env-file`; Vite lê via `envDir: "../../"` e só expõe `VITE_*`.

Rodar um pacote só: `pnpm --filter @tormenta-vtt/server dev`. Adicionar dependência: `pnpm --filter @tormenta-vtt/web add <pkg>`.

## Estrutura

```
apps/web/src/         components/ store/ lib/ (ver SPEC §7)
apps/server/src/      index.ts env.ts db.ts http/ socket/ services/
apps/server/prisma/   schema.prisma + migrations/
packages/shared/src/  schemas/ (Zod) events.ts dice/
packages/shared/systems/  <id>.json
docs/SPEC.md          MVP, modelo de dados, eventos — fonte da verdade do escopo
```

`packages/shared` é consumido **como fonte TS** (sem build): `main` aponta para `src/index.ts`. Vite e tsx compilam direto.

## Convenções

- **TypeScript estrito** (`strict`, `noUncheckedIndexedAccess`). Sem `any`; use `unknown` + Zod.
- **Fronteira = Zod.** Tudo que entra pelo socket ou HTTP é validado com o schema de `shared` antes de tocar o banco. Tipos TS vêm de `z.infer`, nunca duplicados à mão.
- **Servidor é a fonte da verdade.** Cliente aplica mudança otimista → emite evento com ack → servidor valida, persiste, faz broadcast a todos (inclusive autor) → cliente aplica o broadcast. Ack `{ ok:false }` → reverter.
- **Rolagem de dados acontece no servidor.** Cliente só manda a fórmula.
- **Eventos socket**: nome `recurso:acao` (`token:update`), tipados em `packages/shared/src/events.ts`. Novo evento = adicionar lá primeiro.
- **Estado no web**: uma store Zustand por domínio (`connection`, `room`, `tokens`, `chat`, `initiative`). Componentes não chamam `socket.emit` direto; chamam ações da store.
- **Coordenadas de token em pixels do mapa**, nunca em células. Conversão em `apps/web/src/lib/grid.ts` (função pura).
- **Prisma**: campos flexíveis que vão evoluir (grid, resultado de rolagem) são `Json`. Mudou o schema → `make db-migrate` com nome descritivo.
- **Imports ESM** (`"type": "module"`). No server, imports relativos com extensão `.js` (exigência do NodeNext).
- Código e comentários em **português**; identificadores em inglês (`cellSize`, `ownerId`).
- Commits: mensagem curta no imperativo, em português ("Adiciona parser de dados").
- **Commitar direto na `main`, sem criar branches**, a menos que o dono do projeto peça explicitamente.

## Ao implementar algo

1. Confira o escopo em `docs/SPEC.md`. Fora do MVP → pergunte antes.
2. Comece pelo `shared` (schema/evento), depois server, depois web.
3. `make typecheck && make test` antes de dar por concluído.
4. Se mudar comportamento descrito no SPEC, atualize o SPEC no mesmo commit.

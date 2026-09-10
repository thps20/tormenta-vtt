# Comandos do dia a dia. Rode `make help` para ver a lista.
.DEFAULT_GOAL := help
SHELL := /bin/bash

# Carrega o .env da raiz e exporta tudo para os comandos filhos (prisma, node...).
# O "-" faz o include não falhar se o .env ainda não existir (a regra .env abaixo cria).
-include .env
export

.PHONY: help install up down logs dev build test typecheck db-migrate db-reset db-studio seed-test tunnel clean

help: ## Lista os comandos
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(firstword $(MAKEFILE_LIST)) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

.env:
	cp .env.example .env

install: .env ## Instala dependências de todos os pacotes
	pnpm install

up: .env ## Sobe o PostgreSQL (Docker) e espera ficar saudável
	docker compose up -d --wait

down: ## Derruba o PostgreSQL (mantém os dados no volume)
	docker compose down

logs: ## Logs do banco
	docker compose logs -f db

dev: install ## Roda web + server em modo dev (hot reload)
	pnpm dev

build: install ## Build de produção de todos os pacotes
	pnpm build

test: install ## Roda os testes de todos os pacotes
	pnpm test

typecheck: install ## Checa tipos em todos os pacotes
	pnpm typecheck

db-migrate: install ## Cria/aplica migrations do Prisma. Uso: make db-migrate name=descricao
	pnpm --filter @tormenta-vtt/server exec prisma migrate dev $(if $(name),--name $(name),)

db-reset: install ## Apaga e recria o banco a partir das migrations
	pnpm --filter @tormenta-vtt/server exec prisma migrate reset --force

db-studio: install ## Abre o Prisma Studio (GUI do banco)
	pnpm --filter @tormenta-vtt/server exec prisma studio

seed-test: install ## Recria do zero a sala fixa "Mesa de Teste" (mapas/fichas/tokens prontos, ver docs/testar-com-amigos.md)
	pnpm --filter @tormenta-vtt/server run seed:test

# Túnel público (Cloudflare quick tunnel): sem conta, sem token, URL aleatória
# *.trycloudflare.com que muda a cada execução. Expõe só o Vite (5173); o Vite
# faz proxy de /api, /uploads e /socket.io para o server, então um túnel basta.
CLOUDFLARED := .tools/cloudflared
CLOUDFLARED_URL := https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$(shell uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')

$(CLOUDFLARED):
	@echo "Baixando cloudflared para $(CLOUDFLARED)..."
	@mkdir -p .tools
	@curl -fsSL -o $(CLOUDFLARED) $(CLOUDFLARED_URL)
	@chmod +x $(CLOUDFLARED)

# O cloudflared é bem verboso; o awk filtra o log e mostra só a URL pública,
# as conexões registradas e erros. Ctrl+C derruba os dois (mesmo grupo de processos).
tunnel: $(CLOUDFLARED) ## Expõe o VTT na internet (rode com `make dev` aberto em outro terminal)
	@curl -fsS -o /dev/null http://localhost:5173 || { echo "Vite não está no ar em :5173. Rode 'make dev' em outro terminal."; exit 1; }
	@echo "Abrindo túnel (Cloudflare quick tunnel)... Ctrl+C encerra."
	@$(CLOUDFLARED) tunnel --no-autoupdate --url http://localhost:5173 2>&1 | awk '\
	  match($$0, /https:\/\/[a-z0-9-]+\.trycloudflare\.com/) { \
	    printf "\n  URL pública: %s\n  Mande este link para os jogadores (muda a cada execução).\n\n", substr($$0, RSTART, RLENGTH); fflush(); next } \
	  /Registered tunnel connection/ { print "  túnel conectado"; fflush(); next } \
	  /ERR/ { print; fflush() }'

clean: ## Remove node_modules e builds
	rm -rf node_modules apps/*/node_modules apps/*/dist packages/*/node_modules packages/*/dist

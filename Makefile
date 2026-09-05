# Comandos do dia a dia. Rode `make help` para ver a lista.
.DEFAULT_GOAL := help
SHELL := /bin/bash

# Carrega o .env da raiz e exporta tudo para os comandos filhos (prisma, node...).
# O "-" faz o include não falhar se o .env ainda não existir (a regra .env abaixo cria).
-include .env
export

.PHONY: help install up down logs dev build test typecheck db-migrate db-reset db-studio clean

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

clean: ## Remove node_modules e builds
	rm -rf node_modules apps/*/node_modules apps/*/dist packages/*/node_modules packages/*/dist

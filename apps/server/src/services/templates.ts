import { TEMPLATE_MAX_PER_SCENE, type Template } from "@tormenta-vtt/shared";

/**
 * Gabaritos de área de efeito (docs/plano-gabaritos.md): efêmeros por sessão, guardados em
 * memória — não sobrevivem a um restart do servidor, mesmo padrão de `presence.ts` (quem está
 * online) e da pilha de desfazer (`history.ts`). Chave: sceneId -> templateId -> Template.
 */
const bySceneAndId = new Map<string, Map<string, Template>>();

export function listTemplates(sceneId: string): Template[] {
  return [...(bySceneAndId.get(sceneId)?.values() ?? [])];
}

/** `false` = mapa já tem `TEMPLATE_MAX_PER_SCENE` gabaritos e este é um NOVO (não sobrescreve). */
export function upsertTemplate(sceneId: string, template: Template): boolean {
  let scene = bySceneAndId.get(sceneId);
  if (!scene) bySceneAndId.set(sceneId, (scene = new Map()));
  if (!scene.has(template.id) && scene.size >= TEMPLATE_MAX_PER_SCENE) return false;
  scene.set(template.id, template);
  return true;
}

/** Dono do gabarito, ou `undefined` se não existir (mais neste mapa) — usado para checar permissão antes de editar/apagar. */
export function templateOwner(sceneId: string, templateId: string): string | undefined {
  return bySceneAndId.get(sceneId)?.get(templateId)?.ownerId;
}

export function removeTemplate(sceneId: string, templateId: string): void {
  bySceneAndId.get(sceneId)?.delete(templateId);
}

/** Mapa apagado (`scene:delete`) — evita vazar memória com cenas que não existem mais. */
export function clearTemplates(sceneId: string): void {
  bySceneAndId.delete(sceneId);
}

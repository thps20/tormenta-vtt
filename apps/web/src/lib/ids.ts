/** Id local para itens/ações/modificadores dentro da ficha (o servidor só valida que é string). */
export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

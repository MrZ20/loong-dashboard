import type { DomainDefinition } from "./types";

export function defineDomain(definition: DomainDefinition) {
  return Object.freeze(definition);
}

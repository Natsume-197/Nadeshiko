/** A resource object from a Patreon API v2 (JSON:API) response. */
export interface PatreonResource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { id: string; type: string } | Array<{ id: string; type: string }> | null }>;
}

/** The tier ids linked under one of a resource's relationships (e.g. `currently_entitled_tiers`). */
export function relationshipTierIds(resource: PatreonResource | undefined, relationship: string): string[] {
  const rel = resource?.relationships?.[relationship]?.data;
  return Array.isArray(rel) ? rel.filter((item) => item.type === 'tier').map((item) => item.id) : [];
}

// Marquee mis-statuses these backend application errors as 401.
// Keep the body match narrow so genuine authentication failures remain intact.
export function upstreamUnauthorizedClassification(
  body: string,
): 'entity_401' | 'entitlement_401' | undefined {
  if (/error getting entity/i.test(body)) return 'entity_401';
  if (/\bnot entitled\b/i.test(body)) return 'entitlement_401';
  return undefined;
}

import "server-only";

import { createHmac } from "node:crypto";

const SENSITIVE_TEXT_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/iu,
  /\b[A-Z0-9._%+-]+\s*(?:\[at\]|\(at\)| arobase )\s*[A-Z0-9.-]+\s*(?:\[dot\]|\(dot\)| point )\s*[A-Z]{2,63}\b/iu,
  /\b(?:\+33|0033|0)[1-9](?:[\s.-]?\d{2}){4}\b/u,
  /(?:^|[^\w])\+\d{1,3}(?:[\s.-]?\d){8,14}(?:$|[^\w])/u,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u,
  /\b(?:shpat|shpca|shppa|shpss|ghp|github_pat|xox[baprs]|sk_live|pk_live)[_-][A-Za-z0-9_-]{12,}\b/iu,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*\b/iu,
  /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|password|mot de passe)\s*[:=]\s*\S{6,}/iu,
  /\b[A-Za-z0-9_-]{32,}\b/u,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu,
  /\b(?:commande|order|facture|invoice|colis|suivi|tracking)\s*(?:n(?:uméro|umber)?|n[o°.]|r[ée]f(?:[ée]rence)?|#|:)\s*[A-Z0-9][A-Z0-9-]{3,}\b/iu,
  /#[A-Z0-9][A-Z0-9-]{3,}\b/iu,
  /\b(?:adresse|address)\s*[:=-]\s*[^\n]{3,160}/iu,
  /\b\d{1,5}\s*(?:bis|ter)?\s+(?:rue|avenue|av\.?|boulevard|bd\.?|chemin|route|impasse|all[ée]e|place|quai|cours|lotissement)\b[^\n,;]{1,100}/iu,
  /\b(?:code postal|cp)\s*[:=-]?\s*(?:F-)?\d{5}\b/iu,
  /\b(?:F-)?\d{5}\s+\p{Lu}[\p{L}\p{M}'’ -]{1,40}\b/u,
  /\b(?:je m'appelle|mon nom est|my name is)\s+[\p{L}\p{M}][\p{L}\p{M}'’ -]{1,100}/iu,
  /\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]){11,30}\b/iu,
  /\b(?:\d[\s-]?){13,19}\b/u
] as const;

function privacySecret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error("Runtime privacy protection is unavailable.");
  }
  return value;
}

export function containsSensitiveRuntimeText(value: string) {
  return SENSITIVE_TEXT_PATTERNS.some((pattern) => pattern.test(value));
}

export function coarsenRuntimeCoordinates(value: string) {
  return value.replace(
    /(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/g,
    (match, rawLatitude: string, rawLongitude: string) => {
      const latitude = Number(rawLatitude);
      const longitude = Number(rawLongitude);
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        return match;
      }
      return `${Math.round(latitude * 100) / 100}, ${Math.round(longitude * 100) / 100}`;
    }
  );
}

export function runtimePseudonym(
  purpose: "message" | "request" | "sender",
  value: string
) {
  const digest = createHmac("sha256", privacySecret())
    .update(`rasa-runtime:${purpose}:v1\0`, "utf8")
    .update(value, "utf8")
    .digest("base64url");
  return `${purpose}_${digest.slice(0, 48)}`;
}

export function safeRuntimeText(
  value: string,
  replacement = "[CONTENU_SENSIBLE_MASQUE]"
) {
  return containsSensitiveRuntimeText(value) ? replacement : value;
}

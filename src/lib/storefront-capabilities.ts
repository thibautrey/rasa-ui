import "server-only";

import {
  createHash,
  createHmac,
  randomBytes
} from "node:crypto";
import { z } from "zod";
import type { RasaParseResult, RasaReply } from "@/lib/rasa";

const EXECUTE_PATH = "/api/storefront-assistant/capabilities/execute";
const SIGNATURE_VERSION = "v1";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

const placeNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[\p{L}\p{M}0-9 .,'’()/-]+$/u);

const coordinateLocationSchema = z
  .object({
    type: z.literal("coordinates"),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180)
  })
  .strict();

const cityLocationSchema = z
  .object({
    type: z.literal("city"),
    city: placeNameSchema,
    country: placeNameSchema.optional()
  })
  .strict();

const skyForecastRequestSchema = z
  .object({
    capability: z.literal("sky.forecast"),
    input: z
      .object({
        location: z.discriminatedUnion("type", [
          coordinateLocationSchema,
          cityLocationSchema
        ])
      })
      .strict()
  })
  .strict();

const skyEventsRequestSchema = z
  .object({
    capability: z.literal("sky.events"),
    input: z
      .object({
        location: z.discriminatedUnion("type", [
          coordinateLocationSchema,
          cityLocationSchema
        ]),
        heightMeters: z.number().finite().min(-500).max(10_000).optional(),
        startsAt: z.string().datetime({ offset: true }).optional(),
        days: z.number().int().min(1).max(7).optional(),
        limit: z.number().int().min(1).max(12).optional()
      })
      .strict()
  })
  .strict();

const catalogGuidanceModeSchema = z.enum([
  "availability",
  "comparison",
  "compatibility",
  "recommendation"
]);

const catalogGuidanceRequestSchema = z
  .object({
    capability: z.literal("catalog.guidance"),
    input: z
      .object({
        mode: catalogGuidanceModeSchema,
        query: z.string().trim().min(3).max(500),
        limit: z.number().int().min(1).max(6).optional()
      })
      .strict()
  })
  .strict();

const storefrontCapabilityRequestSchema = z.discriminatedUnion("capability", [
  catalogGuidanceRequestSchema,
  skyForecastRequestSchema,
  skyEventsRequestSchema
]);

export type StorefrontCapabilityRequest = z.infer<
  typeof storefrontCapabilityRequestSchema
>;

const plainTextSchema = (maxLength: number) =>
  z
    .string()
    .max(maxLength)
    .refine((value) => !/[\u0000-\u001F\u007F]/.test(value));

const timestampSchema = z.string().datetime({ offset: true });
const scoreSchema = z.number().finite().min(0).max(100);
const percentageSchema = z.number().finite().min(0).max(100);
const qualitySchema = z.enum(["green", "orange", "red", "black"]);

const skyForecastResponseSchema = z
  .object({
    capability: z.literal("sky.forecast"),
    answer: plainTextSchema(500).min(1),
    data: z
      .object({
        generatedAt: timestampSchema,
        stale: z.boolean(),
        location: z
          .object({
            name: plainTextSchema(100),
            country: plainTextSchema(100),
            timezone: plainTextSchema(80)
          })
          .strict(),
        score: scoreSchema,
        daily: z
          .array(
            z
              .object({
                date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
                score: scoreSchema,
                quality: qualitySchema,
                cloudPercent: percentageSchema,
                seeing: plainTextSchema(16),
                transparency: plainTextSchema(16),
                windKph: z.number().finite().min(0).max(500),
                humidityPercent: percentageSchema,
                moonIlluminationPercent: percentageSchema,
                dewRisk: z.enum(["low", "moderate", "high"]),
                precipitationProbabilityPercent: percentageSchema,
                temperatureMinCelsius: z
                  .number()
                  .finite()
                  .min(-100)
                  .max(100)
                  .nullable(),
                temperatureMaxCelsius: z
                  .number()
                  .finite()
                  .min(-100)
                  .max(100)
                  .nullable(),
                bestTime: plainTextSchema(40).nullable(),
                summary: plainTextSchema(300)
              })
              .strict()
          )
          .max(7),
        windows: z
          .array(
            z
              .object({
                startTime: plainTextSchema(40).nullable(),
                durationHours: z
                  .number()
                  .finite()
                  .min(0)
                  .max(168)
                  .nullable(),
                quality: qualitySchema.nullable(),
                summary: plainTextSchema(300)
              })
              .strict()
          )
          .max(5)
      })
      .strict()
  })
  .strict();

const skyEventKindSchema = z.enum([
  "asteroid",
  "bright-satellite",
  "conjunction",
  "iss-pass",
  "jupiter-grs",
  "jupiter-moon-transit",
  "jupiter-shadow-transit",
  "lunar-eclipse",
  "lunar-phase",
  "lunar-terminator",
  "meteor-shower",
  "occultation",
  "planetary-opposition",
  "solar-eclipse"
]);

const skyEventsResponseSchema = z
  .object({
    capability: z.literal("sky.events"),
    answer: plainTextSchema(300).min(1),
    data: z
      .object({
        generatedAt: timestampSchema,
        stale: z.boolean(),
        items: z
          .array(
            z
              .object({
                kind: skyEventKindSchema,
                name: plainTextSchema(160),
                startsAt: timestampSchema,
                peaksAt: timestampSchema,
                endsAt: timestampSchema,
                altitudeDegrees: z.number().finite().min(-90).max(90),
                azimuthDegrees: z.number().finite().min(0).max(360),
                confidence: z.number().finite().min(0).max(1),
                visibilityScore: scoreSchema,
                equipment: z
                  .array(
                    z.enum([
                      "binoculars",
                      "certified-solar-filter",
                      "naked-eye",
                      "telescope"
                    ])
                  )
                  .max(4)
              })
              .strict()
          )
          .max(12)
      })
      .strict()
  })
  .strict();

const catalogGuidanceResponseSchema = z
  .object({
    capability: z.literal("catalog.guidance"),
    answer: plainTextSchema(1_500).min(1),
    data: z
      .object({
        mode: catalogGuidanceModeSchema,
        products: z
          .array(
            z
              .object({
                name: plainTextSchema(180),
                variant: plainTextSchema(160).nullable(),
                sku: plainTextSchema(120).nullable(),
                vendor: plainTextSchema(120).nullable(),
                price: z.number().finite().min(0).nullable(),
                availability: z.enum([
                  "available",
                  "limited",
                  "unavailable"
                ]),
                url: z.string().url().max(1_000).nullable()
              })
              .strict()
          )
          .max(6),
      })
      .strict()
  })
  .strict();

const storefrontCapabilityResponseSchema = z.discriminatedUnion(
  "capability",
  [
    catalogGuidanceResponseSchema,
    skyForecastResponseSchema,
    skyEventsResponseSchema
  ]
);

export type StorefrontCapabilityResponse = z.infer<
  typeof storefrontCapabilityResponseSchema
>;

export class StorefrontCapabilityError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "StorefrontCapabilityError";
  }
}

export function storefrontCapabilitiesEnabled() {
  return (
    process.env.STOREFRONT_CAPABILITIES_ENABLED?.trim().toLowerCase() ===
    "true"
  );
}

function settings(storeBotId: string) {
  if (!storefrontCapabilitiesEnabled()) {
    throw new StorefrontCapabilityError(
      "Storefront capabilities are disabled.",
      "STOREFRONT_CAPABILITIES_DISABLED"
    );
  }

  const rawBaseUrl = process.env.STOREFRONT_CAPABILITIES_BASE_URL?.trim();
  const keyId = process.env.STOREFRONT_CAPABILITIES_KEY_ID?.trim();
  const secret = process.env.STOREFRONT_CAPABILITIES_SECRET;
  const configuredBotId =
    process.env.STOREFRONT_CAPABILITIES_BOT_ID?.trim();

  if (
    !rawBaseUrl ||
    !keyId ||
    !secret ||
    !configuredBotId ||
    secret.length < 32 ||
    secret.length > 512 ||
    !/^[A-Za-z0-9._-]{8,80}$/.test(keyId) ||
    configuredBotId.length > 120
  ) {
    throw new StorefrontCapabilityError(
      "Storefront capabilities are not configured.",
      "STOREFRONT_CAPABILITIES_NOT_CONFIGURED"
    );
  }

  if (configuredBotId !== storeBotId) {
    throw new StorefrontCapabilityError(
      "This storefront bot is not allowed to use capabilities.",
      "STOREFRONT_CAPABILITIES_BOT_FORBIDDEN",
      403
    );
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw new StorefrontCapabilityError(
      "The storefront capabilities URL is invalid.",
      "STOREFRONT_CAPABILITIES_INVALID_URL"
    );
  }

  if (
    !["http:", "https:"].includes(baseUrl.protocol) ||
    baseUrl.username ||
    baseUrl.password ||
    (baseUrl.pathname !== "/" && baseUrl.pathname !== "") ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new StorefrontCapabilityError(
      "The storefront capabilities URL is invalid.",
      "STOREFRONT_CAPABILITIES_INVALID_URL"
    );
  }

  return {
    endpoint: new URL(EXECUTE_PATH, baseUrl),
    keyId,
    secret
  };
}

function roundedCoordinate(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizedRequest(input: unknown): StorefrontCapabilityRequest {
  let request: StorefrontCapabilityRequest;
  try {
    request = storefrontCapabilityRequestSchema.parse(input);
  } catch {
    throw new StorefrontCapabilityError(
      "The storefront capability input is invalid.",
      "STOREFRONT_CAPABILITY_INVALID_INPUT",
      400
    );
  }

  if (request.capability === "catalog.guidance") {
    return request;
  }

  if (request.capability === "sky.forecast") {
    const location = request.input.location;
    return location.type === "coordinates"
      ? {
          capability: request.capability,
          input: {
            location: {
              ...location,
              latitude: roundedCoordinate(location.latitude),
              longitude: roundedCoordinate(location.longitude)
            }
          }
        }
      : request;
  }

  return {
    capability: request.capability,
    input: {
      ...request.input,
      location:
        request.input.location.type === "coordinates"
          ? {
              ...request.input.location,
              latitude: roundedCoordinate(
                request.input.location.latitude
              ),
              longitude: roundedCoordinate(
                request.input.location.longitude
              )
            }
          : request.input.location
    }
  };
}

function signedHeaders(body: string, keyId: string, secret: string) {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const nonce = randomBytes(24).toString("base64url");
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
  const signature = createHmac("sha256", secret)
    .update(
      [
        SIGNATURE_VERSION,
        keyId,
        "POST",
        EXECUTE_PATH,
        timestamp,
        nonce,
        bodyHash
      ].join("\n"),
      "utf8"
    )
    .digest("hex");

  return {
    "x-storefront-assistant-key-id": keyId,
    "x-storefront-assistant-timestamp": timestamp,
    "x-storefront-assistant-nonce": nonce,
    "x-storefront-assistant-signature": signature
  };
}

async function readBoundedResponse(response: Response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_RESPONSE_BYTES
  ) {
    await response.body?.cancel();
    throw new StorefrontCapabilityError(
      "The storefront capability response is too large.",
      "STOREFRONT_CAPABILITY_RESPONSE_TOO_LARGE"
    );
  }
  const mediaType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    await response.body?.cancel();
    throw new StorefrontCapabilityError(
      "The storefront capability response is invalid.",
      "STOREFRONT_CAPABILITY_INVALID_RESPONSE"
    );
  }
  if (!response.body) {
    throw new StorefrontCapabilityError(
      "The storefront capability response is empty.",
      "STOREFRONT_CAPABILITY_INVALID_RESPONSE"
    );
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new StorefrontCapabilityError(
        "The storefront capability response is too large.",
        "STOREFRONT_CAPABILITY_RESPONSE_TOO_LARGE"
      );
    }
    chunks.push(chunk.value);
  }

  try {
    return JSON.parse(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
        "utf8"
      )
    ) as unknown;
  } catch {
    throw new StorefrontCapabilityError(
      "The storefront capability response is invalid.",
      "STOREFRONT_CAPABILITY_INVALID_RESPONSE"
    );
  }
}

export async function executeStorefrontCapability(
  storeBotId: string,
  input: unknown
): Promise<StorefrontCapabilityResponse> {
  const request = normalizedRequest(input);
  const { endpoint, keyId, secret } = settings(storeBotId);
  const body = JSON.stringify(request);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...signedHeaders(body, keyId, secret)
      },
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new StorefrontCapabilityError(
        "The storefront capability request timed out.",
        "STOREFRONT_CAPABILITY_TIMEOUT",
        504
      );
    }
    throw new StorefrontCapabilityError(
      "The storefront capability service is unreachable.",
      "STOREFRONT_CAPABILITY_UNREACHABLE",
      503
    );
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new StorefrontCapabilityError(
      "The storefront capability request failed.",
      `STOREFRONT_CAPABILITY_HTTP_${response.status}`,
      response.status
    );
  }

  const responseBody = await readBoundedResponse(response);
  try {
    return storefrontCapabilityResponseSchema.parse(responseBody);
  } catch {
    throw new StorefrontCapabilityError(
      "The storefront capability response is invalid.",
      "STOREFRONT_CAPABILITY_INVALID_RESPONSE"
    );
  }
}

const rasaActionSchema = z
  .object({
    type: z.literal("storefront_capability"),
    action: z.enum([
      "action_storefront_catalog_guidance",
      "action_storefront_sky_forecast",
      "action_storefront_sky_events"
    ]),
    input: z.unknown()
  })
  .strict();

const actionCapabilities = {
  action_storefront_catalog_guidance: "catalog.guidance",
  action_storefront_sky_forecast: "sky.forecast",
  action_storefront_sky_events: "sky.events"
} as const;

const intentCapabilities = {
  ask_availability: {
    capability: "catalog.guidance",
    mode: "availability"
  },
  ask_compatibility: {
    capability: "catalog.guidance",
    mode: "compatibility"
  },
  ask_product: {
    capability: "catalog.guidance",
    mode: "recommendation"
  },
  ask_product_advice: {
    capability: "catalog.guidance",
    mode: "recommendation"
  },
  ask_product_comparison: {
    capability: "catalog.guidance",
    mode: "comparison"
  },
  ask_sky_forecast: "sky.forecast",
  ask_sky_events: "sky.events"
} as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function entityValue(
  nlu: RasaParseResult,
  names: readonly string[]
): unknown {
  if (!Array.isArray(nlu.entities)) return undefined;
  for (const entity of nlu.entities) {
    const value = record(entity);
    if (
      typeof value?.entity === "string" &&
      names.includes(value.entity)
    ) {
      return value.value;
    }
  }
  return undefined;
}

function finiteNumber(value: unknown) {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function boundedString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength
    ? normalized
    : undefined;
}

function requestFromIntent(
  intentCapability: (typeof intentCapabilities)[keyof typeof intentCapabilities],
  nlu: RasaParseResult
): StorefrontCapabilityRequest | null {
  if (typeof intentCapability !== "string") {
    const query = boundedString(nlu.text, 500);
    return query
      ? {
          capability: intentCapability.capability,
          input: {
            mode: intentCapability.mode,
            query
          }
        }
      : null;
  }
  const capability = intentCapability;
  const latitude = finiteNumber(
    entityValue(nlu, ["latitude", "lat"])
  );
  const longitude = finiteNumber(
    entityValue(nlu, ["longitude", "lng", "lon"])
  );

  if (capability === "sky.forecast") {
    if (latitude !== undefined && longitude !== undefined) {
      return {
        capability,
        input: {
          location: {
            type: "coordinates",
            latitude,
            longitude
          }
        }
      };
    }
    const city = boundedString(
      entityValue(nlu, ["city", "location_city"]),
      100
    );
    if (!city) return null;
    const country = boundedString(
      entityValue(nlu, ["country", "location_country"]),
      100
    );
    return {
      capability,
      input: {
        location: {
          type: "city",
          city,
          ...(country ? { country } : {})
        }
      }
    };
  }

  const city = boundedString(
    entityValue(nlu, ["city", "location_city"]),
    100
  );
  const country = boundedString(
    entityValue(nlu, ["country", "location_country"]),
    100
  );
  const location =
    latitude !== undefined && longitude !== undefined
      ? {
          type: "coordinates" as const,
          latitude,
          longitude
        }
      : city
        ? {
            type: "city" as const,
            city,
            ...(country ? { country } : {})
          }
        : null;
  if (!location) return null;
  const heightMeters = finiteNumber(
    entityValue(nlu, ["height_meters", "heightMeters", "elevation"])
  );
  const startsAt = boundedString(
    entityValue(nlu, ["starts_at", "startsAt"]),
    64
  );
  const days = finiteNumber(entityValue(nlu, ["days"]));
  const limit = finiteNumber(entityValue(nlu, ["limit"]));

  return {
    capability,
    input: {
      location,
      ...(heightMeters !== undefined ? { heightMeters } : {}),
      ...(startsAt ? { startsAt } : {}),
      ...(days !== undefined ? { days } : {}),
      ...(limit !== undefined ? { limit } : {})
    }
  };
}

export function resolveStorefrontCapabilityRequest(
  nlu: RasaParseResult,
  replies: RasaReply[]
): StorefrontCapabilityRequest | null {
  const directives: z.infer<typeof rasaActionSchema>[] = [];
  for (const reply of replies) {
    const custom = record(reply.custom);
    if (custom?.type !== "storefront_capability") continue;
    const parsed = rasaActionSchema.safeParse(custom);
    if (!parsed.success) {
      throw new StorefrontCapabilityError(
        "The Rasa storefront action is invalid.",
        "STOREFRONT_CAPABILITY_INVALID_RASA_ACTION",
        400
      );
    }
    directives.push(parsed.data);
  }

  if (directives.length > 1) {
    throw new StorefrontCapabilityError(
      "Rasa returned multiple storefront actions.",
      "STOREFRONT_CAPABILITY_AMBIGUOUS_RASA_ACTION",
      400
    );
  }

  const directive = directives[0];
  if (directive) {
    return normalizedRequest({
      capability: actionCapabilities[directive.action],
      input: directive.input
    });
  }

  const intentName =
    typeof nlu.intent?.name === "string" ? nlu.intent.name : "";
  const intentCapability =
    intentCapabilities[intentName as keyof typeof intentCapabilities];
  return intentCapability
    ? requestFromIntent(intentCapability, nlu)
    : null;
}

export function storefrontCapabilityReply(
  response: StorefrontCapabilityResponse
): RasaReply {
  return {
    text: response.answer
  };
}

import { z } from "zod";

export const capabilityNames = ["sky.forecast", "sky.events"] as const;
export type Capability = (typeof capabilityNames)[number];

const identifierSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9._-]+$/);

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

const plainTextSchema = (maximumLength: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximumLength)
    .refine((value) => !hasControlCharacter(value));

const placeNameSchema = plainTextSchema(100).refine((value) =>
  /^[\p{L}\p{M}0-9 .,'’()/-]+$/u.test(value),
);

function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const loopback =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]";
    if (
      (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.origin !== value
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export const exactOriginSchema = z
  .string()
  .min(8)
  .max(256)
  .refine((value) => normalizedOrigin(value) !== null, {
    message: "Expected an exact HTTPS origin",
  })
  .transform((value) => normalizedOrigin(value) as string);

const locationIdSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);

const locationBase = {
  id: locationIdSchema,
  label: plainTextSchema(80),
};

const cityLocationSchema = z
  .object({
    ...locationBase,
    type: z.literal("city"),
    city: placeNameSchema,
    country: placeNameSchema.optional(),
  })
  .strict();

const coordinateLocationSchema = z
  .object({
    ...locationBase,
    type: z.literal("coordinates"),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();

export const configuredLocationSchema = z.discriminatedUnion("type", [
  cityLocationSchema,
  coordinateLocationSchema,
]);
export type ConfiguredLocation = z.infer<typeof configuredLocationSchema>;

export const runtimeBotConfigSchema = z
  .object({
    version: z.literal(1),
    botKey: z
      .string()
      .min(24)
      .max(84)
      .regex(/^bot_[A-Za-z0-9_-]{20,80}$/),
    name: plainTextSchema(80),
    locale: z.enum(["fr", "en"]),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    position: z.enum(["left", "right"]),
    allowedOrigins: z.array(exactOriginSchema).min(1).max(8),
    locations: z.array(configuredLocationSchema).min(1).max(12),
  })
  .strict()
  .superRefine((config, context) => {
    const origins = new Set(config.allowedOrigins);
    if (origins.size !== config.allowedOrigins.length) {
      context.addIssue({
        code: "custom",
        message: "Duplicate allowed origin",
        path: ["allowedOrigins"],
      });
    }
    const locationIds = new Set(config.locations.map((location) => location.id));
    if (locationIds.size !== config.locations.length) {
      context.addIssue({
        code: "custom",
        message: "Duplicate location id",
        path: ["locations"],
      });
    }
  });
export type RuntimeBotConfig = z.infer<typeof runtimeBotConfigSchema>;

const sessionTokenSchema = z
  .string()
  .min(43)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

const requestIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

const widgetTurnBase = {
  sessionToken: sessionTokenSchema,
  requestId: requestIdSchema,
  locationId: locationIdSchema,
};

export const widgetTurnRequestSchema = z.discriminatedUnion("operation", [
  z
    .object({
      ...widgetTurnBase,
      operation: z.literal("sky.forecast"),
    })
    .strict(),
  z
    .object({
      ...widgetTurnBase,
      operation: z.literal("sky.events"),
      days: z.union([z.literal(1), z.literal(3), z.literal(7)]),
    })
    .strict(),
]);
export type WidgetTurnRequest = z.infer<typeof widgetTurnRequestSchema>;

const flowTurnBase = {
  version: z.literal(1),
  sessionId: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/),
  turnId: requestIdSchema,
  locationId: locationIdSchema,
};

export const flowTurnRequestSchema = z.discriminatedUnion("operation", [
  z
    .object({
      ...flowTurnBase,
      operation: z.literal("sky.forecast"),
    })
    .strict(),
  z
    .object({
      ...flowTurnBase,
      operation: z.literal("sky.events"),
      days: z.union([z.literal(1), z.literal(3), z.literal(7)]),
    })
    .strict(),
]);
export type FlowTurnRequest = z.infer<typeof flowTurnRequestSchema>;

export const flowDecisionResponseSchema = z
  .object({
    version: z.literal(1),
    turnId: requestIdSchema,
    decision: z
      .object({
        type: z.literal("execute"),
        capability: z.enum(capabilityNames),
      })
      .strict(),
  })
  .strict();
export type FlowDecisionResponse = z.infer<typeof flowDecisionResponseSchema>;

const flowCredentialSchema = z
  .object({
    keyId: identifierSchema.min(8),
    secret: z.string().min(32).max(512),
    botId: identifierSchema.max(120),
    capabilities: z.array(z.enum(capabilityNames)).min(1).max(2),
  })
  .strict();

export const flowCredentialsSchema = z
  .array(flowCredentialSchema)
  .min(1)
  .max(16)
  .superRefine((credentials, context) => {
    const keyIds = new Set<string>();
    for (const [index, credential] of credentials.entries()) {
      if (keyIds.has(credential.keyId)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate flow credential key id",
          path: [index, "keyId"],
        });
      }
      keyIds.add(credential.keyId);
      if (new Set(credential.capabilities).size !== credential.capabilities.length) {
        context.addIssue({
          code: "custom",
          message: "Duplicate flow capability",
          path: [index, "capabilities"],
        });
      }
    }
  });
export type FlowCredential = z.infer<typeof flowCredentialSchema>;

const responseTextSchema = (maximumLength: number) =>
  z
    .string()
    .min(1)
    .max(maximumLength)
    .refine((value) => !hasControlCharacter(value));

const timestampSchema = z.string().datetime({ offset: true });
const scoreSchema = z.number().finite().min(0).max(100);
const percentageSchema = z.number().finite().min(0).max(100);
const qualitySchema = z.enum(["green", "orange", "red", "black"]);

const skyForecastResponseSchema = z
  .object({
    capability: z.literal("sky.forecast"),
    answer: responseTextSchema(500),
    data: z
      .object({
        generatedAt: timestampSchema,
        stale: z.boolean(),
        location: z
          .object({
            name: responseTextSchema(100),
            country: responseTextSchema(100),
            timezone: responseTextSchema(80),
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
                seeing: responseTextSchema(16),
                transparency: responseTextSchema(16),
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
                bestTime: responseTextSchema(40).nullable(),
                summary: responseTextSchema(300),
              })
              .strict(),
          )
          .max(7),
        windows: z
          .array(
            z
              .object({
                startTime: responseTextSchema(40).nullable(),
                durationHours: z
                  .number()
                  .finite()
                  .min(0)
                  .max(168)
                  .nullable(),
                quality: qualitySchema.nullable(),
                summary: responseTextSchema(300),
              })
              .strict(),
          )
          .max(5),
      })
      .strict(),
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
  "solar-eclipse",
]);

const skyEventsResponseSchema = z
  .object({
    capability: z.literal("sky.events"),
    answer: responseTextSchema(300),
    data: z
      .object({
        generatedAt: timestampSchema,
        stale: z.boolean(),
        items: z
          .array(
            z
              .object({
                kind: skyEventKindSchema,
                name: responseTextSchema(160),
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
                      "telescope",
                    ]),
                  )
                  .max(4),
              })
              .strict(),
          )
          .max(12),
      })
      .strict(),
  })
  .strict();

export const storefrontCapabilityResponseSchema = z.discriminatedUnion(
  "capability",
  [skyForecastResponseSchema, skyEventsResponseSchema],
);
export type StorefrontCapabilityResponse = z.infer<
  typeof storefrontCapabilityResponseSchema
>;

export const flowTurnResponseSchema = z
  .object({
    version: z.literal(1),
    turnId: requestIdSchema,
    result: storefrontCapabilityResponseSchema,
  })
  .strict();
export type FlowTurnResponse = z.infer<typeof flowTurnResponseSchema>;

export function backendCapabilityRequest(
  operation: Capability,
  location: ConfiguredLocation,
  days?: 1 | 3 | 7,
) {
  const resolvedLocation =
    location.type === "city"
      ? {
          type: "city" as const,
          city: location.city,
          ...(location.country ? { country: location.country } : {}),
        }
      : {
          type: "coordinates" as const,
          latitude: Math.round(location.latitude * 100) / 100,
          longitude: Math.round(location.longitude * 100) / 100,
        };

  return operation === "sky.forecast"
    ? {
        capability: operation,
        input: { location: resolvedLocation },
      }
    : {
        capability: operation,
        input: {
          location: resolvedLocation,
          days: days ?? 1,
          limit: 6,
        },
      };
}

export function parseJsonEnvironment<T>(
  name: string,
  schema: z.ZodType<T>,
): T {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new Error(`${name} is invalid`);
  }
  const parsed = schema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error(`${name} is invalid`);
  }
  return parsed.data;
}

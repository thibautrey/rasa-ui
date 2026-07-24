import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { getRedisClient } from "@/lib/redis";

const REQUESTS_PER_MINUTE = 60;
const MAX_CONCURRENT_REQUESTS = 4;
const MAX_GLOBAL_CONCURRENT_REQUESTS = 16;
const LEASE_DURATION_MS = 30_000;

const ACQUIRE_SCRIPT = `
local requestCount = redis.call("INCR", KEYS[1])
if requestCount == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local requestTtl = redis.call("PTTL", KEYS[1])
if requestCount > tonumber(ARGV[2]) then
  return { 0, requestTtl }
end

redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", ARGV[3])
local activeCount = redis.call("ZCARD", KEYS[2])
if activeCount >= tonumber(ARGV[4]) then
  return { -1, activeCount }
end

redis.call("ZREMRANGEBYSCORE", KEYS[3], "-inf", ARGV[3])
local globalActiveCount = redis.call("ZCARD", KEYS[3])
if globalActiveCount >= tonumber(ARGV[8]) then
  return { -2, globalActiveCount }
end

redis.call("ZADD", KEYS[2], ARGV[5], ARGV[6])
redis.call("ZADD", KEYS[3], ARGV[5], ARGV[6])
redis.call("PEXPIRE", KEYS[2], ARGV[7])
redis.call("PEXPIRE", KEYS[3], ARGV[7])
return { 1, globalActiveCount + 1 }
`;

export class RuntimeExternalLimitError extends Error {
  constructor(
    public readonly code:
      | "RUNTIME_EXTERNAL_CONCURRENCY_LIMIT"
      | "RUNTIME_EXTERNAL_RATE_LIMIT"
      | "RUNTIME_EXTERNAL_LIMIT_UNAVAILABLE"
  ) {
    super(code);
    this.name = "RuntimeExternalLimitError";
  }
}

export type RuntimeExternalLease = {
  release: () => Promise<void>;
};

export async function acquireRuntimeExternalLease(
  storeBotId: string
): Promise<RuntimeExternalLease> {
  const scope = createHash("sha256")
    .update(`storefront-bot:${storeBotId}`, "utf8")
    .digest("base64url");
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const now = Date.now();
  const leaseId = randomBytes(18).toString("base64url");
  const rateKey = `rasa-ui:runtime-rate:${scope}:${minuteBucket}`;
  const concurrencyKey = `rasa-ui:runtime-active:${scope}`;
  const globalConcurrencyKey = "rasa-ui:runtime-active:global";

  let client: Awaited<ReturnType<typeof getRedisClient>>;
  try {
    client = await getRedisClient();
    const result = await client.eval(ACQUIRE_SCRIPT, {
      keys: [rateKey, concurrencyKey, globalConcurrencyKey],
      arguments: [
        "90000",
        String(REQUESTS_PER_MINUTE),
        String(now),
        String(MAX_CONCURRENT_REQUESTS),
        String(now + LEASE_DURATION_MS),
        leaseId,
        String(LEASE_DURATION_MS * 2),
        String(MAX_GLOBAL_CONCURRENT_REQUESTS)
      ]
    });
    if (
      !Array.isArray(result) ||
      result.length !== 2 ||
      typeof result[0] !== "number"
    ) {
      throw new RuntimeExternalLimitError(
        "RUNTIME_EXTERNAL_LIMIT_UNAVAILABLE"
      );
    }
    if (result[0] === 0) {
      throw new RuntimeExternalLimitError(
        "RUNTIME_EXTERNAL_RATE_LIMIT"
      );
    }
    if (result[0] === -1 || result[0] === -2) {
      throw new RuntimeExternalLimitError(
        "RUNTIME_EXTERNAL_CONCURRENCY_LIMIT"
      );
    }
  } catch (error) {
    if (error instanceof RuntimeExternalLimitError) throw error;
    throw new RuntimeExternalLimitError(
      "RUNTIME_EXTERNAL_LIMIT_UNAVAILABLE"
    );
  }

  return {
    release: async () => {
      try {
        await Promise.all([
          client.zRem(concurrencyKey, leaseId),
          client.zRem(globalConcurrencyKey, leaseId)
        ]);
      } catch {
        // The expiring lease remains the fail-safe release mechanism.
      }
    }
  };
}

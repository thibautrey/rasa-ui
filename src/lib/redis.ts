import "server-only";
import { createClient } from "redis";

type RedisClient = ReturnType<typeof createClient>;

const redisState = globalThis as unknown as {
  sharedRedisClient?: RedisClient;
  sharedRedisConnection?: Promise<RedisClient>;
};

export class RedisUnavailableError extends Error {
  constructor() {
    super("Redis is unavailable.");
    this.name = "RedisUnavailableError";
  }
}

export async function getRedisClient() {
  if (redisState.sharedRedisClient?.isReady) {
    return redisState.sharedRedisClient;
  }
  if (redisState.sharedRedisConnection) {
    return redisState.sharedRedisConnection;
  }
  if (redisState.sharedRedisClient) {
    if (redisState.sharedRedisClient.isOpen) {
      redisState.sharedRedisClient.destroy();
    }
    redisState.sharedRedisClient = undefined;
  }

  const url = process.env.REDIS_URL;
  if (!url) {
    throw new RedisUnavailableError();
  }

  const client = createClient({
    url,
    password: process.env.REDIS_PASSWORD || undefined,
    socket: {
      connectTimeout: 1_500,
      reconnectStrategy: false
    }
  });
  client.on("error", () => {
    // Callers fail closed. Avoid logging connection details from the URL.
  });

  redisState.sharedRedisConnection = client
    .connect()
    .then(() => {
      redisState.sharedRedisClient = client;
      return client;
    })
    .catch((error: unknown) => {
      redisState.sharedRedisConnection = undefined;
      if (client.isOpen) {
        client.destroy();
      }
      throw error;
    });

  try {
    return await redisState.sharedRedisConnection;
  } catch {
    throw new RedisUnavailableError();
  } finally {
    redisState.sharedRedisConnection = undefined;
  }
}

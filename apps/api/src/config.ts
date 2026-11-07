import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default("file:./dev.db"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  AUTH_COOKIE_SECURE: z.enum(["true", "false"]).transform(value => value === "true"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  ADMIN_EMAILS: z.string().default(""),
  GREENHOUSE_BOARDS: z.string().default(""),
  LEVER_SITES: z.string().default(""),
  ASHBY_BOARDS: z.string().default(""),
  SOURCE_TIMEOUT_MS: z.coerce.number().default(12000),
  SOURCE_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(1440).default(0)
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === "production") {
    const databaseUrl = env.DATABASE_URL?.trim() ?? "";
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required in production.");
    }
    if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
      throw new Error("DATABASE_URL must use the PostgreSQL protocol in production.");
    }
  }

  const defaults = {
    ...env,
    AUTH_COOKIE_SECURE: env.AUTH_COOKIE_SECURE ?? (env.NODE_ENV === "production" ? "true" : "false")
  };
  return schema.parse(defaults);
}

export const config = loadConfig();
export const list = (value: string) => value.split(",").map(x => x.trim()).filter(Boolean);

import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default("file:./dev.db"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  GREENHOUSE_BOARDS: z.string().default(""),
  LEVER_SITES: z.string().default(""),
  ASHBY_BOARDS: z.string().default(""),
  SOURCE_TIMEOUT_MS: z.coerce.number().default(12000)
});

export const config = schema.parse(process.env);
export const list = (value: string) => value.split(",").map(x => x.trim()).filter(Boolean);

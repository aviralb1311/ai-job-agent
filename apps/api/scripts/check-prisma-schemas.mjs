import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const sqlitePath = resolve(scriptDirectory, "../prisma/schema.prisma");
const postgresPath = resolve(scriptDirectory, "../prisma/postgresql/schema.prisma");

const [sqliteSchema, postgresSchema] = await Promise.all([
  readFile(sqlitePath, "utf8"),
  readFile(postgresPath, "utf8")
]);

function modelDefinitions(schema) {
  return [...schema.matchAll(/^model\s+(\w+)\s*\{[\s\S]*?^\}/gm)].map(match => {
    const lines = match[0].split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    return [match[1], lines.join("\n")];
  });
}

const sqliteModels = new Map(modelDefinitions(sqliteSchema));
const postgresModels = new Map(modelDefinitions(postgresSchema));
const names = [...new Set([...sqliteModels.keys(), ...postgresModels.keys()])].sort();
const differences = names.filter(name => sqliteModels.get(name) !== postgresModels.get(name));

if (!sqliteSchema.includes('provider = "sqlite"')) {
  differences.push("SQLite datasource provider is not sqlite");
}
if (!postgresSchema.includes('provider = "postgresql"')) {
  differences.push("PostgreSQL datasource provider is not postgresql");
}
if (!postgresSchema.includes('directUrl = env("DIRECT_URL")')) {
  differences.push("PostgreSQL datasource must use DIRECT_URL for migrations");
}

if (differences.length) {
  console.error("Prisma schema consistency check failed:");
  for (const difference of differences) console.error(`- ${difference}`);
  process.exitCode = 1;
} else {
  console.log(`Prisma model definitions match (${names.length} models).`);
}

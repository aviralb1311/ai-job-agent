import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { syncJobs } from "./jobs/service.js";

export const app = express();
app.use(cors({ origin: config.CORS_ORIGIN }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "connected" });
  } catch {
    res.status(503).json({ status: "degraded", database: "unavailable" });
  }
});

app.get("/api/jobs", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const location = String(req.query.location ?? "").trim();
  const take = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100);
  const jobs = await prisma.job.findMany({
    where: {
      AND: [
        q ? { OR: [{ title: { contains: q } }, { company: { contains: q } }, { description: { contains: q } }] } : {},
        location ? { location: { contains: location } } : {}
      ]
    },
    orderBy: [{ publishedAt: "desc" }, { discoveredAt: "desc" }],
    take
  });
  res.json({ data: jobs, count: jobs.length });
});

app.post("/api/jobs/sync", async (_req, res) => {
  const result = await syncJobs();
  res.json(result);
});

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
  try {
    const q = String(req.query.q ?? "").trim();
    const location = String(req.query.location ?? "").trim();
    const source = String(req.query.source ?? "").trim().toUpperCase();
    const parsedLimit = Number(req.query.limit ?? 50);
    const take = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.floor(parsedLimit), 1), 100) : 50;

    const where = {
      AND: [
        q ? { OR: [{ title: { contains: q } }, { company: { contains: q } }, { description: { contains: q } }] } : {},
        location ? { location: { contains: location } } : {},
        source ? { source } : {}
      ]
    };

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        orderBy: [{ publishedAt: "desc" }, { discoveredAt: "desc" }],
        take
      }),
      prisma.job.count({ where })
    ]);

    res.json({ data: jobs, count: jobs.length, total });
  } catch (error) {
    res.status(500).json({
      error: "Unable to retrieve jobs",
      detail: error instanceof Error ? error.message : "Unknown database error"
    });
  }
});

app.post("/api/jobs/sync", async (_req, res) => {
  try {
    const result = await syncJobs();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: "Job synchronization failed",
      detail: error instanceof Error ? error.message : "Unknown synchronization error"
    });
  }
});

import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { getConnector, previewSource, syncJobs } from "./jobs/service.js";

export const app = express();
app.use(cors({ origin: config.CORS_ORIGIN }));
app.use(express.json({ limit: "1mb" }));

const SUPPORTED_PROVIDERS = ["GREENHOUSE", "LEVER", "ASHBY"] as const;

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

app.get("/api/sources", async (_req, res) => {
  try {
    const sources = await prisma.jobSource.findMany({ orderBy: { createdAt: "desc" } });
    res.json({ data: sources });
  } catch (error) {
    res.status(500).json({
      error: "Unable to retrieve job sources",
      detail: error instanceof Error ? error.message : "Unknown database error"
    });
  }
});

app.post("/api/sources", async (req, res) => {
  const provider = typeof req.body?.provider === "string" ? req.body.provider.trim().toUpperCase() : "";
  const boardId = typeof req.body?.boardId === "string" ? req.body.boardId.trim() : "";
  const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim() : "";

  if (!SUPPORTED_PROVIDERS.includes(provider as typeof SUPPORTED_PROVIDERS[number])) {
    res.status(400).json({ error: "provider must be GREENHOUSE, LEVER or ASHBY" });
    return;
  }
  if (!boardId || boardId.length > 120 || !/^[a-zA-Z0-9._-]+$/.test(boardId)) {
    res.status(400).json({ error: "boardId must be 1–120 letters, numbers, dots, underscores or hyphens" });
    return;
  }
  if (displayName.length > 120) {
    res.status(400).json({ error: "displayName must be 120 characters or fewer" });
    return;
  }

  try {
    const source = await prisma.jobSource.create({
      data: { provider, boardId, displayName: displayName || null, enabled: true }
    });
    res.status(201).json({ data: source });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      res.status(409).json({ error: "This provider and board ID are already configured" });
      return;
    }
    res.status(500).json({
      error: "Unable to save job source",
      detail: error instanceof Error ? error.message : "Unknown database error"
    });
  }
});

app.post("/api/sources/:id/test", async (req, res) => {
  try {
    const source = await prisma.jobSource.findUnique({ where: { id: req.params.id } });
    if (!source) {
      res.status(404).json({ error: "Job source not found" });
      return;
    }
    const preview = await previewSource(source.provider, source.boardId);
    res.json({ success: true, ...preview });
  } catch (error) {
    res.status(502).json({
      success: false,
      error: "Could not validate this public job board",
      detail: error instanceof Error ? error.message : "Unknown provider error"
    });
  }
});

app.patch("/api/sources/:id", async (req, res) => {
  if (typeof req.body?.enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be a boolean" });
    return;
  }
  try {
    const source = await prisma.jobSource.update({
      where: { id: req.params.id },
      data: { enabled: req.body.enabled }
    });
    res.json({ data: source });
  } catch (error) {
    res.status(404).json({
      error: "Unable to update job source",
      detail: error instanceof Error ? error.message : "Source not found"
    });
  }
});

app.delete("/api/sources/:id", async (req, res) => {
  try {
    await prisma.jobSource.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    res.status(404).json({
      error: "Unable to delete job source",
      detail: error instanceof Error ? error.message : "Source not found"
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

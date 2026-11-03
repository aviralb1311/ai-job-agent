import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "./db.js";
import { config } from "./config.js";

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = "ai_job_session";
const passwordSchema = z.string().min(12).max(128);
const credentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: passwordSchema
});

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [algorithm, salt, expectedHex] = stored.split(":");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function setSessionCookie(res: Response, token: string, maxAgeSeconds: number): void {
  const secure = config.AUTH_COOKIE_SECURE ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`);
}

function clearSessionCookie(res: Response): void {
  const secure = config.AUTH_COOKIE_SECURE ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function readCookie(req: Request, name: string): string | null {
  const header = req.header("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

async function findSession(req: Request) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token || token.length > 200) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: tokenDigest(token) },
    include: { user: { select: { id: true, email: true, role: true } } }
  });
  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    await prisma.session.delete({ where: { id: session.id } });
    return null;
  }
  return { session, user: session.user };
}

export async function register(req: Request, res: Response): Promise<void> {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email and a password of at least 12 characters." });
    return;
  }
  const email = parsed.data.email.toLowerCase();
  try {
    const user = await prisma.user.create({
      data: { email, passwordHash: await hashPassword(parsed.data.password), role: "USER" },
      select: { id: true, email: true, role: true }
    });
    await issueSession(user.id, res);
    res.status(201).json({ data: { user } });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }
    res.status(500).json({ error: "Unable to create account." });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email and password." });
    return;
  }
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: "Email or password is incorrect." });
    return;
  }
  await issueSession(user.id, res);
  res.json({ data: { user: { id: user.id, email: user.email, role: user.role } } });
}

async function issueSession(userId: string, res: Response): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const ttlSeconds = config.SESSION_TTL_DAYS * 24 * 60 * 60;
  await prisma.session.create({
    data: {
      tokenHash: tokenDigest(token),
      userId,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000)
    }
  });
  setSessionCookie(res, token, ttlSeconds);
}

export async function logout(req: Request, res: Response): Promise<void> {
  const token = readCookie(req, COOKIE_NAME);
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: tokenDigest(token) } });
  }
  clearSessionCookie(res);
  res.json({ data: { loggedOut: true } });
}

export async function currentSession(req: Request, res: Response): Promise<void> {
  const found = await findSession(req);
  if (!found) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  res.json({ data: { user: found.user } });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const found = await findSession(req);
    if (!found) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    res.locals.userId = found.user.id;
    res.locals.userRole = found.user.role;
    next();
  } catch {
    res.status(500).json({ error: "Unable to validate session." });
  }
}

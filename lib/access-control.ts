import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type AccessRole = "USER" | "ADMIN";

type AccessCodeRecord = {
  id: string;
  label: string;
  codeHash: string;
  displayCode: string | null;
  role: AccessRole;
  createdAt: Date;
  lastUsedAt: Date | null;
};

export type AccessSession = {
  id: string;
  role: AccessRole;
  label: string;
};

const COOKIE_NAME = "taijitu_access";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const DEFAULT_ADMIN_CODE = process.env.DEFAULT_ADMIN_ACCESS_CODE || "taijitu-admin";

function getSessionSecret() {
  return process.env.ACCESS_SESSION_SECRET || process.env.NEXTAUTH_SECRET || process.env.AI_RELAY_API_KEY || "taijitu-local-session-secret";
}

export function hashAccessCode(code: string) {
  return createHash("sha256").update(code.trim()).digest("hex");
}

function signPayload(payload: string) {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function encodeSession(session: AccessSession) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${signPayload(payload)}`;
}

function decodeSession(value?: string): AccessSession | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature || !safeEqual(signature, signPayload(payload))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AccessSession;
    if (!parsed.id || (parsed.role !== "ADMIN" && parsed.role !== "USER")) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setAccessCookie(response: NextResponse, session: AccessSession) {
  response.cookies.set(COOKIE_NAME, encodeSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export function clearAccessCookie(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function ensureDefaultAccessCode() {
  const count = await prisma.accessCode.count();
  if (count > 0) return;

  await prisma.accessCode.create({
    data: {
      label: "默认管理员",
      codeHash: hashAccessCode(DEFAULT_ADMIN_CODE),
      displayCode: DEFAULT_ADMIN_CODE,
      role: "ADMIN",
    },
  });
}

export async function verifyAccessCode(code: string): Promise<AccessCodeRecord | null> {
  await ensureDefaultAccessCode();
  const normalized = code.trim();
  if (normalized.length < 4 || normalized.length > 64) return null;

  const accessCode = await prisma.accessCode.findUnique({ where: { codeHash: hashAccessCode(normalized) } });
  if (!accessCode) return null;

  await prisma.accessCode.update({
    where: { id: accessCode.id },
    data: { lastUsedAt: new Date() },
  });

  return accessCode;
}

export async function getAccessSession(request: NextRequest): Promise<AccessSession | null> {
  await ensureDefaultAccessCode();
  const session = decodeSession(request.cookies.get(COOKIE_NAME)?.value);
  if (!session) return null;

  const accessCode = await prisma.accessCode.findUnique({ where: { id: session.id } });
  if (!accessCode) return null;

  return {
    id: accessCode.id,
    role: accessCode.role,
    label: accessCode.label,
  };
}

export async function requireAccessSession(request: NextRequest) {
  const session = await getAccessSession(request);
  if (!session) throw new Error("请先输入正确口令。");
  return session;
}

export async function requireAdminSession(request: NextRequest) {
  const session = await requireAccessSession(request);
  if (session.role !== "ADMIN") throw new Error("当前口令无权使用管理员功能。");
  return session;
}

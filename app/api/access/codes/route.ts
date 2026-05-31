import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { hashAccessCode, requireAdminSession } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

const CreateCodeSchema = z.object({
  label: z.string().min(1).max(40),
  code: z.string().min(4).max(64),
  role: z.enum(["USER", "ADMIN"]).default("USER"),
});

export async function GET(request: NextRequest) {
  try {
    await requireAdminSession(request);
    const codes = await prisma.accessCode.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        label: true,
        displayCode: true,
        role: true,
        createdAt: true,
        lastUsedAt: true,
        _count: { select: { conversations: true } },
      },
    });

    return NextResponse.json({ ok: true, codes });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取口令失败。";
    return NextResponse.json({ ok: false, message }, { status: 403 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdminSession(request);
    const input = CreateCodeSchema.parse(await request.json());
    const normalizedCode = input.code.trim();
    const codeHash = hashAccessCode(normalizedCode);
    const duplicate = await prisma.accessCode.findUnique({
      where: { codeHash },
      select: { id: true },
    });

    if (duplicate) {
      return NextResponse.json(
        { ok: false, message: "该访问口令已存在，请换一个新的口令。" },
        { status: 409 },
      );
    }

    const code = await prisma.accessCode.create({
      data: {
        label: input.label.trim(),
        codeHash,
        displayCode: normalizedCode,
        role: input.role,
      },
      select: {
        id: true,
        label: true,
        displayCode: true,
        role: true,
        createdAt: true,
        lastUsedAt: true,
        _count: { select: { conversations: true } },
      },
    });

    return NextResponse.json({ ok: true, code });
  } catch (error) {
    const isDuplicateCode =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      Array.isArray(error.meta?.target) &&
      error.meta.target.includes("codeHash");
    const message = isDuplicateCode
      ? "该访问口令已存在，请换一个新的口令。"
      : error instanceof Error
        ? error.message
        : "新增口令失败。";
    const status = isDuplicateCode ? 409 : message.includes("无权") ? 403 : 400;
    return NextResponse.json({ ok: false, message }, { status });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAccessSession } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

const MessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  content: z.string().max(12000),
  time: z.string().min(1),
  attachments: z.array(z.object({
    id: z.string(),
    url: z.string().nullable().optional(),
    name: z.string(),
    type: z.string().optional(),
    mimeType: z.string().optional(),
    size: z.number(),
    kind: z.enum(["IMAGE", "DOCUMENT", "SPREADSHEET", "TEXT", "OTHER"]),
    status: z.enum(["PROCESSING", "READY", "FAILED"]).optional(),
    summary: z.string().optional(),
    materials: z.unknown().optional(),
    warnings: z.array(z.string()).optional(),
  })).optional(),
  images: z.array(z.object({
    id: z.string(),
    url: z.string(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    seed: z.string().nullable(),
  })).optional(),
});

const ConversationSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(80),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messages: z.array(MessageSchema).max(200),
});

const SaveSchema = z.object({
  conversations: z.array(ConversationSchema).max(100),
});

type SavedConversationWithOwner = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: unknown;
  accessCodeId: string;
  accessCode: {
    label: string;
    role: "USER" | "ADMIN";
  };
};

type TransactionClient = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

type ConversationMessage = z.infer<typeof MessageSchema>;

function isHtmlDocument(text: string) {
  const normalized = text.trim().slice(0, 5000).toLowerCase();
  return (
    normalized.startsWith("<!doctype html") ||
    (normalized.startsWith("<html") && normalized.includes("<head")) ||
    (normalized.includes("<script") && normalized.includes("window.__app_config__")) ||
    (normalized.includes("<div id=\"app\"") && normalized.includes("/assets/"))
  );
}

function sanitizeMessages(messages: unknown): ConversationMessage[] {
  const parsed = z.array(MessageSchema).max(200).safeParse(messages);
  if (!parsed.success) return [];
  return parsed.data.filter((message) => !isHtmlDocument(message.content));
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireAccessSession(request);
    const conversations = await prisma.savedConversation.findMany({
      where: session.role === "ADMIN"
        ? { OR: [{ accessCodeId: session.id }, { accessCode: { role: "USER" } }] }
        : { accessCodeId: session.id },
      orderBy: { updatedAt: "desc" },
      include: {
        accessCode: { select: { label: true, role: true } },
      },
    });

    return NextResponse.json({
      ok: true,
      conversations: conversations.map((item: SavedConversationWithOwner) => ({
        id: item.id,
        title: item.title,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        messages: sanitizeMessages(item.messages),
        ownerAccessCodeId: item.accessCodeId,
        ownerLabel: item.accessCode.label,
        ownerRole: item.accessCode.role,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取对话失败。";
    return NextResponse.json({ ok: false, message }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAccessSession(request);
    const input = SaveSchema.parse(await request.json());

    await prisma.$transaction(async (tx: TransactionClient) => {
      for (const conversation of input.conversations) {
        const existing = await tx.savedConversation.findUnique({
          where: { id: conversation.id },
          select: { accessCodeId: true },
        });

        if (existing && existing.accessCodeId !== session.id) {
          continue;
        }

        await tx.savedConversation.upsert({
          where: { id: conversation.id },
          create: {
            id: conversation.id,
            accessCodeId: session.id,
            title: conversation.title,
            messages: sanitizeMessages(conversation.messages) as Prisma.InputJsonValue,
            createdAt: new Date(conversation.createdAt),
            updatedAt: new Date(conversation.updatedAt),
          },
          update: {
            title: conversation.title,
            messages: sanitizeMessages(conversation.messages) as Prisma.InputJsonValue,
            updatedAt: new Date(conversation.updatedAt),
          },
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存对话失败。";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}

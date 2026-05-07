import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAccessSession } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

const MessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  content: z.string().max(12000),
  time: z.string().min(1),
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

export async function GET(request: NextRequest) {
  try {
    const session = await requireAccessSession(request);
    const conversations = await prisma.savedConversation.findMany({
      where: session.role === "ADMIN" ? undefined : { accessCodeId: session.id },
      orderBy: { updatedAt: "desc" },
      include: {
        accessCode: { select: { label: true, role: true } },
      },
    });

    return NextResponse.json({
      ok: true,
      conversations: conversations.map((item) => ({
        id: item.id,
        title: item.title,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        messages: item.messages,
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

    await prisma.$transaction(async (tx) => {
      for (const conversation of input.conversations) {
        const existing = await tx.savedConversation.findUnique({
          where: { id: conversation.id },
          select: { accessCodeId: true },
        });

        if (existing && existing.accessCodeId !== session.id && session.role !== "ADMIN") {
          continue;
        }

        await tx.savedConversation.upsert({
          where: { id: conversation.id },
          create: {
            id: conversation.id,
            accessCodeId: session.id,
            title: conversation.title,
            messages: conversation.messages,
            createdAt: new Date(conversation.createdAt),
            updatedAt: new Date(conversation.updatedAt),
          },
          update: {
            title: conversation.title,
            messages: conversation.messages,
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

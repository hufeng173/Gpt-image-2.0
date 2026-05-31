import { NextRequest, NextResponse } from "next/server";
import { requireAccessSession } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAccessSession(request);
    const { id } = await context.params;
    const conversation = await prisma.savedConversation.findUnique({
      where: { id },
      select: { accessCodeId: true, accessCode: { select: { role: true } } },
    });

    if (!conversation) return NextResponse.json({ ok: true });

    const canDelete = conversation.accessCodeId === session.id ||
      (session.role === "ADMIN" && conversation.accessCode.role === "USER");

    if (!canDelete) {
      return NextResponse.json(
        { ok: false, message: "无权删除其他用户的对话。" },
        { status: 403 },
      );
    }

    await prisma.savedConversation.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除对话失败。";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}

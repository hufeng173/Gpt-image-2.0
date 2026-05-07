import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdminSession(request);
    const { id } = await context.params;

    if (id === session.id) {
      return NextResponse.json(
        { ok: false, message: "不能删除当前正在使用的管理员口令。" },
        { status: 400 },
      );
    }

    await prisma.$transaction([
      prisma.savedConversation.deleteMany({ where: { accessCodeId: id } }),
      prisma.accessCode.delete({ where: { id } }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除口令失败。";
    return NextResponse.json({ ok: false, message }, { status: message.includes("无权") ? 403 : 400 });
  }
}

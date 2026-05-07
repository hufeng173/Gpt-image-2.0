import { NextRequest, NextResponse } from "next/server";
import { getAppSettings, saveAppSettings } from "@/lib/settings";
import { getLimiterSnapshot } from "@/lib/concurrency";
import { assertWritableRequest } from "@/lib/request-guard";
import { getAccessSession, requireAdminSession } from "@/lib/access-control";

export async function GET(request: NextRequest) {
  const settings = await getAppSettings();
  const session = await getAccessSession(request);
  return NextResponse.json({
    ok: true,
    settings,
    limiter: getLimiterSnapshot(),
    canManageSettings: session?.role === "ADMIN",
  });
}

export async function POST(request: NextRequest) {
  try {
    assertWritableRequest(request);
    await requireAdminSession(request);
    const body = await request.json();
    const settings = await saveAppSettings(body);
    return NextResponse.json({
      ok: true,
      settings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存设置失败。";
    const status = message.includes("无权") || message.includes("跨站") ? 403 : 400;

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getAppSettings, saveAppSettings } from "@/lib/settings";
import { getLimiterSnapshot } from "@/lib/concurrency";

export async function GET() {
  const settings = await getAppSettings();
  return NextResponse.json({
    ok: true,
    settings,
    limiter: getLimiterSnapshot(),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const settings = await saveAppSettings(body);
  return NextResponse.json({
    ok: true,
    settings,
  });
}

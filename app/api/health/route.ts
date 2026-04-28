import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getLimiterSnapshot } from "@/lib/concurrency";

export async function GET() {
  const imageJobCount = await prisma.imageJob.count();

  return NextResponse.json({
    ok: true,
    database: "connected",
    imageJobCount,
    limiter: getLimiterSnapshot(),
  });
}

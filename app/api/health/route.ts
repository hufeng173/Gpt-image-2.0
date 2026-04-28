import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const imageJobCount = await prisma.imageJob.count();

  return NextResponse.json({
    ok: true,
    database: "connected",
    imageJobCount,
  });
}

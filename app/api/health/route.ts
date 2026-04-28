import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const jobCount = await prisma.imageJob.count();

  return NextResponse.json({
    ok: true,
    database: "connected",
    imageJobCount: jobCount,
  });
}
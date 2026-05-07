import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clearAccessCookie, getAccessSession, setAccessCookie, verifyAccessCode } from "@/lib/access-control";

const LoginSchema = z.object({
  code: z.string().min(4).max(64),
});

export async function GET(request: NextRequest) {
  const session = await getAccessSession(request);
  return NextResponse.json({ ok: true, authenticated: Boolean(session), session });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = LoginSchema.parse(body);
    const accessCode = await verifyAccessCode(input.code);

    if (!accessCode) {
      return NextResponse.json(
        { ok: false, message: "口令不正确，请检查后重试。" },
        { status: 401 },
      );
    }

    const session = { id: accessCode.id, role: accessCode.role, label: accessCode.label };
    const response = NextResponse.json({ ok: true, session });
    setAccessCookie(response, session);
    return response;
  } catch {
    return NextResponse.json(
      { ok: false, message: "口令格式不正确。" },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  clearAccessCookie(response);
  return response;
}

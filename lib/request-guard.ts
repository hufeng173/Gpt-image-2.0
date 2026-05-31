import { NextRequest } from "next/server";

const DEV_TUNNEL_ORIGINS = ["trycloudflare.com", "loca.lt"];

function getAllowedOrigins(request: NextRequest) {
  const host = request.headers.get("host");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "");
  const hosts = [request.nextUrl.host, host, forwardedHost].filter(Boolean) as string[];
  const protocols = Array.from(new Set([request.nextUrl.protocol.replace(":", ""), forwardedProto, "http", "https"]));

  return new Set([
    request.nextUrl.origin,
    ...hosts.flatMap((item) => protocols.map((protocol) => `${protocol}://${item}`)),
  ]);
}

function isAllowedDevTunnelOrigin(origin: string) {
  if (process.env.NODE_ENV === "production") return false;

  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return DEV_TUNNEL_ORIGINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function assertWritableRequest(request: NextRequest) {
  const adminToken = process.env.APP_ADMIN_TOKEN;
  const origin = request.headers.get("origin");

  if (origin) {
    if (!getAllowedOrigins(request).has(origin) && !isAllowedDevTunnelOrigin(origin)) {
      throw new Error("跨站请求被拒绝。");
    }

    return;
  }

  if (adminToken) {
    const authHeader = request.headers.get("authorization") || "";
    const requestToken = request.headers.get("x-app-admin-token") || authHeader.replace(/^Bearer\s+/i, "");
    if (requestToken !== adminToken) {
      throw new Error("无权执行该操作。");
    }
    return;
  }
}

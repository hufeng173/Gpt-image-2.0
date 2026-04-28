export function getUpstreamStatus(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }

  return null;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

export function getShortErrorReason(error: unknown): string {
  const status = getUpstreamStatus(error);
  const message = getErrorMessage(error).toLowerCase();

  if (status === 401 || status === 403) return "模型或 API Key 没有权限。";
  if (status === 404) return "模型名或接口地址不存在。";
  if (status === 408 || message.includes("timeout")) return "接口超时，请稍后重试。";
  if (status === 429) return "请求过多，已触发限流。";
  if (status && status >= 500) return "上游模型服务暂时不可用。";
  if (message.includes("size")) return "图片尺寸不被当前模型支持。";
  if (message.includes("model")) return "模型配置不正确。";

  return "生成失败，请检查模型、尺寸或提示词。";
}

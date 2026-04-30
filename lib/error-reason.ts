const MAX_CUSTOM_IMAGE_SIZE = 10000; // 如果你后端仍然限制 8192，这里就改成 8192
const MIN_CUSTOM_IMAGE_SIZE = 1;     // 如果你后端要求最小 256，这里就改成 256

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
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}

function containsAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function isCustomSizeError(message: string) {
  return containsAny(message, [
    "customwidth",
    "customheight",
    "width",
    "height",
    "size",
  ]);
}

export function getShortErrorReason(error: unknown): string {
  const status = getUpstreamStatus(error);
  const rawMessage = getErrorMessage(error);
  const message = rawMessage.toLowerCase();

  // 上游接口类错误
  if (status === 401 || status === 403) {
    return "模型或 API Key 没有权限。";
  }

  if (status === 404) {
    return "模型名或接口地址不存在。";
  }

  if (status === 408 || message.includes("timeout")) {
    return "接口超时，请稍后重试。";
  }

  if (status === 429) {
    return "请求过多，已触发限流。";
  }

  if (status && status >= 500) {
    return "上游模型服务暂时不可用。";
  }

  // 自定义尺寸错误
  if (isCustomSizeError(message)) {
    if (message.includes("too_big")) {
      return `自定义尺寸过大，单边不能超过 ${MAX_CUSTOM_IMAGE_SIZE} 像素。`;
    }

    if (message.includes("too_small")) {
      return `自定义尺寸过小，单边不能小于 ${MIN_CUSTOM_IMAGE_SIZE} 像素。`;
    }

    if (
      message.includes("invalid_type") ||
      message.includes("expected number") ||
      message.includes("nan")
    ) {
      return "自定义尺寸必须填写数字。";
    }

    if (
      message.includes("required") ||
      message.includes("undefined") ||
      message.includes("null")
    ) {
      return "请填写完整的自定义宽度和高度。";
    }

    return "自定义尺寸参数有误。";
  }

  // 模型类错误
  if (message.includes("model")) {
    return "模型配置不正确。";
  }

  // 参考图类错误
  if (
    message.includes("reference") ||
    message.includes("参考") ||
    message.includes("imagebuffer") ||
    message.includes("upload")
  ) {
    return "参考图读取失败。";
  }

  return "生成失败，请稍后重试。";
}
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";

type ImageModelOption = {
  id: string;
  name: string;
  note?: string;
};

type AppSettings = {
  maxConcurrentGenerations: number;
  defaultImageModel: string;
  promptOptimizerModel: string;
  allowReferenceImageEdit: boolean;
  imageModels: ImageModelOption[];
};

type GeneratedImage = {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  seed: string | null;
};

type ReferenceCategory = "composition" | "color" | "material" | "lighting" | "other";

type UploadedReference = {
  url: string;
  name: string;
  type: string;
  size: number;
  category: ReferenceCategory;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  time: string;
  images?: GeneratedImage[];
};

type ApiConversationMessage = Pick<ChatMessage, "role" | "content">;

type ChatConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  ownerLabel?: string;
  ownerRole?: "USER" | "ADMIN";
};

type AccessSession = {
  id: string;
  role: "USER" | "ADMIN";
  label: string;
};

type AccessCodeItem = {
  id: string;
  label: string;
  role: "USER" | "ADMIN";
  createdAt: string;
  lastUsedAt: string | null;
  _count?: { conversations: number };
};

type GenerateResult = {
  ok: boolean;
  jobId?: string;
  images?: GeneratedImage[];
  warnings?: string[];
  notes?: Array<{ index: number; message: string }>;
  failures?: Array<{ index: number; reason: string }>;
  shortReason?: string;
  message?: string;
  generatedCount?: number;
  requestedCount?: number;
};

type UploadResult = {
  ok: boolean;
  files?: UploadedReference[];
  rejected?: Array<{ name: string; reason: string }>;
  message?: string;
};

type ChatResult = {
  ok: boolean;
  reply?: string;
  shortReason?: string;
  message?: string;
};

type HealthResult = {
  ok: boolean;
  limiter?: {
    active: number;
    waiting: number;
    oldestWaitingMs: number;
  };
};

type AccessSessionResult = {
  ok: boolean;
  authenticated?: boolean;
  session?: AccessSession | null;
  message?: string;
};

type ConversationsResult = {
  ok: boolean;
  conversations?: ChatConversation[];
  message?: string;
};

const storageKey = "taijitu.conversations.v4";

const fallbackSettings: AppSettings = {
  maxConcurrentGenerations: 8,
  defaultImageModel: "gpt-image-2",
  promptOptimizerModel: "gpt-5.4",
  allowReferenceImageEdit: true,
  imageModels: [
    { id: "gpt-image-2", name: "GPT Image 2", note: "推荐" },

  ],
};

const quickCards = [
  {
    title: "图片生成",
    desc: "根据提示词、分类参考图与模型参数生成图像，支持多张输出和自定义尺寸",
    prompt: "一张东方美学品牌主视觉，留白构图，温润松绿色，淡墨山水背景，高级商业质感",
  },
  {
    title: "提示词构建",
    desc: "从简单想法生成结构化提示词，补全主体、风格、构图、材质与光线细节",
    prompt: "请帮我构建一个适合 AI 作图的高质量提示词，主题是东方美学科技产品海报。",
  },
  {
    title: "创意扩展",
    desc: "能够基于当前对话和目标生成多方向创意方案，快速探索不同视觉可能性",
    prompt: "围绕太极图、东方审美、AI 创作工作台，给我 6 个视觉创意方向。",
  },
  {
    title: "提示词优化",
    desc: "结合历史对话、选中图片与分类参考图，提升提示词稳定性和出图质量",
    prompt: "请把当前提示词优化成更适合高质量图片生成的版本。",
  },
];

const referenceCategories: Array<{
  id: ReferenceCategory;
  title: string;
  max: number;
  desc: string;
}> = [
  { id: "composition", title: "构图", max: 2, desc: "主体位置、镜头距离、留白、透视" },
  { id: "color", title: "配色", max: 2, desc: "主色、辅色、明度、饱和度、色彩情绪" },
  { id: "material", title: "材质", max: 2, desc: "纹理、材料触感、颗粒、真实质感" },
  { id: "lighting", title: "光线", max: 2, desc: "光源方向、明暗、阴影、氛围光" },
  { id: "other", title: "其他", max: 4, desc: "万能参考：主体、风格、道具、场景都可以" },
];

const emptyReferences: Record<ReferenceCategory, UploadedReference[]> = {
  composition: [],
  color: [],
  material: [],
  lighting: [],
  other: [],
};

const defaultPrompt = "";

function uid(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowText() {
  return new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function nowIso() {
  return new Date().toISOString();
}

function hideBrokenImage(event: React.SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.display = "none";
}

async function readApiJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error("接口返回了损坏的 JSON，请稍后重试。");
    }
  }

  if (text.includes("<!DOCTYPE") || text.includes("<html")) {
    if (response.status === 413) {
      throw new Error("请求内容过大，请减少图片数量、降低尺寸或减少参考图后重试。");
    }

    if (response.status === 502 || response.status === 503 || response.status === 504) {
      throw new Error("公网连接中断或服务超时，请降低生成张数/尺寸后重试。");
    }

    throw new Error(`服务返回了错误页面，状态码：${response.status}。请稍后重试。`);
  }

  if (!text.trim()) {
    throw new Error(`接口没有返回内容，状态码：${response.status}。`);
  }

  throw new Error(text.slice(0, 300));
}

function getImageSizeText(image: GeneratedImage | null) {
  if (!image?.width || !image?.height) return "尺寸未知";
  return `${image.width} × ${image.height}`;
}

function isPreviewLikelyBlurry(image: GeneratedImage | null) {
  if (!image?.width || !image?.height) return false;
  return image.width < 512 || image.height < 512;
}

function getConversationTitle(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 18 ? `${normalized.slice(0, 18)}...` : normalized || "新对话";
}

function flattenReferenceImages(references: Record<ReferenceCategory, UploadedReference[]>) {
  return referenceCategories.flatMap((category) => references[category.id]);
}

function normalizeLocalUrl(url: string) {
  if (!url) return url;
  if (url.startsWith("/uploads/")) {
    return `/api${url}`;
  }

  if (url.startsWith("/generated/")) {
    return `/api/generated${url.slice("/generated".length)}`;
  }

  if (
    url.startsWith("/api/") ||
    url.startsWith("/") ||
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("data:") ||
    url.startsWith("blob:")
  ) {
    return url;
  }

  return `/${url.replace(/^\/+/, "")}`;
}

function buildGenerationStatus(result: GenerateResult | null, loading: boolean, count: number, liveProgress: string) {
  if (loading) {
    if (liveProgress) return liveProgress;

    const notes = result?.notes || [];
    if (notes.length > 0) {
      return notes.map((item) => item.message).join(" · ");
    }

    return `正在生成 ${count} 张图片...`;
  }

  if (result?.notes?.length) {
    return result.notes.map((item) => item.message).join(" · ");
  }

  return `当前待生成 ${count} 张图片`;
}

function serializeRecentMessages(messages: ApiConversationMessage[], limit = 20) {
  return messages.slice(-limit).map((item) => ({
    role: item.role,
    content: item.content,
  }));
}

export default function Home() {
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<"chat" | "draw">("draw");
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [model, setModel] = useState("gpt-image-2");
  const [sizeMode, setSizeMode] = useState<"preset" | "custom">("preset");
  const [size, setSize] = useState("1920x1080");
  const [customWidth, setCustomWidth] = useState(1024);
  const [customHeight, setCustomHeight] = useState(1024);
  const [count, setCount] = useState(2);
  const [refineCount, setRefineCount] = useState(1);
  const [useReferenceImage, setUseReferenceImage] = useState(true);
  const [references, setReferences] = useState<Record<ReferenceCategory, UploadedReference[]>>(emptyReferences);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>("");
  const [chatDraft, setChatDraft] = useState("");
  const [contextDraft, setContextDraft] = useState("");
  const [imageDraft, setImageDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [generationSource, setGenerationSource] = useState<"main" | "selected" | null>(null);
  const [generationProgress, setGenerationProgress] = useState("");
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [generationTargetCount, setGenerationTargetCount] = useState(1);
  const [chatLoading, setChatLoading] = useState(false);
  const [promptOptimizing, setPromptOptimizing] = useState(false);
  const [imageOptimizing, setImageOptimizing] = useState(false);
  const [uploading, setUploading] = useState<ReferenceCategory | "">("");
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState("");
  const [accessChecking, setAccessChecking] = useState(true);
  const [accessSession, setAccessSession] = useState<AccessSession | null>(null);
  const [accessCodeInput, setAccessCodeInput] = useState("");
  const [accessMessage, setAccessMessage] = useState("");
  const [accessSubmitting, setAccessSubmitting] = useState(false);
  const [accessCodes, setAccessCodes] = useState<AccessCodeItem[]>([]);
  const [newCodeLabel, setNewCodeLabel] = useState("");
  const [newCodeValue, setNewCodeValue] = useState("");
  const [newCodeRole, setNewCodeRole] = useState<"USER" | "ADMIN">("USER");
  const [showAccessAdmin, setShowAccessAdmin] = useState(false);

  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const accessSubmitTimerRef = useRef<number | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) || null,
    [activeConversationId, conversations],
  );

  const activeMessages = activeConversation?.messages || [];
  const referenceImages = useMemo(() => flattenReferenceImages(references), [references]);
  const mainGenerating = loading && generationSource === "main";
  const selectedGenerating = loading && generationSource === "selected";
  const isAdmin = accessSession?.role === "ADMIN";

  useEffect(() => {
    void checkAccessSession();
  }, []);

  useEffect(() => {
    if (accessSession) {
      void loadSettings();
      void loadConversations();
    }
  }, [accessSession]);

  useEffect(() => {
    if (accessSession && conversations.length > 0) {
      void saveConversationsToServer(conversations);
    }
  }, [accessSession, conversations]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConversationId, activeMessages.length, chatLoading]);

  useEffect(() => {
    return () => {
      if (accessSubmitTimerRef.current) window.clearTimeout(accessSubmitTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!loading || !generationStartedAt) return;

    let cancelled = false;
    const startedAt = generationStartedAt;

    async function updateProgress() {
      const elapsedSeconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
      const estimatedSecondsPerImage = 18;
      const currentImage = Math.min(generationTargetCount, Math.max(1, Math.floor(elapsedSeconds / estimatedSecondsPerImage) + 1));
      const remainingImages = Math.max(0, generationTargetCount - currentImage);
      let queueText = "";

      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const health = await readApiJson<HealthResult>(response);
        const waiting = health.limiter?.waiting || 0;
        const active = health.limiter?.active || 0;
        const oldestWaitingSeconds = Math.round((health.limiter?.oldestWaitingMs || 0) / 1000);

        if (waiting > 0) {
          queueText = ` · 已进入队列，前面还有 ${waiting} 个任务，预计等待 ${Math.max(1, oldestWaitingSeconds)} 秒`;
        } else if (active >= settings.maxConcurrentGenerations) {
          queueText = " · 当前并发已满，正在等待生成空位";
        }
      } catch {
        // Health status is best-effort; keep local progress visible if polling fails.
      }

      if (!cancelled) {
        setGenerationProgress(`第 ${currentImage} / ${generationTargetCount} 张生成中，预计还剩 ${remainingImages} 张${queueText}`);
      }
    }

    void updateProgress();
    const timer = window.setInterval(() => void updateProgress(), 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [generationStartedAt, generationTargetCount, loading, settings.maxConcurrentGenerations]);

  async function loadSettings() {
    try {
      const response = await fetch("/api/settings");
      const data = await readApiJson<{ ok: boolean; settings?: AppSettings }>(response);
      if (data.ok && data.settings) {
        setSettings(data.settings);
        setModel(data.settings.defaultImageModel || "gpt-image-2");
      }
    } catch {
      setSettings(fallbackSettings);
    }
  }

  async function checkAccessSession() {
    try {
      const response = await fetch("/api/access/session", { cache: "no-store" });
      const data = await readApiJson<AccessSessionResult>(response);
      if (data.ok && data.authenticated && data.session) {
        setAccessSession(data.session);
        setAccessMessage("");
      }
    } catch {
      setAccessSession(null);
    } finally {
      setAccessChecking(false);
    }
  }

  async function submitAccessCode(code = accessCodeInput) {
    if (accessSubmitting) return;
    const normalized = code.trim();
    if (normalized.length < 4) {
      setAccessMessage("口令太短，请继续输入。");
      return;
    }

    if (normalized.length > 64) {
      setAccessMessage("口令太长，请检查是否多输了字符。");
      return;
    }

    setAccessSubmitting(true);
    setAccessMessage("正在验证口令...");

    try {
      const response = await fetch("/api/access/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: normalized }),
      });
      const data = await readApiJson<AccessSessionResult>(response);
      if (!response.ok || !data.ok || !data.session) throw new Error(data.message || "口令不正确。");

      setAccessSession(data.session);
      setAccessCodeInput("");
      setAccessMessage("");
    } catch (err) {
      setAccessSession(null);
      setAccessMessage(err instanceof Error ? err.message : "口令不正确，请检查后重试。");
    } finally {
      setAccessSubmitting(false);
    }
  }

  async function logoutAccess() {
    await fetch("/api/access/session", { method: "DELETE" }).catch(() => undefined);
    setAccessSession(null);
    setConversations([]);
    setActiveConversationId("");
    setAccessCodeInput("");
    setAccessMessage("已退出，请重新输入口令。");
  }

  async function loadAccessCodes() {
    if (!isAdmin) return;
    try {
      const response = await fetch("/api/access/codes", { cache: "no-store" });
      const data = await readApiJson<{ ok: boolean; codes?: AccessCodeItem[]; message?: string }>(response);
      if (!response.ok || !data.ok) throw new Error(data.message || "读取口令失败");
      setAccessCodes(data.codes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取口令失败");
    }
  }

  async function createAccessCode() {
    if (!newCodeLabel.trim() || !newCodeValue.trim()) {
      setError("请填写口令名称和口令内容。");
      return;
    }

    try {
      const response = await fetch("/api/access/codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newCodeLabel.trim(), code: newCodeValue.trim(), role: newCodeRole }),
      });
      const data = await readApiJson<{ ok: boolean; code?: AccessCodeItem; message?: string }>(response);
      if (!response.ok || !data.ok || !data.code) throw new Error(data.message || "新增口令失败");

      setAccessCodes((prev) => [data.code!, ...prev]);
      setNewCodeLabel("");
      setNewCodeValue("");
      setNewCodeRole("USER");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "新增口令失败");
    }
  }

  async function deleteAccessCode(id: string) {
    try {
      const response = await fetch(`/api/access/codes/${id}`, { method: "DELETE" });
      const data = await readApiJson<{ ok: boolean; message?: string }>(response);
      if (!response.ok || !data.ok) throw new Error(data.message || "删除口令失败");
      setAccessCodes((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除口令失败");
    }
  }

  function openMessageImagesInDraw(images: GeneratedImage[], selected?: GeneratedImage) {
    if (images.length === 0) return;

    setGeneratedImages((prev) => {
      const merged = images.map((image) => ({
        ...image,
        url: normalizeLocalUrl(image.url),
      }));

      for (const item of prev) {
        if (!merged.some((image) => image.id === item.id)) {
          merged.push(item);
        }
      }

      return merged;
    });

      const selectedImageItem = selected ? { ...selected, url: normalizeLocalUrl(selected.url) } : { ...images[0], url: normalizeLocalUrl(images[0].url) };
    setSelectedImage(selectedImageItem);
    setMode("draw");
  }
  async function loadConversations() {
    try {
      const response = await fetch("/api/conversations", { cache: "no-store" });
      const data = await readApiJson<ConversationsResult>(response);
      if (!response.ok || !data.ok) throw new Error(data.message || "读取对话失败");

      const parsed = data.conversations || [];
      if (parsed.length > 0) {
        setConversations(parsed);
        setActiveConversationId((prev) => prev || parsed[0].id);
        return;
      }
    } catch {
      // Keep the workspace usable even if server conversation sync is unavailable.
    }

    const first = createConversationObject("新对话");
    setConversations([first]);
    setActiveConversationId(first.id);
  }

  async function saveConversationsToServer(nextConversations: ChatConversation[]) {
    try {
      await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversations: nextConversations }),
      });
    } catch {
      // Conversation sync is best-effort and should not interrupt creation.
    }
  }

  function createConversationObject(title = "新对话"): ChatConversation {
    const time = nowIso();
    return {
      id: uid("conversation"),
      title,
      createdAt: time,
      updatedAt: time,
      messages: [],
    };
  }

  function createNewConversation() {
    const next = createConversationObject("新对话");
    setConversations((prev) => [next, ...prev]);
    setActiveConversationId(next.id);
    setChatDraft("");
    setContextDraft("");
    setImageDraft("");
    setSelectedImage(null);
    setMode("chat");
    return next.id;
  }
  function deleteConversation(id: string) {
    void deleteConversationFromServer(id);
    setConversations((prev) => {
      const next = prev.filter((item) => item.id !== id);

      if (next.length === 0) {
        const fresh = createConversationObject("新对话");
        setActiveConversationId(fresh.id);
        return [fresh];
      }

      if (activeConversationId === id) {
        setActiveConversationId(next[0].id);
      }

      return next;
    });
  }

  async function deleteConversationFromServer(id: string) {
    try {
      await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    } catch {
      // Server deletion is best-effort; local UI should remain responsive.
    }
  }
  function ensureConversation() {
    if (activeConversationId) return activeConversationId;
    return createNewConversation();
  }

  function updateConversation(id: string, updater: (conversation: ChatConversation) => ChatConversation) {
    setConversations((prev) =>
      prev.map((conversation) => (conversation.id === id ? updater(conversation) : conversation)),
    );
  }

  function appendMessages(id: string, messages: ChatMessage[], titleSeed?: string) {
    updateConversation(id, (conversation) => {
      const shouldRename = conversation.title === "新对话" && titleSeed;
      return {
        ...conversation,
        title: shouldRename ? getConversationTitle(titleSeed) : conversation.title,
        updatedAt: nowIso(),
        messages: [...conversation.messages, ...messages],
      };
    });
  }

  async function saveSettings(nextSettings: Partial<AppSettings>) {
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextSettings),
      });
      const data = await readApiJson<{ ok: boolean; settings?: AppSettings; message?: string }>(response);
      if (!response.ok || !data.ok || !data.settings) {
        throw new Error(data.message || "保存设置失败");
      }

      setSettings(data.settings);
      if (nextSettings.defaultImageModel) setModel(data.settings.defaultImageModel);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存设置失败");
    }
  }

  async function uploadReferences(category: ReferenceCategory, event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const config = referenceCategories.find((item) => item.id === category);
    const max = config?.max || 2;
    const remaining = Math.max(0, max - references[category].length);

    if (remaining <= 0) {
      setError(`${config?.title || "该分类"}参考图已达到上限。`);
      event.target.value = "";
      return;
    }

    setUploading(category);
    setError("");

    try {
      const selectedFiles = Array.from(files).slice(0, remaining);
      const formData = new FormData();
      formData.append("category", category);
      selectedFiles.forEach((file) => formData.append("files", file));

      const response = await fetch("/api/uploads", { method: "POST", body: formData });
      const data = await readApiJson<UploadResult>(response);
      if (!response.ok || !data.ok) throw new Error(data.message || data.rejected?.[0]?.reason || "上传失败");

      setReferences((prev) => ({
        ...prev,
        [category]: [
          ...prev[category],
          ...(data.files || []).map((item) => ({
            ...item,
            url: normalizeLocalUrl(item.url),
          })),
        ],
      }));

      const uploadWarnings = [
        files.length > remaining ? `${config?.title || "该分类"}最多上传 ${max} 张，本次只保留前 ${remaining} 张。` : "",
        ...(data.rejected || []).map((item) => `${item.name}：${item.reason}`),
      ].filter(Boolean);

      if (uploadWarnings.length > 0) {
        setError(uploadWarnings.join("\n"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading("");
      event.target.value = "";
    }
  }

  function removeReference(category: ReferenceCategory, url: string) {
    setReferences((prev) => ({
      ...prev,
      [category]: prev[category].filter((item) => item.url !== url),
    }));
  }

  function buildGeneratePayload(options?: {
    prompt?: string;
    selectedImageUrl?: string;
    conversation?: ApiConversationMessage[];
    countOverride?: number;
  }) {
    return {
      prompt: options?.prompt || prompt,
      model,
      size,
      sizeMode,
      customWidth,
      customHeight,
      count: options?.countOverride || count,
      selectedImageUrl: options?.selectedImageUrl,
      referenceImages: useReferenceImage ? referenceImages.map((item) => ({
        category: item.category,
        url: item.url,
        name: item.name,
      })) : [],
      useReferenceImage,
      conversation: serializeRecentMessages(options?.conversation || activeMessages),
    };
  }

  async function sendChat() {
    const text = chatDraft.trim();
    if (!text) return;

    const conversationId = ensureConversation();
    const currentMessages = conversations.find((item) => item.id === conversationId)?.messages || [];
    const userMessage: ChatMessage = { id: uid("msg"), role: "user", content: text, time: nowText() };

    setChatDraft("");
    setChatLoading(true);
    setError("");
    appendMessages(conversationId, [userMessage], text);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          model: settings.promptOptimizerModel,
          conversation: serializeRecentMessages(currentMessages),
          mode: "chat",
          selectedImageUrl: selectedImage?.url,
        }),
      });

      const data = await readApiJson<ChatResult>(response);
      if (!response.ok || !data.ok) throw new Error(data.shortReason || data.message || "对话失败");

      appendMessages(conversationId, [
        { id: uid("msg"), role: "assistant", content: data.reply || "我已收到。", time: nowText() },
      ]);
    } catch (err) {
      appendMessages(conversationId, [
        { id: uid("msg"), role: "assistant", content: err instanceof Error ? err.message : "对话失败", time: nowText() },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  async function generateImages(options?: {
    prompt?: string;
    selectedImageUrl?: string;
    countOverride?: number;
    userText?: string;
    throwOnError?: boolean;
  }) {
    const conversationId = ensureConversation();
    const currentMessages = conversations.find((item) => item.id === conversationId)?.messages || [];
    const finalPrompt = options?.prompt || prompt;
    const userText = options?.userText || finalPrompt;
    const targetCount = options?.countOverride || count;

    setLoading(true);
    setGenerationSource(options?.selectedImageUrl ? "selected" : "main");
    setGenerationTargetCount(targetCount);
    setGenerationStartedAt(Date.now());
    setGenerationProgress(`第 1 / ${targetCount} 张准备中，正在提交生成任务...`);
    setError("");
    setResult(null);

    const userMessage: ChatMessage = {
      id: uid("msg"),
      role: "user",
      content: options?.selectedImageUrl ? `基于选中图片优化：${userText}` : `生成图片：${finalPrompt}`,
      time: nowText(),
    };

    appendMessages(conversationId, [userMessage], userText);

    try {
      const response = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildGeneratePayload({
          prompt: finalPrompt,
          selectedImageUrl: options?.selectedImageUrl,
          countOverride: options?.countOverride,
          conversation: serializeRecentMessages(currentMessages),
        })),
      });
      const data = await readApiJson<GenerateResult>(response);
      if (!response.ok || !data.ok) throw new Error(data.shortReason || data.message || "生成失败");

      setResult(data);
      const nextImages = data.images || [];
      const normalizedNextImages = nextImages.map((item) => ({ ...item, url: normalizeLocalUrl(item.url) }));
      setGeneratedImages((prev) => {
        const filteredPrev = prev.filter((item) => !normalizedNextImages.some((next) => next.id === item.id));
        return [...normalizedNextImages, ...filteredPrev];
      });
      if (normalizedNextImages[0]) setSelectedImage(normalizedNextImages[0]);

      const summary = `已完成图片生成：请求 ${data.requestedCount || options?.countOverride || count} 张，成功 ${data.generatedCount || nextImages.length} 张。${data.failures?.length ? `部分失败：${data.failures.map((item) => `第${item.index}张${item.reason}`).join("；")}` : ""}`;
      appendMessages(conversationId, [
        { id: uid("msg"), role: "assistant", content: summary, time: nowText(), images: normalizedNextImages },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成失败";
      setError(message);
      appendMessages(conversationId, [
        { id: uid("msg"), role: "assistant", content: `生成失败：${message}`, time: nowText() },
      ]);
      if (options?.throwOnError) throw err;
    } finally {
      setLoading(false);
      setGenerationSource(null);
      setGenerationProgress("");
      setGenerationStartedAt(null);
    }
  }

  async function optimizePrompt() {
    const basePrompt = prompt.trim();
    const userText = contextDraft.trim();
    if (!basePrompt && !userText) {
      setError("请先输入主提示词，或在优化提示词输入中写下你的作图需求。");
      return;
    }

    setPromptOptimizing(true);
    setError("");

    const optimizeInstruction = userText || "请结合当前对话和参考图，优化当前提示词。";
    const conversationId = ensureConversation();
    const currentMessages = conversations.find((item) => item.id === conversationId)?.messages || [];

    try {
      const response = await fetch("/api/prompt/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: basePrompt,
          userMessage: optimizeInstruction,
          selectedImageUrl: selectedImage?.url,
          referenceImages: referenceImages.map((item) => ({ category: item.category, url: item.url, name: item.name })),
          conversation: serializeRecentMessages(currentMessages),
          model: settings.promptOptimizerModel,
        }),
      });
      const data = await readApiJson<{ ok: boolean; optimizedPrompt?: string; reply?: string; shortReason?: string; message?: string }>(response);
      if (!data.ok) throw new Error(data.shortReason || data.message || "提示词优化失败");

      if (!data.optimizedPrompt) throw new Error("提示词优化没有返回有效结果");
      setPrompt(data.optimizedPrompt);
      appendMessages(conversationId, [
        { id: uid("msg"), role: "user", content: optimizeInstruction, time: nowText() },
        { id: uid("msg"), role: "assistant", content: data.reply || "已优化提示词。", time: nowText() },
      ], optimizeInstruction);
      setContextDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "提示词优化失败");
    } finally {
      setPromptOptimizing(false);
    }
  }

  async function optimizeSelectedImageAndGenerate() {
    if (!selectedImage) return;
    const userText = imageDraft.trim();
    if (!userText) return;

    setImageOptimizing(true);
    setError("");

    const conversationId = ensureConversation();
    const currentMessages = conversations.find((item) => item.id === conversationId)?.messages || [];

    try {
      const response = await fetch("/api/prompt/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          userMessage: userText,
          selectedImageUrl: selectedImage.url,
          referenceImages: referenceImages.map((item) => ({ category: item.category, url: item.url, name: item.name })),
          conversation: serializeRecentMessages(currentMessages),
          model: settings.promptOptimizerModel,
        }),
      });

      const data = await readApiJson<{ ok: boolean; optimizedPrompt?: string; shortReason?: string; message?: string }>(response);
      if (!data.ok) throw new Error(data.shortReason || data.message || "单图优化失败");
      if (!data.optimizedPrompt) throw new Error("单图优化没有返回有效提示词");

      const optimizedPrompt = data.optimizedPrompt;
      setImageDraft("");
      setImageOptimizing(false);
      try {
        await generateImages({
          prompt: optimizedPrompt,
          selectedImageUrl: selectedImage.url,
          countOverride: refineCount,
          userText,
          throwOnError: true,
        });
      } catch {
        setError((prev) => prev ? `提示词已优化，但生成失败：${prev}` : "提示词已优化，但生成失败。请检查上方错误信息后重试。");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "单图优化失败");
    } finally {
      setImageOptimizing(false);
    }
  }

  async function downloadImage(image: GeneratedImage, format: "png" | "jpeg") {
    if (format === "png") {
      const link = document.createElement("a");
      link.href = image.url;
      link.download = `taijitu-${image.id}.png`;
      link.click();
      return;
    }

    const htmlImage = new Image();
    htmlImage.crossOrigin = "anonymous";
    htmlImage.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = htmlImage.naturalWidth;
      canvas.height = htmlImage.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(htmlImage, 0, 0);
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/jpeg", 0.92);
      link.download = `taijitu-${image.id}.jpg`;
      link.click();
    };
    htmlImage.src = image.url;
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <img className="brand-logo" src="/brand/logo.png" alt="太极图" onError={hideBrokenImage} />
          <div className="brand-fallback">
            <div className="brand-en">EastWill Studio</div>
          </div>
        </div>

        <button className="primary-nav" type="button" onClick={createNewConversation}>新对话</button>

        <div className="conversation-list">
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`conversation-item ${activeConversationId === conversation.id ? "active" : ""}`}
            >
              <button
                className="conversation-open"
                type="button"
                onClick={() => {
                  setActiveConversationId(conversation.id);
                  setMode("chat");
                }}
              >
                <span>{conversation.title}</span>
                <small>{conversation.messages.length} 条{isAdmin && conversation.ownerLabel ? ` · ${conversation.ownerLabel}` : ""}</small>
              </button>

              <button
                className="conversation-delete"
                type="button"
                title="删除对话"
                onClick={(event) => {
                  event.stopPropagation();
                  deleteConversation(conversation.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <button className="nav-item" type="button" onClick={() => setMode("draw")}>工作台</button>
        {isAdmin ? <button className="nav-item" type="button" onClick={() => { setShowSettings(true); void loadAccessCodes(); }}>设置</button> : null}

        <div className="space-card">
          <strong>EastWill 空间</strong>
          <span>EW·{accessSession?.label || "未登录"}</span>
          <button type="button" className="logout-link" onClick={() => void logoutAccess()}>退出口令</button>
          <div className="meter"><i /></div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <button className="version-pill" type="button">● 太极图1.0</button>
          <div className="mode-switch">
            <button type="button" className={mode === "chat" ? "active" : ""} onClick={() => setMode("chat")}>对话</button>
            <button type="button" className={mode === "draw" ? "active" : ""} onClick={() => setMode("draw")}>作图</button>
          </div>
          <div className="top-actions">
            <button type="button">⌕</button>
            <button type="button">□</button>
            <button type="button">⌂</button>
            <img src="/brand/seal.png" alt="印章" onError={hideBrokenImage} />
          </div>
        </header>

        <section className="hero compact">
          <img className="seal" src="/brand/seal.png" alt="印章" onError={hideBrokenImage} />
          <h1>太极图</h1>
          <p>以平衡之道，组织审美与灵感</p>
          <div className="quick-grid">
            {quickCards.map((card) => (
              <button
                key={card.title}
                className="quick-card"
                type="button"
                onClick={() => {
                  if (card.prompt) setPrompt(card.prompt);
                  setMode(card.title === "图片生成" ? "draw" : "chat");
                  if (card.title !== "图片生成") setChatDraft(card.prompt);
                }}
              >
                <strong>{card.title}</strong>
                <span>{card.desc}</span>
                
              </button>
            ))}
          </div>
        </section>

        {mode === "chat" ? (
          <section className="chat-workspace panel">
            <div className="panel-head">
              <div>
                <h2>{activeConversation?.title || "新对话"}</h2>
                <p>使用 {settings.promptOptimizerModel} 进行上下文对话，也可以让它辅助构建作图提示词。</p>
              </div>
            </div>
            <div className="chat-thread">
              {activeMessages.length === 0 ? (
                <div className="empty-chat">开始新的对话。你可以直接提问，也可以让太极图帮你构思图片。</div>
              ) : null}
              {activeMessages.map((message) => (
                <article key={message.id} className={`chat-message ${message.role}`}>
                  <div className="bubble">
                    <p>{message.content}</p>
                    {message.images?.length ? (
                      <div className="message-images">
                        {message.images.map((image) => (
                          <button
                            key={image.id}
                            type="button"
                            onClick={() => openMessageImagesInDraw(message.images || [], image)}
                          >
                            <img src={normalizeLocalUrl(image.url)} alt="对话图片" />
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <small>{message.time}</small>
                  </div>
                </article>
              ))}
              {chatLoading ? <div className="chat-message assistant"><div className="bubble"><p>正在思考...</p></div></div> : null}
              <div ref={messageEndRef} />
            </div>
            <div className="chat-input-row">
              <textarea
                value={chatDraft}
                placeholder="给太极图发送消息..."
                onChange={(event) => setChatDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendChat();
                  }
                }}
              />
              <button className="primary-btn" type="button" disabled={chatLoading || !chatDraft.trim()} onClick={sendChat}>发送</button>
            </div>
          </section>
        ) : (
          <section className="workspace">
            <section className="panel composer-panel">
              <div className="panel-head">
                <div>
                  <h2>AI 作图工作台</h2>
                  <p>支持分类参考图、多张生成、上下文优化、选中图片单独对话优化。</p>
                </div>
                {isAdmin ? <button className="secondary-btn" type="button" onClick={() => { setShowSettings(true); void loadAccessCodes(); }}>设置</button> : null}
              </div>

              <div className="form-grid two">
                <label>
                  <span>模型</span>
                  <select value={model} onChange={(event) => setModel(event.target.value)}>
                    {settings.imageModels.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}（{item.id}）</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>生成张数</span>
                  <select value={count} onChange={(event) => setCount(Number(event.target.value))}>
                    {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value} 张</option>)}
                  </select>
                </label>
              </div>

              <label className="field-block">
                <span>主提示词</span>
                <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入作图提示词..." />
              </label>

              <section className="prompt-optimize-box">
                <label className="field-block compact">
                  <span>优化提示词输入</span>
                  <textarea value={contextDraft} placeholder="例如：更像宋代山水，画面更留白，品牌感更强..." onChange={(event) => setContextDraft(event.target.value)} />
                </label>
                <div className="button-row prompt-actions">
                  <button className="secondary-btn" type="button" disabled={promptOptimizing || imageOptimizing || loading} onClick={optimizePrompt}>{promptOptimizing ? "优化中..." : "优化提示词"}</button>
                  <button className="primary-btn" type="button" disabled={loading || !prompt.trim()} onClick={() => void generateImages()}>{mainGenerating ? "生成中..." : "开始生成"}</button>
                </div>
                {(promptOptimizing || mainGenerating) ? (
                  <div className="inline-loading">
                    <img src="/brand/loading.gif" alt="加载中" />
                    <span>{promptOptimizing ? "正在优化提示词..." : generationProgress || "正在生成图片..."}</span>
                  </div>
                ) : null}
              </section>

              <div className="form-grid three">
                <label>
                  <span>尺寸模式</span>
                  <select value={sizeMode} onChange={(event) => setSizeMode(event.target.value as "preset" | "custom")}>
                    <option value="preset">默认尺寸</option>
                    <option value="custom">自定义尺寸</option>
                  </select>
                </label>
                {sizeMode === "preset" ? (
                  <label className="span-two">
                    <span>尺寸</span>
                    <select value={size} onChange={(event) => setSize(event.target.value)}>
                      <option value="1920x1080">1920 × 1080</option>
                      <option value="2560x1440">2560 × 1440</option>
                      <option value="3840x2160">3840 × 2160</option>
                      <option value="1080x1920">1080 × 1920</option>
                      <option value="1080x1440">1080 × 1440</option>
                      <option value="1080x1080">1080 × 1080</option>
                      <option value="1440x1080">1440 × 1080</option>
                      <option value="800x800">800 × 800</option>
                      <option value="1000x1000">1000 × 1000</option>
                    </select>
                  </label>
                ) : (
                  <>
                    <label><span>宽度</span><input type="number" min={1} max={8192} value={customWidth} onChange={(event) => setCustomWidth(Number(event.target.value))} /></label>
                    <label><span>高度</span><input type="number" min={1} max={8192} value={customHeight} onChange={(event) => setCustomHeight(Number(event.target.value))} /></label>
                  </>
                )}
              </div>

              <section className="reference-box">
                <div className="reference-head">
                  <div>
                    <h3>分类参考图</h3>
                    <p>每类可为空；生成时会按分类额外重视。其他为万能参考。</p>
                  </div>
                  <label className="check-line"><input type="checkbox" checked={useReferenceImage} onChange={(event) => setUseReferenceImage(event.target.checked)} /> 启用参考图</label>
                </div>
                <div className="reference-category-grid">
                  {referenceCategories.map((category) => (
                    <div key={category.id} className="reference-category-card">
                      <div className="reference-category-title">
                        <strong>{category.title}</strong>
                        <small>{references[category.id].length}/{category.max}</small>
                      </div>
                      <p>{category.desc}</p>
                      <label className="upload-btn compact">
                        {uploading === category.id ? "上传中..." : "上传"}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          multiple
                          disabled={uploading === category.id || references[category.id].length >= category.max}
                          onChange={(event) => void uploadReferences(category.id, event)}
                        />
                      </label>
                      <div className="reference-list small">
                        {references[category.id].map((item) => (
                          <button key={item.url} type="button" onClick={() => removeReference(category.id, item.url)} title="点击移除">
                            <img src={normalizeLocalUrl(item.url)} alt={item.name} />
                            <span>移除</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="context-box">
                <h3>上下文对话</h3>
                <p>当前对话会作为作图上下文。</p>
                <div className="generation-status">{buildGenerationStatus(result, loading, generationTargetCount, generationProgress)}</div>
              </section>

              {error ? <div className="error-line">{error}</div> : null}
              {result?.warnings?.map((item) => <div key={item} className="warn-line">{item}</div>)}
            </section>

            <section className="panel result-panel">
              <div className="panel-head">
                <div>
                  <h2>生成结果</h2>
                  <p>点击图片可选中，并进行单图对话优化。</p>
                </div>
              </div>

              {generatedImages.length === 0 || !selectedImage ? (
                <div className="empty-result">生成后的图片会显示在这里。</div>
              ) : (
                <div className="result-gallery">
                  <section className="gallery-stage">
                    <button type="button" className="gallery-stage-image-wrap" onClick={() => setSelectedImage(selectedImage)} title="当前选中图片">
                      <img src={normalizeLocalUrl(selectedImage.url)} alt="当前选中图片" className="gallery-stage-image" />
                    </button>
                    <div className="gallery-stage-toolbar">
                      <div>
                        <strong>当前展示</strong>
                        <small>{getImageSizeText(selectedImage)}</small>
                      </div>
                      <div className="gallery-downloads">
                        <button type="button" onClick={() => void downloadImage(selectedImage, "png")}>PNG</button>
                        <button type="button" onClick={() => void downloadImage(selectedImage, "jpeg")}>JPEG</button>
                      </div>
                    </div>
                    {isPreviewLikelyBlurry(selectedImage) ? (
                      <div className="result-note">当前图片本身像素较小，放大预览会显得模糊。若想更清晰，建议提升生成尺寸，或在主提示词中正向强调“主体清晰、准确对焦、高清细节”。</div>
                    ) : null}
                  </section>

                  <section className="gallery-thumbs">
                    <div className="gallery-thumbs-head">
                      <span>缩略图</span>
                      <small>当前大图为下方“单独优化”的对象。</small>
                    </div>
                    <div className="gallery-thumb-list">
                      {generatedImages.map((image, index) => (
                        <button
                          key={image.id}
                          type="button"
                          className={`gallery-thumb ${selectedImage?.id === image.id ? "active" : ""}`}
                          onClick={() => setSelectedImage(image)}
                        >
                          <img src={normalizeLocalUrl(image.url)} alt={`作品 ${index + 1}`} />
                          <span>作品 {generatedImages.length - index}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              )}

              <section className="selected-dialogue">
                <h3>选中图片单独优化</h3>
                {selectedImage ? (
                  <>
                    <div className="selected-row">
                      <img src={normalizeLocalUrl(selectedImage.url)} alt="选中图片" />
                      <div>
                        <strong>当前选中图片</strong>
                        <p>当前上方大图就是优化对象，这里独立控制优化张数。</p>
                      </div>
                    </div>
                    <label className="field-block refine-count">
                      <span>优化生成张数</span>
                      <select value={refineCount} onChange={(event) => setRefineCount(Number(event.target.value))}>
                        {Array.from({ length: 4 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value} 张</option>)}
                      </select>
                    </label>
                    <textarea value={imageDraft} placeholder="例如：保留主体，增加星系背景，整体更梦幻但不要改变猫的姿态..." onChange={(event) => setImageDraft(event.target.value)} />
                    <button className="primary-btn full" type="button" disabled={imageOptimizing || loading || !imageDraft.trim()} onClick={optimizeSelectedImageAndGenerate}>
                      {imageOptimizing || selectedGenerating ? "处理中..." : "优化选中图片并生成"}
                    </button>
                    {(imageOptimizing || selectedGenerating) ? (
                      <div className="inline-loading selected-loading">
                        <img src="/brand/loading.gif" alt="加载中" />
                        <span>{imageOptimizing ? "正在优化选中图片..." : generationProgress || "正在生成图片..."}</span>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="muted">请先在上方结果中点击一张图片。</p>
                )}
              </section>
            </section>
          </section>
        )}
      </section>

      {showSettings && isAdmin ? (
        <div className="settings-mask" onClick={() => setShowSettings(false)}>
          <section className="settings-panel" onClick={(event) => event.stopPropagation()}>
            <div className="panel-head">
              <div><h2>管理员设置</h2><p>模型、并发和口令管理。</p></div>
              <button type="button" onClick={() => setShowSettings(false)}>关闭</button>
            </div>
            {isAdmin ? (
              <>
                <label><span>默认图片模型</span><select value={settings.defaultImageModel} onChange={(event) => void saveSettings({ defaultImageModel: event.target.value })}>{settings.imageModels.map((item) => <option key={item.id} value={item.id}>{item.name}（{item.id}）</option>)}</select></label>
                <label><span>提示词/对话模型</span><input value={settings.promptOptimizerModel} onChange={(event) => setSettings((prev) => ({ ...prev, promptOptimizerModel: event.target.value }))} onBlur={(event) => void saveSettings({ promptOptimizerModel: event.target.value })} /></label>
                <label><span>团队最大并发生成数（建议 8-12，最高 20）</span><input type="number" min={1} max={20} value={settings.maxConcurrentGenerations} onChange={(event) => void saveSettings({ maxConcurrentGenerations: Number(event.target.value) })} /></label>
                <label className="check-line"><input type="checkbox" checked={settings.allowReferenceImageEdit} onChange={(event) => void saveSettings({ allowReferenceImageEdit: event.target.checked })} /> 选中图片优化时优先尝试图片编辑接口，失败后自动转文字生成</label>

                <section className="access-admin-box">
                  <button className="access-admin-toggle" type="button" onClick={() => { setShowAccessAdmin((prev) => !prev); if (!showAccessAdmin) void loadAccessCodes(); }}>
                    <span>口令管理</span>
                    <small>{showAccessAdmin ? "收起" : "展开"}</small>
                  </button>
                  {showAccessAdmin ? (
                    <div className="access-admin-content">
                      <div className="form-grid three">
                        <label><span>名称</span><input value={newCodeLabel} onChange={(event) => setNewCodeLabel(event.target.value)} placeholder="例如：设计组" /></label>
                        <label><span>新口令</span><input value={newCodeValue} onChange={(event) => setNewCodeValue(event.target.value)} placeholder="至少 4 位" /></label>
                        <label><span>权限</span><select value={newCodeRole} onChange={(event) => setNewCodeRole(event.target.value as "USER" | "ADMIN")}><option value="USER">普通用户</option><option value="ADMIN">管理员</option></select></label>
                      </div>
                      <button className="primary-btn" type="button" onClick={() => void createAccessCode()}>新增口令</button>
                      <div className="access-code-list">
                        {accessCodes.map((item) => (
                          <div key={item.id} className="access-code-row">
                            <div>
                              <strong>{item.label}</strong>
                              <small>{item.role === "ADMIN" ? "管理员" : "普通用户"} · 对话 {item._count?.conversations || 0} 个{item.lastUsedAt ? ` · 最近使用 ${new Date(item.lastUsedAt).toLocaleString("zh-CN")}` : ""}</small>
                            </div>
                            <button type="button" onClick={() => void deleteAccessCode(item.id)} disabled={item.id === accessSession?.id}>删除</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>
              </>
            ) : null}
          </section>
        </div>
      ) : null}

      {!accessSession ? (
        <div className="access-gate">
          <section className="access-card">
            <img src="/brand/seal.png" alt="太极图" onError={hideBrokenImage} />
            <h1>访问口令</h1>
            <p>口令正确后会自动进入工作台。</p>
            <input
              value={accessCodeInput}
              autoFocus
              placeholder="输入口令"
              disabled={accessChecking || accessSubmitting}
              onChange={(event) => {
                const value = event.target.value;
                setAccessCodeInput(value);
                if (accessSubmitTimerRef.current) window.clearTimeout(accessSubmitTimerRef.current);
                if (value.trim().length === 0) setAccessMessage("");
                else if (value.trim().length < 4) setAccessMessage("口令太短，请继续输入。");
                else if (value.trim().length > 64) setAccessMessage("口令太长，请检查是否多输了字符。");
                else accessSubmitTimerRef.current = window.setTimeout(() => void submitAccessCode(value), 350);
              }}
            />
            <small>{accessChecking ? "正在检查登录状态..." : accessMessage}</small>
          </section>
        </div>
      ) : null}
    </main>
  );
}

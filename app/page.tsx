"use client";

import {
  Bell,
  Bot,
  Check,
  ChevronRight,
  Copy,
  FileArchive,
  FileText,
  ImageIcon,
  KeyRound,
  LayoutDashboard,
  Library,
  MessageSquare,
  PanelLeft,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  Table2,
  Trash2,
  Upload,
  Download,
  LogOut,
  Maximize2,
  WandSparkles,
  ZoomIn,
  ZoomOut,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";

type WorkspaceMode = "dashboard" | "chat" | "draw" | "assets" | "admin";
type ReferenceCategory = "composition" | "color" | "material" | "lighting" | "other";
type SizeMode = "preset" | "custom";
type DownloadFormat = "png" | "jpg";
type ImageInputFidelity = "high" | "low";
type BusyAction = "chat" | "optimize" | "generate" | "edit" | "complete" | null;

type ImageModelOption = {
  id: string;
  name: string;
  note?: string;
};

type TextModelOption = {
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
  textModels: TextModelOption[];
};

type GeneratedImage = {
  id: string;
  ownerAccessCodeId?: string | null;
  url: string;
  width: number | null;
  height: number | null;
  seed: string | null;
  ownerLabel?: string;
  ownerRole?: "USER" | "ADMIN" | null;
  prompt?: string;
  model?: string;
  size?: string;
};

type AttachmentMaterial = {
  summary: string;
  keyFacts: string[];
  entities: string[];
  visualNotes: string[];
  tables: Array<{ name: string; columns: string[]; sampleRows: string[]; notes: string[] }>;
  promptHints: string[];
  warnings: string[];
};

type UploadedAttachment = {
  id: string;
  url: string | null;
  name: string;
  type: string;
  mimeType: string;
  size: number;
  kind: "IMAGE" | "DOCUMENT" | "SPREADSHEET" | "TEXT" | "OTHER";
  status: "PROCESSING" | "READY" | "FAILED";
  summary: string;
  materials: AttachmentMaterial;
  warnings: string[];
};

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
  attachments?: UploadedAttachment[];
};

type ChatConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  ownerAccessCodeId?: string;
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
  displayCode?: string | null;
  role: "USER" | "ADMIN";
  createdAt: string;
  lastUsedAt: string | null;
  _count?: { conversations: number };
};

type ApiResult<T> = T & {
  ok: boolean;
  message?: string;
  shortReason?: string;
};

type ImageJobPollResult = {
  jobId: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "PARTIAL_SUCCEEDED" | "FAILED";
  model: string;
  size: string;
  requestedCount: number;
  generatedCount: number;
  images: GeneratedImage[];
  failures?: Array<{ index: number; reason: string }>;
  notes?: Array<{ index: number; message: string }>;
  warnings?: string[];
  errorMessage?: string | null;
};

const storageKey = "taijitu.conversations.v5";
const sessionStorageKey = (sessionId: string) => `${storageKey}.${sessionId}`;

const fallbackSettings: AppSettings = {
  maxConcurrentGenerations: 8,
  defaultImageModel: "gpt-image-2",
  promptOptimizerModel: "gpt-5.4",
  allowReferenceImageEdit: true,
  imageModels: [
    { id: "gpt-image-2", name: "GPT Image 2", note: "默认" },
    { id: "gpt-image-1.5", name: "GPT Image 1.5" },
    { id: "gpt-image-1", name: "GPT Image 1" },
  ],
  textModels: [
    { id: "gpt-5.5", name: "GPT-5.5", note: "高质量推理" },
    { id: "gpt-5.4", name: "GPT-5.4", note: "默认文本模型" },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { id: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark" },
    { id: "gpt-5.2", name: "GPT-5.2" },
  ],
};

const referenceCategories: Array<{ id: ReferenceCategory; title: string; max: number; desc: string }> = [
  { id: "composition", title: "构图", max: 2, desc: "控制画面结构与视角" },
  { id: "color", title: "色彩", max: 2, desc: "提取配色、明度和氛围" },
  { id: "material", title: "材质", max: 2, desc: "指定纹理、质感和表面" },
  { id: "lighting", title: "光影", max: 2, desc: "参考光源、阴影和层次" },
  { id: "other", title: "其他", max: 4, desc: "人物、产品或附加参考" },
];

const emptyReferences: Record<ReferenceCategory, UploadedReference[]> = {
  composition: [],
  color: [],
  material: [],
  lighting: [],
  other: [],
};

const inspirationTags = ["东方留白", "商业海报", "太极图形", "新中式", "高级材质"];
const generationSteps = [
  "正在分析用户意图",
  "正在锁定参考图片主体",
  "正在提取画面主体",
  "正在匹配图像风格",
  "正在生成更优质的图像",
  "正在进行最后一步精修",
];
const generationCompleteText = "图片已生成完成，即将显示页面";

function uid(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowText() {
  return new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function nowIso() {
  return new Date().toISOString();
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function titleFrom(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (isHtmlDocument(clean)) return "接口返回异常";
  return clean ? clean.slice(0, 24) : "新对话";
}

function isHtmlDocument(text: string) {
  const normalized = text.trim().slice(0, 5000).toLowerCase();
  return (
    normalized.startsWith("<!doctype html") ||
    (normalized.startsWith("<html") && normalized.includes("<head")) ||
    (normalized.includes("<script") && normalized.includes("window.__app_config__")) ||
    (normalized.includes("<div id=\"app\"") && normalized.includes("/assets/"))
  );
}

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T;
  if (!response.ok) {
    const payload = data as { message?: unknown; shortReason?: unknown };
    const shortReason = typeof payload.shortReason === "string" ? payload.shortReason : "";
    const detail = typeof payload.message === "string" ? payload.message : "";
    const message = shortReason && detail && shortReason !== detail ? `${shortReason}\n${detail}` : shortReason || detail || "请求失败";
    throw new Error(message);
  }
  return data;
}

function flattenReferences(references: Record<ReferenceCategory, UploadedReference[]>) {
  return referenceCategories.flatMap((category) => references[category.id]);
}

function readStoredConversations(sessionId?: string | null) {
  if (typeof window === "undefined") return [];
  if (!sessionId) return [];
  const saved = window.localStorage.getItem(sessionStorageKey(sessionId));
  if (!saved) return [];

  try {
    return JSON.parse(saved) as ChatConversation[];
  } catch {
    window.localStorage.removeItem(sessionStorageKey(sessionId));
    return [];
  }
}

function attachmentIcon(kind: UploadedAttachment["kind"]) {
  if (kind === "IMAGE") return ImageIcon;
  if (kind === "SPREADSHEET") return Table2;
  if (kind === "DOCUMENT") return FileText;
  return FileArchive;
}

function LoadingMark(props: { label?: string; compact?: boolean }) {
  return (
    <span className={`loading-mark ${props.compact ? "compact" : ""}`}>
      <img src="/brand/jiazai1.gif" alt="" />
      {props.label ? <span>{props.label}</span> : null}
    </span>
  );
}

function MessageText(props: { content: string }) {
  if (isHtmlDocument(props.content)) {
    return (
      <div className="message-warning">
        <strong>上游接口返回了网页源码</strong>
        <span>这通常是 AI_RELAY_BASE_URL 指到了网关页面或登录页，而不是 OpenAI 兼容 API 地址。</span>
      </div>
    );
  }

  return <p>{props.content}</p>;
}

export default function Home() {
  const [mode, setMode] = useState<WorkspaceMode>("dashboard");
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings);
  const [session, setSession] = useState<AccessSession | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [sharedPrompt, setSharedPrompt] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [model, setModel] = useState(fallbackSettings.defaultImageModel);
  const [size, setSize] = useState("1920x1080");
  const [sizeMode, setSizeMode] = useState<SizeMode>("preset");
  const [customWidth, setCustomWidth] = useState(1920);
  const [customHeight, setCustomHeight] = useState(1080);
  const [count, setCount] = useState(4);
  const [editCount, setEditCount] = useState(1);
  const [inputFidelity, setInputFidelity] = useState<ImageInputFidelity>("high");
  const [downloadFormat, setDownloadFormat] = useState<DownloadFormat>("png");
  const [references, setReferences] = useState<Record<ReferenceCategory, UploadedReference[]>>(emptyReferences);
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [previewImage, setPreviewImage] = useState<GeneratedImage | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [generationStepIndex, setGenerationStepIndex] = useState(0);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [uploadingReference, setUploadingReference] = useState<ReferenceCategory | "">("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState("");
  const [accessCodes, setAccessCodes] = useState<AccessCodeItem[]>([]);
  const [newCodeLabel, setNewCodeLabel] = useState("");
  const [newCodeValue, setNewCodeValue] = useState("");
  const [newCodeRole, setNewCodeRole] = useState<"USER" | "ADMIN">("USER");
  const [savingSettings, setSavingSettings] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);

  const referenceImages = useMemo(() => flattenReferences(references), [references]);
  const loading = busyAction !== null;
  const generationStep = busyAction === "complete"
    ? generationCompleteText
    : generationSteps[Math.min(generationStepIndex, generationSteps.length - 1)];

  const visibleConversations = useMemo(
    () => session
      ? session.role === "ADMIN"
        ? conversations
        : conversations.filter((conversation) => !conversation.ownerAccessCodeId || conversation.ownerAccessCodeId === session.id)
      : [],
    [conversations, session],
  );
  const visibleImages = useMemo(
    () => session
      ? session.role === "ADMIN"
        ? generatedImages
        : generatedImages.filter((image) => !image.ownerAccessCodeId || image.ownerAccessCodeId === session.id)
      : [],
    [generatedImages, session],
  );
  const activeConversation = useMemo(
    () => visibleConversations.find((conversation) => conversation.id === activeConversationId) || null,
    [activeConversationId, visibleConversations],
  );
  const activeMessages = activeConversation?.messages || [];
  const selectedImages = useMemo(
    () => visibleImages.filter((image) => selectedImageIds.includes(image.id)),
    [selectedImageIds, visibleImages],
  );
  const selectedImageUrl = selectedImageIds.length === 1 && selectedImage ? selectedImage.url : undefined;
  const conversationSyncSignature = useMemo(
    () => visibleConversations.map((conversation) => `${conversation.id}:${conversation.updatedAt}:${conversation.messages.length}`).join("|"),
    [visibleConversations],
  );

  const loadConversations = useCallback(async (accessSession?: AccessSession | null) => {
    const currentSession = accessSession || session;
    if (!currentSession) return;
    try {
      const data = await readJson<{ ok: boolean; conversations: ChatConversation[] }>(
        await fetch("/api/conversations", { cache: "no-store" }),
      );
      const nextConversations = currentSession.role === "ADMIN"
        ? data.conversations || []
        : (data.conversations || []).filter(
          (conversation) => !conversation.ownerAccessCodeId || conversation.ownerAccessCodeId === currentSession.id,
        );
      setConversations(nextConversations);
      setActiveConversationId((current) => current && nextConversations.some((item) => item.id === current) ? current : nextConversations[0]?.id || null);
    } catch {
      const cached = readStoredConversations(currentSession.id);
      setConversations(cached);
      setActiveConversationId((current) => current && cached.some((item) => item.id === current) ? current : cached[0]?.id || null);
    }
  }, [session]);

  const loadImages = useCallback(async (accessSession?: AccessSession | null) => {
    const currentSession = accessSession || session;
    if (!currentSession) return;
    try {
      const data = await readJson<{ ok: boolean; images: GeneratedImage[] }>(
        await fetch("/api/images", { cache: "no-store" }),
      );
      const nextImages = currentSession.role === "ADMIN"
        ? data.images || []
        : (data.images || []).filter((image) => !image.ownerAccessCodeId || image.ownerAccessCodeId === currentSession.id);
      setGeneratedImages(nextImages);
      setSelectedImageIds((current) => {
        const nextIds = current.filter((id) => nextImages.some((image) => image.id === id));
        setSelectedImage((currentImage) => {
          if (currentImage && nextIds.includes(currentImage.id)) return currentImage;
          return nextIds.length ? nextImages.find((image) => image.id === nextIds[0]) || null : null;
        });
        return nextIds;
      });
    } catch {
      // Image history is optional for the working canvas.
    }
  }, [session]);

  const loadAccessCodes = useCallback(async () => {
    try {
      const data = await readJson<{ ok: boolean; codes: AccessCodeItem[] }>(
        await fetch("/api/access/codes", { cache: "no-store" }),
      );
      setAccessCodes(data.codes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取口令组失败");
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const data = await readJson<{ ok: boolean; settings: AppSettings }>(await fetch("/api/settings"));
      setSettings(data.settings);
      if (data.settings.defaultImageModel) setModel(data.settings.defaultImageModel);
    } catch {
      setSettings(fallbackSettings);
    }
  }, []);

  const loadSession = useCallback(async () => {
    const data = await readJson<{ ok: boolean; authenticated: boolean; session: AccessSession | null }>(
      await fetch("/api/access/session", { cache: "no-store", credentials: "same-origin" }),
    );
    setSession(data.session);
      if (data.authenticated) {
        const cached = readStoredConversations(data.session?.id);
        setConversations(cached);
        setActiveConversationId(cached[0]?.id || null);
        void loadConversations(data.session);
        void loadImages(data.session);
        if (data.session?.role === "ADMIN") void loadAccessCodes();
      }
  }, [loadAccessCodes, loadConversations, loadImages]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    queueMicrotask(() => {
      void loadSettings();
      void loadSession();
    });
  }, [loadSession, loadSettings]);

  useEffect(() => {
    if (!session) return;
    localStorage.setItem(sessionStorageKey(session.id), JSON.stringify(visibleConversations));
    if (visibleConversations.length === 0) return;

    const timer = window.setTimeout(() => {
      void fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversations: visibleConversations.filter(
            (conversation) => !conversation.ownerAccessCodeId || conversation.ownerAccessCodeId === session.id,
          ),
        }),
      }).catch(() => undefined);
    }, 500);

    return () => window.clearTimeout(timer);
  }, [conversationSyncSignature, session, visibleConversations]);

  useEffect(() => {
    if (busyAction !== "generate" && busyAction !== "edit") {
      return;
    }

    const timer = window.setInterval(() => {
      setGenerationStepIndex((index) => Math.min(index + 1, generationSteps.length - 1));
    }, 1800);

    return () => window.clearInterval(timer);
  }, [busyAction]);

  useEffect(() => {
    if (mode !== "chat") return;
    messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [activeMessages.length, busyAction, mode]);

  async function login() {
    const code = accessCode.trim();
    if (!code || loggingIn) return;

    setError("");
    setLoggingIn(true);
    try {
      const data = await readJson<{ ok: boolean; session: AccessSession }>(
        await fetch("/api/access/session", {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        }),
      );
      setSession(data.session);
      setMode("dashboard");
      setAccessCode("");
      const cached = readStoredConversations(data.session.id);
      setConversations(cached);
      setActiveConversationId(cached[0]?.id || null);
      void loadConversations(data.session);
      void loadImages(data.session);
      if (data.session.role === "ADMIN") void loadAccessCodes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "口令验证失败");
    } finally {
      setLoggingIn(false);
    }
  }

  async function logout() {
    setError("");
    await fetch("/api/access/session", { method: "DELETE", cache: "no-store", credentials: "same-origin" }).catch(() => undefined);
    setSession(null);
    setActiveConversationId(null);
    setConversations([]);
    setGeneratedImages([]);
    setAttachments([]);
    setSelectedImage(null);
    setSelectedImageIds([]);
    setPreviewImage(null);
    setBusyAction(null);
    setMode("dashboard");
  }

  async function saveSettings(next: Partial<AppSettings>) {
    if (session?.role !== "ADMIN") return;
    setSavingSettings(true);
    setError("");
    try {
      const data = await readJson<{ ok: boolean; settings: AppSettings }>(
        await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...settings, ...next }),
        }),
      );
      setSettings(data.settings);
      setModel(data.settings.defaultImageModel);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存设置失败");
    } finally {
      setSavingSettings(false);
    }
  }
  async function createAccessCode() {
    if (session?.role !== "ADMIN" || !newCodeLabel.trim() || !newCodeValue.trim()) return;
    setError("");
    try {
      await readJson<{ ok: boolean; code: AccessCodeItem }>(
        await fetch("/api/access/codes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: newCodeLabel.trim(),
            code: newCodeValue.trim(),
            role: newCodeRole,
          }),
        }),
      );
      setNewCodeLabel("");
      setNewCodeValue("");
      setNewCodeRole("USER");
      void loadAccessCodes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "新增口令失败");
    }
  }

  async function deleteAccessCode(id: string) {
    if (session?.role !== "ADMIN") return;
    setError("");
    try {
      await readJson<{ ok: boolean }>(await fetch(`/api/access/codes/${id}`, { method: "DELETE" }));
      void loadAccessCodes();
      void loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除口令失败");
    }
  }

  async function deleteConversation(id: string) {
    setError("");
    try {
      await readJson<{ ok: boolean }>(
        await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
          method: "DELETE",
          cache: "no-store",
          credentials: "same-origin",
        }),
      );
      setConversations((prev) => {
        const next = prev.filter((conversation) => conversation.id !== id);
        setActiveConversationId((current) => current === id ? next[0]?.id || null : current);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除对话失败");
    }
  }

  function ensureConversation(seed = sharedPrompt || "新对话") {
    const existingConversation = activeConversationId
      ? visibleConversations.find((conversation) => conversation.id === activeConversationId)
      : null;
    if (existingConversation) return existingConversation.id;

    const conversation: ChatConversation = {
      id: uid("conversation"),
      title: titleFrom(seed),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      messages: [],
      ownerAccessCodeId: session?.id,
      ownerLabel: session?.label,
      ownerRole: session?.role,
    };
    setConversations((prev) => [conversation, ...prev]);
    setActiveConversationId(conversation.id);
    return conversation.id;
  }

  function appendMessages(id: string, messages: ChatMessage[], seed?: string) {
    setConversations((prev) => {
      const existing = prev.find((conversation) => conversation.id === id);
      if (!existing) {
        return [
          {
            id,
            title: titleFrom(seed || messages[0]?.content || "新对话"),
            createdAt: nowIso(),
            updatedAt: nowIso(),
            messages,
            ownerAccessCodeId: session?.id,
            ownerLabel: session?.label,
            ownerRole: session?.role,
          },
          ...prev,
        ];
      }

      return prev.map((conversation) => conversation.id === id ? {
        ...conversation,
        title: conversation.title === "新对话" && seed ? titleFrom(seed) : conversation.title,
        updatedAt: nowIso(),
        messages: [...conversation.messages, ...messages],
      } : conversation);
    });
  }

  function serializeConversation(messages: ChatMessage[]) {
    return messages
      .filter((message) => !isHtmlDocument(message.content))
      .slice(-20)
      .map((message) => ({ role: message.role, content: message.content }));
  }

  function showImageInDraw(image: GeneratedImage, replaceSelection = true) {
    setSelectedImage(image);
    if (replaceSelection) setSelectedImageIds([image.id]);
    setGeneratedImages((prev) => (prev.some((item) => item.id === image.id) ? prev : [image, ...prev]));
    setMode("draw");
  }

  function toggleSelectedImage(image: GeneratedImage, multi = false) {
    if (!multi) {
      setSelectedImage(image);
      setSelectedImageIds([image.id]);
      return;
    }

    setSelectedImageIds((prev) => {
      if (prev.includes(image.id)) {
        const nextIds = prev.filter((id) => id !== image.id);
        setSelectedImage(nextIds.length ? visibleImages.find((item) => item.id === nextIds[0]) || null : null);
        return nextIds;
      }

      setSelectedImage(image);
      return [...prev, image.id];
    });
  }

  function openImagePreview(image: GeneratedImage) {
    setPreviewImage(image);
    setPreviewZoom(1);
  }

  function handleGeneratedImageError(imageId: string) {
    setGeneratedImages((prev) => prev.filter((image) => image.id !== imageId));
    setSelectedImage((current) => current?.id === imageId ? null : current);
    setSelectedImageIds((prev) => prev.filter((id) => id !== imageId));
    setPreviewImage((current) => current?.id === imageId ? null : current);
  }

  async function uploadAttachments(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;

    setUploadingAttachment(true);
    setError("");
    try {
      const formData = new FormData();
      formData.set("mode", "attachments");
      if (activeConversationId) formData.set("conversationId", activeConversationId);
      files.forEach((file) => formData.append("files", file));

      const data = await readJson<{
        ok: boolean;
        attachments?: UploadedAttachment[];
        rejected?: Array<{ name: string; reason: string }>;
        message?: string;
      }>(await fetch("/api/uploads", { method: "POST", body: formData }));

      const nextAttachments = data.attachments || [];
      setAttachments((prev) => [...prev, ...nextAttachments]);
      if (data.rejected?.length) setError(data.rejected.map((item) => `${item.name}: ${item.reason}`).join("\n"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "附件上传失败");
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function uploadReference(category: ReferenceCategory, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;

    setUploadingReference(category);
    setError("");
    try {
      const formData = new FormData();
      formData.set("category", category);
      files.forEach((file) => formData.append("files", file));
      const data = await readJson<{
        ok: boolean;
        files?: UploadedReference[];
        rejected?: Array<{ name: string; reason: string }>;
      }>(await fetch("/api/uploads", { method: "POST", body: formData }));
      setReferences((prev) => ({
        ...prev,
        [category]: [...prev[category], ...(data.files || [])].slice(0, referenceCategories.find((item) => item.id === category)?.max || 4),
      }));
      if (data.rejected?.length) setError(data.rejected.map((item) => `${item.name}: ${item.reason}`).join("\n"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "参考图上传失败");
    } finally {
      setUploadingReference("");
    }
  }

  async function sendChat(text = sharedPrompt) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const conversationId = ensureConversation(trimmed);
    const currentMessages = visibleConversations.find((item) => item.id === conversationId)?.messages || [];
    const usedAttachments = attachments;
    const userMessage: ChatMessage = {
      id: uid("message"),
      role: "user",
      content: trimmed,
      time: nowText(),
      attachments: usedAttachments,
    };

    setSharedPrompt("");
    setBusyAction("chat");
    setError("");
    appendMessages(conversationId, [userMessage], trimmed);

    try {
      const data = await readJson<ApiResult<{ reply: string }>>(
        await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            conversation: serializeConversation(currentMessages),
            mode: "image-assistant",
            selectedImageUrl: undefined,
            attachments: usedAttachments,
          }),
        }),
      );
      appendMessages(conversationId, [{ id: uid("message"), role: "assistant", content: data.reply, time: nowText() }]);
    } catch (err) {
      appendMessages(conversationId, [
        { id: uid("message"), role: "assistant", content: err instanceof Error ? err.message : "对话失败", time: nowText() },
      ]);
    } finally {
      setBusyAction(null);
    }
  }

  async function optimizePrompt() {
    const source = sharedPrompt.trim() || materialHints.join("；");
    if (!source || loading) return;
    setBusyAction("optimize");
    setError("");
    try {
      const data = await readJson<ApiResult<{ optimizedPrompt: string }>>(
        await fetch("/api/prompt/optimize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: source,
            userMessage: sharedPrompt,
            selectedImageUrl: mode === "draw" ? selectedImageUrl : undefined,
            referenceImages: referenceImages.map((item) => ({ category: item.category, url: item.url, name: item.name })),
            conversation: serializeConversation(activeMessages),
            attachments,
          }),
        }),
      );
      setSharedPrompt(data.optimizedPrompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "优化失败");
    } finally {
      setBusyAction(null);
    }
  }

  async function waitForImageJob(jobId: string, action: "generate" | "edit") {
    const startedAt = Date.now();
    let delayMs = 1600;

    while (Date.now() - startedAt < 30 * 60 * 1000) {
      await wait(delayMs);
      const data = await readJson<ApiResult<ImageJobPollResult>>(
        await fetch(`/api/images/generate?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" }),
      );

      if (data.status === "SUCCEEDED" || data.status === "PARTIAL_SUCCEEDED") {
        return data;
      }

      if (data.status === "FAILED") {
        throw new Error(data.errorMessage || data.shortReason || "图片生成失败");
      }

      setBusyAction(action);
      delayMs = Math.min(5000, delayMs + 600);
    }

    throw new Error("图片生成仍在后台运行，请稍后刷新生成历史查看结果。");
  }

  async function submitImageJob(body: Record<string, unknown>, action: "generate" | "edit") {
    const submitted = await readJson<ApiResult<ImageJobPollResult & { accepted?: boolean }>>(
      await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

    if (submitted.status === "SUCCEEDED" || submitted.status === "PARTIAL_SUCCEEDED") {
      return submitted;
    }

    if (!submitted.jobId) {
      throw new Error(submitted.message || "图片任务提交失败");
    }

    return waitForImageJob(submitted.jobId, action);
  }

  async function generateImages() {
    const source =
      sharedPrompt.trim() ||
      materialHints.join("；") ||
      attachments.map((item) => item.summary).filter(Boolean).join("；");
    if (!source || loading) return;
    const conversationId = ensureConversation(source);
    const currentMessages = visibleConversations.find((item) => item.id === conversationId)?.messages || [];

    setMode("draw");
    setSelectedImage(null);
    setSelectedImageIds([]);
    setGenerationStepIndex(0);
    setBusyAction("generate");
    setError("");
    appendMessages(conversationId, [{ id: uid("message"), role: "user", content: source, time: nowText(), attachments }], source);

    try {
      const data = await submitImageJob({
        prompt: source,
        model: model || settings.defaultImageModel,
        size,
        sizeMode,
        customWidth,
        customHeight,
        count,
        selectedImageUrl: undefined,
        referenceImages: referenceImages.map((item) => ({ category: item.category, url: item.url, name: item.name })),
        inputFidelity,
        conversation: serializeConversation(currentMessages),
        attachments,
      }, "generate");
      const nextImages = data.images || [];
      setBusyAction("complete");
      setGenerationStepIndex(generationSteps.length - 1);
      await wait(1000);
      setGeneratedImages((prev) => [...nextImages, ...prev]);
      setSelectedImage(nextImages[0] || selectedImage);
      setSelectedImageIds(nextImages[0] ? [nextImages[0].id] : []);
      void loadImages();
      appendMessages(conversationId, [
        {
          id: uid("message"),
          role: "assistant",
          content: `已完成图片生成：请求 ${data.requestedCount || count} 张，成功 ${data.generatedCount || nextImages.length} 张。`,
          time: nowText(),
          images: nextImages,
        },
      ]);
    } catch (err) {
      appendMessages(conversationId, [
        { id: uid("message"), role: "assistant", content: err instanceof Error ? err.message : "生成失败", time: nowText() },
      ]);
    } finally {
      setBusyAction(null);
    }
  }

  function prepareImageGeneration() {
    setMode("draw");
    setError("");
  }

  async function editSelectedImage() {
    if (!(selectedImage || selectedImages.length) || loading) return;
    const source = editPrompt.trim();
    if (!source) {
      setError("请输入图片优化提示词。");
      return;
    }
    const imagesToEdit = selectedImages.length ? selectedImages : selectedImage ? [selectedImage] : [];
    const selectionNote = imagesToEdit.length > 1
      ? `当前共选中 ${imagesToEdit.length} 张图片，本次只基于这些选中图片逐张优化，禁止参考未选中的历史图片。`
      : "当前只选中 1 张图片，本次必须以这张图片作为唯一主图。";
    setGenerationStepIndex(0);
    setBusyAction("edit");
    setError("");
    try {
      const editRequests = imagesToEdit.map(async (image) =>
        submitImageJob({
              prompt: `${selectionNote}\n请基于当前选中的图片进行局部或风格优化，必须保持原图的主体、构图、姿态、主要色彩和画面关系，只按用户要求调整：${source}`,
              model: model || settings.defaultImageModel,
              size,
              sizeMode,
              customWidth,
              customHeight,
              count: editCount,
              selectedImageUrl: image.url,
              referenceImages: [],
              inputFidelity,
              conversation: serializeConversation(activeMessages),
              attachments: [],
              useReferenceImage: true,
        }, "edit"),
      );
      const results = await Promise.all(editRequests);
      const nextImages = results.flatMap((data) => data.images || []);
      setBusyAction("complete");
      setGenerationStepIndex(generationSteps.length - 1);
      await wait(1000);
      setGeneratedImages((prev) => [...nextImages, ...prev]);
      setSelectedImage(nextImages[0] || selectedImage);
      setSelectedImageIds(nextImages.length ? nextImages.map((image) => image.id) : selectedImageIds);
      setEditPrompt("");
      void loadImages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "图片优化失败");
    } finally {
      setBusyAction(null);
    }
  }

  function downloadImage(image: GeneratedImage, format: DownloadFormat) {
    window.open(`/api/images/download?id=${encodeURIComponent(image.id)}&format=${format}`, "_blank");
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  }

  const parsedCount = attachments.filter((item) => item.status === "READY").length;
  const materialHints = attachments.flatMap((item) => item.materials?.promptHints || []).slice(0, 8);

  if (!session) {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <img src="/brand/logo.png" alt="EastWill" />
          <h1>EastWill Studio</h1>
          <p>输入口令进入图像生成工作台</p>
          <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void login(); }}>
            <input
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value)}
              placeholder="访问口令"
              type="password"
              autoComplete="current-password"
            />
            <button type="submit" disabled={loggingIn || !accessCode.trim()}>{loggingIn ? "进入中..." : "进入"}</button>
          </form>
          {error ? <pre className="error-box">{error}</pre> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="eastwill-shell">
      <aside className="eastwill-sidebar">
        <div className="brand-lockup">
          <img src="/brand/logo.png" alt="EastWill" />
          <span>EASTWILL<br />STUDIO</span>
        </div>
        <button className="new-chat" type="button" onClick={() => { setActiveConversationId(null); setMode("chat"); }}>
          <Plus size={18} /> 新对话
        </button>
        <nav className="side-nav">
          {[
            ["dashboard", LayoutDashboard, "总览"],
            ["chat", MessageSquare, "对话"],
            ["draw", ImageIcon, "图像生成"],
            ["assets", Library, "素材库"],
            ...(session.role === "ADMIN" ? [["admin", KeyRound, "管理"]] : []),
          ].map(([id, Icon, label]) => (
            <button key={id as string} className={mode === id ? "active" : ""} type="button" onClick={() => setMode(id as WorkspaceMode)}>
              <Icon size={17} /> {label as string}
            </button>
          ))}
        </nav>
        <div className="conversation-zone">
          <small>近期对话</small>
          <div className="conversation-scroll">
          {visibleConversations.slice(0, 20).map((conversation) => (
            <div key={conversation.id} className={`conversation-item ${activeConversationId === conversation.id ? "active" : ""}`}>
              <button type="button" onClick={() => { setActiveConversationId(conversation.id); setMode("chat"); }}>
                <span>{conversation.title}</span>
                <em>{conversation.messages.length} 条{conversation.ownerLabel ? ` · ${conversation.ownerLabel}` : ""}</em>
              </button>
              <button className="conversation-delete" type="button" title="删除对话" onClick={() => void deleteConversation(conversation.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          </div>
        </div>
        <div className="space-card">
          <strong>EastWill 空间</strong>
          <span>{session.label} · {session.role === "ADMIN" ? "管理员" : "用户"}</span>
          <button className="logout-btn" type="button" onClick={() => void logout()}><LogOut size={14} /> 退出口令</button>
          <div><i style={{ width: `${Math.min(86, 20 + attachments.length * 8)}%` }} /></div>
          <small>附件 {attachments.length} 个 · 生成 {visibleImages.length} 张</small>
        </div>
      </aside>

      <section className="eastwill-main">
        <header className="workspace-topbar">
          <button type="button" className="ghost-icon"><PanelLeft size={18} /></button>
          <div className="top-search"><Search size={16} /><input placeholder="搜索对话、素材或提示词..." /></div>
          <div className="top-actions">
            <button type="button" onClick={() => session.role === "ADMIN" ? setMode("admin") : setMode("dashboard")}><Settings size={17} /></button>
            <button type="button"><Bell size={17} /></button>
            <span className="avatar-dot">{session.label.slice(0, 1).toUpperCase()}</span>
          </div>
        </header>

        {error && mode !== "admin" ? <pre className="error-box floating">{error}</pre> : null}

        {mode === "dashboard" ? (
          <Dashboard
            sessionLabel={session.label}
            setMode={setMode}
            conversations={visibleConversations}
            attachments={attachments}
            generatedImages={visibleImages}
            materialHints={materialHints}
            onQuickPrompt={(text) => { setSharedPrompt(text); setMode("chat"); }}
            onDeleteConversation={deleteConversation}
            onImageError={handleGeneratedImageError}
          />
        ) : null}

        {mode === "chat" ? (
          <section className="chat-layout">
            <div className="chat-panel">
              <div className="panel-title">
                <span>Chat-first 统一工作区</span>
                <small>对话即创作</small>
              </div>
              <div className="messages">
                {activeMessages.length === 0 ? (
                  <div className="empty-message">
                    <Bot size={24} />
                    <p>把图片、文档或表格拖进来，直接让它们成为生成图片的素材。</p>
                  </div>
                ) : (
                  activeMessages.map((message) => (
                    <article key={message.id} className={`message ${message.role}`}>
                      <div className="bubble">
                        <MessageText content={message.content} />
                        {message.attachments?.length ? <AttachmentStrip attachments={message.attachments} compact /> : null}
                        {message.images?.length ? (
                          <ImageStrip
                            images={message.images}
                            onSelect={(image) => showImageInDraw(image)}
                            onImageError={handleGeneratedImageError}
                          />
                        ) : null}
                      </div>
                    </article>
                  ))
                )}
                {busyAction === "chat" ? (
                  <article className="message assistant loading-message">
                    <div className="bubble">
                      <LoadingMark label="正在思考并生成回复..." />
                    </div>
                  </article>
                ) : null}
                <div ref={messagesEndRef} />
              </div>
              <Composer
                value={sharedPrompt}
                setValue={setSharedPrompt}
                attachments={attachments}
                loading={loading}
                uploading={uploadingAttachment}
                inputRef={attachmentInputRef}
                onUpload={uploadAttachments}
                onRemove={removeAttachment}
                onSend={() => void sendChat()}
                onOptimize={() => void optimizePrompt()}
                onGenerate={prepareImageGeneration}
                busyAction={busyAction}
              />
            </div>
            <MaterialInspector attachments={attachments} parsedCount={parsedCount} materialHints={materialHints} />
          </section>
        ) : null}

        {mode === "draw" ? (
          <section className="draw-layout">
            <div className="draw-control">
              <div className="toolbar-row">
                <Field label="模型">
                  <select value={model} onChange={(event) => setModel(event.target.value)}>
                    {settings.imageModels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </Field>
                <Field label="文本模型">
                  <select
                    value={settings.promptOptimizerModel}
                    onChange={(event) => {
                      const next = { ...settings, promptOptimizerModel: event.target.value };
                      setSettings(next);
                      if (session.role === "ADMIN") void saveSettings({ promptOptimizerModel: event.target.value });
                    }}
                  >
                    {settings.textModels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </Field>
                <Field label="画面尺寸">
                  <select
                    value={sizeMode === "custom" ? "custom" : size}
                    onChange={(event) => {
                      if (event.target.value === "custom") {
                        setSizeMode("custom");
                      } else {
                        setSizeMode("preset");
                        setSize(event.target.value);
                      }
                    }}
                  >
                    {["1920x1080", "1080x1920", "1080x1080", "2560x1440", "3840x2160"].map((item) => <option key={item}>{item}</option>)}
                    <option value="custom">自定义</option>
                  </select>
                </Field>
                {sizeMode === "custom" ? (
                  <>
                    <Field label="宽度 px">
                      <input type="number" min={100} max={8192} value={customWidth} onChange={(event) => setCustomWidth(Number(event.target.value))} />
                    </Field>
                    <Field label="高度 px">
                      <input type="number" min={100} max={8192} value={customHeight} onChange={(event) => setCustomHeight(Number(event.target.value))} />
                    </Field>
                  </>
                ) : null}
                <Field label="数量">
                  <select value={count} onChange={(event) => setCount(Number(event.target.value))}>
                    {[1, 2, 4, 6, 8, 12].map((item) => <option key={item} value={item}>{item} 张</option>)}
                  </select>
                </Field>
                <Field label="保真程度">
                  <select value={inputFidelity} onChange={(event) => setInputFidelity(event.target.value as ImageInputFidelity)}>
                    <option value="high">高保真</option>
                    <option value="low">快速</option>
                  </select>
                </Field>
              </div>
              <textarea value={sharedPrompt} onChange={(event) => setSharedPrompt(event.target.value)} placeholder="描述你要生成的画面..." />
              <AttachmentStrip attachments={attachments} onRemove={removeAttachment} />
              <div className="mini-actions">
                <button type="button" onClick={() => attachmentInputRef.current?.click()}><Upload size={16} /> 上传附件</button>
                <button type="button" disabled={loading} onClick={() => void optimizePrompt()}>
                  {busyAction === "optimize" ? <LoadingMark compact /> : <WandSparkles size={16} />} 优化提示词
                </button>
                <button className="primary-action" type="button" disabled={loading || !(sharedPrompt.trim() || attachments.length)} onClick={() => void generateImages()}>
                  {busyAction === "generate" ? <LoadingMark compact /> : <Sparkles size={16} />} 生成图片
                </button>
              </div>
              <ReferenceUploader references={references} uploading={uploadingReference} onUpload={uploadReference} />
            </div>
            <div className="gallery-panel">
              <div className="panel-title">
                <span>生成结果</span>
                <small>{selectedImages.length ? `已选 ${selectedImages.length} 张` : visibleImages.length ? `${visibleImages.length} 张作品` : "等待生成"}</small>
              </div>
              <div className="generation-stage">
                {busyAction === "generate" || busyAction === "edit" || busyAction === "complete" ? (
                  <div className="generation-loading">
                    <img src="/brand/loading.gif" alt="" />
                    <span>{generationStep}</span>
                    <small>{busyAction === "complete" ? "1 秒后显示生成结果" : busyAction === "edit" ? "正在基于选中图片精修" : "正在生成图片"}</small>
                  </div>
                ) : selectedImage ? (
                  <button className="stage-image" type="button" style={{ backgroundImage: `url("${selectedImage.url}")` }} onClick={() => openImagePreview(selectedImage)}>
                    <img src={selectedImage.url} alt="当前生成图片" onError={() => handleGeneratedImageError(selectedImage.id)} />
                    <span><Maximize2 size={15} /> 放大查看</span>
                  </button>
                ) : (
                  <div className="stage-empty">
                    <ImageIcon size={34} />
                    <span>生成图片会显示在这里</span>
                  </div>
                )}
              </div>
              {selectedImage ? (
                <div className="edit-panel">
                  <textarea value={editPrompt} onChange={(event) => setEditPrompt(event.target.value)} placeholder="输入优化提示词..." />
                  <div className="edit-actions">
                    <Field label="优化数量">
                      <select value={editCount} onChange={(event) => setEditCount(Number(event.target.value))}>
                        {[1, 2, 4, 6, 8, 12].map((item) => <option key={item} value={item}>{item} 张</option>)}
                      </select>
                    </Field>
                    <Field label="下载格式">
                      <select value={downloadFormat} onChange={(event) => setDownloadFormat(event.target.value as DownloadFormat)}>
                        <option value="png">PNG</option>
                        <option value="jpg">JPG</option>
                      </select>
                    </Field>
                    <button type="button" onClick={() => downloadImage(selectedImage, downloadFormat)}><Download size={16} /> 下载</button>
                    <button className="primary-action" type="button" disabled={loading || !editPrompt.trim()} onClick={() => void editSelectedImage()}>
                      {busyAction === "edit" ? <LoadingMark compact /> : <WandSparkles size={16} />} 优化图片
                    </button>
                  </div>
                  <small>{selectedImages.length > 1 ? `已选 ${selectedImages.length} 张，仅优化所选图片` : "点击缩略图单选，按住 Ctrl/⌘ 可多选"}</small>
                </div>
              ) : null}
              <div className="image-grid">
                {visibleImages.length ? visibleImages.map((image) => (
                  <button
                    key={image.id}
                    type="button"
                    className={selectedImageIds.includes(image.id) ? "selected" : ""}
                    onClick={(event) => toggleSelectedImage(image, event.ctrlKey || event.metaKey)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      toggleSelectedImage(image, true);
                    }}
                    onDoubleClick={() => openImagePreview(image)}
                  >
                    <img src={image.url} alt="生成图片" onError={() => handleGeneratedImageError(image.id)} />
                    {selectedImageIds.includes(image.id) ? <span className="selection-mark"><Check size={13} /></span> : null}
                  </button>
                )) : Array.from({ length: 4 }).map((_, index) => <div key={index} className="image-placeholder" />)}
              </div>
            </div>
          </section>
        ) : null}

        {mode === "assets" ? (
          <section className="assets-layout">
            <div className="assets-head">
              <div>
                <h2>附件智能优先</h2>
                <p>上传资料后自动解析为可用于生图的素材 brief。</p>
              </div>
              <button className="primary-action" type="button" onClick={() => attachmentInputRef.current?.click()}>
                <Upload size={16} /> 上传素材
              </button>
            </div>
            <div className="asset-stats">
              <Stat label="已解析附件" value={parsedCount} />
              <Stat label="素材提示" value={materialHints.length} />
              <Stat label="生成作品" value={visibleImages.length} />
            </div>
            <div className="workflow-line">
              {["资料导入", "内容解析", "要点整合", "提示词优化", "图像生成"].map((item, index) => (
                <div key={item} className={index <= Math.min(4, attachments.length + 1) ? "done" : ""}>
                  <span>{index + 1}</span>{item}
                </div>
              ))}
            </div>
            <AttachmentGrid attachments={attachments} onRemove={removeAttachment} />
          </section>
        ) : null}

        {mode === "admin" && session.role === "ADMIN" ? (
          <AdminPanel
            settings={settings}
            accessCodes={accessCodes}
            savingSettings={savingSettings}
            newCodeLabel={newCodeLabel}
            newCodeValue={newCodeValue}
            newCodeRole={newCodeRole}
            setNewCodeLabel={setNewCodeLabel}
            setNewCodeValue={setNewCodeValue}
            setNewCodeRole={setNewCodeRole}
            error={error}
            onSaveSettings={saveSettings}
            onCreateCode={createAccessCode}
            onDeleteCode={deleteAccessCode}
          />
        ) : null}

        <input
          ref={attachmentInputRef}
          className="hidden-input"
          type="file"
          multiple
          accept="image/png,image/jpeg,image/jpg,image/pjpeg,image/webp,.jpg,.jpeg,.jpe,.jfif,.ipg,.png,.webp,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.markdown"
          onChange={(event) => void uploadAttachments(event)}
        />
        {previewImage ? (
          <div className="image-preview-modal" role="dialog" aria-modal="true">
            <div className="preview-toolbar">
              <button type="button" onClick={() => setPreviewZoom((value) => Math.max(0.5, value - 0.25))}><ZoomOut size={16} /></button>
              <span>{Math.round(previewZoom * 100)}%</span>
              <button type="button" onClick={() => setPreviewZoom((value) => Math.min(3, value + 0.25))}><ZoomIn size={16} /></button>
              <button type="button" onClick={() => setPreviewImage(null)}><X size={16} /></button>
            </div>
            <div className="preview-canvas" onClick={() => setPreviewImage(null)}>
              <img
                src={previewImage.url}
                alt="放大预览"
                style={{ transform: `scale(${previewZoom})` }}
                onError={() => handleGeneratedImageError(previewImage.id)}
                onClick={(event) => event.stopPropagation()}
              />
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function Dashboard(props: {
  sessionLabel: string;
  setMode: (mode: WorkspaceMode) => void;
  conversations: ChatConversation[];
  attachments: UploadedAttachment[];
  generatedImages: GeneratedImage[];
  materialHints: string[];
  onQuickPrompt: (text: string) => void;
  onDeleteConversation: (id: string) => Promise<void>;
  onImageError: (id: string) => void;
}) {
  return (
    <section className="dashboard-page">
      <div className="dashboard-hero">
        <div>
          <h1>欢迎回来，{props.sessionLabel}</h1>
          <p>以东方美学为灵感，智能驱动创意落地。</p>
        </div>
      </div>
      <div className="quick-grid">
        {[
          [MessageSquare, "对话", "与 AI 对话，激发创意", "chat"],
          [FileText, "附件理解", "上传资料，提炼素材", "assets"],
          [WandSparkles, "提示词优化", "优化创意，提升质量", "chat"],
          [ImageIcon, "图片生成", "生成高质量图片", "draw"],
        ].map(([Icon, title, desc, target]) => (
          <button key={title as string} type="button" onClick={() => props.setMode(target as WorkspaceMode)}>
            <Icon size={24} />
            <strong>{title as string}</strong>
            <span>{desc as string}</span>
          </button>
        ))}
      </div>
      <div className="dashboard-grid">
        <Panel title="近期对话" action="查看全部" onAction={() => props.setMode("chat")}>
          {props.conversations.slice(0, 4).map((item) => (
            <div className="list-row" key={item.id}>
              <button type="button" onClick={() => props.setMode("chat")}>
                <strong>{item.title}</strong><span>{item.messages.length} 条消息</span>
              </button>
              <button className="list-row-delete" type="button" title="删除对话" onClick={() => void props.onDeleteConversation(item.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </Panel>
        <Panel title="素材中心" action="查看更多素材" onAction={() => props.setMode("assets")}>
          <AttachmentGrid attachments={props.attachments.slice(0, 6)} compact />
        </Panel>
        <Panel title="最新生成" action="查看全部结果" onAction={() => props.setMode("draw")}>
          <div className="mini-gallery">
            {props.generatedImages.slice(0, 4).map((image) => (
              <img key={image.id} src={image.url} alt="最新生成" onError={() => props.onImageError(image.id)} />
            ))}
          </div>
        </Panel>
      </div>
      <div className="inspiration-bar">
        <span>灵感推荐</span>
        {inspirationTags.map((tag) => <button key={tag} type="button" onClick={() => props.onQuickPrompt(tag)}>{tag}</button>)}
      </div>
    </section>
  );
}

function AdminPanel(props: {
  settings: AppSettings;
  accessCodes: AccessCodeItem[];
  savingSettings: boolean;
  newCodeLabel: string;
  newCodeValue: string;
  newCodeRole: "USER" | "ADMIN";
  error: string;
  setNewCodeLabel: (value: string) => void;
  setNewCodeValue: (value: string) => void;
  setNewCodeRole: (value: "USER" | "ADMIN") => void;
  onSaveSettings: (settings: Partial<AppSettings>) => Promise<void>;
  onCreateCode: () => Promise<void>;
  onDeleteCode: (id: string) => Promise<void>;
}) {
  return (
    <section className="admin-layout">
      <div className="assets-head">
        <div>
          <h2>管理员控制台</h2>
          <p>口令组、全局模型和生成并发只允许管理员设置。管理员可查看所有口令组对话。</p>
        </div>
        <span className="admin-badge">ADMIN ONLY</span>
      </div>

      <div className="admin-grid">
        <article className="admin-card">
          <div className="panel-title">
            <span>模型与并发</span>
            <small>{props.savingSettings ? "保存中..." : "已启用管理员保护"}</small>
          </div>
          <div className="settings-form">
            <Field label="默认图片模型">
              <select
                value={props.settings.defaultImageModel}
                onChange={(event) => void props.onSaveSettings({ defaultImageModel: event.target.value })}
              >
                {props.settings.imageModels.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </Field>
            <Field label="默认文本模型">
              <select
                value={props.settings.promptOptimizerModel}
                onChange={(event) => void props.onSaveSettings({ promptOptimizerModel: event.target.value })}
              >
                {props.settings.textModels.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </Field>
            <Field label="最大并发生成数">
              <input
                type="number"
                min={1}
                max={20}
                value={props.settings.maxConcurrentGenerations}
                onChange={(event) => void props.onSaveSettings({ maxConcurrentGenerations: Number(event.target.value) })}
              />
            </Field>
            <label className="check-row">
              <input
                type="checkbox"
                checked={props.settings.allowReferenceImageEdit}
                onChange={(event) => void props.onSaveSettings({ allowReferenceImageEdit: event.target.checked })}
              />
              允许参考图进入图片编辑接口
            </label>
          </div>
          <div className="model-list">
            {[...props.settings.textModels, ...props.settings.imageModels].map((item) => (
              <span key={item.id}>{item.name}<em>{item.id}</em></span>
            ))}
          </div>
        </article>

        <article className="admin-card">
          <div className="panel-title">
            <span>新增口令组</span>
            <small>可创建普通用户或管理员</small>
          </div>
          <div className="settings-form">
            <Field label="口令组名称">
              <input value={props.newCodeLabel} onChange={(event) => props.setNewCodeLabel(event.target.value)} placeholder="例如：设计组" />
            </Field>
            <Field label="访问口令">
              <input value={props.newCodeValue} onChange={(event) => props.setNewCodeValue(event.target.value)} placeholder="至少 4 位" />
            </Field>
            <Field label="角色">
              <select value={props.newCodeRole} onChange={(event) => props.setNewCodeRole(event.target.value as "USER" | "ADMIN")}>
                <option value="USER">普通用户</option>
                <option value="ADMIN">管理员</option>
              </select>
            </Field>
            <button className="primary-action" type="button" onClick={() => void props.onCreateCode()}>
              <KeyRound size={16} /> 新增口令
            </button>
          </div>
        </article>
      </div>

      <article className="admin-card code-table-card">
        <div className="panel-title">
          <span>口令组与对话</span>
          <small>管理员在对话列表中可看到所有口令组的会话</small>
        </div>
        <div className="code-table">
          {props.accessCodes.map((item) => (
            <div key={item.id} className="code-row">
              <div>
                <strong>{item.label}</strong>
                <span>{item.role === "ADMIN" ? "管理员" : "普通用户"} · 对话 {item._count?.conversations || 0} 个</span>
              </div>
              <code>{item.displayCode || "已隐藏"}</code>
              <button type="button" onClick={() => navigator.clipboard?.writeText(item.displayCode || "")}>
                <Copy size={15} />
              </button>
              <button type="button" onClick={() => void props.onDeleteCode(item.id)}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {props.accessCodes.length === 0 ? <div className="empty-assets">暂无口令组。</div> : null}
          {props.error ? <pre className="error-box admin-error">{props.error}</pre> : null}
        </div>
      </article>
    </section>
  );
}

function Panel(props: { title: string; action: string; onAction: () => void; children: React.ReactNode }) {
  return (
    <article className="dashboard-panel">
      <div className="panel-title"><span>{props.title}</span><button type="button" onClick={props.onAction}>{props.action}<ChevronRight size={14} /></button></div>
      {props.children}
    </article>
  );
}

function Composer(props: {
  value: string;
  setValue: (value: string) => void;
  attachments: UploadedAttachment[];
  loading: boolean;
  uploading: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: (id: string) => void;
  onSend: () => void;
  onOptimize: () => void;
  onGenerate: () => void;
  busyAction: BusyAction;
}) {
  return (
    <div className="composer">
      <AttachmentStrip attachments={props.attachments} onRemove={props.onRemove} />
      <textarea
        value={props.value}
        onChange={(event) => props.setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (!props.loading && props.value.trim()) props.onSend();
        }}
        placeholder="输入你的需求、提示词或问题..."
      />
      <div className="composer-actions">
        <button type="button" onClick={() => props.inputRef.current?.click()}>{props.uploading ? <LoadingMark compact /> : <Upload size={16} />}附件</button>
        <button type="button" disabled={props.loading} onClick={props.onOptimize}>
          {props.busyAction === "optimize" ? <LoadingMark compact /> : <WandSparkles size={16} />}优化提示词
        </button>
        <button type="button" onClick={props.onGenerate}><ImageIcon size={16} />生成图片</button>
        <button className="send-btn" type="button" disabled={props.loading || !props.value.trim()} onClick={props.onSend}>
          {props.busyAction === "chat" ? <LoadingMark compact /> : <Send size={17} />}
        </button>
      </div>
    </div>
  );
}

function MaterialInspector(props: { attachments: UploadedAttachment[]; parsedCount: number; materialHints: string[] }) {
  const hasMaterials = props.parsedCount > 0 || props.materialHints.length > 0;

  return (
    <aside className="material-inspector">
      <div className="panel-title"><span>素材解析</span><small>{props.parsedCount} 个已解析</small></div>
      <div className="inspector-tabs"><button className="active">要点</button><button>图像</button><button>关键词</button></div>
      {!hasMaterials ? (
        <div className="material-section">
          <strong>暂无素材</strong>
          <p>上传附件后，这里会显示从文件中提取的画面要点、色彩和风格关键词。</p>
        </div>
      ) : null}
      <div className="material-section">
        <strong>核心要点</strong>
        {props.materialHints.slice(0, 6).map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}
      </div>
      {hasMaterials ? <div className="material-section">
        <strong>色彩参考</strong>
        <div className="swatches"><i /><i /><i /><i /><i /></div>
      </div> : null}
      {hasMaterials ? <div className="material-section">
        <strong>风格参考</strong>
        <div className="tag-cloud">
          {["水墨写意", "东方留白", "商业质感", "诗意场景"].map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      </div> : null}
    </aside>
  );
}

function AttachmentStrip(props: { attachments: UploadedAttachment[]; onRemove?: (id: string) => void; compact?: boolean }) {
  if (!props.attachments.length) return null;
  return (
    <div className={`attachment-strip ${props.compact ? "compact" : ""}`}>
      {props.attachments.map((item) => {
        return (
          <div key={item.id} className="attachment-chip">
            <span>{item.name}</span>
            {props.onRemove ? <button type="button" onClick={() => props.onRemove?.(item.id)}><X size={13} /></button> : null}
          </div>
        );
      })}
    </div>
  );
}

function AttachmentGrid(props: { attachments: UploadedAttachment[]; onRemove?: (id: string) => void; compact?: boolean }) {
  if (!props.attachments.length) {
    return <div className="empty-assets">上传图片、PDF、DOCX 或 Excel 后会在这里形成素材卡片。</div>;
  }
  return (
    <div className={`attachment-grid ${props.compact ? "compact" : ""}`}>
      {props.attachments.map((item) => {
        const Icon = attachmentIcon(item.kind);
        return (
          <article key={item.id} className="asset-card">
            {item.url ? <img src={item.url} alt={item.name} /> : <Icon size={28} />}
            <strong>{item.name}</strong>
            <span>{item.summary}</span>
            {props.onRemove ? <button type="button" onClick={() => props.onRemove?.(item.id)}><X size={14} /></button> : null}
          </article>
        );
      })}
    </div>
  );
}

function ImageStrip(props: { images: GeneratedImage[]; onSelect: (image: GeneratedImage) => void; onImageError?: (id: string) => void }) {
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const images = props.images.filter((image) => !failedIds.includes(image.id));
  if (!images.length) return null;

  return (
    <div className="image-strip">
      {images.map((image) => (
        <button key={image.id} type="button" onClick={() => props.onSelect(image)}>
          <img
            src={image.url}
            alt="生成图片"
            onError={() => {
              setFailedIds((prev) => prev.includes(image.id) ? prev : [...prev, image.id]);
              props.onImageError?.(image.id);
            }}
          />
        </button>
      ))}
    </div>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{props.label}</span>{props.children}</label>;
}

function Stat(props: { label: string; value: number }) {
  return <div className="stat"><strong>{props.value}</strong><span>{props.label}</span></div>;
}

function ReferenceUploader(props: {
  references: Record<ReferenceCategory, UploadedReference[]>;
  uploading: ReferenceCategory | "";
  onUpload: (category: ReferenceCategory, event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <section className="reference-box">
      <div className="panel-title"><span>分类参考图</span><small>保留原作图流程</small></div>
      <div className="reference-grid">
        {referenceCategories.map((category) => (
          <div key={category.id} className="reference-card">
            <div><strong>{category.title}</strong><small>{props.references[category.id].length}/{category.max}</small></div>
            <p>{category.desc}</p>
            <label>
              {props.uploading === category.id ? <LoadingMark compact label="上传中" /> : "上传"}
              <input type="file" accept="image/png,image/jpeg,image/jpg,image/pjpeg,image/webp,.jpg,.jpeg,.jpe,.jfif,.ipg,.png,.webp" multiple onChange={(event) => props.onUpload(category.id, event)} />
            </label>
          </div>
        ))}
      </div>
    </section>
  );
}


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

type ChatConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

type GenerateResult = {
  ok: boolean;
  jobId?: string;
  images?: GeneratedImage[];
  warnings?: string[];
  failures?: Array<{ index: number; reason: string }>;
  shortReason?: string;
  message?: string;
  generatedCount?: number;
  requestedCount?: number;
};

type ChatResult = {
  ok: boolean;
  reply?: string;
  shortReason?: string;
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

const defaultPrompt = "一只穿着宇航服的猫，站在月球上，电影质感，高细节，东方留白构图";

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

export default function Home() {
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<"chat" | "draw">("draw");
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [negative, setNegative] = useState("");
  const [model, setModel] = useState("gpt-image-2");
  const [sizeMode, setSizeMode] = useState<"preset" | "custom">("preset");
  const [size, setSize] = useState("1024x1024");
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
  const [chatLoading, setChatLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [uploading, setUploading] = useState<ReferenceCategory | "">("");
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState("");

  const messageEndRef = useRef<HTMLDivElement | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) || null,
    [activeConversationId, conversations],
  );

  const activeMessages = activeConversation?.messages || [];
  const referenceImages = useMemo(() => flattenReferenceImages(references), [references]);

  useEffect(() => {
    void loadSettings();
    loadConversations();
  }, []);

  useEffect(() => {
    if (conversations.length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(conversations));
    }
  }, [conversations]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConversationId, activeMessages.length, chatLoading]);

  async function loadSettings() {
    try {
      const response = await fetch("/api/settings");
      const data = await response.json();
      if (data.ok && data.settings) {
        setSettings(data.settings);
        setModel(data.settings.defaultImageModel || "gpt-image-2");
      }
    } catch {
      setSettings(fallbackSettings);
    }
  }
  function openMessageImagesInDraw(images: GeneratedImage[], selected?: GeneratedImage) {
    if (images.length === 0) return;

    setGeneratedImages((prev) => {
      const merged = [...images];

      for (const item of prev) {
        if (!merged.some((image) => image.id === item.id)) {
          merged.push(item);
        }
      }

      return merged;
    });

    setSelectedImage(selected || images[0]);
    setMode("draw");
  }
  function loadConversations() {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? (JSON.parse(raw) as ChatConversation[]) : [];
      if (Array.isArray(parsed) && parsed.length > 0) {
        setConversations(parsed);
        setActiveConversationId(parsed[0].id);
        return;
      }
    } catch {
      // ignore broken local data
    }

    const first = createConversationObject("新对话");
    setConversations([first]);
    setActiveConversationId(first.id);
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
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextSettings),
    });
    const data = await response.json();
    if (data.ok && data.settings) {
      setSettings(data.settings);
      setModel(data.settings.defaultImageModel);
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
      const data = await response.json();
      if (!data.ok) throw new Error(data.message || "上传失败");

      setReferences((prev) => ({
        ...prev,
        [category]: [...prev[category], ...(data.files || [])],
      }));

      if (files.length > remaining) {
        setError(`${config?.title || "该分类"}最多上传 ${max} 张，本次只保留前 ${remaining} 张。`);
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
    conversation?: ChatMessage[];
    countOverride?: number;
  }) {
    return {
      prompt: options?.prompt || prompt,
      negative,
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
      conversation: (options?.conversation || activeMessages).map((item) => ({
        role: item.role,
        content: item.content,
      })),
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
          conversation: currentMessages.map((item) => ({ role: item.role, content: item.content })),
          mode: "chat",
          selectedImageUrl: selectedImage?.url,
        }),
      });

      const data = (await response.json()) as ChatResult;
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
  }) {
    const conversationId = ensureConversation();
    const currentMessages = conversations.find((item) => item.id === conversationId)?.messages || [];
    const finalPrompt = options?.prompt || prompt;
    const userText = options?.userText || finalPrompt;

    setLoading(true);
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
          conversation: currentMessages,
        })),
      });
      const data = (await response.json()) as GenerateResult;
      if (!response.ok || !data.ok) throw new Error(data.shortReason || data.message || "生成失败");

      setResult(data);
      const nextImages = data.images || [];
      setGeneratedImages((prev) => {
        const filteredPrev = prev.filter((item) => !nextImages.some((next) => next.id === item.id));
        return [...nextImages, ...filteredPrev];
      });
      if (nextImages[0]) setSelectedImage(nextImages[0]);

      const summary = `已完成图片生成：请求 ${data.requestedCount || options?.countOverride || count} 张，成功 ${data.generatedCount || nextImages.length} 张。${data.failures?.length ? `部分失败：${data.failures.map((item) => `第${item.index}张${item.reason}`).join("；")}` : ""}`;
      appendMessages(conversationId, [
        { id: uid("msg"), role: "assistant", content: summary, time: nowText(), images: nextImages },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成失败";
      setError(message);
      appendMessages(conversationId, [
        { id: uid("msg"), role: "assistant", content: `生成失败：${message}`, time: nowText() },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function optimizePrompt() {
    setOptimizing(true);
    setError("");

    const userText = contextDraft.trim() || "请结合当前对话和参考图，优化当前提示词。";
    const conversationId = ensureConversation();
    const currentMessages = conversations.find((item) => item.id === conversationId)?.messages || [];

    try {
      const response = await fetch("/api/prompt/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          negative,
          userMessage: userText,
          selectedImageUrl: selectedImage?.url,
          referenceImages: referenceImages.map((item) => ({ category: item.category, url: item.url, name: item.name })),
          conversation: currentMessages.map((item) => ({ role: item.role, content: item.content })),
          model: settings.promptOptimizerModel,
        }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.shortReason || data.message || "提示词优化失败");

      setPrompt(data.optimizedPrompt);
      appendMessages(conversationId, [
        { id: uid("msg"), role: "user", content: userText, time: nowText() },
        { id: uid("msg"), role: "assistant", content: data.reply || "已优化提示词。", time: nowText() },
      ], userText);
      setContextDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "提示词优化失败");
    } finally {
      setOptimizing(false);
    }
  }

  async function optimizeSelectedImageAndGenerate() {
    if (!selectedImage) return;
    const userText = imageDraft.trim();
    if (!userText) return;

    setOptimizing(true);
    setError("");

    const conversationId = ensureConversation();
    const currentMessages = conversations.find((item) => item.id === conversationId)?.messages || [];

    try {
      const response = await fetch("/api/prompt/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          negative,
          userMessage: userText,
          selectedImageUrl: selectedImage.url,
          referenceImages: referenceImages.map((item) => ({ category: item.category, url: item.url, name: item.name })),
          conversation: currentMessages.map((item) => ({ role: item.role, content: item.content })),
          model: settings.promptOptimizerModel,
        }),
      });

      const data = await response.json();
      if (!data.ok) throw new Error(data.shortReason || data.message || "单图优化失败");

      const optimizedPrompt = data.optimizedPrompt as string;
      setPrompt(optimizedPrompt);
      setImageDraft("");
      await generateImages({
        prompt: optimizedPrompt,
        selectedImageUrl: selectedImage.url,
        countOverride: refineCount,
        userText,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "单图优化失败");
    } finally {
      setOptimizing(false);
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
                <small>{conversation.messages.length} 条</small>
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
        <button className="nav-item" type="button" onClick={() => setShowSettings(true)}>设置</button>

        <div className="space-card">
          <strong>EastWill 空间</strong>
          <span>企业版 · 太极图 1.0</span>
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
                            <img src={image.url} alt="对话图片" />
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
                <button className="secondary-btn" type="button" onClick={() => setShowSettings(true)}>设置</button>
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

              <label className="field-block">
                <span>负面提示词（默认空）</span>
                <textarea value={negative} onChange={(event) => setNegative(event.target.value)} placeholder="可留空，例如：低清晰度、畸形、模糊" />
                <small className="field-help">说明：像 gpt-image-2 这类模型对负面提示词的约束通常弱于 SD 类模型。想减少模糊，建议在主提示词中正向写明“主体清晰、准确对焦、高清细节、边缘清楚、纹理真实”。</small>
              </label>

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
                      <option value="1024x1024">1024 × 1024</option>
                      <option value="1024x1536">1024 × 1536</option>
                      <option value="1536x1024">1536 × 1024</option>
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
                            <img src={item.url} alt={item.name} />
                            <span>移除</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="context-box">
                <h3>上下文对话与提示词优化</h3>
                <p>当前对话会作为作图上下文。也可以在这里补充要求后优化提示词。</p>
                <textarea value={contextDraft} placeholder="例如：更像宋代山水，画面更留白，品牌感更强..." onChange={(event) => setContextDraft(event.target.value)} />
                <div className="button-row">
                  <button className="secondary-btn" type="button" disabled={optimizing} onClick={optimizePrompt}>{optimizing ? "优化中..." : "优化提示词"}</button>
                  <button className="primary-btn" type="button" disabled={loading || !prompt.trim()} onClick={() => void generateImages()}>{loading ? "生成中..." : "开始生成"}</button>
                </div>
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
                      <img src={selectedImage.url} alt="当前选中图片" className="gallery-stage-image" />
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
                          <img src={image.url} alt={`作品 ${index + 1}`} />
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
                      <img src={selectedImage.url} alt="选中图片" />
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
                    <button className="primary-btn full" type="button" disabled={optimizing || loading || !imageDraft.trim()} onClick={optimizeSelectedImageAndGenerate}>
                      {optimizing || loading ? "处理中..." : "优化选中图片并生成"}
                    </button>
                  </>
                ) : (
                  <p className="muted">请先在上方结果中点击一张图片。</p>
                )}
              </section>
            </section>
          </section>
        )}
      </section>

      {showSettings ? (
        <div className="settings-mask" onClick={() => setShowSettings(false)}>
          <section className="settings-panel" onClick={(event) => event.stopPropagation()}>
            <div className="panel-head">
              <div><h2>设置</h2><p>并发、模型和参考图策略。</p></div>
              <button type="button" onClick={() => setShowSettings(false)}>关闭</button>
            </div>
            <label><span>默认图片模型</span><select value={settings.defaultImageModel} onChange={(event) => void saveSettings({ defaultImageModel: event.target.value })}>{settings.imageModels.map((item) => <option key={item.id} value={item.id}>{item.name}（{item.id}）</option>)}</select></label>
            <label><span>提示词/对话模型</span><input value={settings.promptOptimizerModel} onChange={(event) => setSettings((prev) => ({ ...prev, promptOptimizerModel: event.target.value }))} onBlur={(event) => void saveSettings({ promptOptimizerModel: event.target.value })} /></label>
            <label><span>团队最大并发生成数（建议 8-12，最高 16）</span><input type="number" min={1} max={16} value={settings.maxConcurrentGenerations} onChange={(event) => void saveSettings({ maxConcurrentGenerations: Number(event.target.value) })} /></label>
            <label className="check-line"><input type="checkbox" checked={settings.allowReferenceImageEdit} onChange={(event) => void saveSettings({ allowReferenceImageEdit: event.target.checked })} /> 选中图片优化时优先尝试图片编辑接口，失败后自动转文字生成</label>
          </section>
        </div>
      ) : null}
    </main>
  );
}

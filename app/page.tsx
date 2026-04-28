"use client";

import { useEffect, useMemo, useState } from "react";
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

type UploadedReference = {
  url: string;
  name: string;
  type: string;
  size: number;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  time: string;
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

const fallbackSettings: AppSettings = {
  maxConcurrentGenerations: 8,
  defaultImageModel: "gpt-image-2",
  promptOptimizerModel: "gpt-5.2",
  allowReferenceImageEdit: true,
  imageModels: [
    { id: "gpt-image-2", name: "GPT Image 2", note: "推荐" },
    { id: "gpt-image-1", name: "GPT Image 1" },
    { id: "banana", name: "Banana" },
    { id: "nano-banana", name: "Nano Banana" },
    { id: "dall-e-3", name: "DALL·E 3" },
  ],
};

const quickCards = [
  {
    title: "图片生成",
    desc: "根据所写提示词设计你的专属美感",
    prompt: "一张具备东方美学信息图，淡墨山水背景，温润绿色点缀，留白构图，高级简约",
  },
  {
    title: "提示词构建",
    desc: "拆解创作目标，自动生成结构化提示词，提升出图稳定性与可控性",
    prompt: "",
  },
  {
    title: "创意扩展",
    desc: "基于当前提示词与上下文，生成多方向创意方案，快速拓展灵感边界",
    prompt: "一幅创意头脑风暴视觉图，水墨圆环、灵感光点、东方美学、现代 AI 产品视觉，干净高级",
  },
  {
    title: "提示词优化",
    desc: "智能优化提示词结构与细节，结合历史对话与参考图提升生成质量",
    prompt: "一张文字润色与表达优化主题的品牌视觉图，宣纸肌理、书法笔触、松绿色、极简高雅",
  },
];

const defaultPrompt = "一只穿着宇航服的猫，站在月球上，电影质感，高细节，东方留白构图";

function nowText() {
  return new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function hideBrokenImage(event: React.SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.display = "none";
}

export default function Home() {
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [negative, setNegative] = useState("");
  const [model, setModel] = useState("gpt-image-2");
  const [sizeMode, setSizeMode] = useState<"preset" | "custom">("preset");
  const [size, setSize] = useState("1024x1024");
  const [customWidth, setCustomWidth] = useState(1024);
  const [customHeight, setCustomHeight] = useState(1024);
  const [count, setCount] = useState(1);
  const [useReferenceImage, setUseReferenceImage] = useState(true);
  const [references, setReferences] = useState<UploadedReference[]>([]);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [globalConversation, setGlobalConversation] = useState<ChatMessage[]>([]);
  const [contextDraft, setContextDraft] = useState("");
  const [imageDraft, setImageDraft] = useState("");
  const [imageConversations, setImageConversations] = useState<Record<string, ChatMessage[]>>({});
  const [loading, setLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState("");

  const selectedConversation = useMemo(() => {
    if (!selectedImage) return [];
    return imageConversations[selectedImage.id] || [];
  }, [imageConversations, selectedImage]);

  useEffect(() => {
    void loadSettings();
  }, []);

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

  async function uploadReferences(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setError("");

    try {
      const formData = new FormData();
      Array.from(files).forEach((file) => formData.append("files", file));
      const response = await fetch("/api/uploads", { method: "POST", body: formData });
      const data = await response.json();
      if (!data.ok) throw new Error(data.message || "上传失败");
      setReferences((prev) => [...prev, ...(data.files || [])]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  function buildGeneratePayload(override?: { prompt?: string; selectedImageUrl?: string; conversation?: ChatMessage[] }) {
    return {
      prompt: override?.prompt || prompt,
      negative,
      model,
      size,
      useCustomSize: sizeMode === "custom",
      customWidth,
      customHeight,
      count,
      selectedImageUrl: override?.selectedImageUrl || selectedImage?.url,
      referenceImageUrls: references.map((item) => item.url),
      useReferenceImage,
      conversation: override?.conversation || globalConversation,
    };
  }

  async function generateImages(override?: { prompt?: string; selectedImageUrl?: string; conversation?: ChatMessage[] }) {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildGeneratePayload(override)),
      });
      const data = (await response.json()) as GenerateResult;
      if (!response.ok || !data.ok) throw new Error(data.shortReason || data.message || "生成失败");
      setResult(data);
      const nextImages = data.images || [];
      setGeneratedImages((prev) => [...nextImages, ...prev]);
      if (nextImages[0]) setSelectedImage(nextImages[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setLoading(false);
    }
  }

  async function optimizePrompt() {
    setOptimizing(true);
    setError("");

    const userText = contextDraft.trim() || "请优化当前提示词，使它更适合高质量 AI 作图。";
    const nextConversation: ChatMessage[] = [
      ...globalConversation,
      { role: "user", content: userText, time: nowText() },
    ];

    try {
      const response = await fetch("/api/prompt/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          negative,
          userMessage: userText,
          selectedImageUrl: selectedImage?.url,
          referenceImageUrls: references.map((item) => item.url),
          conversation: nextConversation,
          model: settings.promptOptimizerModel,
        }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.shortReason || data.message || "提示词优化失败");
      setPrompt(data.optimizedPrompt);
      setGlobalConversation([
        ...nextConversation,
        { role: "assistant", content: data.reply || "已优化提示词。", time: nowText() },
      ]);
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

    const current = imageConversations[selectedImage.id] || [];
    const nextConversation: ChatMessage[] = [...current, { role: "user", content: userText, time: nowText() }];

    try {
      const response = await fetch("/api/prompt/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          negative,
          userMessage: userText,
          selectedImageUrl: selectedImage.url,
          referenceImageUrls: references.map((item) => item.url),
          conversation: nextConversation,
          model: settings.promptOptimizerModel,
        }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.shortReason || data.message || "单图优化失败");
      const optimizedPrompt = data.optimizedPrompt as string;
      setPrompt(optimizedPrompt);
      setImageConversations((prev) => ({
        ...prev,
        [selectedImage.id]: [
          ...nextConversation,
          { role: "assistant", content: data.reply || "已根据选中图片优化，并开始生成新版本。", time: nowText() },
        ],
      }));
      setImageDraft("");
      await generateImages({
        prompt: optimizedPrompt,
        selectedImageUrl: selectedImage.url,
        conversation: nextConversation,
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

        <button className="primary-nav" type="button">新对话</button>
        <button className="nav-item" type="button">历史记录</button>
        <button className="nav-item" type="button">知识库</button>
        <button className="nav-item" type="button">工作台</button>
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
          <div className="top-actions">
            <button type="button">⌕</button>
            <button type="button">□</button>
            <button type="button">⌂</button>
            <img src="/brand/seal.png" alt="印章" onError={hideBrokenImage} />
          </div>
        </header>

        <section className="hero">
          <img className="seal" src="/brand/seal.png" alt="印章" onError={hideBrokenImage} />
          <h1>太极图</h1>
          <p>以平衡之道，组织审美与灵感</p>
          <div className="quick-grid">
            {quickCards.map((card) => (
              <button key={card.title} className="quick-card" type="button" onClick={() => setPrompt(card.prompt)}>
                <strong>{card.title}</strong>
                <span>{card.desc}</span>
                <em>→</em>
              </button>
            ))}
          </div>
        </section>

        <section className="workspace">
          <section className="panel composer-panel">
            <div className="panel-head">
              <div>
                <h2>AI 作图工作台</h2>
                <p>支持多张生成、上下文优化、参考图上传、选中图片单独对话优化。</p>
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
                  <option value={1}>1 张</option>
                  <option value={2}>2 张</option>
                  <option value={3}>3 张</option>
                  <option value={4}>4 张</option>
                </select>
              </label>
            </div>

            <label className="field-block">
              <span>主提示词</span>
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            </label>

            <label className="field-block">
              <span>负面提示词（默认空）</span>
              <textarea value={negative} placeholder="可留空；例如：低清晰度，畸形，模糊" onChange={(event) => setNegative(event.target.value)} />
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
                <label>
                  <span>默认尺寸</span>
                  <select value={size} onChange={(event) => setSize(event.target.value)}>
                    <option value="1024x1024">1920 × 1080 正方形</option>
                    <option value="1024x1536">1024 × 1536 竖图</option>
                    <option value="1536x1024">1020 × 1020 横图</option>
                  </select>
                </label>
              ) : (
                <>
                  <label><span>宽度</span><input type="number" min={256} max={2048} value={customWidth} onChange={(e) => setCustomWidth(Number(e.target.value))} /></label>
                  <label><span>高度</span><input type="number" min={256} max={2048} value={customHeight} onChange={(e) => setCustomHeight(Number(e.target.value))} /></label>
                </>
              )}
            </div>

            <div className="reference-box">
              <div className="reference-head">
                <strong>示例 / 参考图片</strong>
                <label className="upload-btn">
                  {uploading ? "上传中..." : "上传参考图"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={uploadReferences} />
                </label>
              </div>
              <label className="check-line"><input type="checkbox" checked={useReferenceImage} onChange={(e) => setUseReferenceImage(e.target.checked)} /> 使用参考图进行编辑或风格延展</label>
              <div className="reference-list">
                {references.map((item) => (
                  <button key={item.url} type="button" onClick={() => setReferences((prev) => prev.filter((x) => x.url !== item.url))}>
                    <img src={item.url} alt={item.name} />
                    <span>移除</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="context-box">
              <strong>上下文对话与提示词优化</strong>
              <div className="chat-mini">
                {globalConversation.slice(-4).map((item, index) => (
                  <p key={`${item.time}-${index}`} className={item.role}>{item.content}</p>
                ))}
              </div>
              <textarea value={contextDraft} placeholder="例如：更像宋代山水，画面更留白，品牌感更强..." onChange={(e) => setContextDraft(e.target.value)} />
              <div className="button-row">
                <button type="button" className="secondary-btn" disabled={optimizing} onClick={optimizePrompt}>{optimizing ? "优化中..." : "优化提示词"}</button>
                <button type="button" className="primary-btn" disabled={loading || !prompt.trim()} onClick={() => void generateImages()}>{loading ? "生成中..." : "开始生成"}</button>
              </div>
            </div>

            {error ? <div className="error-line">{error}</div> : null}
            {result?.warnings?.length ? <div className="warn-line">{result.warnings.join("；")}</div> : null}
          </section>

          <section className="panel result-panel">
            <div className="panel-head">
              <div>
                <h2>生成结果</h2>
                <p>{result?.generatedCount ? `已生成 ${result.generatedCount}/${result.requestedCount} 张` : "点击图片可选中，并进行单图对话优化。"}</p>
              </div>
            </div>

            {generatedImages.length === 0 ? (
              <div className="empty-result">结果区域会展示新生成的图片。</div>
            ) : (
              <div className="image-grid">
                {generatedImages.map((image, index) => (
                  <article key={image.id} className={`image-card ${selectedImage?.id === image.id ? "selected" : ""}`}>
                    <button type="button" onClick={() => setSelectedImage(image)}>
                      <img src={image.url} alt={`生成图 ${index + 1}`} />
                    </button>
                    <div className="image-tools">
                      <span>作品 {index + 1}</span>
                      <div>
                        <button type="button" onClick={() => void downloadImage(image, "png")}>PNG</button>
                        <button type="button" onClick={() => void downloadImage(image, "jpeg")}>JPEG</button>
                      </div>
                    </div>
                  </article>
                ))}
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
                      <p>输入修改要求后，会结合当前图片与上下文优化提示词，并生成新版本。</p>
                    </div>
                  </div>
                  <div className="chat-mini">
                    {selectedConversation.map((item, index) => (
                      <p key={`${item.time}-${index}`} className={item.role}>{item.content}</p>
                    ))}
                  </div>
                  <textarea value={imageDraft} placeholder="例如：保留主体，把背景改成水墨山水，增加竹影和留白..." onChange={(e) => setImageDraft(e.target.value)} />
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
      </section>

      {showSettings ? (
        <div className="settings-mask" onClick={() => setShowSettings(false)}>
          <section className="settings-panel" onClick={(event) => event.stopPropagation()}>
            <div className="panel-head">
              <div><h2>设置</h2><p>并发、模型和参考图策略。</p></div>
              <button type="button" onClick={() => setShowSettings(false)}>关闭</button>
            </div>
            <label><span>默认图片模型</span><select value={settings.defaultImageModel} onChange={(e) => void saveSettings({ defaultImageModel: e.target.value })}>{settings.imageModels.map((item) => <option key={item.id} value={item.id}>{item.name}（{item.id}）</option>)}</select></label>
            <label><span>提示词优化模型</span><input value={settings.promptOptimizerModel} onChange={(e) => setSettings((prev) => ({ ...prev, promptOptimizerModel: e.target.value }))} onBlur={(e) => void saveSettings({ promptOptimizerModel: e.target.value })} /></label>
            <label><span>最大并发生成数（建议 6-8，最高 12）</span><input type="number" min={1} max={12} value={settings.maxConcurrentGenerations} onChange={(e) => void saveSettings({ maxConcurrentGenerations: Number(e.target.value) })} /></label>
            <label className="check-line"><input type="checkbox" checked={settings.allowReferenceImageEdit} onChange={(e) => void saveSettings({ allowReferenceImageEdit: e.target.checked })} /> 优先尝试使用参考图编辑接口，失败后自动转文字生成</label>
          </section>
        </div>
      ) : null}
    </main>
  );
}

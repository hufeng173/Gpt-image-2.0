"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

type GeneratedImage = {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  seed: string | null;
};

type ApiResult = {
  ok: boolean;
  jobId?: string;
  images?: GeneratedImage[];
  rawImages?: Array<{ url?: string | null; b64_json?: string | null }>;
  error?: string;
  message?: string;
  upstreamStatus?: number | null;
};

const quickCards = [
  {
    title: "总结文档",
    desc: "提炼要点，生成结构化摘要与结论",
    prompt: "请将以下内容整理成结构化摘要，并提炼 5 个关键结论。",
  },
  {
    title: "制定计划",
    desc: "设定目标，拆解步骤，生成可执行计划",
    prompt: "请围绕这个目标，为我制定一个分阶段执行计划。",
  },
  {
    title: "头脑风暴",
    desc: "激发灵感，拓展思路，提供多种创意方向",
    prompt: "围绕东方美学与现代 AI 产品，给我 10 个创意方向。",
  },
  {
    title: "润色表达",
    desc: "优化语言，提升表达的准确性与感染力",
    prompt: "请把下面这段文案润色得更简约、高雅、有东方气质。",
  },
];

const defaultPrompt = "一只穿着宇航服的猫，站在月球上，电影质感，高细节，东方留白构图";

export default function Home() {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [negative, setNegative] = useState("低清晰度，畸形，模糊，重复，多余肢体");
  const [size, setSize] = useState<"1024x1024" | "1024x1536" | "1536x1024">("1024x1024");
  const [count, setCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string>("");

  const generatedImages = useMemo(() => result?.images ?? [], [result]);

  async function handleGenerate() {
    try {
      setLoading(true);
      setError("");
      setResult(null);

      const response = await fetch("/api/images/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          negative,
          size,
          count,
        }),
      });

      const data = (await response.json()) as ApiResult;

      if (!response.ok || !data.ok) {
        throw new Error(data.message || "生成失败，请稍后重试。");
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="tai-layout">
      <aside className="tai-sidebar">
        <div className="brand-block">
          <img className="brand-logo" src="/brand/logo-taijitu.svg" alt="太极图 Logo" />
          <div>
            <div className="brand-title">太极图</div>
            <div className="brand-subtitle">EastWill AI Studio</div>
          </div>
        </div>

        <button className="new-chat-btn" type="button">
          <SidebarIconChat />
          新对话
        </button>

        <nav className="nav-list">
          <NavItem icon={<SidebarIconHistory />} text="历史记录" active />
          <NavItem icon={<SidebarIconBook />} text="知识库" />
          <NavItem icon={<SidebarIconGrid />} text="工作台" />
          <NavItem icon={<SidebarIconSetting />} text="设置" />
        </nav>

        <div className="sidebar-card">
          <div className="sidebar-card-title">EastWill 空间</div>
          <div className="sidebar-card-subtitle">企业版 · 太极图 3.0</div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: "32%" }} />
          </div>
          <div className="sidebar-card-foot">32% 已使用</div>
        </div>

        <div className="user-card">
          <img className="user-avatar" src="/ui/avatar-eastwill.svg" alt="EastWill" />
          <div>
            <div className="user-name">EastWill</div>
            <div className="user-status">在线</div>
          </div>
        </div>
      </aside>

      <section className="tai-main">
        <header className="topbar">
          <button className="version-pill" type="button">
            <span className="version-dot" />
            太极图 3.0
            <span className="caret">▾</span>
          </button>

          <div className="topbar-actions">
            <TopIconButton icon={<TopIconSearch />} />
            <TopIconButton icon={<TopIconBook />} />
            <TopIconButton icon={<TopIconBell />} />
            <img className="topbar-avatar" src="/ui/avatar-eastwill.svg" alt="EastWill" />
          </div>
        </header>

        <div className="hero-panel">
          <img className="hero-ring" src="/ui/ink-ring.svg" alt="水墨背景" />
          <img className="hero-seal" src="/ui/hero-seal.svg" alt="篆刻印章" />
          <div className="hero-title">太极图</div>
          <div className="hero-subtitle">以平衡之道，组织知识与灵感</div>
          <div className="hero-divider" />

          <div className="quick-grid">
            {quickCards.map((card) => (
              <button
                key={card.title}
                className="quick-card"
                type="button"
                onClick={() => setPrompt(card.prompt)}
              >
                <div className="quick-card-title">{card.title}</div>
                <div className="quick-card-desc">{card.desc}</div>
                <div className="quick-card-arrow">→</div>
              </button>
            ))}
          </div>
        </div>

        <div className="workspace-grid">
          <section className="card panel-card">
            <div className="panel-title">AI 作图工作台</div>
            <div className="panel-subtitle">简约但高雅，有传统文化气息，适合 EastWill 内部日常创作与演示。</div>

            <label className="field-label" htmlFor="prompt">主提示词</label>
            <textarea
              id="prompt"
              className="field-textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="请输入作图提示词，例如：一幅宋式留白风格的山水海报，竹影、云雾、温润青绿色调。"
            />

            <label className="field-label" htmlFor="negative">负面提示词</label>
            <textarea
              id="negative"
              className="field-textarea small"
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
              placeholder="例如：低清晰度、畸形、模糊、重复、过曝、多余手指"
            />

            <div className="field-row">
              <div className="field-group">
                <label className="field-label" htmlFor="size">图片尺寸</label>
                <select id="size" className="field-select" value={size} onChange={(e) => setSize(e.target.value as typeof size)}>
                  <option value="1024x1024">正方形 1024 × 1024</option>
                  <option value="1024x1536">竖图 1024 × 1536</option>
                  <option value="1536x1024">横图 1536 × 1024</option>
                </select>
              </div>

              <div className="field-group small-width">
                <label className="field-label" htmlFor="count">生成张数</label>
                <select id="count" className="field-select" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  <option value={1}>1 张</option>
                  <option value={2}>2 张</option>
                  <option value={3}>3 张</option>
                  <option value={4}>4 张</option>
                </select>
              </div>
            </div>

            <div className="button-row">
              <button className="primary-btn" type="button" onClick={handleGenerate} disabled={loading || !prompt.trim()}>
                {loading ? "生成中..." : "开始生成"}
              </button>
              <button
                className="ghost-btn"
                type="button"
                onClick={() => {
                  setPrompt(defaultPrompt);
                  setNegative("低清晰度，畸形，模糊，重复，多余肢体");
                  setSize("1024x1024");
                  setCount(1);
                }}
              >
                重置
              </button>
            </div>

            <div className="tip-box">
              <div className="tip-title">品牌与视觉建议</div>
              <ul>
                <li>主色：墨黑、松绿、暖白、印章朱红</li>
                <li>风格：水墨留白 + 极简排版 + 现代产品感</li>
                <li>品牌名：太极图</li>
                <li>公司署名：EastWill</li>
              </ul>
            </div>
          </section>

          <section className="card result-card">
            <div className="result-header">
              <div>
                <div className="panel-title">生成结果</div>
                <div className="panel-subtitle">本地成功保存的图片会显示在这里。</div>
              </div>
              {result?.jobId ? <div className="job-badge">任务号：{result.jobId}</div> : null}
            </div>

            {error ? <div className="error-box">{error}</div> : null}

            {loading ? <div className="empty-state">正在生成图片，请稍候...</div> : null}

            {!loading && generatedImages.length === 0 && !error ? (
              <div className="empty-state with-art">
                <img src="/ui/mountain-right.svg" alt="山水装饰" />
                <p>结果区域会展示新生成的图片。建议先尝试 1 张图进行测试。</p>
              </div>
            ) : null}

            {generatedImages.length > 0 ? (
              <div className="image-grid">
                {generatedImages.map((image, index) => (
                  <article key={image.id} className="image-card">
                    <img className="generated-image" src={image.url} alt={`生成图片 ${index + 1}`} />
                    <div className="image-card-footer">
                      <div>
                        <div className="image-card-title">第 {index + 1} 张作品</div>
                        <div className="image-card-url">{image.url}</div>
                      </div>
                      <a className="download-link" href={image.url} target="_blank" rel="noreferrer">
                        查看
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        </div>

        <footer className="page-footer">
          <div>太极图 · EastWill ｜ 内容由 AI 生成，仅供参考，请注意甄别</div>
          <img className="footer-bamboo" src="/ui/bamboo-right.svg" alt="竹影装饰" />
        </footer>
      </section>
    </main>
  );
}

function NavItem({ icon, text, active = false }: { icon: ReactNode; text: string; active?: boolean }) {
  return (
    <button className={`nav-item ${active ? "active" : ""}`} type="button">
      <span className="nav-icon">{icon}</span>
      <span>{text}</span>
    </button>
  );
}

function TopIconButton({ icon }: { icon: ReactNode }) {
  return (
    <button className="top-icon-btn" type="button" aria-label="toolbar button">
      {icon}
    </button>
  );
}

function SidebarIconChat() {
  return <svg viewBox="0 0 24 24" fill="none"><path d="M5 7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5v5A2.5 2.5 0 0 1 16.5 15H10l-4 4v-4H7.5A2.5 2.5 0 0 1 5 12.5v-5Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function SidebarIconHistory() {
  return <svg viewBox="0 0 24 24" fill="none"><path d="M12 8v4l2.5 2.5M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function SidebarIconBook() {
  return <svg viewBox="0 0 24 24" fill="none"><path d="M5 6.5A2.5 2.5 0 0 1 7.5 4H19v15H7.5A2.5 2.5 0 0 0 5 21V6.5Zm0 0A2.5 2.5 0 0 1 7.5 9H19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function SidebarIconGrid() {
  return <svg viewBox="0 0 24 24" fill="none"><path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>;
}
function SidebarIconSetting() {
  return <svg viewBox="0 0 24 24" fill="none"><path d="M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Zm8 3.2-1.73-.65a6.74 6.74 0 0 0-.48-1.16l.78-1.67-1.98-1.98-1.67.78c-.37-.18-.76-.34-1.16-.48L13 3h-2l-.65 1.73c-.4.14-.79.3-1.16.48l-1.67-.78-1.98 1.98.78 1.67c-.18.37-.34.76-.48 1.16L4 11v2l1.73.65c.14.4.3.79.48 1.16l-.78 1.67 1.98 1.98 1.67-.78c.37.18.76.34 1.16.48L11 21h2l.65-1.73c.4-.14.79-.3 1.16-.48l1.67.78 1.98-1.98-.78-1.67c.18-.37.34-.76.48-1.16L20 13v-2Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function TopIconSearch() {
  return <svg viewBox="0 0 24 24" fill="none"><path d="m20 20-3.8-3.8M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function TopIconBook() {
  return <svg viewBox="0 0 24 24" fill="none"><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v16H7.5A2.5 2.5 0 0 0 5 21V5.5Zm0 0A2.5 2.5 0 0 1 7.5 8H19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function TopIconBell() {
  return <svg viewBox="0 0 24 24" fill="none"><path d="M15 18a3 3 0 0 1-6 0m10-2H5l1.2-1.35A2 2 0 0 0 6.7 13V10a5.3 5.3 0 1 1 10.6 0v3c0 .48.17.95.5 1.3L19 16Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

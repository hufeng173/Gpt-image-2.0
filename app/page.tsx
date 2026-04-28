"use client";

import { useState } from "react";

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/images/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          negative,
          size,
          count: 1,
        }),
      });

      const data = await res.json();
      setResult(data);
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : "unknown error",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold">Image 2.0</h1>
        <p className="mt-2 text-gray-500">内部 AI 作图应用测试版</p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="font-medium">提示词</label>
        <textarea
          className="min-h-40 rounded-lg border p-4"
          placeholder="请输入作图提示词，例如：一只穿着宇航服的猫，站在月球上，电影质感，高细节"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="font-medium">负面提示词，可选</label>
        <textarea
          className="min-h-24 rounded-lg border p-4"
          placeholder="例如：低清晰度、畸形、模糊、多余手指"
          value={negative}
          onChange={(e) => setNegative(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="font-medium">图片尺寸</label>
        <select
          className="rounded-lg border p-3"
          value={size}
          onChange={(e) => setSize(e.target.value)}
        >
          <option value="1024x1024">1024x1024 正方形</option>
          <option value="1024x1536">1024x1536 竖图</option>
          <option value="1536x1024">1536x1024 横图</option>
        </select>
      </div>

      <button
        className="rounded-lg bg-black px-4 py-3 text-white disabled:opacity-50"
        disabled={loading || !prompt.trim()}
        onClick={handleGenerate}
      >
        {loading ? "生成中..." : "开始生成"}
      </button>

      {result && (
        <div className="rounded-lg border p-4">
          <h2 className="mb-2 font-semibold">接口返回结果</h2>
          <pre className="max-h-96 overflow-auto rounded-lg bg-gray-100 p-4 text-sm">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </main>
  );
}
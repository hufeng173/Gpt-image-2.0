# 太极图 V4 替换说明

本版本完成以下需求：

1. 参考图片分类上传：构图、配色、材质、光线、其他。
   - 构图：最多 2 张
   - 配色：最多 2 张
   - 材质：最多 2 张
   - 光线：最多 2 张
   - 其他：最多 4 张，作为万能参考
2. 生成时会把分类参考图写入后端提示词，并按分类额外强调。
3. 选中图片优化有独立“优化生成张数”，不再复用主生成张数。
4. 新增完整上下文对话：使用 `AI_TEXT_MODEL`，默认 `gpt-5.4`。
5. 新对话功能已实现；左侧不再显示“历史记录”，而是直接显示对话标题。
6. 点击对话标题可切换到对应对话。
7. 生成图片会写入当前对话上下文，点击对话里的图片可回到作图工作台继续优化。
8. 自定义尺寸保持自由输入，后端会先使用最接近的模型尺寸生成，再用 sharp 后处理到目标尺寸。

## 替换文件

把本包中的文件覆盖到项目根目录。

重点替换：

- `app/page.tsx`
- `app/globals.css`
- `app/layout.tsx`
- `app/api/chat/route.ts`
- `app/api/images/generate/route.ts`
- `app/api/prompt/optimize/route.ts`
- `app/api/uploads/route.ts`
- `lib/ai/relay-provider.ts`
- `lib/settings.ts`
- `lib/error-reason.ts`
- `prisma/schema.prisma`
- `postcss.config.mjs`

## 执行命令

```powershell
cd "E:\Project_code\VScode\image2.0"
pnpm add sharp
pnpm prisma generate
Remove-Item -Recurse -Force ".next"
pnpm dev
```

不要执行新的 Prisma 迁移。本版本没有改变数据库结构。

## 环境变量建议

```env
AI_RELAY_BASE_URL="https://tokens.byteseek.ai/v1"
AI_RELAY_API_KEY="你的新key"
AI_IMAGE_MODEL="gpt-image-2"
AI_TEXT_MODEL="gpt-5.4"
```

## 本地品牌图片

放在：

```text
public/brand/
```

文件名：

- `background.png`：1920x1080，页面背景
- `logo.png`：建议透明 PNG，约 640x180
- `seal.png`：建议透明 PNG，约 256x256

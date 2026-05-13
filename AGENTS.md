# AGENTS.md

## 项目定位

本仓库是一个 Next.js 图像生成应用，包含前端界面、API Route、Prisma 数据模型、上传文件与生成图片资产。

默认以程序开发、智能体开发、工作流搭建、App 功能迭代和方案撰写为主要协作场景。

## 沟通与决策规则

- 默认使用中文沟通；代码、命令、变量名、文件路径和接口字段保持英文。
- 结论先行，再给理由；不要用客套话开头。
- 从问题本质出发做判断，不因惯例照搬。
- 发现方案有问题时直接指出，并给出更直接的替代方案。
- 遇到模糊需求，先按最合理方案推进；只有命中红线或存在明显不可逆风险时才暂停询问。

## 约束先行

- 新项目先写 `AGENTS.md`；新目录先定义结构约定，再放文件。
- 没有规范的工作空间不开始开发；已有规范时严格遵守本文件。
- 需要调整规范时，先更新 `AGENTS.md` 或对应目录说明，再按新规范实践。
- 能先读取和分析，就先读取和分析，再改动。

## 自主边界

以下操作必须先取得用户明确确认：

- 删除文件、目录或 git 历史。
- 修改 `.env`、密钥、token、CI/CD 配置。
- 数据库结构变更、数据迁移或生产数据操作。
- `git push`、`git rebase`、`git reset --hard`、强制推送。
- 安装新的全局依赖或修改系统配置。
- 公开发布，例如 `npm publish`、生产部署、公开发文。
- 大范围重构或跨模块大改动；先给方案，确认后实施。

## 目录约定

- `app/`：Next.js App Router 页面、布局和 API Route。
- `components/`：可复用 React 组件；`components/ui/` 存放基础 UI 组件。
- `lib/`：服务端与客户端共享工具、业务工具、AI Provider、访问控制等逻辑。
- `data/`：本地数据文件与运行期生成内容；不要把密钥放入此目录。
- `data/generated/`：服务端生成图片文件。
- `public/`：公开静态资源。
- `public/generated/`：可公开访问的生成图片。
- `public/uploads/`：用户上传资源。
- `public/brand/`：品牌、Logo、背景、加载动画等品牌资产。
- `public/ui/`：界面装饰性静态资产。
- `docs/`：产品说明、版本说明、方案文档。
- `prisma/`：Prisma schema 与 migrations；涉及迁移必须先确认。

## 命名与清理

- 代码文件优先使用小写短横线命名，例如 `image-files.ts`。
- React 组件导出名使用 `PascalCase`。
- API 路由保持 REST 风格目录结构，动态参数使用 `[name]`。
- 生成图片、上传图片等运行期产物按现有命名规则追加，不随意重命名历史文件。
- 临时日志、调试输出、一次性脚本在任务完成后说明用途；需要删除时先询问。

## 前端修改规则

- 前端页面修改必须保持响应式布局，兼容移动端与桌面端。
- 延续现有视觉语言和组件风格，优先复用 `components/ui/` 与已有 CSS 变量。
- 控件尺寸、文本换行和容器宽度要显式考虑，避免移动端溢出或重叠。
- 交互按钮优先使用已有图标体系和组件约定。
- 修改完成后尽量运行构建或类型检查，并在需要时启动本地页面核对。

## 后端与接口规则

- 后端接口修改必须兼容旧接口返回格式，除非用户明确要求破坏性变更。
- API Route 错误返回应保持结构稳定，避免把内部错误、密钥或 token 输出到响应和日志。
- 访问控制、并发控制、请求保护相关逻辑优先复用 `lib/` 中已有模块。
- 涉及 Prisma schema、migration 或数据迁移时必须先停下来确认。

## 验证规则

- 改完主动跑验证，不只改不验。
- 优先使用项目已有脚本：`pnpm build`、`pnpm lint`、`pnpm prisma:generate`。
- Next.js 16 已移除 `next lint`；lint 脚本必须使用 ESLint CLI，例如 `eslint .`。
- 不为了让验证通过而注释报错或增加绕过标记；应定位根因。

## 安全规则

- 密钥、token、密码不进代码、不进 commit、不进日志。
- 不读取或修改 `.env`，除非用户明确要求并确认风险。
- 不把用户上传内容或生成图片误当作可随意删除的临时文件。

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AI Auth Bridge

纯前端的 **Auth / Session JSON 格式互转** 工具。

在浏览器本地完成解析与转换：不上传 token，不把凭证写入业务存储。

**仓库：** [github.com/luoyeETH/AIAuthBridge](https://github.com/luoyeETH/AIAuthBridge)  
**在线：** [authx.luoye.de](https://authx.luoye.de)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/luoyeETH/AIAuthBridge)

---

## 功能

| 分类 | 能力 |
| --- | --- |
| **Codex** | ChatGPT Web session、9router、Codex、AxonHub、Codex-Manager 等 ↔ CPA / sub2api / Cockpit / 9router / Codex / AxonHub / Codex-Manager |
| **Grok** | xAI CPA 扁平凭证（`xai-*.json`）↔ sub2api（`type=sub2api-data`）双向互转，并补全 JWT 字段 |

其它：

- 粘贴 JSON 或拖入多个文件
- 实时转换、账号预览、复制 / 下载
- 主题：系统 / 浅色 / 深色（默认跟随系统）

---

## 快速开始

### 在线

打开 [authx.luoye.de](https://authx.luoye.de) 即可。

### 一键部署到 Vercel

点击上方 **Deploy** 按钮，用 GitHub 登录后即可克隆并部署。Vercel 会自动识别 Vite，构建命令为 `npm run build`，输出目录为 `dist`。

也可在 [vercel.com/new](https://vercel.com/new) 手动导入本仓库，框架预设选 Vite。

### 本地开发

需要 Node.js 18+。

```bash
git clone https://github.com/luoyeETH/AIAuthBridge.git
cd AIAuthBridge
npm install
npm run dev
```

```bash
npm test          # 单元测试
npm run build     # 构建到 dist/
npm run preview   # 预览生产构建
```

部署 GitHub Pages 时，将 Pages 源指向构建产物 `dist/`（或使用 Actions 部署），无需把构建结果提交进仓库。

---

## 使用说明

1. 顶栏切换 **Codex** 或 **Grok**
2. 左侧粘贴 / 拖入 JSON
3. 右侧选择输出格式，复制或下载

### Codex

- 输入：ChatGPT session、9router OAuth、Codex `auth.json`、AxonHub、Codex-Manager 等（含 `accessToken` 的同类结构）
- ChatGPT session 可选来源：`https://chatgpt.com/api/auth/session`
- 仅做格式转换，不能绕过 OpenAI / Codex 的登录与手机绑定等限制
- Web session 通常无 `refresh_token`，过期后无法自动刷新

### Grok

| 方向 | 说明 |
| --- | --- |
| CPA → sub2api | 扁平 `type=xai` 凭证 → `{ type: "sub2api-data", version: 1, accounts }` |
| sub2api → CPA | sub2api 导出 → CPA 扁平（单账号对象 / 多账号数组） |

推荐使用含 `refresh_token` 的 OAuth 凭证；仅短期 `access_token` 且已过期时会被跳过。

---

## 技术栈

- React 19 + TypeScript
- Vite 7
- Vitest
- 静态构建输出 `dist/`

转换逻辑为纯函数模块，与 UI 解耦。

---

## 目录

```text
AIAuthBridge/
├── index.html
├── package.json
├── vite.config.ts
├── public/                 # favicon 等
├── src/
│   ├── App.tsx
│   ├── hooks/useTheme.ts
│   ├── lib/
│   │   ├── convert.ts      # Codex 系转换
│   │   ├── grokConvert.ts  # Grok CPA ↔ sub2api
│   │   ├── types.ts
│   │   └── examples.ts
│   └── styles/global.css
└── tests/
    ├── convert-session.test.ts
    └── grok-convert.test.ts
```

---

## 隐私

| 项目 | 说明 |
| --- | --- |
| 网络 | 转换过程不请求后端 |
| Token | 不上传、不写入业务存储 |
| 主题 | 仅 `localStorage` 保存 `system` / `light` / `dark` |

---

## 许可

[MIT](./LICENSE) © luoyeETH

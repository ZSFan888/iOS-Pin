# 部署指南

一份手把手的指南，帮你在自己的 Cloudflare 账号上把 Worker 跑起来。

## 1. 前置条件

- Node.js 20+
- 一个 Cloudflare 账号
- Wrangler CLI（在 `Worker/` 目录下执行 `npm install` 时会自动安装）

## 2. 安装依赖

```bash
cd Worker
npm install
```

## 3. 登录 Wrangler

```bash
npx wrangler login
```

## 4. 创建 KV 命名空间

```bash
npx wrangler kv namespace create ios-pin-locations
```

这条命令会打印出一个命名空间 `id`，把它复制到 `Worker/wrangler.jsonc` 中：

```jsonc
"kv_namespaces": [
  { "binding": "LOCATIONS", "id": "<粘贴你的 id>" }
]
```

如果你打算单独部署一个生产环境，也需要再创建第二个命名空间，并把它的 id 填入 `env.production.kv_namespaces` 里。

## 5.（可选）配置访问控制

默认情况下，任何知道你 Worker 地址和 Token 的人都可以读写对应设备的坐标。如果要限制这一点：

```bash
# 要求所有写请求都携带共享密钥（放在 x-wloc-key 请求头中）
npx wrangler secret put API_KEY

# 可选：限制哪些设备 Token 允许被使用（用逗号分隔）
npx wrangler secret put ALLOWED_TOKENS
```

本地开发时，把 `.dev.vars.example` 复制为 `.dev.vars` 并填入相同的值——`wrangler dev` 会自动读取 `.dev.vars`，并且这个文件已经被 git 忽略，不会被提交。

## 6. 本地运行

```bash
npm run dev
```

Wrangler 会打印一个本地地址（通常是 `http://localhost:8787`）。测试时把这个地址填入 `Frontend/Public/Console.html` 里的"Worker 地址"字段即可。

## 7. 部署到生产环境

```bash
npm run deploy
# 或者，部署到指定的生产环境：
npx wrangler deploy --env production
```

Wrangler 会打印出你线上的 Worker 地址，例如 `https://ios-pin.<你的子域名>.workers.dev`。

## 8. 让前端连接到你的 Worker

打开 `Frontend/Public/Console.html`（也可以把它托管到 Cloudflare Pages 上），填入：

- Worker 地址：你部署好的 Worker 地址
- 设备 Token：任意你自定义的标识，例如 `iphone-main`
- API Key：只有在第 5 步设置了 `API_KEY` 时才需要填写

## 9. 生成并安装代理模块

在控制台里选择一个客户端（Surge / Loon / Quantumult X / Stash / Shadowrocket），点击"生成模块地址"。在对应的代理 App 中打开这个地址，即可安装 MITM 与脚本模块。请确保 MITM 的主机名同时包含 `gs-loc.apple.com` 和 `gs-loc-cn.apple.com`。

## 10. 验证 protobuf 字段假设

在正式日常使用之前，建议先抓取一份真实响应并运行检查工具：

```bash
node Scripts/Inspect-capture.mjs Test/Fixtures/sample-01.bin
```

把打印出来的字段布局与 `Src/Proto/Apple-wloc.ts` 中的假设进行对比，如果 Apple 的实际响应结构有差异，就相应调整。

## 持续集成

每次涉及 `Worker/**` 的推送都会触发 `.github/workflows/Worker-ci.yml`，自动运行 Vitest 测试套件和 TypeScript 类型检查。合并改动前请确保这个流程通过。

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

## 7. 一次部署，前后端都上线

`Worker/wrangler.jsonc` 里的 `assets.directory` 指向 `../Frontend/Public`，所以 **一次 `wrangler deploy` 会同时发布前端页面和后端 API**，不需要再单独部署 Cloudflare Pages。

```bash
npm run deploy
# 或者，部署到指定的生产环境：
npx wrangler deploy --env production
```

Wrangler 会打印出你线上的 Worker 地址，例如 `https://ios-pin.<你的子域名>.workers.dev`。这个地址现在同时是：

- 前端控制台地址：直接访问该地址即可打开 `Console.html`
- 后端 API 地址：`/api/*`、`/relay/*`、`/script/*.js` 等路由都在同一个域名下

## 8. 打开前端控制台

直接在浏览器里访问第 7 步打印出的 Worker 地址即可看到控制台页面（因为前端已经和 Worker 一起部署了）。页面打开时会自动把"Worker 地址"输入框填充为当前页面地址，你只需要填写：

- 设备 Token：任意你自定义的标识，例如 `iphone-main`
- API Key：只有在第 5 步设置了 `API_KEY` 时才需要填写

如果你想在本地单独预览前端样式（不连接真实 Worker），仍然可以直接双击打开 `Frontend/Public/Console.html`，或用任意静态服务器托管它，再手动填入其他环境的 Worker 地址。

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


## 方式三：通过 GitHub Actions 自动部署（推送即上线）

除了本地手动执行 `wrangler deploy`，仓库里的 `.github/workflows/Worker-ci.yml` 现在已经内置了**部署任务**：每次推送到 `main` 分支，测试通过后会自动执行 `npx wrangler deploy` 把 Worker 部署到 Cloudflare。

要让这个自动部署生效，需要在 GitHub 仓库里配置一个密钥：

1. 生成一个 Cloudflare API Token：登录 [Cloudflare 控制台](https://dash.cloudflare.com) → 右上角头像 → **My Profile** → **API Tokens** → **Create Token**，选择 **Edit Cloudflare Workers** 模板（或自定义权限：Account → Workers Scripts 编辑、Workers KV Storage 编辑）。
2. 复制生成的 Token。
3. 打开你的 GitHub 仓库页面 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**。
4. **Name** 填 `CLOUDFLARE_API_TOKEN`，**Value** 粘贴刚生成的 Token，保存。
5. 之后每次 `git push` 到 `main` 分支，GitHub Actions 会自动跑测试，测试通过后自动部署，无需再手动执行 `wrangler deploy`。

> 这个方式和"方式二：连接 GitHub 仓库自动部署"（Cloudflare Workers Builds）是两条独立的自动部署路径，二选一即可，不要同时启用，否则同一次推送会触发两次部署。

## 通过 Cloudflare 网站控制台部署（不使用命令行）

如果你不想用 Wrangler CLI，也可以完全在浏览器里通过 Cloudflare 官网控制台完成部署。由于前端资源已经打包进 Worker 部署（见第 7 步），这里只需要部署一次 Worker，不需要再单独部署 Cloudflare Pages。

### 一、部署 Worker（后端）

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com)，在左侧菜单进入 **Workers 和 Pages**。
2. 点击 **创建应用程序** → 选择 **创建 Worker**。
3. 给 Worker 起一个名字，例如 `ios-pin`，然后点击 **部署**（此时会先生成一个默认的 "Hello World" 模板）。
4. 部署完成后，点击进入该 Worker，选择 **编辑代码**（会打开在线代码编辑器 Quick Edit）。
5. 把仓库中 `Worker/Src/Index.ts` 和 `Worker/Src/Proto/Apple-wloc.ts` 的内容分别粘贴到编辑器中对应的文件里（如果编辑器只支持单文件，需要手动把 `Apple-wloc.ts` 的内容合并到 `Index.ts` 顶部，并删除多余的 `import`/`export` 语句）。
6. 点击右上角 **保存并部署**。

> 提示：Cloudflare 在线编辑器目前对多文件 TypeScript 项目支持有限，如果遇到编译报错，建议优先使用下面的"连接 GitHub 仓库自动部署"方式，能完整支持这个项目的多文件结构。

### 二、通过连接 GitHub 仓库自动部署（推荐）

这种方式可以让 Cloudflare 直接从你的 GitHub 仓库拉取代码并自动构建，后续每次 `git push` 都会自动触发重新部署。

1. 在 Cloudflare 控制台进入 **Workers 和 Pages** → **创建应用程序**。
2. 选择 **连接到 Git**，授权 Cloudflare 访问你的 GitHub 账号（`ZSFan888`）。
3. 选择仓库 `ZSFan888/iOS-Pin`。
4. 在构建配置中填写：
   - **根目录**：`Worker`
   - **构建命令**：`npm install`
   - **部署命令**：`npx wrangler deploy`
5. 点击 **保存并部署**，Cloudflare 会自动安装依赖并执行部署。
6. 部署完成后，在 Worker 的 **设置 → 变量和机密** 页面里添加环境变量：
   - 如果需要访问控制，添加 **机密变量** `API_KEY` 和/或 `ALLOWED_TOKENS`（类型选择 "机密" 而不是明文变量，避免在控制台被直接查看）。
7. 在 Worker 的 **设置 → 绑定** 页面里添加 **KV 命名空间绑定**：
   - 变量名称填 `LOCATIONS`
   - 选择或新建一个 KV 命名空间（如果还没有，可以在 **存储和数据库 → KV** 页面先创建一个，例如命名为 `ios-pin-locations`）

### 三、（已不再需要）单独部署 Frontend 到 Cloudflare Pages

以前的版本需要把 `Frontend/Public` 单独部署到 Cloudflare Pages。**现在不需要这一步了**——第二步部署 Worker 时，`wrangler.jsonc` 的 `assets.directory` 已经把 `Frontend/Public` 一起打包上传，访问 Worker 地址本身即可看到控制台页面。如果你依然想保留一个独立的 Pages 站点（例如挂到自定义域名），仍然可以按旧流程单独部署，两者不冲突。

### 四、后续更新方式

采用"连接 GitHub 仓库"的方式后，你不需要再手动操作 Cloudflare 控制台——只要执行 `git push` 把新代码推送到 `main` 分支，Cloudflare 会自动检测改动并重新构建部署 Worker（前端和后端在同一次部署里一起更新）。

# 部署指南

本项目现在只保留 **Cloudflare Pages 部署** 这一种方式：前端静态文件放在 `Frontend/Public`，后端逻辑通过同目录下的 `_worker.js` 以 Pages Functions Advanced Mode 运行，因此前后端共用同一个 `*.pages.dev` 域名 [web:258][web:256]。

## 1. 前置条件

- 一个 Cloudflare 账号
- 一个 GitHub 仓库
- 仓库代码已经推送到 GitHub

## 2. Pages 架构说明

Cloudflare Pages 支持在项目输出目录中放置 `_worker.js`，由它接管动态请求；如果 `_worker.js` 调用 `env.ASSETS.fetch(request)`，则可以继续返回静态文件，这正适合把当前项目改成“Pages 托管前端 + Functions 处理 API”的单一架构 [web:258]。

本项目里：

- `Frontend/Public/Console.html` 是前端页面
- `Frontend/Public/_worker.js` 是 Pages Functions Advanced Mode 入口
- `Worker/Src/Proto/Apple-wloc.ts` 仍然负责 protobuf 坐标改写逻辑

## 3. 在 Cloudflare 创建 Pages 项目

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com)。
2. 进入 **Workers & Pages**。
3. 点击 **Create application** → **Pages**。
4. 选择 **Connect to Git**，授权并选择你的 GitHub 仓库；Cloudflare Pages 支持 Git 集成，连接后每次 push 都会自动构建与部署 [web:265]。
5. 构建配置填写：
   - **Framework preset**：None
   - **Build command**：留空
   - **Build output directory**：`Frontend/Public`
6. 点击 **Save and Deploy**。

## 4. 配置 KV 绑定

Pages Functions 可以使用 KV 等绑定来提供动态能力 [web:255]。部署完成后，在 Pages 项目设置中：

1. 进入 **Settings** → **Bindings**。
2. 添加一个 **KV Namespace** 绑定。
3. 绑定名称填写 `LOCATIONS`。
4. 选择或新建一个 KV 命名空间，例如 `ios-pin-locations`。

## 5. 配置可选密钥

如果你不想让任何人都能改设备坐标，可以在 Pages 项目里增加环境变量/机密：

- `API_KEY`：要求前端写请求必须带 `x-wloc-key`
- `ALLOWED_TOKENS`：允许使用的设备 Token 白名单，逗号分隔

这些变量会注入到 `_worker.js` 的 `env` 中供后端逻辑读取 [web:255]。

## 6. 使用方式

部署成功后，Cloudflare 会给你一个 `https://<project>.pages.dev` 地址：

- 打开根路径可以直接访问前端控制台
- 前端页面会访问同域名下的 `/api/*`
- 代理模块会访问同域名下的 `/relay/*` 和 `/script/*`

因为现在是单一 Pages 架构，所以以后只需要维护这一个项目，更新代码后直接 `git push`，Pages 会自动重新部署 [web:265]。

## 7. 本地预览（可选）

如果你装了 Wrangler，也可以本地预览 Pages 项目：

```bash
npm install
npm run dev
```

这会使用 `wrangler pages dev Frontend/Public` 在本地启动 Pages 环境，便于调试 `_worker.js` 与静态页面。

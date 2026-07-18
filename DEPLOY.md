# 部署指南

本项目只使用 **Cloudflare Pages** 部署：前端静态文件放在 `Frontend/Public`，后端逻辑通过同目录下的 `_worker.js` 以 Pages Functions Advanced Mode 运行，因此前后端共用同一个 `*.pages.dev` 域名。整个流程从头到尾都在浏览器里通过 Cloudflare 控制台完成，不需要安装任何命令行工具。

## 1. 前置条件

- 一个 Cloudflare 账号（免费版即可）
- 一个 GitHub 仓库，代码已经推送到 GitHub

## 2. 项目结构说明

- `Frontend/Public/Console.html`：前端地图控制台页面
- `Frontend/Public/_worker.js`：Pages Functions Advanced Mode 入口，包含坐标存取 API、Apple WLOC 中继逻辑、代理模块生成逻辑
- `Worker/Src/Proto/Apple-wloc.ts`：protobuf 坐标改写逻辑（被 `_worker.js` 复用/参考）
- `Worker/Test/`：针对 protobuf 改写逻辑的 Vitest 测试
- `wrangler.jsonc`：根目录下的 Pages 配置文件，`pages_build_output_dir` 指向 `Frontend/Public`

## 3. 创建 Pages 项目并连接 GitHub

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com)。
2. 左侧菜单进入 **Workers & Pages**。
3. 点击 **Create application** → 选择 **Pages** 标签页 → **Connect to Git**。
4. 授权 Cloudflare 访问你的 GitHub 账号，选择这个仓库。
5. 在构建配置页填写：
   - **Project name**：任意，例如 `ios-pin`
   - **Production branch**：`main`
   - **Framework preset**：None
   - **Build command**：留空
   - **Build output directory**：`Frontend/Public`
6. 点击 **Save and Deploy**，Cloudflare 会拉取仓库代码并完成第一次部署。

部署完成后会得到一个形如 `https://ios-pin.pages.dev` 的地址，先记下它，接下来还需要两步配置才能正常使用。

## 4. 添加 KV 命名空间绑定

坐标和历史记录都存储在 Cloudflare KV 里，Pages Functions 需要绑定这个 KV 命名空间才能读写：

1. 在刚创建的 Pages 项目里，进入 **Settings → Bindings**。
2. 点击 **Add binding** → 选择 **KV namespace**。
3. **Variable name** 填写 `LOCATIONS`（必须完全一致，`_worker.js` 里是按这个名字读取的）。
4. **KV namespace** 选择一个已有命名空间，或者点击 **Create new** 现场新建一个，例如命名为 `ios-pin-locations`。
5. 保存绑定。

## 5.（可选）配置访问控制密钥

默认情况下，任何知道你 Pages 地址和设备 Token 的人都可以读写对应坐标，适合个人使用。如果要加一层保护：

1. 进入 **Settings → Environment variables**。
2. 点击 **Add variable**，添加：
   - **Variable name**：`API_KEY`，**Value** 填你自定义的密钥，类型选择 **Secret**（加密存储，避免在控制台被直接查看）
   - 可选再添加 **Variable name**：`ALLOWED_TOKENS`，**Value** 填允许使用的设备 Token，用英文逗号分隔，例如 `iphone-main,ipad-test`
3. 保存后这两个变量会同时应用到 Production 和 Preview 环境（如果 Cloudflare 界面要求分别选择环境，两个都勾选）。

## 6. 让新配置生效：重新部署一次

添加 KV 绑定或环境变量之后，**必须重新触发一次部署** 才会生效：

1. 进入 Pages 项目的 **Deployments** 标签页。
2. 找到最新的一次部署，点击右侧 **⋯** 菜单 → **Retry deployment**。
3. 等待状态变为 **Success**。

## 7. 打开前端控制台开始使用

直接在浏览器访问第 3 步得到的 Pages 地址即可看到控制台页面。页面打开时会自动把"站点地址"输入框填充为当前页面地址，你只需要填写：

- **设备 Token**：任意自定义标识，例如 `iphone-main`
- **API Key**：只有在第 5 步设置了 `API_KEY` 时才需要填写

## 8. 生成并安装代理模块

在控制台里选择一个客户端（Surge / Loon / Quantumult X / Stash / Shadowrocket），点击"生成模块地址"。在对应的代理 App 中打开这个地址，即可安装 MITM 与脚本模块。请确保 MITM 的主机名同时包含 `gs-loc.apple.com` 和 `gs-loc-cn.apple.com`。

## 9. 验证 protobuf 字段假设（建议在正式使用前做一次）

`_worker.js` 里的 protobuf 改写逻辑基于公开的社区逆向结果。建议先用真实抓包验证一次：

1. 用 Surge/Loon 的 MITM 日志功能，抓取一份真实的 `gs-loc.apple.com/clls/wloc` 响应体，保存为 `Worker/Test/Fixtures/sample-01.bin`（注意脱敏，不要包含真实 BSSID 或个人信息）。
2. 在本地电脑（需要装 Node.js）运行：
   ```bash
   cd Worker
   npm install
   node Scripts/Inspect-capture.mjs Test/Fixtures/sample-01.bin
   ```
3. 对照打印出来的字段布局与 `Worker/Src/Proto/Apple-wloc.ts` 中的假设，如有差异就相应调整，并同步更新 `Frontend/Public/_worker.js` 中的引用逻辑。

## 10. 后续更新方式

以后修改代码只需要 `git push` 到 `main` 分支，Cloudflare Pages 会自动检测到改动、重新构建并部署，不需要再手动操作 Cloudflare 控制台。如果只是改了环境变量或 KV 绑定（没有改代码），则需要按第 6 步手动触发一次 **Retry deployment**。

## 持续集成（仅测试，不做部署）

每次涉及 `Worker/**` 的推送都会触发 `.github/workflows/Worker-ci.yml`，自动运行 Vitest 测试套件和 TypeScript 类型检查，帮助在合并前发现 protobuf 改写逻辑的问题。这个工作流**不负责部署**——实际站点部署完全由 Cloudflare Pages 的 Git 集成自动完成（见第 3 步）。

## 本地预览（可选）

如果你在本地装了 Node.js，也可以在推送前先本地预览：

```bash
npm install
npm run dev
```

这会执行 `wrangler pages dev Frontend/Public`，本地启动一个 Pages 模拟环境，便于在推送前调试 `_worker.js` 和静态页面。

# iOS Pin

一个基于 Cloudflare Worker 的 iOS 虚拟定位工具：通过修改 Apple WLOC（WiFi 定位）响应，让指定设备在系统层面"看到"你在控制台里选择的坐标，而不是真实位置。

> 使用前请了解：这个项目依赖 MITM（中间人）方式拦截 Apple 的定位请求，仅建议在自己的设备上用于测试、开发或隐私保护场景，请遵守当地法律法规与 App 服务条款。

## 目录

- [项目原理](#项目原理)
- [项目结构](#项目结构)
- [准备工作](#准备工作)
- [第一步：部署 Worker](#第一步部署-worker)
- [第二步：打开控制台并保存坐标](#第二步打开控制台并保存坐标)
- [第三步：在代理客户端安装模块](#第三步在代理客户端安装模块)
- [第四步：验证虚拟定位是否生效](#第四步验证虚拟定位是否生效)
- [常见问题排查](#常见问题排查)
- [进阶：访问控制](#进阶访问控制)
- [进阶：多设备管理](#进阶多设备管理)
- [进阶：验证 protobuf 字段假设](#进阶验证-protobuf-字段假设)
- [已知限制](#已知限制)
- [本地开发](#本地开发)

---

## 项目原理

iOS 定位系统在 GPS 信号弱或不可用时，会向 `gs-loc.apple.com/clls/wloc`（中国大陆走 `gs-loc-cn.apple.com`）发送周边 WiFi 信息，换取一个坐标。整个流程是：

1. 代理客户端（Surge / Loon / Quantumult X / Stash / Shadowrocket）通过 MITM 拦截这条 HTTPS 请求；
2. 代理脚本把原始请求转发给你部署的 Cloudflare Worker；
3. Worker 再把请求转发给 Apple 真实服务器，拿到真实的 protobuf 响应；
4. Worker 解析这个 protobuf 响应，把里面的经纬度字段替换成你在控制台里保存的坐标；
5. 改写后的响应交还给代理客户端，最终交还给 iOS 系统，设备就"认为"自己在你指定的位置。

坐标数据按"设备 Token"存储在 Cloudflare KV 里，所以同一个 Worker 可以同时管理多台设备，每台设备用不同 Token 区分。

## 项目结构

```
iOS-Pin/
├── Worker/                  Cloudflare Worker 后端（Hono 框架）
│   ├── Src/Index.ts         API 路由、中继逻辑、代理模块生成
│   ├── Src/Proto/           protobuf 改写逻辑
│   ├── Test/                Vitest 测试 + 抓包回归测试
│   └── Scripts/             protobuf 字段转储调试工具
├── Frontend/Public/         静态前端控制台（Console.html）
├── Modules-Templates/       各代理客户端模块模板说明
├── Shortcuts/               iOS 快捷指令占位目录
├── README.md                本文件
└── DEPLOY.md                更详细的 Wrangler/Cloudflare 部署参考
```

## 准备工作

开始之前，确认你有以下条件：

- 一个 **Cloudflare 账号**（免费版即可）
- 一台已安装以下任一代理客户端的 iOS 设备：Surge、Loon、Quantumult X、Stash 或 Shadowrocket，并已启用该客户端的 **MITM 功能**（需要先在设备上安装客户端提供的根证书）
- 本地电脑安装 **Node.js 20+**（仅部署时需要，日常使用不需要）

## 第一步：部署 Worker

### 方式 A：命令行部署（推荐，熟悉终端的用户）

```bash
git clone https://github.com/<你的用户名>/<你的仓库>.git
cd <你的仓库>/Worker
npm install
npx wrangler login
npx wrangler kv namespace create ios-pin-locations
```

把上一条命令返回的 `id` 填入 `Worker/wrangler.jsonc` 的 `kv_namespaces` 里：

```jsonc
"kv_namespaces": [
  { "binding": "LOCATIONS", "id": "<粘贴你的 id>" }
]
```

然后执行一次部署，**前端和后端会一起发布**，不需要分两次操作：

```bash
npm run deploy
```

命令执行完，终端会打印出一个形如 `https://ios-pin.<你的子域名>.workers.dev` 的地址——这个地址同时是你的前端控制台地址和后端 API 地址，记下它。

### 方式 B：纯网页操作（不使用命令行）

如果你不想装 Node.js 或用终端，可以完全在浏览器里通过 Cloudflare 控制台完成部署，详细图文步骤见 [`DEPLOY.md`](./DEPLOY.md) 中的"通过 Cloudflare 网站控制台部署"章节。推荐使用"连接 GitHub 仓库自动部署"的方式，这样以后你每次 `git push` 都会自动重新部署。

## 第二步：打开控制台并保存坐标

1. 用浏览器打开第一步部署好的 Worker 地址，会看到地图控制台页面。
2. 页面会自动把"Worker 地址"输入框填成当前地址（因为前后端同源），你不需要手动填。
3. 在"设备 Token"输入框里填一个你自定义的标识，例如 `iphone-main`——同一台设备之后都用这个 Token。
4. 在地图上点击你想要设置的位置，或者在搜索框里输入地名搜索。
5. 点击"保存坐标"按钮，坐标会写入 Cloudflare KV，并出现在下方的历史记录列表中。

> 如果部署时设置过 `API_KEY`（见"进阶：访问控制"），这里还需要在"API Key"输入框里填入对应密钥，否则保存会被拒绝。

## 第三步：在代理客户端安装模块

1. 在控制台里找到"生成模块"区域，选择你使用的客户端（Surge / Loon / Quantumult X / Stash / Shadowrocket）。
2. 点击生成后会得到一个模块订阅地址，复制它。
3. 打开对应的代理 App，找到"模块"或"脚本"管理页面，粘贴这个地址并添加。
4. **确认 MITM 主机名列表里同时包含** `gs-loc.apple.com` 和 `gs-loc-cn.apple.com`——这一步很关键，遗漏任何一个都会导致部分请求不走改写逻辑。
5. 启用刚添加的模块，并重启一次代理客户端的 MITM 功能，确保新证书和规则生效。

## 第四步：验证虚拟定位是否生效

1. 在 iOS 设备上，打开一个依赖网络定位的场景，最简单的办法是**关闭 Wi-Fi 定位精度提示、暂时关掉 GPS 权限**，强制系统走 WLOC 网络定位路径，或者直接观察地图 App 在室内/信号差环境下的定位结果。
2. 打开代理客户端的 MITM 日志，找一条 `gs-loc.apple.com/clls/wloc` 的请求，查看响应头里是否带有 `x-ios-pin-relay: 1` 和 `x-ios-pin-spoofed: 1`——这两个头是 Worker 加上的调试标记，出现说明请求确实经过了你的 Worker 并执行了坐标改写。
3. 如果标记显示 `x-ios-pin-spoofed: 0`，通常是因为该次响应体过短或状态码非 2xx，Worker 判断为无效响应直接透传，不代表配置有问题。

## 常见问题排查

| 现象 | 可能原因 |
|---|---|
| 打开 Worker 地址显示 404 或空白页 | 检查 `wrangler.jsonc` 里 `assets.directory` 路径是否正确，或重新执行一次 `npm run deploy` |
| 保存坐标时报 401 | 部署时设置了 `API_KEY`，但前端"API Key"字段没填或填错 |
| 保存坐标时报 403 | 当前 Token 不在 `ALLOWED_TOKENS` 白名单里 |
| 代理客户端里看不到改写效果 | 确认 MITM 主机名同时包含 `gs-loc.apple.com` 与 `gs-loc-cn.apple.com`，并重启一次 MITM |
| 定位仍然是真实位置 | 检查代理客户端的 MITM 日志确认请求确实被拦截；某些 App 会缓存旧定位结果，可尝试重启 App 或设备 |
| 抓包看到响应体，但坐标没变 | 参考下方"进阶：验证 protobuf 字段假设"，可能是 Apple 更新了响应结构 |

## 进阶：访问控制

默认情况下，任何知道你 Worker 地址和 Token 的人都可以读写对应设备的坐标，适合个人/本地使用，但公开分享前建议开启保护：

```bash
# 要求所有写请求都携带共享密钥
npx wrangler secret put API_KEY

# 可选：限制哪些设备 Token 允许被使用（逗号分隔）
npx wrangler secret put ALLOWED_TOKENS
```

设置后，前端"API Key"输入框填入相同密钥即可正常使用。本地开发时可以把 `.dev.vars.example` 复制为 `.dev.vars` 填入相同的值。

## 进阶：多设备管理

控制台里的设备列表可以注册多组 `{Worker 地址, Token}` 组合并一键切换，选中某个设备会自动回填地址和 Token，并刷新对应的历史记录。目前设备列表只存在于当前浏览器会话内存中，刷新页面会重置，如果需要跨会话保存，可以考虑后续把设备列表也存进 Worker KV。

## 进阶：验证 protobuf 字段假设

`Worker/Src/Proto/Apple-wloc.ts` 里的字段编号和编码方式基于公开的社区逆向结果，如果 Apple 后续调整了响应结构，改写逻辑可能需要跟着调整。建议上线前用自己的真实抓包数据验证一遍：

1. 用 Surge/Loon 的 MITM 日志功能，抓取一份真实的 `gs-loc.apple.com/clls/wloc` 响应体（原始字节）。
2. 保存为 `Worker/Test/Fixtures/sample-01.bin`（注意脱敏，不要提交包含真实 BSSID 或个人信息的完整抓包，可参考 `Worker/Test/Fixtures/README.md`）。
3. 运行字段转储工具，直观查看字段编号和 wire type：
   ```bash
   node Scripts/Inspect-capture.mjs Test/Fixtures/sample-01.bin
   ```
4. 对照 `Apple-wloc.ts` 中的字段假设，如有差异就调整字段编号或偏移量。
5. 只要 `sample-01.bin` 文件存在，`Worker/Test/Apple-wloc.test.ts` 里对应的回归测试会自动从"跳过"变为"执行"，无需改代码。

## 已知限制

- 历史记录列表存储在 Worker KV 中（`history:<token>`），每个设备 Token 最多保留 20 条最近记录，超出会自动淘汰最旧的。
- 前端地点搜索使用 OpenStreetMap Nominatim，免费但有速率限制（约每秒 1 次请求），适合个人使用，生产环境大流量建议换成付费地理编码服务。
- protobuf 改写逻辑基于公开逆向结果，尚未经过官方文档确认，如遇失效请参考上面的验证步骤排查。

## 本地开发

### Worker

```bash
cd Worker
npm install
npm run dev
```

Wrangler 会打印一个本地地址（通常是 `http://localhost:8787`），本地开发期间可以直接访问它预览前后端。

### 单独预览前端样式

如果只想调整界面样式，不连接真实 Worker，可以直接打开 `Frontend/Public/Console.html`，或用任意静态服务器托管，再手动填入其他环境的 Worker 地址测试。

### 测试与类型检查

```bash
cd Worker
npm run test
npx tsc --noEmit
```

每次涉及 `Worker/**` 的推送都会触发 GitHub Actions（`.github/workflows/Worker-ci.yml`）自动运行同样的检查。

---

更完整的 Wrangler 命令参考、Cloudflare 网页控制台图文部署步骤、密钥管理细节，请参见 [`DEPLOY.md`](./DEPLOY.md)。

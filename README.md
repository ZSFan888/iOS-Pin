# iOS Pin

一个更简洁、可扩展的重新实现，灵感来自 Apple WLOC 网络定位响应篡改的工作原理。

## 项目结构

- `Worker/`：基于 Hono 构建的 Cloudflare Worker 后端
- `Frontend/`：用于选择坐标的静态地图 UI
- `Modules-Templates/`：Surge / Loon / QX / Stash / Shadowrocket 的代理模块模板
- `Shortcuts/`：iOS 快捷指令占位目录

## 核心原理

- 通过代理客户端拦截 `gs-loc.apple.com` 的网络流量
- 在 Worker 中解析并替换 protobuf 响应中的坐标数据
- 使用 KV 按设备 Token 存储所选坐标
- 动态生成各客户端专属的模块配置文件

## 本地开发

### Worker

```bash
cd Worker
npm install
npm run dev
```

### 前端

直接打开 `Frontend/Public/Console.html` 进行静态预览，或用任意静态服务器托管。

## 部署要点

1. 创建 KV 命名空间并绑定为 `LOCATIONS`。
2. 在 `Worker/wrangler.jsonc` 中更新 Worker 名称与 KV ID。
3. 使用 Wrangler 部署。
4. 把生成的 Worker 地址填入客户端代理模块中。

## 使用 PAT 推送到 GitHub

```bash
git init
git add .
git commit -m "feat: init ios-pin scaffold"
git branch -M main
git remote add origin https://<你的PAT>@github.com/<你的用户名>/<你的仓库>.git
git push -u origin main
```

请使用具备仓库写权限的 PAT，并妥善保管好这个令牌。

## 当前实现进度

- 新增了中继接口 `POST /apple/clls/wloc/:token` 与 `POST /relay/apple/:token/clls/wloc`，会把原始 WLOC 请求转发到 Apple 上游，并在 2xx protobuf 响应上执行坐标改写。
- 中继链路会根据原始请求自动区分 `gs-loc.apple.com` 与 `gs-loc-cn.apple.com`，并把上游返回的状态码与主要响应头透传给代理脚本。
- 新增了一个基于社区逆向结构的轻量级 protobuf 字节改写器。
- 客户端脚本现在通过 Worker 中继完成改写，而不是直接原地修改 `$response.body`。

## 重要提醒

protobuf 字段布局基于公开的逆向工程结果，如果 Apple 更改了响应结构，可能需要相应调整。上线前请务必用自己的抓包数据进行验证。

## 前端进展

- 新增了明暗双主题控制台界面（`Frontend/Public/Console.html`），使用 Leaflet 实现地图选点。
- 新增了基于 OpenStreetMap Nominatim 的防抖地点搜索，支持键盘方向键与回车选择。
- 新增了坐标保存流程（调用 `/api/location/:token`）、按客户端生成模块地址、复制/打开操作，以及一份内存态的最近坐标历史列表。

## 已知限制

- 历史列表目前仅存在内存中（刷新页面会重置）。后续可以考虑把它持久化到 Worker KV 或 D1。
- Nominatim 有速率限制（约每秒 1 次请求），只适合个人使用；生产环境流量建议换成付费地理编码服务。

## 历史记录持久化

- Worker 现在提供 `/api/history/:token`（GET/POST）与 `/api/history/:token/:index`（DELETE）接口，复用同一个 `LOCATIONS` KV 命名空间，以 `history:<token>` 为键，每个设备 Token 最多保留 20 条最近记录。
- 前端在 Worker 地址和 Token 都填写完成后会自动加载历史记录，带 500ms 防抖，并在每次保存或删除后刷新。
- 保存坐标时会同步写入一条历史记录，标签优先使用当前搜索结果名称，否则退回经纬度文本，并对几乎相同的坐标做去重处理。

## 多设备管理（前端）

- 在 Worker 连接区域上方新增了会话内的设备列表，可以注册多组 `{base, token}` 组合并一键切换。
- 选择某个设备会自动回填 Worker 地址与 Token 字段，并立即重新加载该设备对应的历史记录。
- 设备列表目前仅存在于当前会话内存中（受限于沙箱化 iframe 环境不支持 `localStorage`）——如果需要跨会话的持久化多设备管理，下一步可以考虑把设备列表本身存到 Worker KV 中的用户级键下。

## 反向地理编码

- 点击地图后会触发一次防抖（500ms）的反向地理编码请求，调用 Nominatim 的 `/reverse` 接口，在坐标徽标区域展示可读的地点名称（社区/城市 + 省州/国家）。
- 选择搜索结果或历史记录时会跳过反向地理编码请求，直接复用已知的标签，避免重复请求。
- 保存坐标时会优先使用解析出的地点名称作为历史标签，其次是搜索框文本，最后才退回原始经纬度。

## Protobuf 验证工具

- 新增 `Worker/Test/Apple-wloc.test.ts`（基于 Vitest），覆盖字段替换正确性、过短响应体的直通逻辑，以及 `decimalToMicro` 的缩放与四舍五入。
- 新增 `Worker/Test/Fixtures/README.md`，说明如何安全地存放真实抓包样本（需脱敏，不包含 BSSID / 个人信息）用于回归测试。
- 新增 `Worker/Scripts/Inspect-capture.mjs`，一个独立的 protobuf 字段转储工具——运行 `node Scripts/Inspect-capture.mjs Test/Fixtures/sample-01.bin` 即可直观确认真实 Apple WLOC 响应中的字段编号与 wire type，验证后再信任改写逻辑。
- 新增 `.github/workflows/Worker-ci.yml`，每次改动涉及 `Worker/**` 的推送/PR 都会自动运行 `npm test` 和 `tsc --noEmit`。

## 下一步验证（需要你在真机上手动完成）

1. 通过 Surge/Loon 的 MITM 日志功能，抓取一份真实的 `gs-loc.apple.com/clls/wloc` 响应体。
2. 把原始字节保存为 `Worker/Test/Fixtures/sample-01.bin`。
3. 运行 `node Scripts/Inspect-capture.mjs Test/Fixtures/sample-01.bin` 查看实际的字段布局。
4. 对照 `Worker/Src/Proto/Apple-wloc.ts` 中的假设，如有差异则调整字段编号或偏移量。
5. 布局确认无误后，补充一个基于该 fixture 的测试用例。

## 访问控制（新增）

- Worker 现在支持两种可选的环境密钥保护：`API_KEY`（所有写接口都需要在 `x-wloc-key` 请求头中携带该密钥）和 `ALLOWED_TOKENS`（用逗号分隔的允许使用的设备 Token 白名单）。
- 两者都是可选开启——如果未设置，Worker 行为与之前一致（开放写入），适合个人/本地使用，但不建议在公开分享 Worker 地址时保持这种状态。
- 前端新增了"API Key"输入框；填写后会在保存/删除请求中作为 `x-wloc-key` 请求头发送。
- 完整配置流程（包括 `wrangler secret put` 用法与本地开发用的 `.dev.vars`）请参见 `DEPLOY.md`。

## 完整部署指南

详细的 Wrangler KV 配置、密钥设置、本地开发与生产部署步骤，请参见 [`DEPLOY.md`](./DEPLOY.md)。

# iOS Pin

一个基于 Cloudflare Pages 的 iOS 系统级定位修改工具：通过 MITM 拦截 Apple 网络定位响应，并把返回坐标改写成你在网页控制台中保存的位置。

> 仅建议在自己的设备上用于测试、开发、自动化验证或隐私研究场景。使用前请确认你了解 MITM 风险，并遵守所在地法律法规与相关服务条款。

## 目录

- [项目原理](#项目原理)
- [最新架构](#最新架构)
- [准备工作](#准备工作)
- [快速部署](#快速部署)
- [使用流程](#使用流程)
- [代理模块说明](#代理模块说明)
- [排查步骤](#排查步骤)
- [命名规范](#命名规范)
- [本地开发](#本地开发)
- [已知限制](#已知限制)

## 项目原理

iOS 在 GPS 信号弱或不可用时，会向 `gs-loc.apple.com/clls/wloc` 或 `gs-loc-cn.apple.com/clls/wloc` 发起 Wi‑Fi 网络定位请求。iOS Pin 的核心思路不是改 App 内坐标，而是让系统收到一个被改写过的 Apple 网络定位响应，从而在系统层面“认为”设备位于目标位置。

完整链路如下：

1. 代理客户端通过 MITM 拦截 Apple 的 HTTPS 网络定位请求。
2. 设备上的设置脚本把你在网页端选择的坐标写入代理客户端本地持久化存储。
3. Apple 网络定位响应返回时，响应脚本读取本地已保存坐标。
4. 脚本按 protobuf 结构递归查找位置对象，只替换经纬度与精度字段。
5. 改写后的响应返回给 iOS，系统层位置随之变化。

## 最新架构

当前版本已经从“依赖原项目脚本”切换为**自有防御式实现**，重点是把最容易出错的部分都拆开处理：

- `Frontend/Public/_worker.js`：统一输出网页、模块配置和客户端脚本。
- `ios-pin.js`：Apple 网络定位响应改写脚本，内置防御式 protobuf 递归 patcher。
- `ios-pin-settings.js`：坐标保存脚本，兼容 Shadowrocket 环境，不依赖 `URL` 或 `URLSearchParams`。
- `Worker/Src/Proto/Apple-ios-pin.ts`：TypeScript 版本的协议逻辑，供测试和校验使用。
- `Worker/Test/`：协议回归测试、样本验证、抓包夹具。

这一版的核心特征：

- 项目内部命名统一为 `ios-pin`。
- Apple 官方协议路径仍保留 `wloc`，因为这是上游协议的一部分，不能擅自改名。
- 保存层与改写层完全解耦，便于定位故障点。
- 所有异常默认透传原响应，避免把 Apple 返回体改坏。

## 准备工作

开始前请确认：

- 你有一个 Cloudflare 账号。
- 仓库代码已经放到 GitHub。
- 你有一台安装了 Surge、Loon、Quantumult X、Stash 或 Shadowrocket 的 iOS 设备。
- 代理客户端已经正确开启 MITM，并安装且信任了对应证书。
- 你知道自己的 Pages 域名，或者准备自行部署一个新的 Pages 项目。

## 快速部署

1. 在 Cloudflare 中创建 Pages 项目并连接当前 GitHub 仓库。
2. 构建设置保持最简：`Build command` 留空，`Build output directory` 设为 `Frontend/Public`。
3. 首次部署成功后，在 Pages 项目设置中添加 `LOCATIONS` 这个 KV 绑定。
4. 如果要限制写入权限，再增加环境变量 `API_KEY`，可选增加 `ALLOWED_TOKENS`。
5. 每次新增绑定或环境变量后，都要重新触发一次部署。

更细的控制台截图式说明，请看 `DEPLOY.md`。

## 使用流程

### 1. 打开网页控制台

部署完成后，直接访问你的 Pages 地址。页面会自动生成当前站点对应的模块地址和脚本地址。

### 2. 选择坐标并保存

在地图上选点后，页面会通过 `https://gs-loc.apple.com/wloc-settings/save?lon=...&lat=...` 这条链路触发代理客户端本地保存脚本。最新版本的保存脚本支持：

- `action=save`：保存坐标
- `action=query`：读取当前已保存坐标
- `action=clear`：清空已保存坐标

### 3. 安装模块

在网页里选择对应客户端后，安装生成的模块。当前项目内部统一使用：

- `ios-pin.js`
- `ios-pin-settings.js`
- `ios_pin_settings` 持久化键名

### 4. 触发系统定位

打开苹果地图、天气或其他会调用系统定位的组件，观察代理日志中是否出现：

- `gs-loc.apple.com/clls/wloc`
- `gs-loc-cn.apple.com/clls/wloc`

如果没有出现，说明系统当前没有走 Apple 网络定位链路，而不是脚本没生效。

## 代理模块说明

当前模块命名已经统一：

- Shadowrocket：`Apple iOS Pin`
- 设置脚本：`iOS Pin Settings`
- 脚本路径：`/script/ios-pin.js` 与 `/script/ios-pin-settings.js`

推荐配置原则：

- 对 `gs-loc.apple.com` 和 `gs-loc-cn.apple.com` 开启 MITM。
- 给这两个域名单独加 `DIRECT` 规则，避免 Apple 定位请求跑到远端代理节点。
- 确保全局路由按配置分流，而不是单纯全局代理或全局直连。

## 排查步骤

建议按这个顺序检查：

1. 证书是否已安装并完全信任。
2. MITM 主机名是否包含 `gs-loc.apple.com` 与 `gs-loc-cn.apple.com`。
3. 模块是否加载了最新的 `ios-pin.js` 与 `ios-pin-settings.js`。
4. 选点后是否真的打到了 `wloc-settings/save`。
5. 系统定位时是否真的出现了 `/clls/wloc`。
6. 如果脚本无报错但位置不变，优先考虑系统缓存问题。

高版本 iOS 可能会更积极缓存 `locationd` 结果，因此即使脚本已改写成功，系统也可能继续沿用旧缓存。必要时可切飞行模式、重开定位服务或重启设备后再验证。

## 命名规范

仓库已经完成一轮命名收口：

- **项目内部命名**：统一使用 `ios-pin`
- **内部请求头**：统一使用 `x-ios-pin-*`
- **内部存储键**：统一使用 `ios_pin_settings`
- **Apple 协议路径**：保留 `wloc`

保留 `wloc` 的原因很简单：它是 Apple 网络定位协议真实路径的一部分，不是原项目品牌名，不能为了美观随意替换。

## 本地开发

如需本地调试：

- 前端核心目录：`Frontend/Public`
- Worker 逻辑与测试：`Worker/`
- 建议先改 `Worker/Src/Proto/Apple-ios-pin.ts` 和测试，再同步到前端脚本输出逻辑

如果只是部署使用，不需要本地安装任何依赖，也不需要在根目录放 `wrangler.toml`。

## 已知限制

- 这类方案依赖 Apple 当前的网络定位协议结构，未来可能随系统升级而变化。
- 某些场景优先使用 GPS，不一定会触发 `clls/wloc`。
- 高版本 iOS 的系统缓存可能让“脚本成功、位置没立即变更”看起来像失效。
- 并非所有第三方 App 都只信任系统层网络定位结果。

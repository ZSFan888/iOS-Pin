# 部署指南

本文档对应 **iOS Pin 最新版**，内容已经更新为当前仓库的实际架构、最新脚本命名和最新部署方式。

## 部署模式

本项目使用 **Cloudflare Pages** 部署，前端与后端共用同一个 `*.pages.dev` 域名：

- `Frontend/Public/index.html`：网页控制台
- `Frontend/Public/_worker.js`：Pages Functions Advanced Mode 入口
- `Frontend/Public` 下输出客户端脚本与模块配置

当前版本不依赖根目录 `wrangler.toml`，目的是保留 Cloudflare 网页控制台里的可视化绑定入口。

## 一、前置条件

请先准备：

- Cloudflare 账号
- GitHub 仓库
- 一台可运行 MITM 代理客户端的 iOS 设备
- 已安装并信任代理客户端根证书

## 二、创建 Worker 统一部署

1. 登录 Cloudflare 控制台。
2. 打开 **Workers & Pages**。
3. 点击 **Create application**。
4. 选择 **Pages**，再选择 **Connect to Git**。
5. 连接当前 GitHub 仓库。
6. 构建设置填写：
   - `Project name`：例如 `ios-pin`
   - `Production branch`：`main`
   - `Framework preset`：`None`
   - `Build command`：留空
   - `Build output directory`：`Frontend/Public`
7. 点击 **Save and Deploy**。

## 三、添加 KV 绑定

首次部署成功后，必须添加 `LOCATIONS` 绑定：

1. 进入该 Worker 统一部署。
2. 打开 **Settings**。
3. 找到 **Bindings**。
4. 添加一个 **KV namespace** 绑定。
5. 变量名填写 `LOCATIONS`。
6. 选择已有命名空间，或新建一个例如 `ios-pin-locations` 的命名空间。
7. 保存后重新部署一次。

## 四、可选安全设置

如果不希望任意知道地址的人都能写入位置，可以增加：

- `API_KEY`：写操作密钥
- `ALLOWED_TOKENS`：允许访问的设备 Token 白名单

注意：仓库内部请求头命名已经更新为 `x-ios-pin-key`，因此如果你有额外的自动化脚本或自建调用端，请同步更新。

## 五、重新部署

新增绑定或环境变量后，必须重新部署：

1. 进入 **Deployments**。
2. 找到最新部署。
3. 点击 **Retry deployment**。
4. 等待状态变为 **Success**。

## 六、打开控制台

访问你的 Pages 地址后：

- 输入设备 Token
- 如启用了 `API_KEY`，填写对应密钥
- 选择目标位置
- 生成模块配置

## 七、客户端脚本命名

当前版本的项目命名已经统一，请确认你看到的是最新版：

- 响应脚本：`ios-pin.js`
- 设置脚本：`ios-pin-settings.js`
- 存储键名：`ios_pin_settings`
- 模块显示名：`Apple iOS Pin`

如果你在客户端里还看到旧的 `wloc.js`、`wloc-settings.js` 或旧模块名，通常说明：

- 模块缓存未刷新
- Pages 部署尚未成功
- 设备仍在使用旧的远程脚本 URL

## 八、代理侧建议配置

除了开启 MITM，建议同时加：

```conf
DOMAIN,gs-loc.apple.com,DIRECT
DOMAIN,gs-loc-cn.apple.com,DIRECT
```

同时确保：

- MITM 主机名包含 `gs-loc.apple.com`
- MITM 主机名包含 `gs-loc-cn.apple.com`
- 全局路由按配置执行

## 九、验证是否生效

验证时不要只看网页选点是否成功，而要看完整链路：

1. 选点后是否出现 `wloc-settings/save`
2. 系统定位时是否出现 `/clls/wloc`
3. 响应脚本是否已经是 `ios-pin.js`
4. 若仍不生效，优先排查系统缓存

## 十、常见误区

### 误区 1：网页能打开就代表脚本已更新

不一定。网页和远程脚本更新不是同一个缓存层，必须检查客户端实际拉取到的脚本内容。

### 误区 2：只开 MITM 就够了

不够。Apple 定位请求如果走远端代理，常常会增加不稳定因素，因此建议对两个 Apple 定位域名单独走 `DIRECT`。

### 误区 3：位置没变就是脚本失败

不一定。高版本 iOS 可能继续使用已有缓存；先看日志链路是否完整，再判断是不是脚本问题。

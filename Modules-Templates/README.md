# 模块模板说明

本目录用于说明不同代理客户端的模块模板思路。当前线上实际模块由 `Frontend/Public/_worker.js` 动态生成，因此这里的内容主要用于文档说明，而不是直接发布脚本文件。

## 当前命名

项目已完成命名规范化，当前统一使用：

- 项目名：`iOS Pin`
- 响应脚本：`ios-pin.js`
- 设置脚本：`ios-pin-settings.js`
- 设置存储键：`ios_pin_settings`
- 模块显示名：`Apple iOS Pin`

## 需要保留的协议名

以下内容虽然包含 `wloc`，但属于 Apple 上游协议的一部分，不能更改：

- `gs-loc.apple.com/clls/wloc`
- `gs-loc-cn.apple.com/clls/wloc`
- `gs-loc.apple.com/wloc-settings/save`

## 当前设计原则

生成模块时应满足：

- Apple 定位请求匹配 `/clls/wloc`
- 设置保存请求匹配 `/wloc-settings/save`
- 对 `gs-loc.apple.com` 与 `gs-loc-cn.apple.com` 启用 MITM
- 推荐单独配置 `DIRECT` 规则
- 脚本来源始终指向你自己的 Pages 站点

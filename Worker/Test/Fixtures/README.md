# 抓包样本文件

把真实抓取到的 Apple iOS Pin 响应体保存为 `.bin` 文件（原始响应体字节），并配一份同名的 `.json` 元数据文件说明抓取背景，例如：

```json
{
  "source": "surge-mitm-capture",
  "capturedAt": "2026-07-18T12:00:00Z",
  "device": "iPhone 15 Pro, iOS 26.3",
  "note": "通过 Surge MITM 在 gs-loc.apple.com/clls/wloc 上抓取",
  "expectedFieldLayout": "第 2 个字段（位置子消息）中包含第 1 个字段（纬度）和第 2 个字段（经度），均为按 1e8 缩放的 zigzag varint 编码"
}
```

请不要提交真实的设备标识符、MAC 地址或其他可识别个人身份的抓包数据。提交前请先脱敏处理 BSSID / 位置列表——测试用途只需保留与坐标字段相关的响应片段即可。

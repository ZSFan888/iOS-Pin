# 抓包样本说明

本目录用于存放 Apple 网络定位响应的测试样本，供 `Worker/Test/` 中的回归测试使用。

## 文件格式

每一组样本建议包含：

- 一个 `.bin` 文件：保存原始响应体字节
- 一个同名 `.json` 文件：记录抓包来源、系统版本、说明信息

示例：

```json
{
  "source": "surge-mitm-capture",
  "capturedAt": "2026-07-18T12:00:00Z",
  "device": "iPhone 15 Pro, iOS 26.3",
  "note": "通过 Surge MITM 在 gs-loc.apple.com/clls/wloc 上抓取",
  "expectedFieldLayout": "位置子消息中包含纬度、经度与精度字段，脚本只应改写这些字段，其他字段必须保持原样"
}
```

## 使用目的

这些样本主要用于验证：

- 当前 `Apple-ios-pin` 协议逻辑能否正确识别位置对象
- 递归 patcher 是否只改经纬度与精度字段
- 无法识别的 length-delimited 字段是否保持原样透传
- 新版本重构后是否破坏旧样本兼容性

## 提交要求

请不要提交真实的：

- 设备标识符
- BSSID / MAC 地址
- 家庭或办公地点相关可识别信息
- 任何能直接关联到个人身份的数据

提交前请先完成脱敏。测试只需要保留与协议结构验证相关的最小必要样本。

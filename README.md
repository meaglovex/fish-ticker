# HK Fish Ticker

透明度很高的桌面行情看板，针对港股、大A、美股的轻量盯盘场景设计。  
核心目标不是做全功能交易终端，而是做一个挂在桌面上、低存在感、能快速扫一眼的透明行情窗。

[Releases](https://github.com/meaglovex/fish-ticker/releases)

## 特性

- 支持港股 / 大A / 美股三大市场切换
- 高透明玻璃风格窗口，适合悬浮使用
- 自选股输入与分组保存
- 每个标的卡片内置小型分时图
- 行情字段包含现价、涨跌、涨跌幅、开、高、低、量、均价
- 自动选择可用行情源，不需要手动切源
- 窗口透明度连续可调，并会持久化保存

## 下载

请直接从 [Releases](https://github.com/meaglovex/fish-ticker/releases) 下载。

- macOS Universal: `HK Fish Ticker-<version>.dmg`
- Windows x64 Installer: `HK Fish Ticker Setup <version>.exe`
- Windows x64 Portable: `HK Fish Ticker.exe`

说明：

- macOS 包是 `universal`，同时支持 Apple Silicon 和 Intel。
- 当前自动构建默认是无签名包，首次启动可能会遇到系统安全提示。
- Windows 同时提供安装版和免安装版。

## 数据源

程序会根据市场和时段自动选源：

- 港股 / 大A：腾讯行情
- 美股盘前 / 盘中 / 盘后：优先扩展时段美股源
- 美股夜盘：优先 Alpaca Overnight（已配置凭证时）
- 主源无数据时自动回退到可用源

注意：

- 免费公开源对美股盘前、盘后、夜盘的覆盖并不完全一致。
- 不同源返回字段完整度不同，个别标的的均价、高低价可能为空。
- 这个项目更适合“桌面看盘”，不适合做严格交易决策依据。

## 开发

环境要求：

- Node.js 18+
- npm

启动：

```bash
npm install
npm run dev
```

## 美股夜盘凭证

如果需要 Alpaca 夜盘数据，可以通过环境变量或本地凭证文件提供。

环境变量：

```bash
export APCA_API_KEY_ID="your-key-id"
export APCA_API_SECRET_KEY="your-secret"
export ALPACA_DATA_BASE_URL="https://data.alpaca.markets/v2"
```

凭证文件：

在应用用户目录放置 `credentials.json`：

```json
{
  "alpacaDataBaseUrl": "https://data.alpaca.markets/v2",
  "alpacaKeyId": "your-key-id",
  "alpacaSecretKey": "your-secret"
}
```

## 本地打包

macOS Universal DMG：

```bash
npm run build:mac
```

Windows x64 安装包：

```bash
npm run build:win
```

产物默认输出到：

```bash
dist/
```

## 自动发布

仓库已经接入 GitHub Actions 自动发布流程，工作流文件在：

[`/.github/workflows/release.yml`](./.github/workflows/release.yml)

触发方式：

1. 更新 `package.json` 版本号
2. 提交并推送到 `main`
3. 打 tag 并推送

```bash
git tag v0.1.0
git push origin v0.1.0
```

之后 GitHub Actions 会自动：

- 构建 macOS Universal DMG
- 构建 Windows x64 EXE
- 创建或复用同名 GitHub Release
- 上传安装包到 Release

## 签名

当前自动发布默认是无签名构建。

如果后续需要正式外部分发，建议补齐：

- macOS Developer ID Application
- macOS notarization
- Windows 代码签名证书

## 默认自选

港股默认自选包含：

- `00700.HK`
- `00941.HK`
- `09988.HK`
- `00388.HK`
- `03690.HK`

这些都可以在应用里改掉，并保存为自己的分组。

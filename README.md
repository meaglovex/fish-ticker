# HK Fish Ticker

超高透明度的桌面行情看板，面向摸鱼场景设计，当前支持港股、大A、美股三大市场，提供自动数据源选择、自选分组、分时小图和窗口透明度调节。

仓库地址：
[https://github.com/meaglovex/hk-fish-ticker](https://github.com/meaglovex/hk-fish-ticker)

Release 页面：
[https://github.com/meaglovex/hk-fish-ticker/releases](https://github.com/meaglovex/hk-fish-ticker/releases)

## 安装下载

在 GitHub Releases 页面下载对应平台安装包：

- macOS Universal DMG：`HK Fish Ticker-<version>.dmg`
- Windows x64 安装包：`HK Fish Ticker Setup <version>.exe`
- Windows x64 免安装版：`win-unpacked/HK Fish Ticker.exe`

说明：

- macOS 当前构建为 `universal`，同时支持 Apple Silicon 和 Intel。
- 如果后续未接入正式证书签名，macOS 首次启动可能会遇到系统安全提示。
- Windows 当前提供标准安装包和免安装可执行文件两种形式。

## 主要功能

- 超高透明玻璃质感窗口，适合悬浮盯盘
- 港股 / 大A / 美股切换
- 自动选择可用行情源，不需要手动切换
- 自选股输入与保存分组
- 卡片内小型分时图
- 行情字段包含：现价、涨跌、涨跌幅、开、高、低、量、均价
- 窗口透明度连续调节并持久化保存

## 数据源策略

- 港股 / 大A：默认走腾讯行情
- 美股盘前 / 盘中 / 盘后：优先使用支持扩展时段的美股源
- 美股夜盘：优先使用 Alpaca Overnight（已配置 Key 时）
- 当优先源无数据时，程序会自动降级到可用源

注意：

- 免费公开源对美股夜盘和扩展时段的覆盖并不完全一致。
- 不同源返回的字段完整度不同，个别标的的均价、高低价可能为空。

## 开发运行

要求：

- Node.js 18+
- npm
- macOS / Windows

安装依赖并启动：

```bash
npm install
npm run dev
```

如果需要美股夜盘数据，需提供 Alpaca 凭证。支持两种方式：

1. 环境变量

```bash
export APCA_API_KEY_ID="your-key-id"
export APCA_API_SECRET_KEY="your-secret"
export ALPACA_DATA_BASE_URL="https://data.alpaca.markets/v2"
```

2. 应用用户目录内凭证文件

`credentials.json` 示例：

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
npx electron-builder --mac dmg --universal
```

Windows x64 安装包：

```bash
npx electron-builder --win nsis --x64
```

产物输出目录：

```bash
dist/
```

## 自动发布

仓库已接入 GitHub Actions 自动发布流程：

- 工作流文件：[.github/workflows/release.yml](/Users/yl202103/Documents/Playground/hk-fish-ticker/.github/workflows/release.yml)
- 触发方式：
  - 推送 `v*` tag，例如 `v1.0.1`
  - 在 GitHub Actions 页面手动运行并填写 tag
- 自动构建产物：
  - macOS Universal DMG
  - Windows x64 EXE 安装包
- 自动行为：
  - 构建双平台安装包
  - 创建或复用同名 GitHub Release
  - 自动上传 `.dmg` 和 `.exe`

推荐发布步骤：

1. 更新 `package.json` 版本号
2. 提交代码并推送到 `main`
3. 创建并推送 tag

```bash
git tag v1.0.1
git push origin v1.0.1
```

之后到 GitHub Actions 等待 `Release` 工作流完成即可。

注意：

- 当前 workflow 默认走无签名构建，适合内部测试和快速分发。
- 如果后续需要正式对外发布，建议补齐 macOS Developer ID / notarization 和 Windows 代码签名 secrets。

## 默认自选

港股默认自选：

- `00700.HK` 腾讯控股
- `00941.HK` 中国移动
- `09988.HK` 阿里巴巴-W
- `00388.HK` 香港交易所
- `03690.HK` 美团-W

用户也可以在应用内改成任意自选代码并保存为分组。

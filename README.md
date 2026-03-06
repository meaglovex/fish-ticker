# HK Fish Ticker

超高透明度的港股桌面行情应用（Electron / macOS DMG）。

## 开发运行

```bash
npm install
# 可选：美股夜盘需要 Alpaca Key
export APCA_API_KEY_ID="your-key-id"
export APCA_API_SECRET_KEY="your-secret"
npm run dev
```

## 打包 DMG

```bash
npm run build:dmg
```

打包产物在 `dist/` 目录。

## 默认自选

- 00700 腾讯控股
- 00941 中国移动
- 09988 阿里巴巴-W
- 00388 港交所
- 03690 美团-W

可以在应用输入框改成任意 5 位港股代码，逗号分隔。

## 分组功能

- 支持保存当前代码为分组
- 支持下拉切换分组
- 支持删除分组
- 分组数据持久化到应用用户目录（重启不丢失）

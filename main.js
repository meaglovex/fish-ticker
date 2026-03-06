const fsp = require("node:fs/promises");
const path = require("node:path");
const https = require("node:https");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const iconv = require("iconv-lite");
const { app, BrowserWindow, ipcMain } = require("electron");

const REFRESH_MS = 2500;
const NASDAQ_CACHE_MS = 8000;
const ALPACA_CACHE_MS = 3000;
const DEFAULT_WINDOW_OPACITY = 0.52;
const MIN_WINDOW_OPACITY = 0.03;
const MAX_WINDOW_OPACITY = 1;
const DEFAULT_ALPACA_DATA_BASE_URL = process.env.ALPACA_DATA_BASE_URL || "https://data.alpaca.markets/v2";
const DEFAULT_APCA_API_KEY_ID = (process.env.APCA_API_KEY_ID || "").trim();
const DEFAULT_APCA_API_SECRET_KEY = (process.env.APCA_API_SECRET_KEY || "").trim();
const NASDAQ_QUOTE_BASE_URL = "https://api.nasdaq.com/api/quote";

const MARKET_CONFIG = {
  hk: {
    label: "港股",
    timezone: "Asia/Shanghai",
    exchangeValue: "HK",
    defaultSymbols: ["00700.HK", "00941.HK", "09988.HK", "00388.HK", "03690.HK"],
    indexSymbols: [
      { symbol: "HSI.HK", name: "恒生指数" },
      { symbol: "HSCEI.HK", name: "国企指数" },
      { symbol: "HSTECH.HK", name: "恒生科技" },
    ],
    sessions: [
      [9 * 60 + 30, 12 * 60],
      [13 * 60, 16 * 60],
    ],
  },
  cn: {
    label: "大A",
    timezone: "Asia/Shanghai",
    exchangeValue: "CN",
    defaultSymbols: ["600519.SH", "000001.SZ", "300750.SZ", "601318.SH", "000858.SZ"],
    indexSymbols: [
      { symbol: "000001.SH", name: "上证指数" },
      { symbol: "399001.SZ", name: "深证成指" },
      { symbol: "399006.SZ", name: "创业板指" },
    ],
    sessions: [
      [9 * 60 + 30, 11 * 60 + 30],
      [13 * 60, 15 * 60],
    ],
  },
  us: {
    label: "美股",
    timezone: "America/New_York",
    exchangeValue: "US",
    defaultSymbols: ["AAPL.US", "MSFT.US", "NVDA.US", "TSLA.US", "SPY.US"],
    indexSymbols: [
      { symbol: "GSPC.US", name: "标普500" },
      { symbol: "DJI.US", name: "道琼斯" },
      { symbol: "IXIC.US", name: "纳斯达克" },
    ],
    sessions: [[9 * 60 + 30, 16 * 60]],
  },
};

const DATA_SOURCE_CONFIG = {
  tencent: { label: "腾讯行情" },
  nasdaq: { label: "Nasdaq 扩展时段" },
  alpaca_overnight: { label: "Alpaca 夜盘(需Key)" },
};

let mainWindow = null;
let marketTimer = null;
let marketSnapshot = [];
let marketIndices = [];
let trackedSymbols = [...MARKET_CONFIG.hk.defaultSymbols];
let watchStateFile = "";
let credentialsFile = "";
let nasdaqQuoteCache = new Map();
let nasdaqQuotePending = new Map();
let alpacaQuoteCache = new Map();
let marketRefreshInFlight = false;
let activeSourceId = "tencent";
const execFileAsync = promisify(execFile);
let runtimeSecrets = {
  alpacaDataBaseUrl: DEFAULT_ALPACA_DATA_BASE_URL,
  alpacaKeyId: DEFAULT_APCA_API_KEY_ID,
  alpacaSecretKey: DEFAULT_APCA_API_SECRET_KEY,
};

let watchState = createDefaultWatchState();

function createDefaultWatchState() {
  return {
    version: 2,
    currentMarket: "hk",
    windowOpacity: DEFAULT_WINDOW_OPACITY,
    currentGroupByMarket: {
      hk: "hk_default",
      cn: "cn_default",
      us: "us_default",
    },
    groups: [
      { id: "hk_default", market: "hk", name: "港股默认", symbols: [...MARKET_CONFIG.hk.defaultSymbols] },
      { id: "cn_default", market: "cn", name: "大A默认", symbols: [...MARKET_CONFIG.cn.defaultSymbols] },
      { id: "us_default", market: "us", name: "美股默认", symbols: [...MARKET_CONFIG.us.defaultSymbols] },
    ],
  };
}

function getMarketIds() {
  return Object.keys(MARKET_CONFIG);
}

function getSourceLabel(sourceId) {
  return DATA_SOURCE_CONFIG[sourceId]?.label || sourceId;
}

function getTickerBase(ticker) {
  const parts = String(ticker || "").toUpperCase().split(".");
  return parts[0] || "";
}

function normalizeWindowOpacity(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_WINDOW_OPACITY;
  if (num < MIN_WINDOW_OPACITY) return MIN_WINDOW_OPACITY;
  if (num > MAX_WINDOW_OPACITY) return MAX_WINDOW_OPACITY;
  return num;
}

function normalizeTicker(raw, marketHint = watchState.currentMarket) {
  let text = String(raw || "").trim().toUpperCase();
  if (!text) return "";
  text = text.replace(/\s+/g, "");
  text = text.replace(/^R_?/, "");

  if (text.includes(".")) {
    const [left, right] = text.split(".");
    const suffix = (right || "").replace(/[^A-Z]/g, "");
    if (suffix === "HK") {
      const digits = left.replace(/\D/g, "");
      if (digits) return `${digits.slice(-5).padStart(5, "0")}.HK`;
      const code = left.replace(/[^A-Z0-9]/g, "");
      return code ? `${code}.HK` : "";
    }
    if (suffix === "SH" || suffix === "SZ") {
      const digits = left.replace(/\D/g, "");
      if (!digits) return "";
      return `${digits.slice(-6).padStart(6, "0")}.${suffix}`;
    }
    if (suffix === "US") {
      const code = left.replace(/[^A-Z0-9.-]/g, "");
      return code ? `${code}.US` : "";
    }
  }

  if (/^\d{1,6}$/.test(text)) {
    if (marketHint === "hk") return `${text.slice(-5).padStart(5, "0")}.HK`;
    if (marketHint === "cn") {
      const code = text.slice(-6).padStart(6, "0");
      const suffix = /^[69]/.test(code) ? "SH" : "SZ";
      return `${code}.${suffix}`;
    }
    return `${text.slice(-5).padStart(5, "0")}.HK`;
  }

  if (marketHint === "hk" && /^[A-Z][A-Z0-9]{1,11}$/.test(text)) {
    return `${text}.HK`;
  }

  const us = text.replace(/[^A-Z0-9.-]/g, "");
  if (us && marketHint === "us") return `${us}.US`;
  return "";
}

function toFiniteNumber(value) {
  const num = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(num) ? num : Number.NaN;
}

function buildEmptyQuote(symbol) {
  return {
    code: symbol,
    name: `STOCK ${getTickerBase(symbol)}`,
    price: Number.NaN,
    prevClose: Number.NaN,
    openPrice: Number.NaN,
    avgPrice: Number.NaN,
    volume: Number.NaN,
    time: "",
    change: Number.NaN,
    changePct: Number.NaN,
    high: Number.NaN,
    low: Number.NaN,
  };
}

function formatCompactTime(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (/^\d{14}$/.test(text)) {
    const y = text.slice(0, 4);
    const m = text.slice(4, 6);
    const d = text.slice(6, 8);
    const hh = text.slice(8, 10);
    const mm = text.slice(10, 12);
    const ss = text.slice(12, 14);
    return `${y}/${m}/${d} ${hh}:${mm}:${ss}`;
  }
  return text;
}

function formatUnixSeconds(seconds) {
  const ts = Number(seconds);
  if (!Number.isFinite(ts) || ts <= 0) return "";
  return new Date(ts * 1000).toLocaleString("zh-CN", { hour12: false });
}

function toFiniteNumberFromText(raw) {
  const text = String(raw ?? "").trim();
  if (!text || text === "N/A" || text === "--") return Number.NaN;
  const cleaned = text.replace(/[,%$]/g, "").replace(/\s+/g, "").replace(/,/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : Number.NaN;
}

function parseNasdaqDayRange(text) {
  const raw = String(text || "");
  const parts = raw.split("-").map((part) => toFiniteNumberFromText(part));
  if (parts.length !== 2) return { low: Number.NaN, high: Number.NaN };
  return {
    low: parts[0],
    high: parts[1],
  };
}

function extractNasdaqQuote(raw, symbol) {
  const data = raw?.data;
  const primary = data?.primaryData || {};
  const secondary = data?.secondaryData || {};
  const keyStats = data?.keyStats || {};
  const dayRangeText = keyStats?.dayrange?.value || "";
  const { low, high } = parseNasdaqDayRange(dayRangeText);

  const price = toFiniteNumberFromText(primary?.lastSalePrice || secondary?.lastSalePrice);
  const prevClose = toFiniteNumberFromText(keyStats?.previousclose?.value);
  const change = toFiniteNumberFromText(primary?.netChange || secondary?.netChange);
  const changePct = toFiniteNumberFromText(primary?.percentageChange || secondary?.percentageChange);
  const volume = toFiniteNumberFromText(primary?.volume || secondary?.volume);

  return {
    code: symbol,
    name: String(data?.companyName || `STOCK ${getTickerBase(symbol)}`),
    price,
    prevClose,
    openPrice: Number.NaN,
    avgPrice: Number.NaN,
    volume,
    time: String(primary?.lastTradeTimestamp || secondary?.lastTradeTimestamp || ""),
    change: Number.isFinite(change) ? change : Number.isFinite(price) && Number.isFinite(prevClose) ? price - prevClose : Number.NaN,
    changePct:
      Number.isFinite(changePct)
        ? changePct
        : Number.isFinite(price) && Number.isFinite(prevClose) && prevClose !== 0
          ? ((price - prevClose) / prevClose) * 100
          : Number.NaN,
    high,
    low,
  };
}

function getNasdaqSymbolPlan(symbol) {
  const base = getTickerBase(symbol);
  if (base === "IXIC") return [{ quoteSymbol: "COMP", assetClass: "index" }];
  if (base === "GSPC") return [{ quoteSymbol: "SPY", assetClass: "etf" }];
  if (base === "DJI") return [{ quoteSymbol: "DIA", assetClass: "etf" }];
  return [
    { quoteSymbol: base, assetClass: "stocks" },
    { quoteSymbol: base, assetClass: "etf" },
    { quoteSymbol: base, assetClass: "index" },
  ];
}

async function fetchNasdaqRaw(quoteSymbol, assetClass) {
  const url = `${NASDAQ_QUOTE_BASE_URL}/${encodeURIComponent(quoteSymbol)}/info?assetclass=${encodeURIComponent(assetClass)}`;
  const headers = {
    Accept: "application/json, text/plain, */*",
    Origin: "https://www.nasdaq.com",
    Referer: "https://www.nasdaq.com/",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  };

  try {
    const buffer = await httpGetBuffer(url, headers);
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    const message = String(error?.message || error);
    const retryable = /ECONNRESET|socket hang up|请求超时|empty reply|EAI_AGAIN/i.test(message);
    if (!retryable) throw error;
    const buffer = await httpGetBufferViaCurl(url, headers);
    return JSON.parse(buffer.toString("utf8"));
  }
}

async function requestSingleQuoteViaNasdaq(symbol) {
  const plan = getNasdaqSymbolPlan(symbol);
  let lastError = "";
  for (const step of plan) {
    try {
      const payload = await fetchNasdaqRaw(step.quoteSymbol, step.assetClass);
      if (payload?.status?.rCode !== 200 || !payload?.data) continue;
      const quote = extractNasdaqQuote(payload, symbol);
      if (!Number.isFinite(quote.price)) continue;
      return quote;
    } catch (error) {
      lastError = String(error?.message || error);
    }
  }
  if (lastError) {
    console.warn(`[nasdaq] ${symbol} failed: ${lastError}`);
  }
  return null;
}

async function requestQuotesViaNasdaq(symbols, market, options = {}) {
  const fallbackToTencent = Boolean(options.fallbackToTencent);
  if (market !== "us") {
    return requestQuotesViaTencent(symbols);
  }

  const now = Date.now();
  const result = new Map();
  const pending = [];

  for (const symbol of symbols) {
    const cached = nasdaqQuoteCache.get(symbol);
    if (cached && now - cached.at <= NASDAQ_CACHE_MS) {
      result.set(symbol, cached.quote);
      continue;
    }

    const existingPending = nasdaqQuotePending.get(symbol);
    if (existingPending) {
      pending.push(
        existingPending.then(() => {
          const cached = nasdaqQuoteCache.get(symbol);
          if (cached) result.set(symbol, cached.quote);
        }),
      );
      continue;
    }

    const job = requestSingleQuoteViaNasdaq(symbol)
      .then((quote) => {
        if (quote) {
          nasdaqQuoteCache.set(symbol, { quote, at: Date.now() });
          result.set(symbol, quote);
        }
      })
      .finally(() => {
        nasdaqQuotePending.delete(symbol);
      });

    nasdaqQuotePending.set(symbol, job);
    pending.push(job);
  }

  if (pending.length) await Promise.allSettled(pending);

  for (const symbol of symbols) {
    if (result.has(symbol)) continue;
    const cached = nasdaqQuoteCache.get(symbol);
    if (!cached) continue;
    if (Date.now() - cached.at > NASDAQ_CACHE_MS) continue;
    result.set(symbol, cached.quote);
  }

  const unresolved = symbols.filter((symbol) => !result.has(symbol));
  if (unresolved.length) {
    console.warn(`[nasdaq] unresolved ${unresolved.length}/${symbols.length}: ${unresolved.join(",")}`);
  }
  if (unresolved.length && fallbackToTencent) {
    const fallback = await requestQuotesViaTencent(unresolved);
    for (const item of fallback) {
      if (!result.has(item.code)) result.set(item.code, item);
    }
  }

  return symbols.map((symbol) => result.get(symbol) || buildEmptyQuote(symbol));
}

function httpGetBuffer(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
          Accept: "*/*",
          "Accept-Encoding": "identity",
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const status = response.statusCode || 500;
          const body = Buffer.concat(chunks);
          if (status >= 400) {
            reject(new Error(`HTTP ${status}: ${body.toString("utf8").slice(0, 200)}`));
            return;
          }
          if (!body.length) {
            reject(new Error("空响应"));
            return;
          }
          resolve(body);
        });
      },
    );
    request.setTimeout(10000, () => request.destroy(new Error("请求超时")));
    request.on("error", reject);
    request.end();
  });
}

async function httpGetBufferViaCurl(url, headers = {}) {
  const args = ["-sS", "--connect-timeout", "8", "--max-time", "12"];
  for (const [key, value] of Object.entries(headers)) {
    args.push("-H", `${key}: ${value}`);
  }
  args.push(url);
  const { stdout } = await execFileAsync("curl", args, { maxBuffer: 2 * 1024 * 1024 });
  const text = String(stdout || "");
  if (!text.trim()) throw new Error("curl 空响应");
  return Buffer.from(text, "utf8");
}

function normalizeSymbols(symbols, marketHint = watchState.currentMarket) {
  const normalized = Array.from(
    new Set(
      (Array.isArray(symbols) ? symbols : [])
        .map((item) => normalizeTicker(item, marketHint))
        .filter(Boolean),
    ),
  );
  return normalized.length ? normalized : [...MARKET_CONFIG[marketHint].defaultSymbols];
}

function normalizeGroup(rawGroup) {
  const market = getMarketIds().includes(String(rawGroup?.market || "")) ? String(rawGroup.market) : "hk";
  return {
    id: String(rawGroup?.id || ""),
    market,
    name: String(rawGroup?.name || "").trim() || "未命名分组",
    symbols: normalizeSymbols(rawGroup?.symbols, market),
  };
}

function getActiveGroupId(market = watchState.currentMarket) {
  return watchState.currentGroupByMarket?.[market] || "";
}

function getGroupsByMarket(market = watchState.currentMarket) {
  return watchState.groups.filter((group) => group.market === market);
}

function getActiveGroup(market = watchState.currentMarket) {
  const activeId = getActiveGroupId(market);
  const byMarket = getGroupsByMarket(market);
  return byMarket.find((group) => group.id === activeId) || byMarket[0] || null;
}

function buildWatchPayload() {
  const market = watchState.currentMarket;
  return {
    market,
    source: getSourceLabel(activeSourceId),
    windowOpacity: normalizeWindowOpacity(watchState.windowOpacity),
    markets: getMarketIds().map((id) => ({ id, label: MARKET_CONFIG[id].label })),
    groups: getGroupsByMarket(market),
    currentGroupId: getActiveGroupId(market),
  };
}

async function loadWatchState() {
  try {
    const content = await fsp.readFile(watchStateFile, "utf8");
    const parsed = JSON.parse(content);
    const groups = (Array.isArray(parsed?.groups) ? parsed.groups : [])
      .map(normalizeGroup)
      .filter((group) => group.id);

    const currentMarket = getMarketIds().includes(String(parsed?.currentMarket || "")) ? String(parsed.currentMarket) : "hk";
    const currentGroupByMarket = {};
    for (const market of getMarketIds()) {
      const candidate = String(parsed?.currentGroupByMarket?.[market] || "");
      const firstGroup = groups.find((group) => group.market === market)?.id || `${market}_default`;
      currentGroupByMarket[market] = groups.find((group) => group.id === candidate && group.market === market)
        ? candidate
        : firstGroup;
    }

    watchState = {
      version: 2,
      currentMarket,
      windowOpacity: normalizeWindowOpacity(parsed?.windowOpacity),
      currentGroupByMarket,
      groups: groups.length ? groups : createDefaultWatchState().groups,
    };
  } catch {
    watchState = createDefaultWatchState();
  }

  for (const market of getMarketIds()) {
    if (!getGroupsByMarket(market).length) {
      watchState.groups.push({
        id: `${market}_default`,
        market,
        name: `${MARKET_CONFIG[market].label}默认`,
        symbols: [...MARKET_CONFIG[market].defaultSymbols],
      });
    }
    if (!getActiveGroup(market)) {
      watchState.currentGroupByMarket[market] = getGroupsByMarket(market)[0].id;
    }
  }

  trackedSymbols = normalizeSymbols(getActiveGroup(watchState.currentMarket)?.symbols, watchState.currentMarket);
  await saveWatchState();
}

async function loadCredentials() {
  try {
    const content = await fsp.readFile(credentialsFile, "utf8");
    const parsed = JSON.parse(content);
    runtimeSecrets = {
      alpacaDataBaseUrl: String(parsed?.alpacaDataBaseUrl || DEFAULT_ALPACA_DATA_BASE_URL).trim() || DEFAULT_ALPACA_DATA_BASE_URL,
      alpacaKeyId: String(parsed?.alpacaKeyId || DEFAULT_APCA_API_KEY_ID).trim(),
      alpacaSecretKey: String(parsed?.alpacaSecretKey || DEFAULT_APCA_API_SECRET_KEY).trim(),
    };
  } catch {
    runtimeSecrets = {
      alpacaDataBaseUrl: DEFAULT_ALPACA_DATA_BASE_URL,
      alpacaKeyId: DEFAULT_APCA_API_KEY_ID,
      alpacaSecretKey: DEFAULT_APCA_API_SECRET_KEY,
    };
  }
}

async function saveWatchState() {
  await fsp.writeFile(watchStateFile, JSON.stringify(watchState, null, 2), "utf8");
}

function emitWatchState() {
  mainWindow?.webContents.send("watchgroups:update", buildWatchPayload());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 430,
    height: 720,
    minWidth: 360,
    minHeight: 500,
    frame: true,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    opacity: normalizeWindowOpacity(watchState.windowOpacity),
    vibrancy: "under-window",
    visualEffectState: "active",
    titleBarStyle: "hiddenInset",
    alwaysOnTop: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: false,
      devTools: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer/index.html"));
}

async function setWindowOpacity(nextOpacity) {
  const opacity = normalizeWindowOpacity(nextOpacity);
  watchState.windowOpacity = opacity;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setOpacity(opacity);
  }
  await saveWatchState();
  mainWindow?.webContents.send("window:opacity", opacity);
  return opacity;
}

function previewWindowOpacity(nextOpacity) {
  const opacity = normalizeWindowOpacity(nextOpacity);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setOpacity(opacity);
    mainWindow.webContents.send("window:opacity", opacity);
  }
  return opacity;
}

function formatIsoTime(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString("zh-CN", { hour12: false });
}

async function alpacaGet(pathname, params = {}) {
  if (!runtimeSecrets.alpacaKeyId || !runtimeSecrets.alpacaSecretKey) {
    throw new Error("Alpaca 夜盘需要配置 APCA_API_KEY_ID 和 APCA_API_SECRET_KEY");
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }

  const base = String(runtimeSecrets.alpacaDataBaseUrl || DEFAULT_ALPACA_DATA_BASE_URL).replace(/\/+$/, "");
  const endpoint = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const url = `${base}${endpoint}${query.size ? `?${query.toString()}` : ""}`;
  const buffer = await httpGetBuffer(url, {
    Accept: "application/json",
    "APCA-API-KEY-ID": runtimeSecrets.alpacaKeyId,
    "APCA-API-SECRET-KEY": runtimeSecrets.alpacaSecretKey,
  });
  return JSON.parse(buffer.toString("utf8"));
}

function getAlpacaSymbol(symbol) {
  const [base, suffix] = String(symbol || "").toUpperCase().split(".");
  if (suffix !== "US") return "";
  return String(base || "").replace(/[^A-Z0-9.-]/g, "");
}

function parseAlpacaSnapshot(symbol, snapshot) {
  const latestTrade = snapshot?.latestTrade || {};
  const minuteBar = snapshot?.minuteBar || {};
  const dailyBar = snapshot?.dailyBar || {};
  const prevDailyBar = snapshot?.prevDailyBar || {};

  const priceCandidates = [latestTrade?.p, minuteBar?.c, dailyBar?.c];
  const price = priceCandidates.map((value) => Number(value)).find((value) => Number.isFinite(value));
  if (!Number.isFinite(price)) return buildEmptyQuote(symbol);

  const prevClose = Number(prevDailyBar?.c);
  const high = Number.isFinite(Number(minuteBar?.h)) ? Number(minuteBar?.h) : Number(dailyBar?.h);
  const low = Number.isFinite(Number(minuteBar?.l)) ? Number(minuteBar?.l) : Number(dailyBar?.l);
  const openPrice = Number.isFinite(Number(minuteBar?.o)) ? Number(minuteBar?.o) : Number(dailyBar?.o);
  const avgPrice = [minuteBar?.vw, dailyBar?.vw].map((value) => Number(value)).find((value) => Number.isFinite(value));
  const volume = Number.isFinite(Number(minuteBar?.v)) ? Number(minuteBar?.v) : Number(dailyBar?.v);
  const change = Number.isFinite(prevClose) ? price - prevClose : Number.NaN;
  const changePct = Number.isFinite(change) && prevClose ? (change / prevClose) * 100 : Number.NaN;

  return {
    code: symbol,
    name: `STOCK ${getTickerBase(symbol)}`,
    price,
    prevClose,
    openPrice,
    avgPrice,
    volume,
    time: formatIsoTime(latestTrade?.t || minuteBar?.t || dailyBar?.t || ""),
    change,
    changePct,
    high,
    low,
  };
}

async function requestQuotesViaAlpacaOvernight(symbols, market) {
  if (market !== "us") {
    return requestQuotesViaTencent(symbols);
  }

  const now = Date.now();
  const bySymbol = new Map();
  const querySymbols = [];
  for (const symbol of symbols) {
    const cached = alpacaQuoteCache.get(symbol);
    if (cached && now - cached.at <= ALPACA_CACHE_MS) {
      bySymbol.set(symbol, cached.quote);
      continue;
    }
    const alpacaSymbol = getAlpacaSymbol(symbol);
    if (!alpacaSymbol) continue;
    querySymbols.push(alpacaSymbol);
  }

  if (querySymbols.length) {
    const payload = await alpacaGet("/stocks/snapshots", {
      symbols: querySymbols.join(","),
      feed: "overnight",
    });
    const snapshots = payload?.snapshots || {};
    for (const symbol of symbols) {
      if (bySymbol.has(symbol)) continue;
      const alpacaSymbol = getAlpacaSymbol(symbol);
      if (!alpacaSymbol || !snapshots[alpacaSymbol]) continue;
      const quote = parseAlpacaSnapshot(symbol, snapshots[alpacaSymbol]);
      alpacaQuoteCache.set(symbol, { quote, at: Date.now() });
      bySymbol.set(symbol, quote);
    }
  }

  return symbols.map((symbol) => bySymbol.get(symbol) || buildEmptyQuote(symbol));
}

function mapTencentCode(symbol) {
  const upper = String(symbol || "").toUpperCase();
  const [baseRaw, suffixRaw] = upper.split(".");
  const base = String(baseRaw || "");
  const suffix = String(suffixRaw || "");
  if (suffix === "HK") {
    if (/^\d{1,5}$/.test(base)) return `r_hk${base.padStart(5, "0")}`;
    return `r_hk${base.replace(/[^A-Z0-9]/g, "")}`;
  }
  if (suffix === "SH" && /^\d{1,6}$/.test(base)) return `sh${base.padStart(6, "0")}`;
  if (suffix === "SZ" && /^\d{1,6}$/.test(base)) return `sz${base.padStart(6, "0")}`;
  if (suffix === "US") {
    const alias = base === "GSPC" ? "INX" : base;
    return `us${alias.replace(/[^A-Z0-9.-]/g, "")}`;
  }
  return "";
}

function parseTencentQuote(fields, symbol) {
  const suffix = String(symbol || "").toUpperCase().split(".")[1] || "";
  const name = String(fields?.[1] || `STOCK ${getTickerBase(symbol)}`).trim();
  const price = toFiniteNumber(fields?.[3]);
  const prevClose = toFiniteNumber(fields?.[4]);
  const openPrice = toFiniteNumber(fields?.[5]);
  const high = toFiniteNumber(fields?.[33]);
  const low = toFiniteNumber(fields?.[34]);
  const volume = toFiniteNumber(fields?.[6]);
  let avgPrice = Number.NaN;
  let change = toFiniteNumber(fields?.[31]);
  let changePct = toFiniteNumber(fields?.[32]);

  if (suffix === "HK") {
    avgPrice = toFiniteNumber(fields?.[73]);
    if (!Number.isFinite(avgPrice)) {
      const turnover = toFiniteNumber(fields?.[37]);
      if (Number.isFinite(turnover) && Number.isFinite(volume) && volume > 0) {
        avgPrice = turnover / volume;
      }
    }
  } else if (suffix === "SH" || suffix === "SZ") {
    avgPrice = toFiniteNumber(fields?.[51]);
  } else if (suffix === "US") {
    avgPrice = toFiniteNumber(fields?.[67]);
    if (!Number.isFinite(avgPrice)) {
      const turnover = toFiniteNumber(fields?.[37]);
      if (Number.isFinite(turnover) && Number.isFinite(volume) && volume > 0) {
        avgPrice = turnover / volume;
      }
    }
  }

  if (Number.isNaN(change) && Number.isFinite(price) && Number.isFinite(prevClose)) {
    change = price - prevClose;
  }
  if (Number.isNaN(changePct) && Number.isFinite(change) && Number.isFinite(prevClose) && prevClose !== 0) {
    changePct = (change / prevClose) * 100;
  }

  return {
    code: symbol,
    name,
    price,
    prevClose,
    openPrice,
    avgPrice,
    volume,
    time: formatCompactTime(fields?.[30] || fields?.[29] || ""),
    change,
    changePct,
    high,
    low,
  };
}

async function requestQuotesViaTencent(symbols) {
  const codeToSymbols = new Map();
  for (const symbol of symbols) {
    const code = mapTencentCode(symbol);
    if (!code) continue;
    const list = codeToSymbols.get(code) || [];
    list.push(symbol);
    codeToSymbols.set(code, list);
  }

  const queryCodes = Array.from(codeToSymbols.keys());
  if (!queryCodes.length) {
    return symbols.map((symbol) => buildEmptyQuote(symbol));
  }

  const url = `https://qt.gtimg.cn/q=${encodeURIComponent(queryCodes.join(","))}`;
  const buffer = await httpGetBuffer(url, { Referer: "https://gu.qq.com/" });
  const text = iconv.decode(buffer, "gbk");
  const result = new Map();
  const regex = /v_([^=]+)="([^"]*)";?/g;
  let matched = false;
  let match;
  while ((match = regex.exec(text)) !== null) {
    matched = true;
    const code = String(match[1] || "").trim();
    const body = String(match[2] || "");
    const targetSymbols = codeToSymbols.get(code);
    if (!targetSymbols?.length) continue;
    const fields = body.split("~");
    const parsed = targetSymbols.map((symbol) => parseTencentQuote(fields, symbol));
    for (const item of parsed) result.set(item.code, item);
  }
  if (!matched) {
    throw new Error("腾讯行情响应格式异常");
  }
  return symbols.map((symbol) => result.get(symbol) || buildEmptyQuote(symbol));
}

function getZonedClock(timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const map = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }
  const weekday = map.weekday || "";
  const hour = Number(map.hour || 0);
  const minute = Number(map.minute || 0);
  return { weekday, minutes: hour * 60 + minute };
}

function getMarketStatus(market) {
  const config = MARKET_CONFIG[market];
  const { weekday, minutes } = getZonedClock(config.timezone);
  const isWeekend = weekday === "Sat" || weekday === "Sun";
  if (market === "us") {
    if (isWeekend) {
      return {
        market,
        label: "休市",
        phase: "closed",
        isOpen: false,
        detail: "美股周末休市",
      };
    }
    const pre = minutes >= 4 * 60 && minutes < 9 * 60 + 30;
    const regular = minutes >= 9 * 60 + 30 && minutes < 16 * 60;
    const post = minutes >= 16 * 60 && minutes < 20 * 60;
    if (regular) {
      return { market, label: "盘中", phase: "regular", isOpen: true, detail: "09:30-16:00 ET" };
    }
    if (pre) {
      return { market, label: "盘前", phase: "pre", isOpen: true, detail: "04:00-09:30 ET" };
    }
    if (post) {
      return { market, label: "盘后", phase: "post", isOpen: true, detail: "16:00-20:00 ET" };
    }
    return {
      market,
      label: "休市",
      phase: "closed",
      isOpen: false,
      detail: "20:00-04:00 ET 免费源通常无持续成交更新",
    };
  }

  const isOpen = !isWeekend && config.sessions.some(([start, end]) => minutes >= start && minutes < end);
  const sessionText = config.sessions
    .map(([start, end]) => {
      const hhmm = (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
      return `${hhmm(start)}-${hhmm(end)}`;
    })
    .join(" / ");
  return {
    market,
    label: isOpen ? "开市中" : "休市",
    phase: isOpen ? "open" : "closed",
    isOpen,
    detail: `交易时段 ${sessionText}`,
  };
}

function countValidQuotes(items, symbols) {
  const wanted = new Set(symbols);
  let count = 0;
  for (const item of items) {
    if (!wanted.has(item.code)) continue;
    if (Number.isFinite(Number(item.price))) count += 1;
  }
  return count;
}

function getAutoSourcePlan(market, marketStatus) {
  if (market !== "us") return ["tencent"];
  if (marketStatus.phase === "closed" && /20:00-04:00 ET/.test(String(marketStatus.detail || ""))) {
    return runtimeSecrets.alpacaKeyId ? ["alpaca_overnight", "nasdaq", "tencent"] : ["nasdaq", "tencent"];
  }
  if (["pre", "regular", "post"].includes(marketStatus.phase)) {
    return ["nasdaq", "tencent"];
  }
  return ["tencent"];
}

async function fetchQuotesForSource(source, tracked, indices, market, marketStatus) {
  const mergedSymbols = Array.from(new Set([...indices, ...tracked]));
  if (source === "tencent") {
    return requestQuotesViaTencent(mergedSymbols, market);
  }
  if (source === "alpaca_overnight") {
    if (market !== "us") return requestQuotesViaTencent(mergedSymbols, market);
    const useOvernightFeed = marketStatus.phase === "closed" && /20:00-04:00 ET/.test(String(marketStatus.detail || ""));
    const [mainQuotes, indexQuotes] = await Promise.all([
      useOvernightFeed
        ? requestQuotesViaAlpacaOvernight(tracked, market)
        : requestQuotesViaNasdaq(tracked, market, { fallbackToTencent: false }),
      requestQuotesViaTencent(indices, market),
    ]);
    const merged = new Map();
    for (const item of [...indexQuotes, ...mainQuotes]) merged.set(item.code, item);
    return Array.from(merged.values());
  }
  if (source === "nasdaq") {
    if (market !== "us") return requestQuotesViaTencent(mergedSymbols, market);
    const [mainQuotes, indexQuotes] = await Promise.all([
      requestQuotesViaNasdaq(tracked, market, { fallbackToTencent: false }),
      requestQuotesViaTencent(indices, market),
    ]);
    const merged = new Map();
    for (const item of [...indexQuotes, ...mainQuotes]) merged.set(item.code, item);
    return Array.from(merged.values());
  }
  return requestQuotesViaTencent(mergedSymbols, market);
}

async function refreshMarketData() {
  if (marketRefreshInFlight) return;
  marketRefreshInFlight = true;
  try {
    const market = watchState.currentMarket;
    const marketStatus = getMarketStatus(market);
    const indexConfig = MARKET_CONFIG[market].indexSymbols || [];
    const indexSymbols = indexConfig.map((item) => item.symbol);
    const mergedSymbols = Array.from(new Set([...indexSymbols, ...trackedSymbols]));
    const sourcePlan = getAutoSourcePlan(market, marketStatus);
    let allQuotes = [];
    activeSourceId = sourcePlan[0] || "tencent";

    for (const candidate of sourcePlan) {
      try {
        const candidateQuotes = await fetchQuotesForSource(candidate, trackedSymbols, indexSymbols, market, marketStatus);
        const validCount = countValidQuotes(candidateQuotes, trackedSymbols);
        if (validCount > 0) {
          allQuotes = candidateQuotes;
          activeSourceId = candidate;
          break;
        }
      } catch (error) {
        console.warn(`[source] ${candidate} failed: ${String(error?.message || error)}`);
      }
    }

    if (!allQuotes.length) {
      allQuotes = await requestQuotesViaTencent(mergedSymbols, market);
      activeSourceId = "tencent";
    }

    const byCode = new Map(allQuotes.map((item) => [item.code, item]));

    marketIndices = indexConfig.map((index) => {
      const quote = byCode.get(index.symbol);
      if (quote) return { ...quote, name: index.name, isIndex: true };
      return {
        code: index.symbol,
        name: index.name,
        isIndex: true,
        price: Number.NaN,
        prevClose: Number.NaN,
        openPrice: Number.NaN,
        volume: Number.NaN,
        time: "",
        change: Number.NaN,
        changePct: Number.NaN,
        high: Number.NaN,
        low: Number.NaN,
      };
    });

    marketSnapshot = trackedSymbols.map((symbol) => byCode.get(symbol)).filter(Boolean);
    mainWindow?.webContents.send("market:update", {
      items: marketSnapshot,
      indices: marketIndices,
      symbols: trackedSymbols,
      market,
      source: getSourceLabel(activeSourceId),
      marketStatus,
      at: Date.now(),
    });
  } catch (error) {
    mainWindow?.webContents.send("market:error", String(error?.message || error));
  } finally {
    marketRefreshInFlight = false;
  }
}

function startPolling() {
  stopPolling();
  refreshMarketData();
  marketTimer = setInterval(refreshMarketData, REFRESH_MS);
}

function stopPolling() {
  if (!marketTimer) return;
  clearInterval(marketTimer);
  marketTimer = null;
}

async function applySymbols(symbols) {
  trackedSymbols = normalizeSymbols(symbols, watchState.currentMarket);
  const active = getActiveGroup();
  if (active) {
    const index = watchState.groups.findIndex((group) => group.id === active.id);
    if (index >= 0) watchState.groups[index] = { ...watchState.groups[index], symbols: [...trackedSymbols] };
  }
  await saveWatchState();
  emitWatchState();
  await refreshMarketData();
}

async function switchMarket(market) {
  if (!getMarketIds().includes(market)) return;
  watchState.currentMarket = market;
  trackedSymbols = normalizeSymbols(getActiveGroup(market)?.symbols, market);
  await saveWatchState();
  emitWatchState();
  await refreshMarketData();
}

app.whenReady().then(async () => {
  watchStateFile = path.join(app.getPath("userData"), "watch-groups.json");
  credentialsFile = path.join(app.getPath("userData"), "credentials.json");
  await loadCredentials();
  await loadWatchState();
  createWindow();
  startPolling();

  ipcMain.handle("market:getSnapshot", () => ({
    items: marketSnapshot,
    indices: marketIndices,
    symbols: trackedSymbols,
    market: watchState.currentMarket,
    source: getSourceLabel(activeSourceId),
    windowOpacity: normalizeWindowOpacity(watchState.windowOpacity),
    marketStatus: getMarketStatus(watchState.currentMarket),
  }));

  ipcMain.handle("market:setSymbols", async (_, symbols) => {
    await applySymbols(symbols);
    return { ok: true, symbols: trackedSymbols };
  });

  ipcMain.handle("market:setMarket", async (_, market) => {
    await switchMarket(String(market || ""));
    return { ok: true, market: watchState.currentMarket, symbols: trackedSymbols };
  });

  ipcMain.handle("watchgroups:get", () => buildWatchPayload());

  ipcMain.handle("watchgroups:save", async (_, payload) => {
    const market = watchState.currentMarket;
    const name = String(payload?.name || "").trim();
    const symbols = normalizeSymbols(payload?.symbols, market);
    const groupId = String(payload?.groupId || "");
    const createNew = Boolean(payload?.createNew);
    let nextGroupId = groupId;

    if (!createNew && groupId) {
      const index = watchState.groups.findIndex((group) => group.id === groupId && group.market === market);
      if (index >= 0) {
        watchState.groups[index] = {
          ...watchState.groups[index],
          name: name || watchState.groups[index].name,
          symbols,
        };
      }
    } else {
      nextGroupId = `group_${market}_${Date.now().toString(36)}`;
      watchState.groups.push({
        id: nextGroupId,
        market,
        name: name || `${MARKET_CONFIG[market].label}分组`,
        symbols,
      });
    }

    watchState.currentGroupByMarket[market] = nextGroupId;
    trackedSymbols = [...symbols];
    await saveWatchState();
    emitWatchState();
    await refreshMarketData();
    return buildWatchPayload();
  });

  ipcMain.handle("watchgroups:remove", async (_, groupId) => {
    const market = watchState.currentMarket;
    const id = String(groupId || "");
    const groups = getGroupsByMarket(market);
    if (groups.length <= 1) return buildWatchPayload();

    watchState.groups = watchState.groups.filter((group) => !(group.market === market && group.id === id));
    if (!getActiveGroup(market)) {
      watchState.currentGroupByMarket[market] = getGroupsByMarket(market)[0].id;
    }
    trackedSymbols = normalizeSymbols(getActiveGroup(market)?.symbols, market);
    await saveWatchState();
    emitWatchState();
    await refreshMarketData();
    return buildWatchPayload();
  });

  ipcMain.handle("watchgroups:activate", async (_, groupId) => {
    const market = watchState.currentMarket;
    const id = String(groupId || "");
    const exists = watchState.groups.find((group) => group.market === market && group.id === id);
    if (!exists) return buildWatchPayload();
    watchState.currentGroupByMarket[market] = id;
    trackedSymbols = normalizeSymbols(exists.symbols, market);
    await saveWatchState();
    emitWatchState();
    await refreshMarketData();
    return buildWatchPayload();
  });

  ipcMain.on("window:toggle-pin", () => {
    if (!mainWindow) return;
    const next = !mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(next, "floating");
    mainWindow.webContents.send("window:pinned", next);
  });

  ipcMain.on("window:preview-opacity", (_, value) => {
    previewWindowOpacity(value);
  });

  ipcMain.handle("window:set-opacity", async (_, value) => {
    const opacity = await setWindowOpacity(value);
    return { ok: true, opacity };
  });
});

app.on("window-all-closed", () => {
  stopPolling();
  if (process.platform !== "darwin") app.quit();
});

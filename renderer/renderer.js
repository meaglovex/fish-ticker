const quoteListEl = document.getElementById("quoteList");
const updateTimeEl = document.getElementById("updateTime");
const marketStateEl = document.getElementById("marketState");
const indexSummaryEl = document.getElementById("indexSummary");
const statusTextEl = document.getElementById("statusText");
const symbolInputEl = document.getElementById("symbolInput");
const symbolLabelEl = document.getElementById("symbolLabel");
const applyBtn = document.getElementById("applyBtn");
const pinBtn = document.getElementById("pinBtn");
const marketTabsEl = document.getElementById("marketTabs");
const sourceTextEl = document.getElementById("sourceText");
const groupSelectEl = document.getElementById("groupSelect");
const groupNameInputEl = document.getElementById("groupNameInput");
const saveGroupBtn = document.getElementById("saveGroupBtn");
const deleteGroupBtn = document.getElementById("deleteGroupBtn");
const selectorPanelEl = document.getElementById("selectorPanel");
const selectorToggleBtn = document.getElementById("selectorToggleBtn");
const opacityRangeEl = document.getElementById("opacityRange");
const opacityValueEl = document.getElementById("opacityValue");

const marketHints = {
  hk: "港股：00700.HK, 00941.HK",
  cn: "大A：600519.SH, 000001.SZ",
  us: "美股：AAPL.US, NVDA.US",
};
const SPARKLINE_MAX_POINTS = 42;
const sparklineHistory = new Map();

let viewState = {
  market: "hk",
  markets: [],
  groups: [],
  currentGroupId: "",
};

let selectorCollapsed = true;
let opacitySetting = 0.52;
let symbolInputDirty = false;
let symbolInputEditing = false;
let lastSyncedSymbolsText = "";

function formatNumber(value, digits = 2) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function getPriceClass(change) {
  if (change > 0) return "up";
  if (change < 0) return "down";
  return "";
}

function parseSymbols(inputText) {
  return String(inputText || "")
    .split(/[,，\s]+/)
    .map((symbol) => symbol.trim())
    .filter(Boolean);
}

function marketStateText(marketStatus) {
  if (!marketStatus) return "状态：--";
  return `状态：${marketStatus.label} · ${marketStatus.detail || ""}`;
}

function clampOpacity(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0.52;
  if (num < 0.03) return 0.03;
  if (num > 1) return 1;
  return num;
}

function updateOpacityUI(opacity) {
  opacitySetting = clampOpacity(opacity);
  if (opacityRangeEl) opacityRangeEl.value = String((opacitySetting * 100).toFixed(1));
  if (opacityValueEl) opacityValueEl.textContent = `${(opacitySetting * 100).toFixed(1)}%`;
}

function pushSparklinePoint(item) {
  const symbol = String(item?.code || "");
  const price = Number(item?.price);
  if (!symbol || !Number.isFinite(price)) return;
  const history = sparklineHistory.get(symbol) || [];
  history.push(price);
  if (history.length > SPARKLINE_MAX_POINTS) {
    history.splice(0, history.length - SPARKLINE_MAX_POINTS);
  }
  sparklineHistory.set(symbol, history);
}

function updateSparklineHistory(items) {
  if (!Array.isArray(items)) return;
  const visibleSymbols = new Set();
  for (const item of items) {
    const symbol = String(item?.code || "");
    if (symbol) visibleSymbols.add(symbol);
    pushSparklinePoint(item);
  }
  for (const symbol of Array.from(sparklineHistory.keys())) {
    if (!visibleSymbols.has(symbol)) sparklineHistory.delete(symbol);
  }
}

function renderSparkline(symbol, changeValue) {
  const values = sparklineHistory.get(symbol) || [];
  if (values.length < 2) {
    return `<div class="sparkline-placeholder"></div>`;
  }
  const width = 148;
  const height = 44;
  const padding = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values
    .map((value, index) => {
      const x = padding + (index / (values.length - 1)) * (width - padding * 2);
      const y = height - padding - ((value - min) / range) * (height - padding * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const trendClass = changeValue > 0 ? "up" : changeValue < 0 ? "down" : "flat";
  return `
    <div class="sparkline-wrap">
      <svg class="sparkline ${trendClass}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        <polyline points="${points}"></polyline>
      </svg>
    </div>
  `;
}

function renderQuotes(items) {
  if (!Array.isArray(items) || !items.length) {
    quoteListEl.innerHTML = `<div class="empty">暂无行情数据，稍后自动刷新</div>`;
    return;
  }

  quoteListEl.innerHTML = items
    .map((item) => {
      const changeValue = Number(item.change);
      const pctValue = Number(item.changePct);
      const priceClass = getPriceClass(changeValue);
      const sign = changeValue > 0 ? "+" : "";
      const priceText = formatNumber(Number(item.price), 3);
      const changeText = formatNumber(changeValue, 3);
      const pctText = formatNumber(pctValue, 2);
      const openText = formatNumber(Number(item.openPrice), 3);
      const avgText = formatNumber(Number(item.avgPrice), 3);
      const highText = formatNumber(Number(item.high), 3);
      const lowText = formatNumber(Number(item.low), 3);
      const volText = formatNumber(Number(item.volume), 0);
      const sparkline = renderSparkline(item.code, changeValue);
      return `
      <article class="quote-card">
        <div class="quote-head">
          <div>
            <div class="quote-name">${item.name || `STOCK ${String(item.code || "").split(".")[0]}`}</div>
            <div class="quote-code">${item.code || "--"}</div>
          </div>
          <div class="quote-head-right">
            <span class="quote-code">${item.time || "--"}</span>
            ${sparkline}
          </div>
        </div>
        <div class="quote-price ${priceClass}">
          <strong>${priceText}</strong>
          <em>${sign}${changeText} (${sign}${pctText}%)</em>
        </div>
        <div class="quote-meta">
          <span>开 ${openText}</span>
          <span>均 ${avgText}</span>
          <span>高 ${highText}</span>
          <span>低 ${lowText}</span>
          <span>量 ${volText}</span>
        </div>
      </article>
    `;
    })
    .join("");
}

function renderIndices(indices) {
  if (!Array.isArray(indices) || !indices.length) {
    indexSummaryEl.textContent = "指数：--";
    return;
  }

  const summary = indices
    .slice(0, 3)
    .map((item) => {
      const pctValue = Number(item.changePct || 0);
      const sign = pctValue > 0 ? "+" : "";
      return `${item.name || item.code} ${formatNumber(Number(item.price || 0), 2)}(${sign}${formatNumber(pctValue, 2)}%)`;
    })
    .join(" · ");
  indexSummaryEl.textContent = `指数：${summary}`;
}

function renderMarketTabs() {
  marketTabsEl.innerHTML = (viewState.markets || [])
    .map((market) => {
      const active = market.id === viewState.market ? "active" : "";
      return `<button class="${active}" data-market="${market.id}">${market.label}</button>`;
    })
    .join("");

  marketTabsEl.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", async () => {
      const market = button.dataset.market || "";
      if (!market || market === viewState.market) return;
      statusTextEl.textContent = "切换市场中...";
      await window.market.setMarket(market);
    });
  });
}

function renderSourceText() {
  sourceTextEl.textContent = `数据源：自动 · 当前 ${viewState.source || "--"}`;
}

function renderGroups() {
  groupSelectEl.innerHTML = (viewState.groups || [])
    .map((group) => `<option value="${group.id}" ${group.id === viewState.currentGroupId ? "selected" : ""}>${group.name}</option>`)
    .join("");
}

function setSelectorCollapsed(next) {
  selectorCollapsed = Boolean(next);
  if (selectorCollapsed) {
    selectorPanelEl.classList.add("is-collapsed");
    selectorToggleBtn.textContent = "展开";
  } else {
    selectorPanelEl.classList.remove("is-collapsed");
    selectorToggleBtn.textContent = "收起";
  }
  localStorage.setItem("fish_ticker_selector_collapsed", selectorCollapsed ? "1" : "0");
}

function updateInputHint() {
  const hint = marketHints[viewState.market] || "代码逗号分隔";
  symbolInputEl.placeholder = hint;
  symbolLabelEl.textContent = `自选代码（${hint}）`;
}

function symbolsToText(symbols) {
  return parseSymbols(Array.isArray(symbols) ? symbols.join(",") : symbols).join(",");
}

function syncSymbolInput(symbols, options = {}) {
  const force = Boolean(options.force);
  const nextText = symbolsToText(symbols);
  lastSyncedSymbolsText = nextText;
  if (!force && (symbolInputEditing || symbolInputDirty)) {
    return;
  }
  symbolInputEl.value = nextText;
  symbolInputDirty = false;
}

function applyWatchPayload(payload) {
  viewState = { ...viewState, ...payload };
  renderMarketTabs();
  renderSourceText();
  renderGroups();
  updateInputHint();
}

async function applySymbols() {
  const symbols = parseSymbols(symbolInputEl.value);
  statusTextEl.textContent = "正在更新自选...";
  await window.market.setSymbols(symbols);
  syncSymbolInput(symbols, { force: true });
}

async function saveGroup() {
  const groupName = groupNameInputEl.value.trim();
  statusTextEl.textContent = "正在保存分组...";
  const payload = {
    groupId: groupSelectEl.value || "",
    name: groupName,
    createNew: Boolean(groupName),
    symbols: parseSymbols(symbolInputEl.value),
  };
  const watchPayload = await window.watchGroups.save(payload);
  applyWatchPayload(watchPayload);
  const active = (watchPayload.groups || []).find((group) => group.id === watchPayload.currentGroupId);
  syncSymbolInput(active?.symbols || payload.symbols, { force: true });
  groupNameInputEl.value = "";
  statusTextEl.textContent = "分组已保存";
}

async function deleteGroup() {
  const current = groupSelectEl.value;
  if (!current) return;
  statusTextEl.textContent = "正在删除分组...";
  const watchPayload = await window.watchGroups.remove(current);
  applyWatchPayload(watchPayload);
  const active = (watchPayload.groups || []).find((group) => group.id === watchPayload.currentGroupId);
  syncSymbolInput(active?.symbols || [], { force: true });
  statusTextEl.textContent = "分组已删除";
}

async function activateGroup(groupId) {
  if (!groupId) return;
  statusTextEl.textContent = "切换分组中...";
  const watchPayload = await window.watchGroups.activate(groupId);
  applyWatchPayload(watchPayload);
  const active = (watchPayload.groups || []).find((group) => group.id === watchPayload.currentGroupId);
  syncSymbolInput(active?.symbols || [], { force: true });
  statusTextEl.textContent = "分组已切换";
}

async function init() {
  const [snapshot, watchPayload] = await Promise.all([window.market.getSnapshot(), window.watchGroups.get()]);
  applyWatchPayload(watchPayload);
  updateOpacityUI(Number(snapshot.windowOpacity));
  syncSymbolInput(snapshot.symbols || [], { force: true });
  marketStateEl.textContent = marketStateText(snapshot.marketStatus);
  updateSparklineHistory(snapshot.items || []);
  renderIndices(snapshot.indices || []);
  renderQuotes(snapshot.items || []);
  const savedCollapsed = localStorage.getItem("fish_ticker_selector_collapsed");
  setSelectorCollapsed(savedCollapsed === null ? true : savedCollapsed === "1");
}

window.market.onUpdate(({ items, indices, symbols, market, source, at, marketStatus }) => {
  const marketChanged = Boolean(market && market !== viewState.market);
  updateSparklineHistory(items || []);
  renderIndices(indices || []);
  renderQuotes(items || []);
  syncSymbolInput(symbols || [], { force: marketChanged });
  viewState.market = market || viewState.market;
  viewState.source = source || viewState.source;
  renderMarketTabs();
  renderSourceText();
  updateInputHint();
  updateTimeEl.textContent = `刷新：${new Date(at).toLocaleTimeString("zh-CN")}`;
  marketStateEl.textContent = marketStateText(marketStatus);
  statusTextEl.textContent = "实时轮询中...";
});

window.market.onError((message) => {
  statusTextEl.textContent = `接口异常：${message}`;
});

window.market.onPinned((pinned) => {
  pinBtn.style.background = pinned ? "rgba(41, 196, 115, 0.2)" : "rgba(255, 255, 255, 0.03)";
});

window.appWindow.onOpacity((opacity) => {
  updateOpacityUI(opacity);
});

window.watchGroups.onUpdate((payload) => {
  applyWatchPayload(payload);
});

applyBtn.addEventListener("click", applySymbols);
saveGroupBtn.addEventListener("click", saveGroup);
deleteGroupBtn.addEventListener("click", deleteGroup);
selectorToggleBtn.addEventListener("click", () => setSelectorCollapsed(!selectorCollapsed));

opacityRangeEl.addEventListener("input", () => {
  const opacity = clampOpacity(Number(opacityRangeEl.value) / 100);
  updateOpacityUI(opacity);
  window.appWindow.previewOpacity(opacity);
});

opacityRangeEl.addEventListener("change", async () => {
  const opacity = clampOpacity(Number(opacityRangeEl.value) / 100);
  updateOpacityUI(opacity);
  await window.appWindow.setOpacity(opacity);
});

groupSelectEl.addEventListener("change", (event) => {
  activateGroup(event.target.value);
});

symbolInputEl.addEventListener("focus", () => {
  symbolInputEditing = true;
});

symbolInputEl.addEventListener("blur", () => {
  symbolInputEditing = false;
});

symbolInputEl.addEventListener("input", () => {
  symbolInputDirty = symbolsToText(symbolInputEl.value) !== lastSyncedSymbolsText;
});

symbolInputEl.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  applySymbols();
});

pinBtn.addEventListener("click", () => window.appWindow.togglePin());

init().catch((error) => {
  statusTextEl.textContent = `初始化失败：${error?.message || error}`;
});

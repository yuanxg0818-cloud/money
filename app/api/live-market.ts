import type {
  Candidate,
  HoldingAdvice,
  MarketBreadth,
  MarketIndex,
  MarketReport,
  ProfilePayload,
  ReportNews,
  ScoreFactors,
} from "../types";

const INDEX_URL =
  "https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=1.000001%2C0.399001%2C1.000300%2C1.000905%2C100.HSI%2C100.NDX&fields=f12%2Cf14%2Cf2%2Cf3%2Cf4%2Cf5%2Cf6";
const STOCK_URL =
  "https://push2delay.eastmoney.com/api/qt/clist/get?pz=100&po=1&np=1&fltt=2&invt=2&fid=f6&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f12,f14,f2,f3,f4,f5,f6,f8,f9,f10,f15,f16,f17,f18,f20,f21,f22,f24,f25";
const ETF_URL =
  "https://push2delay.eastmoney.com/api/qt/clist/get?pz=100&po=1&np=1&fltt=2&invt=2&fid=f6&fs=b:MK0021,b:MK0022,b:MK0023,b:MK0024&fields=f12,f14,f2,f3,f4,f5,f6,f8,f10,f15,f16,f17,f18,f20,f21,f24,f25";
const NEWS_URL =
  "https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=200&req_trace=1710315450384";

type QuoteRow = Record<string, string | number | null | undefined>;

type MarketQuote = {
  code: string;
  name: string;
  kind: "主板" | "ETF";
  price: number;
  change: number;
  amount: number;
  turnover: number;
  pe: number | null;
  high: number;
  low: number;
  open: number;
  prevClose: number;
  marketCap: number;
  change60d: number;
  ytd: number;
};

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function isMainboard(code: string) {
  return /^(000|001|002|003|600|601|603|605)\d{3}$/.test(code);
}

function isTradableEtf(code: string) {
  return /^(15|16|50|51|52|56|58)\d{4}$/.test(code);
}

async function fetchJson(url: string, timeout = 16_000) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "Premarket-AI-Copilot/1.0",
    },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`实时数据源返回 ${response.status}`);
  return response.json() as Promise<unknown>;
}

async function fetchQuotePages(baseUrl: string, pages: number) {
  const payloads = await Promise.all(
    Array.from({ length: pages }, (_, index) =>
      fetchJson(`${baseUrl}&pn=${index + 1}`),
    ),
  );
  const diff = payloads.flatMap((payload) => {
    if (
      payload &&
      typeof payload === "object" &&
      "data" in payload &&
      payload.data &&
      typeof payload.data === "object" &&
      "diff" in payload.data &&
      Array.isArray(payload.data.diff)
    ) {
      return payload.data.diff as QuoteRow[];
    }
    return [];
  });
  return { data: { diff } };
}

function parseQuotes(payload: unknown, kind: "主板" | "ETF") {
  const rows =
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    payload.data &&
    typeof payload.data === "object" &&
    "diff" in payload.data &&
    Array.isArray(payload.data.diff)
      ? (payload.data.diff as QuoteRow[])
      : [];
  return rows
    .map((row): MarketQuote => ({
      code: String(row.f12 ?? "").padStart(6, "0"),
      name: String(row.f14 ?? ""),
      kind,
      price: number(row.f2),
      change: number(row.f3),
      amount: number(row.f6),
      turnover: number(row.f8),
      pe: row.f9 == null ? null : number(row.f9),
      high: number(row.f15),
      low: number(row.f16),
      open: number(row.f17),
      prevClose: number(row.f18),
      marketCap: number(row.f20),
      change60d: number(row.f24),
      ytd: number(row.f25),
    }))
    .filter(
      (quote) =>
        quote.price > 0 &&
        !/ST|退市|退$/.test(quote.name) &&
        (kind === "主板"
          ? isMainboard(quote.code)
          : isTradableEtf(quote.code) &&
            !/货币|现金|理财|债|国债|政金债/.test(quote.name)),
    );
}

function mergeQuotes(primary: MarketQuote[], extra: MarketQuote[]) {
  const merged = new Map(
    [...primary, ...extra].map((quote) => [quote.code, quote]),
  );
  return [...merged.values()];
}

function holdingQuoteUrl(profile: ProfilePayload) {
  if (profile.quoteLookupConsent !== true) return null;
  const secids = profile.portfolio.holdings
    .slice(0, 80)
    .map((holding) => {
      const market = /^(5|6)/.test(holding.code) ? "1" : "0";
      return `${market}.${holding.code}`;
    })
    .join(",");
  if (!secids) return null;
  return `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${encodeURIComponent(secids)}&fields=f12%2Cf14%2Cf2%2Cf3%2Cf4%2Cf5%2Cf6%2Cf8%2Cf9%2Cf10%2Cf15%2Cf16%2Cf17%2Cf18%2Cf20%2Cf21%2Cf22%2Cf24%2Cf25`;
}

const POSITIVE_WORDS = [
  "增长",
  "突破",
  "增持",
  "回购",
  "中标",
  "上调",
  "利好",
  "创新高",
  "超预期",
  "签约",
  "改善",
  "支持",
];
const NEGATIVE_WORDS = [
  "下调",
  "减持",
  "风险",
  "亏损",
  "处罚",
  "调查",
  "暴跌",
  "违约",
  "不及预期",
  "终止",
  "下滑",
  "冲突",
];

function newsSentiment(text: string) {
  const positive = POSITIVE_WORDS.filter((word) => text.includes(word)).length;
  const negative = NEGATIVE_WORDS.filter((word) => text.includes(word)).length;
  return clamp((positive - negative) * 0.24, -1, 1);
}

function parseNews(payload: unknown, now: Date): ReportNews[] {
  const rows =
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    payload.data &&
    typeof payload.data === "object" &&
    "fastNewsList" in payload.data &&
    Array.isArray(payload.data.fastNewsList)
      ? (payload.data.fastNewsList as QuoteRow[])
      : [];
  return rows.slice(0, 80).map((row) => {
    const title = String(row.title ?? "财经快讯");
    const summary = String(row.summary ?? "");
    const rawTime = String(row.showTime ?? "");
    const normalizedTime = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(rawTime)
      ? `${rawTime.replace(" ", "T")}+08:00`
      : rawTime;
    const publishedAt = normalizedTime ? new Date(normalizedTime) : now;
    const sentiment = newsSentiment(`${title} ${summary}`);
    const tag = /美联储|美股|纳斯达克|标普|美元/.test(title)
      ? "海外"
      : /政策|国务院|央行|证监会|财政/.test(title)
        ? "政策"
        : /原油|黄金|铜|商品/.test(title)
          ? "商品"
          : "市场";
    return {
      time: publishedAt.toLocaleTimeString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
      publishedAt: Number.isNaN(publishedAt.getTime())
        ? now.toISOString()
        : publishedAt.toISOString(),
      tag,
      title,
      summary: summary.slice(0, 240),
      source: "东方财富全球财经快讯",
      impact:
        sentiment > 0.18
          ? ("positive" as const)
          : sentiment < -0.18
            ? ("negative" as const)
            : ("neutral" as const),
      tickers: [],
    };
  });
}

function parseIndices(payload: unknown): MarketIndex[] {
  const rows =
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    payload.data &&
    typeof payload.data === "object" &&
    "diff" in payload.data &&
    Array.isArray(payload.data.diff)
      ? (payload.data.diff as QuoteRow[])
      : [];
  return rows.map((row) => {
    const name = String(row.f14 ?? "");
    return {
      code: String(row.f12 ?? ""),
      name,
      market: /恒生/.test(name)
        ? "HK"
        : /纳斯达克/.test(name)
          ? "US"
          : "CN",
      last: number(row.f2),
      change: number(row.f3),
      amount: number(row.f6),
    };
  });
}

function factorScores(quote: MarketQuote, relatedNews: ReportNews[]) {
  const dayPosition =
    quote.high > quote.low
      ? clamp(((quote.price - quote.low) / (quote.high - quote.low)) * 100)
      : 50;
  const momentum =
    quote.change >= 0
      ? clamp(54 + quote.change * 7 - Math.max(0, quote.change - 5) * 12)
      : clamp(48 + quote.change * 5);
  const trend = clamp(
    52 +
      clamp(quote.change60d, -25, 35) * 0.9 +
      clamp(quote.ytd, -30, 40) * 0.3,
  );
  const liquidity = clamp(
    25 + (Math.log10(Math.max(quote.amount, 10_000_000)) - 8) * 36,
  );
  const valuation =
    quote.kind === "ETF"
      ? 68
      : quote.pe != null && quote.pe > 0 && quote.pe <= 45
        ? clamp(86 - Math.abs(quote.pe - 22) * 1.35)
        : 44;
  const news =
    relatedNews.length === 0
      ? 50
      : clamp(
          50 +
            relatedNews.reduce(
              (sum, item) =>
                sum +
                (item.impact === "positive"
                  ? 12
                  : item.impact === "negative"
                    ? -15
                    : 0),
              0,
            ),
        );
  const rangePct =
    quote.prevClose > 0
      ? ((quote.high - quote.low) / quote.prevClose) * 100
      : 0;
  const risk = clamp(
    Math.max(0, Math.abs(quote.change) - 4) * 7 +
      Math.max(0, rangePct - 6) * 5 +
      Math.max(0, dayPosition - 94) * 0.8,
  );
  const factors: ScoreFactors = {
    momentum: Math.round(momentum),
    trend: Math.round(trend),
    liquidity: Math.round(liquidity),
    quality: Math.round(valuation),
    news: Math.round(news),
    risk: Math.round(risk),
  };
  const score = clamp(
    momentum * 0.24 +
      trend * 0.24 +
      liquidity * 0.2 +
      valuation * 0.12 +
      news * 0.1 +
      dayPosition * 0.1 -
      risk * 0.18,
  );
  return { score, factors, dayPosition, rangePct };
}

function buildCandidate(
  quote: MarketQuote,
  news: ReportNews[],
): Omit<Candidate, "rank"> {
  const relatedNews = news.filter((item) => item.title.includes(quote.name));
  const { score, factors, rangePct } = factorScores(
    quote,
    relatedNews,
  );
  const precision = quote.kind === "ETF" ? 3 : 2;
  const buyLow = Math.max(
    quote.low || quote.price * 0.98,
    quote.price * 0.985,
  );
  const buyHigh = Math.min(
    quote.price * 1.003,
    (quote.prevClose || quote.price) * 1.035,
  );
  const thesis = [
    factors.trend >= 65
      ? `60日与年内趋势保持强势`
      : `中期趋势处于可观察区间`,
    `成交额${(quote.amount / 100_000_000).toFixed(1)}亿元，流动性评分${factors.liquidity}`,
    factors.momentum >= 65
      ? `当日动量与价格位置相对占优`
      : `未出现明显追涨动量`,
  ];
  if (relatedNews.length > 0) {
    thesis.push(`匹配到${relatedNews.length}条公司相关快讯`);
  }
  const risks = [
    ...(quote.change > 5 ? ["当日涨幅较大，禁止市价追高"] : []),
    ...(quote.change60d > 45 ? ["60日累计涨幅偏高，回撤风险上升"] : []),
    ...(rangePct > 8 ? ["日内振幅较高，限价单成交不确定"] : []),
    ...(quote.kind === "主板" &&
    (quote.pe == null || quote.pe <= 0 || quote.pe > 60)
      ? ["估值数据不完整或处于偏高区间"]
      : []),
  ];
  return {
    code: quote.code,
    name: quote.name,
    kind: quote.kind,
    score: Math.round(score),
    potentialLabel:
      score >= 78
        ? "高潜力"
        : score >= 68
          ? "偏强"
          : score >= 58
            ? "观察"
            : "低优先级",
    confidence: Math.round(
      clamp(
        58 +
          (quote.amount > 500_000_000 ? 8 : 0) +
          (quote.prevClose > 0 ? 6 : 0) +
          (relatedNews.length > 0 ? 5 : 0),
        45,
        86,
      ),
    ),
    change: quote.change,
    price: quote.price,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    amount: quote.amount,
    turnover: quote.turnover,
    pe: quote.pe,
    marketCap: quote.marketCap,
    buyLow: Number(buyLow.toFixed(precision)),
    buyHigh: Number(Math.max(buyLow, buyHigh).toFixed(precision)),
    stopPrice: Number(
      Math.min(quote.low || quote.price * 0.96, quote.price * 0.955).toFixed(
        precision,
      ),
    ),
    tag:
      factors.trend >= 72
        ? "趋势领先"
        : factors.liquidity >= 75
          ? "资金关注"
          : "综合占优",
    thesis,
    risks: risks.length > 0 ? risks.slice(0, 3) : ["评分不是上涨概率，需等待价格条件"],
    factors,
  };
}

function buildBreadth(quotes: MarketQuote[]): MarketBreadth {
  const changes = quotes
    .map((quote) => quote.change)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  return {
    rise: changes.filter((value) => value > 0.05).length,
    fall: changes.filter((value) => value < -0.05).length,
    flat: changes.filter((value) => Math.abs(value) <= 0.05).length,
    limitUp: changes.filter((value) => value >= 9.8).length,
    limitDown: changes.filter((value) => value <= -9.8).length,
    total: changes.length,
    medianChange:
      changes.length > 0
        ? changes[Math.floor(changes.length / 2)]
        : 0,
  };
}

function chinaMarketStatus(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minutes = number(map.hour) * 60 + number(map.minute);
  if (["Sat", "Sun"].includes(map.weekday)) return "休市";
  if (minutes >= 555 && minutes < 570) return "集合竞价";
  if (
    (minutes >= 570 && minutes <= 690) ||
    (minutes >= 780 && minutes <= 900)
  ) {
    return "交易中";
  }
  if (minutes > 690 && minutes < 780) return "午间休市";
  return minutes > 900 ? "已收盘" : "盘前";
}

function holdingAdvice(
  profile: ProfilePayload,
  quotes: MarketQuote[],
  candidates: Candidate[],
  news: ReportNews[],
  decision: "wait" | "operate" | "reduce",
): HoldingAdvice[] {
  const quoteMap = new Map(quotes.map((quote) => [quote.code, quote]));
  const scoreMap = new Map(candidates.map((item) => [item.code, item]));
  const totalAsset = Math.max(profile.portfolio.total_asset, 1);
  const maxSingle = profile.risk.maxSinglePct;
  return profile.portfolio.holdings.map((holding) => {
    const quote = quoteMap.get(holding.code);
    if (!quote) {
      return {
        code: holding.code,
        name: holding.name,
        action: "review" as const,
        actionLabel: "人工复核",
        quantity: 0,
        currentPrice: holding.current_price,
        change: 0,
        pnlPct: holding.pnl_pct,
        positionPct: (holding.market_value / totalAsset) * 100,
        score: 0,
        confidence: 25,
        priceCondition: "未取得该证券的有效实时行情，暂不生成交易动作",
        reasons: ["可能不在主板股票或可交易ETF范围内"],
        relatedNews: [],
      };
    }
    const scored =
      scoreMap.get(holding.code) ??
      ({ ...buildCandidate(quote, news), rank: 0 } as Candidate);
    const liveValue = quote.price * holding.quantity;
    const positionPct = (liveValue / totalAsset) * 100;
    const pnlPct =
      holding.cost_price > 0
        ? (quote.price / holding.cost_price - 1) * 100
        : holding.pnl_pct;
    const relatedNews = news
      .filter((item) => item.title.includes(quote.name))
      .slice(0, 3)
      .map((item) => item.title);
    let action: HoldingAdvice["action"] = "hold";
    let quantity = 0;
    const reasons: string[] = [];
    if (pnlPct <= -8 && scored.score < 60) {
      action = "sell";
      quantity = Math.min(holding.available_quantity, holding.quantity);
      reasons.push(`实时浮亏${pnlPct.toFixed(1)}%，且潜力评分仅${scored.score}`);
    } else if (positionPct > maxSingle) {
      action = "reduce";
      const excess = liveValue - (totalAsset * maxSingle) / 100;
      quantity = Math.max(
        0,
        Math.min(
          holding.available_quantity,
          Math.floor(excess / Math.max(quote.price, 0.01) / 100) * 100,
        ),
      );
      reasons.push(`单一仓位${positionPct.toFixed(1)}%超过上限${maxSingle}%`);
    } else if (scored.score < 48 || quote.change <= -7) {
      action = "reduce";
      quantity =
        Math.floor(
          Math.min(holding.available_quantity, holding.quantity * 0.5) / 100,
        ) * 100;
      reasons.push(`潜力评分${scored.score}，短线结构偏弱`);
    } else if (
      scored.score >= 76 &&
      positionPct < maxSingle * 0.65 &&
      decision === "operate"
    ) {
      action = "add";
      reasons.push(`潜力评分${scored.score}，且当前仓位仍有风险预算`);
    } else {
      reasons.push(`潜力评分${scored.score}，尚未触及强制减仓条件`);
    }
    const actionLabel = {
      sell: "卖出",
      reduce: "减仓",
      hold: "继续持有",
      add: "条件加仓",
      review: "人工复核",
    }[action];
    return {
      code: holding.code,
      name: holding.name || quote.name,
      action,
      actionLabel,
      quantity,
      currentPrice: quote.price,
      change: quote.change,
      pnlPct,
      positionPct,
      score: scored.score,
      confidence: scored.confidence,
      priceCondition:
        action === "add"
          ? `仅在${scored.buyLow.toFixed(quote.kind === "ETF" ? 3 : 2)}–${scored.buyHigh.toFixed(quote.kind === "ETF" ? 3 : 2)}区间，且指数信号不转弱时考虑`
          : action === "sell" || action === "reduce"
            ? `反弹不能站稳${quote.prevClose.toFixed(quote.kind === "ETF" ? 3 : 2)}时优先处理，不以跌停价抢跑`
            : `跌破${scored.stopPrice.toFixed(quote.kind === "ETF" ? 3 : 2)}重新评估`,
      reasons,
      relatedNews,
    };
  });
}

export async function buildLiveMarketReport(
  profile: ProfilePayload,
): Promise<MarketReport> {
  const started = Date.now();
  const now = new Date();
  const holdingsUrl = holdingQuoteUrl(profile);
  const [
    indexPayload,
    stockPayload,
    etfPayload,
    newsPayload,
    holdingPayload,
  ] =
    await Promise.all([
      fetchJson(INDEX_URL),
      fetchQuotePages(STOCK_URL, 10),
      fetchQuotePages(ETF_URL, 16),
      fetchJson(NEWS_URL),
      holdingsUrl
        ? fetchJson(holdingsUrl)
        : Promise.resolve({ data: { diff: [] } }),
    ]);
  const indices = parseIndices(indexPayload);
  const stocks = mergeQuotes(
    parseQuotes(stockPayload, "主板"),
    parseQuotes(holdingPayload, "主板"),
  );
  const etfs = mergeQuotes(
    parseQuotes(etfPayload, "ETF"),
    parseQuotes(holdingPayload, "ETF"),
  );
  if (stocks.length < 500 || indices.length < 4) {
    throw new Error("主板行情或主要指数覆盖不足，停止实时建议");
  }
  const news = parseNews(newsPayload, now);
  const stockCandidates = stocks
    .filter(
      (quote) =>
        quote.amount >= 100_000_000 &&
        quote.marketCap >= 3_000_000_000 &&
        quote.change > -6 &&
        quote.change < 8.8,
    )
    .map((quote) => ({ ...buildCandidate(quote, news), rank: 0 }));
  const etfCandidates = etfs
    .filter(
      (quote) =>
        quote.amount >= 50_000_000 &&
        quote.change > -5 &&
        quote.change < 7,
    )
    .map((quote) => ({ ...buildCandidate(quote, news), rank: 0 }));
  const candidates = [...stockCandidates, ...etfCandidates]
    .sort((a, b) => b.score - a.score || b.amount - a.amount)
    .slice(0, 10)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const breadth = buildBreadth(stocks);
  const aIndices = indices.filter((index) => index.market === "CN");
  const globalIndices = indices.filter((index) => index.market !== "CN");
  const averageA =
    aIndices.reduce((sum, index) => sum + index.change, 0) /
    Math.max(aIndices.length, 1);
  const riseRatio = breadth.rise / Math.max(breadth.total, 1);
  const aShareSignal = clamp(
    50 + averageA * 11 + (riseRatio - 0.5) * 55,
  );
  const globalAverage =
    globalIndices.reduce((sum, index) => sum + index.change, 0) /
    Math.max(globalIndices.length, 1);
  const globalSignal = clamp(50 + globalAverage * 10);
  const newsImpact = news.slice(0, 40).reduce(
    (sum, item) =>
      sum +
      (item.impact === "positive"
        ? 1
        : item.impact === "negative"
          ? -1
          : 0),
    0,
  );
  const newsSignal = clamp(50 + newsImpact * 2.2);
  const regimeScore = clamp(
    aShareSignal * 0.58 + globalSignal * 0.18 + newsSignal * 0.24,
  );
  const decision: MarketReport["decision"] =
    regimeScore >= 62 && aShareSignal >= 58
      ? "operate"
      : regimeScore < 42
        ? "reduce"
        : "wait";
  const marketStatus = chinaMarketStatus(now);
  const holdingActions = holdingAdvice(
    profile,
    [...stocks, ...etfs],
    candidates,
    news,
    decision,
  );
  const actions =
    holdingActions.length > 0
      ? holdingActions.slice(0, 3).map((action) => ({
          time: "持仓动作",
          title: `${action.actionLabel} ${action.name}${
            action.quantity > 0 ? ` ${action.quantity}股/份` : ""
          }`,
          detail: action.priceCondition,
          tone:
            action.action === "sell" || action.action === "reduce"
              ? ("warning" as const)
              : action.action === "add"
                ? ("primary" as const)
                : ("neutral" as const),
        }))
      : [
          {
            time: marketStatus,
            title:
              decision === "operate"
                ? "只考虑排名靠前且价格进入区间的标的"
                : decision === "reduce"
                  ? "只处理风险仓位，不开新仓"
                  : "保持耐心，不追涨",
            detail:
              decision === "operate"
                ? "评分用于排序，不等于上涨概率；下单前核对价格与失效条件"
                : "等待指数、市场宽度与消息信号改善",
            tone:
              decision === "operate"
                ? ("primary" as const)
                : decision === "reduce"
                  ? ("warning" as const)
                  : ("neutral" as const),
          },
        ];
  return {
    source: "live-lite",
    analysisMode: "rules",
    generatedAt: now.toISOString(),
    marketStatus,
    freshnessText: `点击时刷新 · ${Math.max(1, Date.now() - started)}ms`,
    decision,
    headline:
      decision === "operate"
        ? "环境允许精选，不追高。"
        : decision === "reduce"
          ? "风险优先，暂不开新仓。"
          : "机会有，但还不够一致。",
    summary: `主要指数、成交活跃的${stocks.length}只主板股票、${etfs.length}只ETF与最新财经快讯已按当前时刻重算。上涨潜力评分综合动量、趋势、流动性、估值、消息与波动风险。`,
    regimeScore: Math.round(regimeScore),
    riskLevel:
      regimeScore >= 62
        ? "中性偏积极"
        : regimeScore >= 48
          ? "中性"
          : "偏谨慎",
    aShareSignal: Math.round(aShareSignal),
    globalSignal: Math.round(globalSignal),
    newsSignal: Math.round(newsSignal),
    indices,
    breadth,
    actions,
    candidates,
    news: news.slice(0, 24),
    holdingActions,
    sources: [
      {
        name: "主板与ETF实时行情",
        ok: true,
        asOf: now.toISOString(),
        detail: `高流动性主板样本${stocks.length}只，ETF${etfs.length}只`,
      },
      {
        name: "境内外主要指数",
        ok: indices.length >= 4,
        asOf: now.toISOString(),
        detail: `${indices.length}个指数`,
      },
      {
        name: "全球财经快讯",
        ok: news.length > 0,
        asOf: now.toISOString(),
        detail: `${news.length}条最新快讯`,
      },
    ],
    warnings: [
      "轻量实时模型不包含完整财务报表、龙虎榜和逐笔成交；连接高级分析引擎后会补充。",
      "主板市场宽度基于成交额靠前的高流动性样本，不代表全部上市公司。",
      "上涨潜力评分是相对排序，不是上涨概率或收益承诺。",
      "仅选择沪深主板股票与可交易ETF；不选择创业板、科创板个股。",
      ...(profile.portfolio.holdings.length > 0 &&
      profile.quoteLookupConsent !== true
        ? ["未授权持仓代码行情查询，低流动性持仓可能只显示人工复核。"]
        : []),
    ],
  };
}

import type { MarketReport, ProfilePayload } from "./types";

export const EMPTY_PROFILE: ProfilePayload = {
  portfolio: {
    cash_available: 0,
    total_asset: 0,
    holdings: [],
  },
  risk: {
    cashReservePct: 60,
    maxSinglePct: 8,
    maxNewExposurePct: 8,
  },
};

const generatedAt = new Date().toISOString();

export const DEMO_REPORT: MarketReport = {
  source: "demo",
  analysisMode: "rules",
  generatedAt,
  marketStatus: "等待刷新",
  freshnessText: "界面样例",
  decision: "wait",
  headline: "点击刷新，获取当前市场判断。",
  summary:
    "页面会在你点击“生成今日建议”时重新获取主要指数、主板与ETF行情和财经快讯。下方内容仅用于展示信息结构。",
  regimeScore: 50,
  riskLevel: "待计算",
  aShareSignal: 50,
  globalSignal: 50,
  newsSignal: 50,
  indices: [
    {
      code: "000001",
      name: "上证指数",
      market: "CN",
      last: 0,
      change: 0,
      amount: 0,
    },
    {
      code: "000300",
      name: "沪深300",
      market: "CN",
      last: 0,
      change: 0,
      amount: 0,
    },
  ],
  breadth: {
    rise: 0,
    fall: 0,
    flat: 0,
    limitUp: 0,
    limitDown: 0,
    total: 0,
    medianChange: 0,
  },
  actions: [
    {
      time: "当前",
      title: "先刷新实时数据",
      detail: "未取得点击时行情前，不生成交易动作",
      tone: "neutral",
    },
  ],
  candidates: [],
  news: [
    {
      time: "--:--",
      publishedAt: generatedAt,
      tag: "提示",
      title: "实时财经快讯将在刷新后显示",
      summary: "消息会按发布时间倒序排列，并标注影响方向与来源。",
      source: "界面样例",
      impact: "neutral",
      tickers: [],
    },
  ],
  holdingActions: [],
  sources: [
    {
      name: "实时数据",
      ok: false,
      asOf: generatedAt,
      detail: "等待用户刷新",
    },
  ],
  warnings: [
    "演示内容不构成交易依据。",
    "上涨潜力评分是相对排序，不是上涨概率或收益承诺。",
  ],
};

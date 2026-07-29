import type {
  HoldingAdvice,
  MarketReport,
  ProfilePayload,
  ReportAction,
} from "../../types";
import { buildLiveMarketReport } from "../live-market";
import { synthesizeMarketReport } from "../model-analysis";
import { sameOriginOrNoOrigin, validateExternalBaseUrl } from "../security";
import { resolveLlmConfig } from "../server-llm";

type UpstreamReport = {
  generated_at?: string;
  phase?: "premarket" | "auction" | "intraday";
  data_mode?: "live" | "demo" | "blocked";
  executive_summary?: string;
  market_regime?: {
    score?: number;
    decision?: "operate" | "selective" | "wait" | "reduce_only";
    a_share_signal?: number;
    global_signal?: number;
    news_signal?: number;
  };
  candidates?: Array<{
    rank?: number;
    code?: string;
    name?: string;
    score?: number;
    confidence?: number;
    industry?: string;
    reference_price?: number;
    buy_low?: number;
    buy_high?: number;
    invalidation_price?: number;
    thesis?: string[];
    risks?: string[];
    components?: {
      trend?: number;
      momentum?: number;
      liquidity?: number;
      fundamentals?: number;
      news?: number;
      penalty?: number;
    };
    data?: {
      change_pct?: number;
      instrument_type?: string;
      turnover_pct?: number;
      amount?: number;
      pe_ttm?: number | null;
      market_cap?: number;
    };
  }>;
  draft_orders?: Array<{
    side?: "buy" | "sell";
    name?: string;
    quantity?: number;
    price_low?: number;
    price_high?: number;
    trigger?: string;
    cancel_if?: string;
  }>;
  holding_actions?: Array<{
    code?: string;
    name?: string;
    action?: "sell" | "reduce" | "hold" | "add" | "review";
    quantity?: number;
    price_condition?: string;
    reason?: string[];
    confidence?: number;
  }>;
  portfolio?: {
    total_asset?: number;
    holdings?: Array<{
      code?: string;
      name?: string;
      current_price?: number;
      market_value?: number;
      pnl_pct?: number;
    }>;
  };
  news?: Array<{
    title?: string;
    summary?: string;
    published_at?: string;
    source?: string;
    sentiment?: number;
    tags?: string[];
    tickers?: string[];
  }>;
  indices?: Array<{
    code?: string;
    name?: string;
    market?: string;
    last?: number;
    change_pct?: number;
  }>;
  sources?: Array<{
    name?: string;
    ok?: boolean;
    as_of?: string;
    detail?: string;
  }>;
  warnings?: string[];
};

type ReportRequest = {
  profile?: ProfilePayload;
  llm?: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  };
};

function numeric(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function potentialLabel(score: number) {
  return score >= 78
    ? "高潜力"
    : score >= 68
      ? "偏强"
      : score >= 58
        ? "观察"
        : "低优先级";
}

function normalizeReport(
  value: UpstreamReport,
  profile: ProfilePayload,
): MarketReport {
  const regime = value.market_regime ?? {};
  const score = numeric(regime.score);
  const blocked = value.data_mode === "blocked";
  const decision: MarketReport["decision"] =
    regime.decision === "reduce_only"
      ? "reduce"
      : regime.decision === "operate" || regime.decision === "selective"
        ? "operate"
        : "wait";
  const generatedAt = value.generated_at ?? new Date().toISOString();
  const headline = blocked
    ? "数据不完整，今天不下单。"
    : regime.decision === "operate"
      ? "环境允许，按价格条件执行。"
      : regime.decision === "selective"
        ? "只做潜力评分最高的一笔。"
        : regime.decision === "reduce_only"
          ? "先降风险，不开新仓。"
          : "机会有，但还不够一致。";
  const candidates = (value.candidates ?? []).slice(0, 10).map((candidate, index) => {
    const candidateScore = Math.round(numeric(candidate.score));
    const kind =
      candidate.data?.instrument_type === "ETF"
        ? ("ETF" as const)
        : ("主板" as const);
    return {
      rank: candidate.rank ?? index + 1,
      code: candidate.code ?? "—",
      name: candidate.name ?? "待核对",
      kind,
      score: candidateScore,
      potentialLabel: potentialLabel(candidateScore),
      confidence: Math.round(numeric(candidate.confidence) * 100),
      change: numeric(candidate.data?.change_pct),
      price: numeric(candidate.reference_price),
      open: 0,
      high: 0,
      low: 0,
      amount: numeric(candidate.data?.amount),
      turnover: numeric(candidate.data?.turnover_pct),
      pe:
        candidate.data?.pe_ttm == null
          ? null
          : numeric(candidate.data.pe_ttm),
      marketCap: numeric(candidate.data?.market_cap),
      buyLow: numeric(candidate.buy_low),
      buyHigh: numeric(candidate.buy_high),
      stopPrice: numeric(candidate.invalidation_price),
      tag: candidate.industry || candidate.thesis?.[0] || "综合占优",
      thesis: candidate.thesis ?? ["量价、基本面与消息综合评分"],
      risks: candidate.risks ?? ["评分不是上涨概率，需等待价格条件"],
      factors: {
        momentum: Math.round(numeric(candidate.components?.momentum)),
        trend: Math.round(numeric(candidate.components?.trend)),
        liquidity: Math.round(numeric(candidate.components?.liquidity)),
        quality: Math.round(numeric(candidate.components?.fundamentals)),
        news: Math.round(numeric(candidate.components?.news)),
        risk: Math.round(numeric(candidate.components?.penalty)),
      },
    };
  });
  const candidateMap = new Map(candidates.map((item) => [item.code, item]));
  const upstreamHoldings = new Map(
    (value.portfolio?.holdings ?? []).map((holding) => [
      holding.code ?? "",
      holding,
    ]),
  );
  const totalAsset = Math.max(
    numeric(value.portfolio?.total_asset, profile.portfolio.total_asset),
    1,
  );
  const holdingActions: HoldingAdvice[] = (value.holding_actions ?? []).map(
    (action) => {
      const code = action.code ?? "";
      const holding = upstreamHoldings.get(code);
      const candidate = candidateMap.get(code);
      const actionName = action.action ?? "review";
      return {
        code,
        name: action.name ?? holding?.name ?? "待核对",
        action: actionName,
        actionLabel: {
          sell: "卖出",
          reduce: "减仓",
          hold: "继续持有",
          add: "条件加仓",
          review: "人工复核",
        }[actionName],
        quantity: numeric(action.quantity),
        currentPrice: numeric(holding?.current_price, candidate?.price),
        change: numeric(candidate?.change),
        pnlPct: numeric(holding?.pnl_pct),
        positionPct:
          (numeric(holding?.market_value) / totalAsset) * 100,
        score: numeric(candidate?.score),
        confidence: Math.round(numeric(action.confidence) * 100),
        priceCondition:
          action.price_condition || "仅在条件满足时执行",
        reasons: action.reason ?? ["等待更多有效数据"],
        relatedNews: (value.news ?? [])
          .filter((item) => item.tickers?.includes(code))
          .slice(0, 3)
          .map((item) => item.title ?? "相关消息"),
      };
    },
  );
  const orderActions: ReportAction[] = (value.draft_orders ?? [])
    .slice(0, 3)
    .map((order) => ({
      time: value.phase === "intraday" ? "盘中条件单" : "条件单",
      title: `${order.side === "sell" ? "卖出" : "买入"} ${order.name ?? "待核对"} ${numeric(order.quantity)}股/份`,
      detail: `${numeric(order.price_low).toFixed(3)}–${numeric(
        order.price_high,
      ).toFixed(3)} · ${order.trigger ?? order.cancel_if ?? "到价执行"}`,
      tone: order.side === "sell" ? "warning" : "primary",
    }));
  const holdingReportActions: ReportAction[] = holdingActions
    .slice(0, 3)
    .map((action) => ({
      time: "持仓动作",
      title: `${action.actionLabel} ${action.name}${
        action.quantity > 0 ? ` ${action.quantity}股/份` : ""
      }`,
      detail: action.priceCondition,
      tone:
        action.action === "sell" || action.action === "reduce"
          ? "warning"
          : action.action === "add"
            ? "primary"
            : "neutral",
    }));
  const fallbackActions: ReportAction[] = blocked
    ? [
        {
          time: "当前",
          title: "不下单",
          detail: "实时数据校验未通过，等待数据源恢复",
          tone: "warning",
        },
      ]
    : [
        {
          time: value.phase === "intraday" ? "盘中" : "当前",
          title:
            decision === "reduce"
              ? "只处理风险仓位"
              : decision === "operate"
                ? "只挂满足价格条件的订单"
                : "不主动开新仓",
          detail:
            decision === "operate"
              ? "单日新增仓位不超过风险预算"
              : "等待市场环境和价格条件改善",
          tone: decision === "reduce" ? "warning" : "neutral",
        },
      ];
  const news = (value.news ?? []).slice(0, 30).map((item) => {
    const publishedAt = item.published_at ?? generatedAt;
    return {
      time: new Date(publishedAt).toLocaleTimeString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
      publishedAt,
      tag: item.tags?.[0] ?? item.source ?? "市场",
      title: item.title ?? "消息标题缺失",
      summary: item.summary ?? "",
      source: item.source ?? "公开信息",
      impact:
        numeric(item.sentiment) > 0.18
          ? ("positive" as const)
          : numeric(item.sentiment) < -0.18
            ? ("negative" as const)
            : ("neutral" as const),
      tickers: item.tickers ?? [],
    };
  });
  return {
    source: value.data_mode === "live" ? "live" : "demo",
    analysisMode: "rules",
    generatedAt,
    marketStatus:
      value.phase === "intraday"
        ? "交易中"
        : value.phase === "auction"
          ? "集合竞价"
          : "盘前",
    freshnessText: "点击时重新拉取",
    decision,
    headline,
    summary:
      value.executive_summary ??
      "当前报告信息不足，暂不生成交易动作。",
    regimeScore: Math.max(0, Math.min(100, Math.round(score))),
    riskLevel:
      score >= 62
        ? "中性偏积极"
        : score >= 53
          ? "中性精选"
          : score >= 43
            ? "中性偏谨慎"
            : "防守",
    aShareSignal: Math.round(numeric(regime.a_share_signal)),
    globalSignal: Math.round(numeric(regime.global_signal)),
    newsSignal: Math.round(numeric(regime.news_signal)),
    indices: (value.indices ?? []).map((index) => ({
      code: index.code ?? "",
      name: index.name ?? "指数",
      market: index.market ?? "CN",
      last: numeric(index.last),
      change: numeric(index.change_pct),
      amount: 0,
    })),
    breadth: {
      rise: 0,
      fall: 0,
      flat: 0,
      limitUp: 0,
      limitDown: 0,
      total: 0,
      medianChange: 0,
    },
    actions:
      orderActions.length > 0
        ? orderActions
        : holdingReportActions.length > 0
          ? holdingReportActions
          : fallbackActions,
    candidates,
    news,
    holdingActions,
    sources: (value.sources ?? []).map((source) => ({
      name: source.name ?? "数据源",
      ok: Boolean(source.ok),
      asOf: source.as_of ?? generatedAt,
      detail: source.detail ?? "",
    })),
    warnings: value.warnings ?? [],
  };
}

function noStore(payload: unknown, init?: ResponseInit) {
  const response = Response.json(payload, init);
  response.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0",
  );
  return response;
}

export async function POST(request: Request) {
  if (!sameOriginOrNoOrigin(request)) {
    return noStore({ error: "请求来源校验失败" }, { status: 403 });
  }
  let profile: ProfilePayload;
  let llm: ReportRequest["llm"];
  try {
    const body = (await request.json()) as ReportRequest | ProfilePayload;
    if ("profile" in body && body.profile) {
      profile = body.profile;
      llm = body.llm;
    } else {
      profile = body as ProfilePayload;
    }
  } catch {
    return noStore({ error: "账户数据格式不正确" }, { status: 400 });
  }
  let resolvedLlm;
  try {
    resolvedLlm = resolveLlmConfig(llm);
  } catch (error) {
    return noStore(
      {
        error:
          error instanceof Error
            ? error.message
            : "请先配置并连接模型；未调用模型不会生成买卖建议",
        code: "MODEL_REQUIRED",
      },
      { status: 428 },
    );
  }
  let baseReport: MarketReport | null = null;
  let dataMessage = "已按点击时刻刷新实时行情、指数和财经快讯";
  const backend = process.env.ANALYTICS_API_BASE_URL?.trim();
  if (backend) {
    try {
      const base = validateExternalBaseUrl(
        backend,
        process.env.ANALYTICS_ALLOWED_HOSTS ?? "",
      );
      const target = new URL("/api/public/report/run", base);
      target.searchParams.set("_t", String(Date.now()));
      const upstream = await fetch(target, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          ...(process.env.ANALYTICS_SHARED_SECRET
            ? {
                "X-Analytics-Token": process.env.ANALYTICS_SHARED_SECRET,
              }
            : {}),
        },
        body: JSON.stringify(profile),
        signal: AbortSignal.timeout(110_000),
      });
      if (!upstream.ok) {
        throw new Error(`高级分析引擎返回 ${upstream.status}`);
      }
      const rawReport = (await upstream.json()) as UpstreamReport;
      baseReport = normalizeReport(rawReport, profile);
      dataMessage =
        rawReport.data_mode === "blocked"
          ? "实时数据校验未通过，已禁用交易候选"
          : "高级数据与模型综合研判已完成";
    } catch {
      // Continue to the live lightweight provider.
    }
  }
  try {
    if (!baseReport) baseReport = await buildLiveMarketReport(profile);
    const report = await synthesizeMarketReport(
      baseReport,
      profile,
      resolvedLlm.config,
    );
    return noStore({
      report,
      source: report.source,
      message: `${dataMessage} · ${report.modelProvider} ${report.modelName} 已参与`,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "实时数据或模型暂时不可用";
    return noStore(
      {
        error: `${message}；本次没有生成或展示规则替代建议`,
        code: "ANALYSIS_FAILED",
      },
      { status: 502 },
    );
  }
}

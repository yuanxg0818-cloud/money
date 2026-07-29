"use client";

import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { DEMO_REPORT, EMPTY_PROFILE } from "./demo-data";
import type {
  Candidate,
  LlmConfig,
  MarketReport,
  Portfolio,
  ProfilePayload,
} from "./types";

type Tab = "today" | "opportunities" | "portfolio" | "intel";
type Toast = { tone: "ok" | "warn"; text: string } | null;
type CandidateFilter = "all" | "stock" | "etf";

const DEFAULT_LLM: LlmConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-5.6",
};
const PROFILE_STORAGE_KEY = "premarket_profile_v1";

const NAV_ITEMS: Array<{
  id: Tab;
  label: string;
  short: string;
  icon: string;
}> = [
  { id: "today", label: "今日", short: "TODAY", icon: "⌂" },
  { id: "opportunities", label: "机会", short: "RANK", icon: "↗" },
  { id: "portfolio", label: "持仓诊断", short: "POSITION", icon: "▣" },
  { id: "intel", label: "市场情报", short: "INTEL", icon: "◎" },
];

function money(value: number, digits = 2) {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value || 0);
}

function compactMoney(value: number) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(0)}万`;
  return money(value, 0);
}

function percent(value: number) {
  return `${value >= 0 ? "+" : ""}${Number(value).toFixed(2)}%`;
}

function price(value: number, kind?: string) {
  return value > 0 ? value.toFixed(kind === "ETF" ? 3 : 2) : "—";
}

function timeLabel(value: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "Asia/Shanghai",
    }).format(new Date(value));
  } catch {
    return "—";
  }
}

function freshness(value: string) {
  const difference = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(difference) || difference < 0) return "刚刚";
  if (difference < 60_000) return `${Math.max(1, Math.floor(difference / 1000))}秒前`;
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)}分钟前`;
  return timeLabel(value);
}

function candidateMetric(candidate: Candidate, label: string) {
  const values: Record<string, string> = {
    成交额: compactMoney(candidate.amount),
    换手率: candidate.turnover > 0 ? `${candidate.turnover.toFixed(2)}%` : "—",
    PE: candidate.pe && candidate.pe > 0 ? candidate.pe.toFixed(1) : "—",
    置信度: `${candidate.confidence}%`,
  };
  return values[label] ?? "—";
}

export function CopilotApp() {
  const [tab, setTab] = useState<Tab>("today");
  const [profile, setProfile] = useState<ProfilePayload>(EMPTY_PROFILE);
  const [report, setReport] = useState<MarketReport>(DEMO_REPORT);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [llm, setLlm] = useState<LlmConfig>(DEFAULT_LLM);
  const [rememberKey, setRememberKey] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);
  const [testing, setTesting] = useState(false);
  const [running, setRunning] = useState(false);
  const [portfolioRunning, setPortfolioRunning] = useState(false);
  const [holdingQuoteConsent, setHoldingQuoteConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [connection, setConnection] = useState<
    "idle" | "connected" | "failed"
  >("idle");
  const [toast, setToast] = useState<Toast>(null);
  const [fileName, setFileName] = useState("");
  const [candidateFilter, setCandidateFilter] =
    useState<CandidateFilter>("all");
  const [expandedCandidate, setExpandedCandidate] = useState<string | null>(
    null,
  );
  const [newsExpanded, setNewsExpanded] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const storedProfile = localStorage.getItem(PROFILE_STORAGE_KEY);
        if (storedProfile) {
          const parsedProfile = JSON.parse(storedProfile) as ProfilePayload;
          if (
            parsedProfile.portfolio &&
            Array.isArray(parsedProfile.portfolio.holdings) &&
            parsedProfile.risk
          ) {
            setProfile(parsedProfile);
          }
        }
        const stored = sessionStorage.getItem("premarket_llm");
        if (stored) {
          const parsed = JSON.parse(stored) as LlmConfig;
          setLlm(parsed);
          setRememberKey(true);
        }
      } catch {
        localStorage.removeItem(PROFILE_STORAGE_KEY);
        sessionStorage.removeItem("premarket_llm");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const exposure = useMemo(() => {
    const marketValue = profile.portfolio.holdings.reduce(
      (sum, holding) => sum + holding.market_value,
      0,
    );
    return profile.portfolio.total_asset > 0
      ? (marketValue / profile.portfolio.total_asset) * 100
      : 0;
  }, [profile.portfolio]);

  const filteredCandidates = useMemo(
    () =>
      report.candidates.filter((candidate) =>
        candidateFilter === "all"
          ? true
          : candidateFilter === "etf"
            ? candidate.kind === "ETF"
            : candidate.kind === "主板",
      ),
    [candidateFilter, report.candidates],
  );

  const breadthRatio =
    report.breadth.total > 0
      ? (report.breadth.rise / report.breadth.total) * 100
      : 50;

  function changePortfolio(field: keyof Portfolio, value: number) {
    setProfile((current) => ({
      ...current,
      portfolio: { ...current.portfolio, [field]: value },
    }));
  }

  async function saveProfile(showToast = true) {
    setSaving(true);
    try {
      const safeProfile = structuredClone(profile);
      safeProfile.portfolio.cash_available = Math.max(
        0,
        safeProfile.portfolio.cash_available,
      );
      safeProfile.portfolio.total_asset = Math.max(
        0,
        safeProfile.portfolio.total_asset,
      );
      safeProfile.risk.cashReservePct = Math.min(
        90,
        Math.max(0, safeProfile.risk.cashReservePct),
      );
      safeProfile.risk.maxSinglePct = Math.min(
        50,
        Math.max(1, safeProfile.risk.maxSinglePct),
      );
      safeProfile.risk.maxNewExposurePct = Math.min(
        50,
        Math.max(0, safeProfile.risk.maxNewExposurePct),
      );
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(safeProfile));
      setProfile(safeProfile);
      if (showToast) {
        setToast({ tone: "ok", text: "账户设置仅保存在当前浏览器" });
      }
      return safeProfile;
    } catch (error) {
      setToast({
        tone: "warn",
        text: error instanceof Error ? error.message : "保存失败",
      });
      return profile;
    } finally {
      setSaving(false);
    }
  }

  async function requestAnalysis(
    target: "market" | "portfolio",
    nextProfile = profile,
  ) {
    if (target === "market") {
      setRunning(true);
    } else {
      setPortfolioRunning(true);
    }
    try {
      const response = await fetch(`/api/report?_t=${Date.now()}`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },
        body: JSON.stringify(nextProfile),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "分析失败");
      setReport(payload.report);
      setTab(target === "market" ? "today" : "portfolio");
      setToast({
        tone: payload.source === "demo" ? "warn" : "ok",
        text:
          target === "portfolio"
            ? `持仓诊断已更新 · ${payload.report.holdingActions.length}项建议`
            : payload.message || "已按当前时刻重新生成建议",
      });
    } catch (error) {
      setToast({
        tone: "warn",
        text: error instanceof Error ? error.message : "分析失败",
      });
    } finally {
      setRunning(false);
      setPortfolioRunning(false);
    }
  }

  async function analyzePortfolio() {
    if (profile.portfolio.holdings.length === 0) {
      setToast({ tone: "warn", text: "请先上传持仓截图" });
      return;
    }
    if (!holdingQuoteConsent) {
      setToast({
        tone: "warn",
        text: "请先确认允许仅发送证券代码以查询实时行情",
      });
      return;
    }
    const saved = await saveProfile(false);
    await requestAnalysis("portfolio", {
      ...saved,
      quoteLookupConsent: true,
    });
  }

  async function testConnection(event: FormEvent) {
    event.preventDefault();
    setTesting(true);
    setConnection("idle");
    try {
      const effectiveLlm =
        /api\.moonshot\.cn/i.test(llm.baseUrl) &&
        !/^(kimi-|moonshot-)/i.test(llm.model)
          ? { ...llm, model: "kimi-k2.6" }
          : llm;
      if (effectiveLlm !== llm) setLlm(effectiveLlm);
      const response = await fetch("/api/llm/test", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(effectiveLlm),
      });
      const payload = await response.json();
      if (!response.ok) {
        if (payload.suggestedModel) {
          setLlm((current) => ({
            ...current,
            model: payload.suggestedModel,
          }));
        }
        throw new Error(payload.error || "连接失败");
      }
      setConnection("connected");
      if (rememberKey) {
        sessionStorage.setItem(
          "premarket_llm",
          JSON.stringify(effectiveLlm),
        );
      } else {
        sessionStorage.removeItem("premarket_llm");
      }
      setToast({ tone: "ok", text: `模型已连接 · ${payload.latencyMs}ms` });
    } catch (error) {
      setConnection("failed");
      setToast({
        tone: "warn",
        text: error instanceof Error ? error.message : "连接失败",
      });
    } finally {
      setTesting(false);
    }
  }

  async function parseScreenshot(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    if (!llm.apiKey) {
      setSettingsOpen(true);
      setToast({ tone: "warn", text: "请先填写并测试模型API" });
      event.target.value = "";
      return;
    }
    setParsing(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("baseUrl", llm.baseUrl);
      form.set("apiKey", llm.apiKey);
      form.set("model", llm.model);
      const response = await fetch("/api/portfolio/parse", {
        method: "POST",
        cache: "no-store",
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "识别失败");
      setProfile((current) => ({
        ...current,
        portfolio: payload.portfolio,
      }));
      setTab("portfolio");
      setToast({
        tone: "ok",
        text: `已识别 ${payload.portfolio.holdings.length} 个持仓，请核对后点击“按最新市场诊断”`,
      });
    } catch (error) {
      setToast({
        tone: "warn",
        text: error instanceof Error ? error.message : "截图识别失败",
      });
    } finally {
      setParsing(false);
      event.target.value = "";
    }
  }

  function renderIndexStrip() {
    return (
      <div className="index-strip" aria-label="主要指数">
        {report.indices.map((index) => (
          <article className="index-chip" key={`${index.market}-${index.code}`}>
            <div>
              <span>{index.name}</span>
              <small>{index.market}</small>
            </div>
            <strong>{index.last > 0 ? money(index.last, 2) : "待刷新"}</strong>
            <em className={index.change >= 0 ? "up" : "down"}>
              {percent(index.change)}
            </em>
          </article>
        ))}
      </div>
    );
  }

  function renderToday() {
    return (
      <>
        <section className={`decision-card decision-${report.decision}`}>
          <div className="decision-meta">
            <span className={`live-chip ${report.source}`}>
              <i />
              {report.source === "live"
                ? "高级实时"
                : report.source === "live-lite"
                  ? "实时"
                  : "安全演示"}
            </span>
            <span>{report.marketStatus}</span>
            <span>更新于 {freshness(report.generatedAt)}</span>
          </div>
          <div className="decision-layout">
            <div className="decision-copy">
              <p className="eyebrow">CURRENT DECISION</p>
              <h1>{report.headline}</h1>
              <p>{report.summary}</p>
              <button
                className="primary-button refresh-button"
                onClick={() => requestAnalysis("market")}
                disabled={running}
              >
                <span className={running ? "spinning" : ""}>↻</span>
                {running ? "正在拉取最新行情与消息…" : "按当前时刻重新生成"}
              </button>
            </div>
            <div
              className="score-orbit"
              style={
                {
                  "--score": `${report.regimeScore * 3.6}deg`,
                } as React.CSSProperties
              }
              aria-label={`市场环境评分${report.regimeScore}分`}
            >
              <strong>{report.regimeScore}</strong>
              <small>环境分</small>
            </div>
          </div>
          <div className="signal-strip">
            {[
              ["A股信号", report.aShareSignal],
              ["外围信号", report.globalSignal],
              ["消息温度", report.newsSignal],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <span>{label}</span>
                <strong>{value}</strong>
                <i>
                  <b style={{ width: `${value}%` }} />
                </i>
              </div>
            ))}
            <div>
              <span>风险级别</span>
              <strong className="text-label">{report.riskLevel}</strong>
              <small>{report.freshnessText}</small>
            </div>
          </div>
        </section>

        <section className="content-section flush-section">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">MARKET NOW</p>
              <h2>指数与市场宽度</h2>
            </div>
            <button className="link-button" onClick={() => setTab("intel")}>
              完整市场情报
            </button>
          </div>
          {renderIndexStrip()}
          <article className="breadth-card">
            <div className="breadth-title">
              <div>
                <span>活跃主板上涨</span>
                <strong>{report.breadth.rise}</strong>
              </div>
              <div className="breadth-center">
                <span>中位涨跌</span>
                <strong
                  className={
                    report.breadth.medianChange >= 0 ? "up" : "down"
                  }
                >
                  {percent(report.breadth.medianChange)}
                </strong>
              </div>
              <div>
                <span>活跃主板下跌</span>
                <strong>{report.breadth.fall}</strong>
              </div>
            </div>
            <div className="breadth-track">
              <i style={{ width: `${breadthRatio}%` }} />
            </div>
            <div className="breadth-foot">
              <span>涨停 {report.breadth.limitUp}</span>
              <span>平盘 {report.breadth.flat}</span>
              <span>跌停 {report.breadth.limitDown}</span>
            </div>
          </article>
        </section>

        <section className="content-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ACTION PLAN</p>
              <h2>现在怎么做</h2>
            </div>
            <span className="section-badge">动态生成</span>
          </div>
          <div className="action-grid">
            {report.actions.map((action, index) => (
              <article
                className={`action-card tone-${action.tone}`}
                key={`${action.time}-${action.title}`}
              >
                <span className="action-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <p>{action.time}</p>
                  <h3>{action.title}</h3>
                  <span>{action.detail}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="content-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">UPSIDE RANK</p>
              <h2>当前上涨潜力 Top 5</h2>
            </div>
            <button
              className="link-button"
              onClick={() => setTab("opportunities")}
            >
              查看全部10只
            </button>
          </div>
          {report.candidates.length === 0 ? (
            <EmptyState
              icon="↻"
              title="等待实时排序"
              detail="点击“按当前时刻重新生成”，系统会重新抓取行情、指数和快讯。"
            />
          ) : (
            <div className="candidate-preview-grid">
              {report.candidates.slice(0, 5).map((candidate) => (
                <button
                  className="candidate-preview"
                  key={candidate.code}
                  onClick={() => {
                    setExpandedCandidate(candidate.code);
                    setTab("opportunities");
                  }}
                >
                  <span className="rank-number">
                    {String(candidate.rank).padStart(2, "0")}
                  </span>
                  <div>
                    <strong>{candidate.name}</strong>
                    <span>
                      {candidate.code} · {candidate.kind}
                    </span>
                  </div>
                  <div className="preview-price">
                    <strong>{price(candidate.price, candidate.kind)}</strong>
                    <span className={candidate.change >= 0 ? "up" : "down"}>
                      {percent(candidate.change)}
                    </span>
                  </div>
                  <div className="potential-pill">
                    <strong>{candidate.score}</strong>
                    <span>{candidate.potentialLabel}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="content-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">LATEST INTEL</p>
              <h2>正在影响市场的消息</h2>
            </div>
            <button className="link-button" onClick={() => setTab("intel")}>
              全部消息
            </button>
          </div>
          <NewsList news={report.news.slice(0, 6)} />
        </section>
      </>
    );
  }

  function renderCandidateCard(candidate: Candidate) {
    const expanded = expandedCandidate === candidate.code;
    return (
      <article
        className={`opportunity-card ${expanded ? "expanded" : ""}`}
        key={candidate.code}
      >
        <button
          className="opportunity-main"
          onClick={() =>
            setExpandedCandidate(expanded ? null : candidate.code)
          }
          aria-expanded={expanded}
        >
          <span className="large-rank">
            {String(candidate.rank).padStart(2, "0")}
          </span>
          <div className="opportunity-identity">
            <div>
              <h3>{candidate.name}</h3>
              <span>
                {candidate.code} · {candidate.kind}
              </span>
            </div>
            <span className="candidate-tag">{candidate.tag}</span>
          </div>
          <div className="opportunity-quote">
            <strong>{price(candidate.price, candidate.kind)}</strong>
            <span className={candidate.change >= 0 ? "up" : "down"}>
              {percent(candidate.change)}
            </span>
          </div>
          <div className="potential-score">
            <strong>{candidate.score}</strong>
            <span>{candidate.potentialLabel}</span>
          </div>
          <span className="chevron">{expanded ? "−" : "+"}</span>
        </button>
        <div className="candidate-metrics">
          {["成交额", "换手率", "PE", "置信度"].map((label) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{candidateMetric(candidate, label)}</strong>
            </div>
          ))}
        </div>
        <div className="order-zone">
          <div>
            <span>观察买入区间</span>
            <strong>
              {price(candidate.buyLow, candidate.kind)}–
              {price(candidate.buyHigh, candidate.kind)}
            </strong>
          </div>
          <div>
            <span>失效参考</span>
            <strong className="down">
              {price(candidate.stopPrice, candidate.kind)}
            </strong>
          </div>
          <p>不追价 · 评分仅用于相对排序</p>
        </div>
        {expanded && (
          <div className="opportunity-detail">
            <div className="factor-panel">
              <h4>上涨潜力因子</h4>
              {(
                [
                  ["当日动量", candidate.factors.momentum],
                  ["中期趋势", candidate.factors.trend],
                  ["流动性", candidate.factors.liquidity],
                  ["质量/估值", candidate.factors.quality],
                  ["消息面", candidate.factors.news],
                ] as const
              ).map(([label, value]) => (
                <div className="factor-row" key={label}>
                  <span>{label}</span>
                  <i>
                    <b style={{ width: `${value}%` }} />
                  </i>
                  <strong>{value}</strong>
                </div>
              ))}
              <div className="risk-penalty">
                波动风险扣分 <strong>{candidate.factors.risk}</strong>
              </div>
            </div>
            <div className="reason-columns">
              <div>
                <h4>为什么入选</h4>
                <ul>
                  {candidate.thesis.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="risk-list">
                <h4>主要风险</h4>
                <ul>
                  {candidate.risks.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </article>
    );
  }

  function renderOpportunities() {
    return (
      <>
        <section className="page-hero compact-hero">
          <div>
            <p className="eyebrow">UPSIDE POTENTIAL</p>
            <h1>当前上涨潜力排序</h1>
            <p>
              综合当日动量、中期趋势、流动性、估值、快讯与波动风险；仅在主板股票和ETF中比较。
            </p>
          </div>
          <button
            className="primary-button"
            onClick={() => requestAnalysis("market")}
            disabled={running}
          >
            <span className={running ? "spinning" : ""}>↻</span>
            {running ? "重新评分中…" : "重新实时评分"}
          </button>
        </section>
        <section className="method-card">
          <div>
            <strong>评分 ≠ 上涨概率</strong>
            <span>
              它回答“当前谁更值得优先研究”，不回答“谁一定会涨”。
            </span>
          </div>
          <div className="method-weights">
            <span>动量 24%</span>
            <span>趋势 24%</span>
            <span>流动性 20%</span>
            <span>质量 12%</span>
            <span>消息 10%</span>
            <span>价格位置 10%</span>
          </div>
        </section>
        <div className="segmented-control" role="tablist">
          {(
            [
              ["all", "全部"],
              ["stock", "主板股票"],
              ["etf", "ETF"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={candidateFilter === id ? "active" : ""}
              onClick={() => setCandidateFilter(id)}
            >
              {label}
              <span>
                {id === "all"
                  ? report.candidates.length
                  : report.candidates.filter((candidate) =>
                        id === "etf"
                          ? candidate.kind === "ETF"
                          : candidate.kind === "主板",
                      ).length}
              </span>
            </button>
          ))}
        </div>
        <section className="opportunity-list">
          {filteredCandidates.length > 0 ? (
            filteredCandidates.map(renderCandidateCard)
          ) : (
            <EmptyState
              icon="↗"
              title="当前分类暂无候选"
              detail="重新生成建议后，系统会按点击时刻更新潜力排名。"
            />
          )}
        </section>
      </>
    );
  }

  function renderPortfolio() {
    return (
      <>
        <section className="page-hero portfolio-page-hero">
          <div>
            <p className="eyebrow">POSITION DIAGNOSIS</p>
            <h1>持仓诊断</h1>
            <p>
              这是独立分析区。上传截图后，会结合当前价格、最新指数和财经快讯逐只给出持有、加仓、减仓或卖出条件。
            </p>
          </div>
          <div className="privacy-chip">持仓仅保存在当前浏览器</div>
        </section>

        <section className="portfolio-workspace">
          <article className="upload-card">
            <div className="card-heading">
              <div>
                <p className="eyebrow">STEP 01</p>
                <h2>导入券商持仓</h2>
              </div>
              {profile.portfolio.holdings.length > 0 && (
                <span className="success-badge">
                  已识别 {profile.portfolio.holdings.length} 项
                </span>
              )}
            </div>
            <label className={`upload-zone ${parsing ? "busy" : ""}`}>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={parseScreenshot}
                disabled={parsing}
              />
              <span className="upload-mark">{parsing ? "···" : "＋"}</span>
              <div>
                <strong>{parsing ? "正在识别持仓" : "选择账户截图"}</strong>
                <span>
                  {fileName ||
                    "只上传资产和持仓页，不要上传密码、验证码或身份证"}
                </span>
              </div>
              <em>PNG / JPG / WEBP · 最大6MB</em>
            </label>
            <div className="upload-footnote">
              图片只临时发送给你配置的模型服务，识别完成后不会保存原图。
            </div>
          </article>

          <article className="account-card">
            <div className="card-heading">
              <div>
                <p className="eyebrow">STEP 02</p>
                <h2>核对账户</h2>
              </div>
              <span className="section-badge">
                仓位 {exposure.toFixed(0)}%
              </span>
            </div>
            <div className="account-summary">
              <div>
                <span>总资产</span>
                <strong>¥{money(profile.portfolio.total_asset)}</strong>
              </div>
              <div>
                <span>可用资金</span>
                <strong>¥{money(profile.portfolio.cash_available)}</strong>
              </div>
              <div>
                <span>持仓市值</span>
                <strong>
                  ¥
                  {money(
                    profile.portfolio.holdings.reduce(
                      (sum, holding) => sum + holding.market_value,
                      0,
                    ),
                  )}
                </strong>
              </div>
            </div>
            <div className="asset-inputs">
              <label>
                <span>总资产</span>
                <input
                  inputMode="decimal"
                  value={profile.portfolio.total_asset}
                  onChange={(event) =>
                    changePortfolio("total_asset", Number(event.target.value))
                  }
                />
              </label>
              <label>
                <span>可用资金</span>
                <input
                  inputMode="decimal"
                  value={profile.portfolio.cash_available}
                  onChange={(event) =>
                    changePortfolio(
                      "cash_available",
                      Number(event.target.value),
                    )
                  }
                />
              </label>
            </div>
            <div className="risk-compact">
              {(
                [
                  ["cashReservePct", "现金底线", 20, 90],
                  ["maxSinglePct", "单只上限", 3, 30],
                  ["maxNewExposurePct", "单日新增", 0, 30],
                ] as const
              ).map(([field, label, min, max]) => (
                <label key={field}>
                  <div>
                    <span>{label}</span>
                    <strong>{profile.risk[field]}%</strong>
                  </div>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    value={profile.risk[field]}
                    onChange={(event) =>
                      setProfile((current) => ({
                        ...current,
                        risk: {
                          ...current.risk,
                          [field]: Number(event.target.value),
                        },
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <label className="holding-consent">
              <input
                type="checkbox"
                checked={holdingQuoteConsent}
                onChange={(event) =>
                  setHoldingQuoteConsent(event.target.checked)
                }
              />
              <span>
                我同意为实时诊断，将持仓证券代码临时发送给东方财富公开行情接口。不会发送数量、成本、资金或账户信息。
              </span>
            </label>
            <button
              className="primary-button full-button"
              onClick={analyzePortfolio}
              disabled={
                portfolioRunning ||
                saving ||
                parsing ||
                !holdingQuoteConsent ||
                profile.portfolio.holdings.length === 0
              }
            >
              <span className={portfolioRunning ? "spinning" : ""}>◎</span>
              {portfolioRunning
                ? "正在结合最新指数与消息诊断…"
                : "按最新市场诊断持仓"}
            </button>
          </article>
        </section>

        <section className="content-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">HOLDINGS</p>
              <h2>持仓明细</h2>
            </div>
            <span className="section-badge">
              {profile.portfolio.holdings.length} 项
            </span>
          </div>
          {profile.portfolio.holdings.length === 0 ? (
            <EmptyState
              icon="▣"
              title="还没有持仓数据"
              detail="上传券商资产与持仓截图，识别后请核对资金、数量和成本价。"
            />
          ) : (
            <div className="holding-table">
              {profile.portfolio.holdings.map((holding) => (
                <article key={holding.code}>
                  <div className="holding-identity">
                    <span className="holding-avatar">
                      {holding.name.slice(0, 1)}
                    </span>
                    <div>
                      <h3>{holding.name}</h3>
                      <span>
                        {holding.code} · {holding.quantity}股/份
                      </span>
                    </div>
                  </div>
                  <div>
                    <span>成本 / 现价</span>
                    <strong>
                      {money(holding.cost_price, 3)} /{" "}
                      {money(holding.current_price, 3)}
                    </strong>
                  </div>
                  <div>
                    <span>持仓市值</span>
                    <strong>¥{money(holding.market_value)}</strong>
                  </div>
                  <div>
                    <span>浮动盈亏</span>
                    <strong className={holding.pnl_pct >= 0 ? "up" : "down"}>
                      {percent(holding.pnl_pct)}
                    </strong>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="content-section diagnosis-results">
          <div className="section-heading">
            <div>
              <p className="eyebrow">LIVE DIAGNOSIS</p>
              <h2>最新持仓操作建议</h2>
            </div>
            {report.holdingActions.length > 0 && (
              <span className="live-time">
                更新于 {freshness(report.generatedAt)}
              </span>
            )}
          </div>
          {report.holdingActions.length === 0 ? (
            <EmptyState
              icon="◎"
              title="等待独立持仓诊断"
              detail="完成截图导入并点击“按最新市场诊断持仓”，结果会在这里逐只展示。"
            />
          ) : (
            <div className="diagnosis-grid">
              {report.holdingActions.map((action) => (
                <article
                  className={`diagnosis-card action-${action.action}`}
                  key={action.code}
                >
                  <div className="diagnosis-head">
                    <div>
                      <span>{action.code}</span>
                      <h3>{action.name}</h3>
                    </div>
                    <span className="action-label">{action.actionLabel}</span>
                  </div>
                  <div className="diagnosis-numbers">
                    <div>
                      <span>实时价</span>
                      <strong>{price(action.currentPrice)}</strong>
                    </div>
                    <div>
                      <span>今日</span>
                      <strong className={action.change >= 0 ? "up" : "down"}>
                        {percent(action.change)}
                      </strong>
                    </div>
                    <div>
                      <span>浮盈亏</span>
                      <strong className={action.pnlPct >= 0 ? "up" : "down"}>
                        {percent(action.pnlPct)}
                      </strong>
                    </div>
                    <div>
                      <span>潜力分</span>
                      <strong>{action.score || "—"}</strong>
                    </div>
                  </div>
                  <div className="diagnosis-order">
                    <span>
                      {action.quantity > 0
                        ? `建议数量 ${action.quantity}股/份`
                        : "价格条件"}
                    </span>
                    <strong>{action.priceCondition}</strong>
                  </div>
                  <ul>
                    {action.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  {action.relatedNews.length > 0 && (
                    <div className="related-news">
                      <span>相关消息</span>
                      {action.relatedNews.map((item) => (
                        <p key={item}>{item}</p>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </>
    );
  }

  function renderIntel() {
    const visibleNews = newsExpanded ? report.news : report.news.slice(0, 12);
    return (
      <>
        <section className="page-hero compact-hero">
          <div>
            <p className="eyebrow">MARKET INTELLIGENCE</p>
            <h1>市场情报</h1>
            <p>
              指数、市场宽度、财经快讯和数据源状态集中在这里，方便核对建议依据。
            </p>
          </div>
          <button
            className="primary-button"
            onClick={() => requestAnalysis("market")}
            disabled={running}
          >
            <span className={running ? "spinning" : ""}>↻</span>
            {running ? "刷新中…" : "刷新全部情报"}
          </button>
        </section>
        <section className="content-section flush-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">INDEX MONITOR</p>
              <h2>境内外主要指数</h2>
            </div>
            <span className="live-time">{report.marketStatus}</span>
          </div>
          <div className="index-grid">{renderIndexStrip()}</div>
        </section>
        <section className="intel-grid">
          <article className="intel-score-card">
            <div className="card-heading">
              <div>
                <p className="eyebrow">SIGNALS</p>
                <h2>三类信号</h2>
              </div>
              <strong>{report.regimeScore}</strong>
            </div>
            {[
              ["A股趋势与宽度", report.aShareSignal],
              ["境外风险偏好", report.globalSignal],
              ["最新消息温度", report.newsSignal],
            ].map(([label, value]) => (
              <div className="intel-signal" key={String(label)}>
                <div>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
                <i>
                  <b style={{ width: `${value}%` }} />
                </i>
              </div>
            ))}
          </article>
          <article className="source-card">
            <div className="card-heading">
              <div>
                <p className="eyebrow">DATA HEALTH</p>
                <h2>数据源状态</h2>
              </div>
            </div>
            <div className="source-list">
              {report.sources.map((source) => (
                <div key={source.name}>
                  <i className={source.ok ? "ok" : "failed"} />
                  <div>
                    <strong>{source.name}</strong>
                    <span>{source.detail}</span>
                  </div>
                  <time>{freshness(source.asOf)}</time>
                </div>
              ))}
            </div>
          </article>
        </section>
        <section className="content-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">NEWS FLOW</p>
              <h2>最新财经快讯</h2>
            </div>
            <span className="section-badge">{report.news.length} 条</span>
          </div>
          <NewsList news={visibleNews} rich />
          {report.news.length > 12 && (
            <button
              className="secondary-button full-button"
              onClick={() => setNewsExpanded((value) => !value)}
            >
              {newsExpanded ? "收起消息" : `展开全部 ${report.news.length} 条`}
            </button>
          )}
        </section>
        <section className="warning-panel">
          <h3>数据限制与风险提示</h3>
          <ul>
            {report.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      </>
    );
  }

  function currentPage() {
    if (tab === "opportunities") return renderOpportunities();
    if (tab === "portfolio") return renderPortfolio();
    if (tab === "intel") return renderIntel();
    return renderToday();
  }

  return (
    <div className="app-shell">
      <aside className="desktop-rail">
        <button className="brand-mark" onClick={() => setTab("today")}>
          <span>盘</span>
          <div>
            <strong>盘前</strong>
            <small>AI 投研</small>
          </div>
        </button>
        <nav>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? "active" : ""}
              onClick={() => setTab(item.id)}
            >
              <i>{item.icon}</i>
              <span>{item.label}</span>
              <small>{item.short}</small>
            </button>
          ))}
        </nav>
        <button
          className="rail-settings"
          onClick={() => setSettingsOpen(true)}
        >
          <i>⚙</i>
          <span>模型设置</span>
        </button>
      </aside>

      <div className="app-main">
        <header className="mobile-app-bar">
          <button className="mobile-brand" onClick={() => setTab("today")}>
            <span>盘</span>
            <strong>盘前 · AI投研</strong>
          </button>
          <div className="app-bar-actions">
            <span className={`market-status status-${report.source}`}>
              <i />
              {report.marketStatus}
            </span>
            <button
              className="icon-button"
              onClick={() => setSettingsOpen(true)}
              aria-label="模型设置"
            >
              ⚙
            </button>
          </div>
        </header>

        <main>{currentPage()}</main>

        <footer className="app-footer">
          <span>公开数据研究辅助 · 不构成投资建议</span>
          <span>最后刷新 {timeLabel(report.generatedAt)}</span>
        </footer>
      </div>

      <nav className="mobile-tab-bar">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? "active" : ""}
            onClick={() => setTab(item.id)}
          >
            <i>{item.icon}</i>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div
        className={`drawer-backdrop ${settingsOpen ? "open" : ""}`}
        onClick={() => setSettingsOpen(false)}
      />
      <aside
        className={`settings-drawer ${settingsOpen ? "open" : ""}`}
        aria-hidden={!settingsOpen}
      >
        <div className="drawer-handle" />
        <div className="drawer-header">
          <div>
            <p className="eyebrow">MODEL CONNECTION</p>
            <h2>模型 API 设置</h2>
          </div>
          <button
            className="close-button"
            onClick={() => setSettingsOpen(false)}
            aria-label="关闭设置"
          >
            ×
          </button>
        </div>
        <div className="security-note">
          <strong>Key 不会保存到本站服务器</strong>
          <span>
            默认只保留在页面内存；你可选择仅在当前标签页临时保存。
          </span>
        </div>
        <form onSubmit={testConnection} className="settings-form">
          <label>
            <span>API 地址</span>
            <input
              type="url"
              value={llm.baseUrl}
              onChange={(event) => {
                const baseUrl = event.target.value;
                setLlm((current) => ({
                  ...current,
                  baseUrl,
                  model:
                    /api\.moonshot\.cn/i.test(baseUrl) &&
                    /^(gpt-|o\d)/i.test(current.model)
                      ? "kimi-k2.6"
                      : current.model,
                }));
              }}
              placeholder="https://api.openai.com/v1"
              required
            />
            <small>
              已支持 api.openai.com 与 api.moonshot.cn。
            </small>
          </label>
          <label>
            <span>模型名称</span>
            <input
              value={llm.model}
              onChange={(event) =>
                setLlm((current) => ({
                  ...current,
                  model: event.target.value,
                }))
              }
              placeholder="gpt-5.6"
              required
            />
            <small>
              {/api\.moonshot\.cn/i.test(llm.baseUrl)
                ? "Moonshot 持仓截图识别建议使用 kimi-k2.6"
                : "OpenAI Responses API 请填写可用的 GPT 模型名称"}
            </small>
          </label>
          <label>
            <span>API Key</span>
            <div className="password-field">
              <input
                type={keyVisible ? "text" : "password"}
                value={llm.apiKey}
                onChange={(event) =>
                  setLlm((current) => ({
                    ...current,
                    apiKey: event.target.value,
                  }))
                }
                placeholder="仅用于本次连接"
                autoComplete="off"
                required
              />
              <button
                type="button"
                onClick={() => setKeyVisible((value) => !value)}
              >
                {keyVisible ? "隐藏" : "显示"}
              </button>
            </div>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={rememberKey}
              onChange={(event) => setRememberKey(event.target.checked)}
            />
            <span>仅在当前标签页保存，关闭标签页后自动清除</span>
          </label>
          <button
            className="primary-button full-button"
            disabled={testing}
            type="submit"
          >
            {testing
              ? "正在测试连接…"
              : connection === "connected"
                ? "✓ 连接正常"
                : connection === "failed"
                  ? "重新测试连接"
                  : "测试并应用"}
          </button>
        </form>
        <div className="drawer-disclaimer">
          持仓截图会发送给你选择的模型服务商。请勿上传交易密码、短信验证码、身份证或银行卡信息。
        </div>
      </aside>

      {toast && <div className={`toast ${toast.tone}`}>{toast.text}</div>}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="empty-state">
      <i>{icon}</i>
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function NewsList({
  news,
  rich = false,
}: {
  news: MarketReport["news"];
  rich?: boolean;
}) {
  return (
    <div className={`news-list ${rich ? "rich-news" : ""}`}>
      {news.map((item) => (
        <article key={`${item.publishedAt}-${item.title}`}>
          <time>{item.time}</time>
          <span className={`impact-dot ${item.impact}`} />
          <div>
            <div className="news-meta">
              <span>{item.tag}</span>
              {rich && <em>{item.source}</em>}
            </div>
            <h3>{item.title}</h3>
            {rich && item.summary && <p>{item.summary}</p>}
          </div>
        </article>
      ))}
    </div>
  );
}

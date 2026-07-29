export type Holding = {
  code: string;
  name: string;
  quantity: number;
  available_quantity: number;
  cost_price: number;
  current_price: number;
  market_value: number;
  pnl_pct: number;
};

export type Portfolio = {
  cash_available: number;
  total_asset: number;
  holdings: Holding[];
  confidence?: number;
  warnings?: string[];
};

export type RiskProfile = {
  cashReservePct: number;
  maxSinglePct: number;
  maxNewExposurePct: number;
};

export type ProfilePayload = {
  portfolio: Portfolio;
  risk: RiskProfile;
  quoteLookupConsent?: boolean;
};

export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type ScoreFactors = {
  momentum: number;
  trend: number;
  liquidity: number;
  quality: number;
  news: number;
  risk: number;
};

export type Candidate = {
  rank: number;
  code: string;
  name: string;
  kind: "主板" | "ETF";
  score: number;
  potentialLabel: string;
  confidence: number;
  change: number;
  price: number;
  open: number;
  high: number;
  low: number;
  amount: number;
  turnover: number;
  pe: number | null;
  marketCap: number;
  buyLow: number;
  buyHigh: number;
  stopPrice: number;
  tag: string;
  thesis: string[];
  risks: string[];
  factors: ScoreFactors;
};

export type MarketIndex = {
  code: string;
  name: string;
  market: string;
  last: number;
  change: number;
  amount: number;
};

export type MarketBreadth = {
  rise: number;
  fall: number;
  flat: number;
  limitUp: number;
  limitDown: number;
  total: number;
  medianChange: number;
};

export type ReportNews = {
  time: string;
  publishedAt: string;
  tag: string;
  title: string;
  summary: string;
  source: string;
  impact: "positive" | "neutral" | "negative";
  tickers: string[];
};

export type SourceInfo = {
  name: string;
  ok: boolean;
  asOf: string;
  detail: string;
};

export type HoldingAdvice = {
  code: string;
  name: string;
  action: "sell" | "reduce" | "hold" | "add" | "review";
  actionLabel: string;
  quantity: number;
  currentPrice: number;
  change: number;
  pnlPct: number;
  positionPct: number;
  score: number;
  confidence: number;
  priceCondition: string;
  reasons: string[];
  relatedNews: string[];
};

export type ReportAction = {
  time: string;
  title: string;
  detail: string;
  tone: "primary" | "warning" | "neutral";
};

export type MarketReport = {
  source: "demo" | "live" | "live-lite";
  generatedAt: string;
  marketStatus: string;
  freshnessText: string;
  decision: "wait" | "operate" | "reduce";
  headline: string;
  summary: string;
  regimeScore: number;
  riskLevel: string;
  aShareSignal: number;
  globalSignal: number;
  newsSignal: number;
  indices: MarketIndex[];
  breadth: MarketBreadth;
  actions: ReportAction[];
  candidates: Candidate[];
  news: ReportNews[];
  holdingActions: HoldingAdvice[];
  sources: SourceInfo[];
  warnings: string[];
};

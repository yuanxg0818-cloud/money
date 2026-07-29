import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return javascriptFiles(path);
      return /\.(?:js|mjs)$/.test(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

test("contains the finished Chinese investment app and security policy", async () => {
  const [
    layout,
    app,
    nextConfig,
    liveMarket,
    edgeone,
    llmSecurity,
    llmTest,
    llmStatus,
    serverLlm,
    modelAnalysis,
    reportRoute,
    portfolioParse,
  ] = await Promise.all([
    source("../app/layout.tsx"),
    source("../app/CopilotApp.tsx"),
    source("../next.config.ts"),
    source("../app/api/live-market.ts"),
    source("../edgeone.json"),
    source("../app/api/security.ts"),
    source("../app/api/llm/test/route.ts"),
    source("../app/api/llm/status/route.ts"),
    source("../app/api/server-llm.ts"),
    source("../app/api/model-analysis.ts"),
    source("../app/api/report/route.ts"),
    source("../app/api/portfolio/parse/route.ts"),
  ]);

  assert.match(layout, /盘前 · AI 投研/);
  assert.doesNotMatch(layout, /每天8点/);
  assert.match(app, /按当前时刻重新生成/);
  assert.match(app, /未调用模型不会生成买卖建议/);
  assert.match(app, /请求模型综合研判/);
  assert.match(app, /AI综合/);
  assert.match(app, /https:\/\/api\.moonshot\.cn\/v1/);
  assert.match(app, /kimi-k2\.6/);
  assert.match(app, /服务端 Kimi/);
  assert.match(app, /规则池.*Kimi精选/);
  assert.match(app, /规则#.*模型#/);
  assert.match(app, /当前上涨潜力排序/);
  assert.match(app, /按最新市场诊断持仓/);
  assert.match(app, /持仓证券代码临时发送给东方财富公开行情接口/);
  assert.match(liveMarket, /profile\.quoteLookupConsent !== true/);
  assert.match(liveMarket, /cache: "no-store"/);
  assert.match(liveMarket, /push2delay\.eastmoney\.com/);
  assert.match(liveMarket, /MODEL_CANDIDATE_POOL_SIZE = 40/);
  assert.match(liveMarket, /\.slice\(0, MODEL_CANDIDATE_POOL_SIZE\)/);
  assert.doesNotMatch(liveMarket, /https:\/\/(?:82|88)\.push2\.eastmoney\.com/);
  assert.match(app, /premarket_profile_v1/);
  assert.match(app, /持仓仅保存在当前浏览器/);
  assert.match(nextConfig, /X-Frame-Options/);
  assert.match(nextConfig, /Content-Security-Policy/);
  assert.match(edgeone, /ap-guangzhou/);
  assert.match(edgeone, /22\.17\.1/);
  assert.match(
    edgeone,
    /"outputDirectory"\s*:\s*"\.next"/,
    "EdgeOne must deploy the Next.js full-stack output instead of treating the repository root as a static project",
  );
  assert.match(llmSecurity, /api\.moonshot\.cn/);
  assert.match(llmSecurity, /chat\/completions/);
  assert.match(llmTest, /Moonshot API 不能使用 GPT 模型/);
  assert.match(llmTest, /resolveLlmConfig/);
  assert.match(llmStatus, /serverModelStatus/);
  assert.match(serverLlm, /MOONSHOT_API_KEY/);
  assert.match(serverLlm, /DEFAULT_MOONSHOT_MODEL = "kimi-k2\.6"/);
  assert.doesNotMatch(serverLlm, /\bsk-[a-zA-Z0-9_-]{12,}/);
  assert.match(modelAnalysis, /strictTemporalRule/);
  assert.match(modelAnalysis, /只能使用cutoff时刻及之前的数据/);
  assert.match(modelAnalysis, /rankedCandidates只能使用candidates中的code/);
  assert.match(modelAnalysis, /minItems: 10/);
  assert.match(modelAnalysis, /必须给出10个互不重复的code/);
  assert.match(modelAnalysis, /changedFromRuleTop10/);
  assert.match(modelAnalysis, /模型只完成了.*未达到10只/);
  assert.doesNotMatch(
    modelAnalysis,
    /for \(const original of report\.candidates\) \{\s*if \(!seen\.has\(original\.code\)\) ranked\.push\(original\)/,
  );
  assert.match(modelAnalysis, /maxBuyQuantity/);
  assert.match(modelAnalysis, /analysisMode: "model"/);
  assert.match(reportRoute, /MODEL_REQUIRED/);
  assert.match(reportRoute, /synthesizeMarketReport/);
  assert.doesNotMatch(reportRoute, /已切换到安全演示模式/);
  assert.match(portfolioParse, /kimi-k2\.6/);
  assert.match(portfolioParse, /json_schema/);
  assert.doesNotMatch(app, /codex-preview|Your site is taking shape/i);
});

test("does not ship credentials in browser JavaScript", async () => {
  const files = await javascriptFiles(`${root}.next/static`);
  assert.ok(files.length > 0, "expected compiled browser assets");
  const payload = (
    await Promise.all(files.map((file) => readFile(file, "utf8")))
  ).join("\n");

  assert.doesNotMatch(payload, /\bsk-[a-zA-Z0-9_-]{12,}/);
  assert.doesNotMatch(
    payload,
    /ANALYTICS_SHARED_SECRET|OPENAI_API_KEY/,
  );
  assert.doesNotMatch(payload, /push2\.eastmoney\.com\/api/);
});

import {
  chatCompletionsEndpoint,
  extractChatCompletionText,
  extractOutputText,
  fetchModelWithRetry,
  isMoonshotBaseUrl,
  responsesEndpoint,
  sameOriginOrNoOrigin,
  validateExternalBaseUrl,
} from "../../security";
import { resolveLlmConfig } from "../../server-llm";

// EdgeOne Cloud Functions accepts request bodies up to 6 MB. Keep multipart
// overhead below that ceiling before forwarding a base64 copy upstream.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const portfolioSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    cash_available: { type: "number" },
    total_asset: { type: "number" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    warnings: { type: "array", items: { type: "string" } },
    holdings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          code: { type: "string", pattern: "^[0-9]{6}$" },
          name: { type: "string" },
          quantity: { type: "integer", minimum: 0 },
          available_quantity: { type: "integer", minimum: 0 },
          cost_price: { type: "number", minimum: 0 },
          current_price: { type: "number", minimum: 0 },
          market_value: { type: "number", minimum: 0 },
          pnl_pct: { type: "number" },
        },
        required: [
          "code",
          "name",
          "quantity",
          "available_quantity",
          "cost_price",
          "current_price",
          "market_value",
          "pnl_pct",
        ],
      },
    },
  },
  required: [
    "cash_available",
    "total_asset",
    "confidence",
    "warnings",
    "holdings",
  ],
};

export async function POST(request: Request) {
  if (!sameOriginOrNoOrigin(request)) {
    return Response.json({ error: "请求来源校验失败" }, { status: 403 });
  }
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "请选择账户截图" }, { status: 400 });
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      return Response.json(
        { error: "仅支持JPEG、PNG或WEBP截图" },
        { status: 415 },
      );
    }
    if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      return Response.json(
        { error: "截图大小必须在4MB以内" },
        { status: 413 },
      );
    }
    const resolved = resolveLlmConfig({
      baseUrl: String(form.get("baseUrl") ?? ""),
      apiKey: String(form.get("apiKey") ?? ""),
      model: String(form.get("model") ?? ""),
    });
    const baseUrl = validateExternalBaseUrl(resolved.config.baseUrl);
    const apiKey = resolved.config.apiKey;
    const model = resolved.config.model;
    const isMoonshot = isMoonshotBaseUrl(baseUrl);
    if (isMoonshot && !/^(kimi-|moonshot-)/i.test(model)) {
      return Response.json(
        { error: "Moonshot 截图识别请使用 kimi-k2.6" },
        { status: 400 },
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    const imageUrl = `data:${file.type};base64,${btoa(binary)}`;
    const upstream = await fetchModelWithRetry(() =>
      fetch(
        isMoonshot
          ? chatCompletionsEndpoint(baseUrl)
          : responsesEndpoint(baseUrl),
        {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        isMoonshot
          ? {
              model,
              thinking: { type: "disabled" },
              messages: [
                {
                  role: "system",
                  content:
                    "你是证券账户截图识别器。只提取截图明确显示的数据，不猜测被遮挡字段；金额不要带千分位符号。严格按JSON Schema返回。",
                },
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: "识别可用资金、总资产和全部持仓。识别不确定的字段填0并写入warnings。",
                    },
                    {
                      type: "image_url",
                      image_url: { url: imageUrl },
                    },
                  ],
                },
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "portfolio_snapshot",
                  strict: true,
                  schema: portfolioSchema,
                },
              },
              max_completion_tokens: 1200,
            }
          : {
              model,
              store: false,
              max_output_tokens: 1200,
              instructions:
                "你是证券账户截图识别器。只提取截图明确显示的数据，不猜测被遮挡字段；金额不要带千分位符号。返回符合JSON Schema的结果。",
              input: [
                {
                  role: "user",
                  content: [
                    {
                      type: "input_text",
                      text: "识别可用资金、总资产和全部持仓。识别不确定的字段填0并写入warnings。",
                    },
                    {
                      type: "input_image",
                      image_url: imageUrl,
                      detail: "high",
                    },
                  ],
                },
              ],
              text: {
                format: {
                  type: "json_schema",
                  name: "portfolio_snapshot",
                  strict: true,
                  schema: portfolioSchema,
                },
              },
            },
      ),
      signal: AbortSignal.timeout(45_000),
        },
      ),
    );
    const payload = (await upstream.json()) as unknown;
    if (!upstream.ok) {
      return Response.json(
        { error: `模型识别失败（${upstream.status}）` },
        { status: 502 },
      );
    }
    const output = isMoonshot
      ? extractChatCompletionText(payload)
      : extractOutputText(payload);
    const portfolio = JSON.parse(output);
    return Response.json({ portfolio });
  } catch (error) {
    const message = error instanceof Error ? error.message : "截图识别失败";
    return Response.json({ error: message.slice(0, 240) }, { status: 400 });
  }
}

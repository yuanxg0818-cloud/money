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

export async function POST(request: Request) {
  if (!sameOriginOrNoOrigin(request)) {
    return Response.json({ error: "请求来源校验失败" }, { status: 403 });
  }
  try {
    const body = (await request.json()) as {
      baseUrl?: string;
      apiKey?: string;
      model?: string;
    };
    const resolved = resolveLlmConfig(body);
    const baseUrl = validateExternalBaseUrl(resolved.config.baseUrl);
    const apiKey = resolved.config.apiKey;
    const model = resolved.config.model;
    if (apiKey.length > 512) {
      return Response.json({ error: "API Key格式不正确" }, { status: 400 });
    }
    if (!model || model.length > 100) {
      return Response.json({ error: "请填写有效的模型名称" }, { status: 400 });
    }
    const isMoonshot = isMoonshotBaseUrl(baseUrl);
    if (isMoonshot && !/^(kimi-|moonshot-)/i.test(model)) {
      return Response.json(
        {
          error: "Moonshot API 不能使用 GPT 模型，请改为 kimi-k2.6",
          suggestedModel: "kimi-k2.6",
        },
        { status: 400 },
      );
    }
    const started = Date.now();
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
                    { role: "user", content: "只回复四个字：连接成功" },
                  ],
                  max_completion_tokens: 24,
                }
              : {
                  model,
                  input: "只回复四个字：连接成功",
                  max_output_tokens: 24,
                  store: false,
                },
          ),
          signal: AbortSignal.timeout(30_000),
        },
      ),
    );
    const payload = (await upstream.json()) as unknown;
    if (!upstream.ok) {
      const message =
        payload &&
        typeof payload === "object" &&
        "error" in payload &&
        typeof payload.error === "object" &&
        payload.error &&
        "message" in payload.error
          ? String(payload.error.message)
          : `上游返回 ${upstream.status}`;
      return Response.json({ error: message.slice(0, 240) }, { status: 502 });
    }
    return Response.json({
      ok: true,
      model,
      provider: isMoonshot ? "Moonshot" : "OpenAI Responses",
      managed: resolved.managed,
      latencyMs: Date.now() - started,
      message:
        (isMoonshot
          ? extractChatCompletionText(payload)
          : extractOutputText(payload)) || "连接成功",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "连接失败";
    return Response.json({ error: message }, { status: 400 });
  }
}

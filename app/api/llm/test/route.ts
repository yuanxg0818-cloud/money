import {
  extractOutputText,
  responsesEndpoint,
  sameOriginOrNoOrigin,
  validateExternalBaseUrl,
} from "../../security";

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
    const baseUrl = validateExternalBaseUrl(body.baseUrl?.trim() ?? "");
    const apiKey = body.apiKey?.trim() ?? "";
    const model = body.model?.trim() ?? "";
    if (!apiKey || apiKey.length > 512) {
      return Response.json({ error: "请填写有效的API Key" }, { status: 400 });
    }
    if (!model || model.length > 100) {
      return Response.json({ error: "请填写有效的模型名称" }, { status: 400 });
    }
    const started = Date.now();
    const upstream = await fetch(responsesEndpoint(baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: "只回复四个字：连接成功",
        max_output_tokens: 24,
        store: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });
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
      latencyMs: Date.now() - started,
      message: extractOutputText(payload) || "连接成功",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "连接失败";
    return Response.json({ error: message }, { status: 400 });
  }
}

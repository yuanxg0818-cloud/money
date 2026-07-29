const BLOCKED_HOSTS = new Set([
  "localhost",
  "0.0.0.0",
  "127.0.0.1",
  "::1",
  "[::1]",
  "metadata.google.internal",
]);

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export function validateExternalBaseUrl(
  raw: string,
  allowlistEnv = process.env.LLM_ALLOWED_HOSTS ?? "api.openai.com",
) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("API地址格式不正确");
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:") {
    throw new Error("公网版本只允许HTTPS API地址");
  }
  if (
    BLOCKED_HOSTS.has(hostname) ||
    hostname.endsWith(".local") ||
    isPrivateIpv4(hostname)
  ) {
    throw new Error("不允许访问本地或内网地址");
  }
  const allowedHosts = allowlistEnv
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!allowedHosts.includes(hostname)) {
    throw new Error(
      `域名 ${hostname} 尚未加入服务端白名单`,
    );
  }
  return url;
}

export function responsesEndpoint(base: URL) {
  const normalized = new URL(base.toString());
  const path = normalized.pathname.replace(/\/+$/, "");
  normalized.pathname = path.endsWith("/responses")
    ? path
    : path.endsWith("/v1")
      ? `${path}/responses`
      : `${path}/v1/responses`;
  normalized.search = "";
  normalized.hash = "";
  return normalized;
}

export function extractOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as {
    output_text?: unknown;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: unknown }>;
    }>;
  };
  if (typeof response.output_text === "string") return response.output_text;
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map((item) => (typeof item.text === "string" ? item.text : ""))
    .join("\n")
    .trim();
}

export function sameOriginOrNoOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

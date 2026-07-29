import type { LlmConfig } from "../types";

export const DEFAULT_MOONSHOT_BASE_URL = "https://api.moonshot.cn/v1";
export const DEFAULT_MOONSHOT_MODEL = "kimi-k2.6";

type PartialLlmConfig = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
};

export function serverModelStatus() {
  const configured = Boolean(process.env.MOONSHOT_API_KEY?.trim());
  return {
    configured,
    provider: "Moonshot",
    baseUrl: DEFAULT_MOONSHOT_BASE_URL,
    model:
      process.env.MOONSHOT_MODEL?.trim() || DEFAULT_MOONSHOT_MODEL,
  };
}

export function resolveLlmConfig(input?: PartialLlmConfig): {
  config: LlmConfig;
  managed: boolean;
} {
  const userKey = input?.apiKey?.trim();
  if (userKey) {
    return {
      managed: false,
      config: {
        baseUrl: input?.baseUrl?.trim() || DEFAULT_MOONSHOT_BASE_URL,
        apiKey: userKey,
        model: input?.model?.trim() || DEFAULT_MOONSHOT_MODEL,
      },
    };
  }
  const serverKey = process.env.MOONSHOT_API_KEY?.trim();
  if (!serverKey) {
    throw new Error(
      "服务端尚未配置MOONSHOT_API_KEY，请在模型设置中填写并测试自己的Key",
    );
  }
  return {
    managed: true,
    config: {
      baseUrl: DEFAULT_MOONSHOT_BASE_URL,
      apiKey: serverKey,
      model:
        process.env.MOONSHOT_MODEL?.trim() || DEFAULT_MOONSHOT_MODEL,
    },
  };
}

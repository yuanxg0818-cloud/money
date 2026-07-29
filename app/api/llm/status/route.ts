import { sameOriginOrNoOrigin } from "../../security";
import { serverModelStatus } from "../../server-llm";

export async function GET(request: Request) {
  if (!sameOriginOrNoOrigin(request)) {
    return Response.json({ error: "请求来源校验失败" }, { status: 403 });
  }
  const response = Response.json(serverModelStatus());
  response.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0",
  );
  return response;
}

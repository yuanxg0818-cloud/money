import { EMPTY_PROFILE } from "../../demo-data";
export async function GET() {
  return Response.json({
    profile: EMPTY_PROFILE,
    persisted: false,
    storage: "browser-local",
  });
}

export async function PUT() {
  return Response.json(
    { error: "EdgeOne版本仅在当前浏览器保存账户数据" },
    { status: 410 },
  );
}

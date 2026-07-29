import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "盘前 · AI 投研",
  description:
    "按点击时刻刷新A股主板与ETF行情、指数和财经快讯，并提供上涨潜力排序与独立持仓诊断。",
  applicationName: "盘前 AI投研",
  keywords: ["A股", "ETF", "盘前分析", "持仓分析", "AI投研"],
  openGraph: {
    title: "盘前 · AI 投研",
    description: "实时市场判断、上涨潜力排序与独立持仓诊断。",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "盘前 · AI 投研",
    description: "实时市场判断、上涨潜力排序与独立持仓诊断。",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#f4f6f8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import "./globals.css";
import BottomNav from "@/components/BottomNav";

export const metadata: Metadata = {
  title: "蛋白钱包",
  description: "拍小票同时记账 + 记营养:每一美元换到多少克蛋白质",
  applicationName: "蛋白钱包",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "蛋白钱包",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#16a34a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full bg-zinc-50 text-zinc-900">
        {/* DECISION: single column, max 400px wide, phone-first per PRD */}
        <div className="mx-auto flex min-h-dvh w-full max-w-[400px] flex-col">
          <main className="flex-1 px-4 pb-24 pt-[max(1rem,env(safe-area-inset-top))]">
            {children}
          </main>
          <BottomNav />
        </div>
      </body>
    </html>
  );
}

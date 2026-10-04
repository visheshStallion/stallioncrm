import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/Toaster";
import { getPreferences } from "@/server/modules/preferences/queries";
import { getRequestContext } from "@/server/request";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "StallionCRM", template: "%s · StallionCRM" },
  description: "Multi-brand automotive sales CRM",
  appleWebApp: { capable: true, title: "StallionCRM", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1565d0" };

/** Resolves the "system" theme before first paint (no flash). */
const SYSTEM_THEME_SCRIPT = `(function(){try{var d=document.documentElement;if(d.dataset.themePref==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches){d.classList.add("dark")}}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRequestContext();
  const prefs = ctx ? await getPreferences(ctx) : null;
  const theme = prefs?.theme ?? "light";
  return (
    <html lang="en" className={theme === "dark" ? "dark" : undefined} data-theme-pref={theme} data-density={prefs?.density ?? "comfortable"} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}

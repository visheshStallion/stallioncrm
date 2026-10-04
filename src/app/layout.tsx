import type { Metadata } from "next";
import { Toaster } from "@/components/Toaster";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "StallionCRM", template: "%s · StallionCRM" },
  description: "Multi-brand automotive sales CRM",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}

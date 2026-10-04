import type { MetadataRoute } from "next";

/** Web app manifest: installable PWA for showroom and field use (prompt 14). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StallionCRM",
    short_name: "StallionCRM",
    description: "Multi-brand automotive sales CRM",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4f6f9",
    theme_color: "#1565d0",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Quick actions", url: "/quick" },
      { name: "Scan VIN", url: "/inventory/scan" },
    ],
  };
}

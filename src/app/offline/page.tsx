import { QuickActions } from "@/components/pwa/QuickActions";

export const metadata = { title: "Offline" };

/**
 * Static offline shell (prompt 14). The service worker serves it when a page cannot be loaded. It contains no
 * data itself: the lists are read from the device's offline store, which only ever holds the signed-in user's
 * own records and is wiped on logout or when their access changes.
 */
export default function OfflinePage() {
  return (
    <main className="min-h-screen bg-canvas p-3">
      <header className="mx-auto mb-3 max-w-xl">
        <h1 className="text-lg font-semibold">StallionCRM – offline</h1>
        <p className="text-[13px] text-text-muted">
          No connection. Your saved leads, deals and activities are below; calls, notes and new leads are stored on this device and sent when you are back online.{" "}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full reload is wanted: the client router has nothing cached */}
          <a href="/" className="text-primary underline">
            Try again
          </a>
        </p>
      </header>
      <QuickActions offlinePage />
    </main>
  );
}

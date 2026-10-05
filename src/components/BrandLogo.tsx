import { cn } from "@/lib/utils";
import { brandColor } from "./BrandBadge";

export interface LogoBrand {
  id: string;
  code: string;
  name: string;
  color?: string | null;
  /** An administrator uploaded a logo (Setup → Brands); otherwise a mark is generated from the brand name. */
  hasLogo?: boolean;
}

/** Letters of the generated mark: "MG" → "MG", "Hyundai" → "H", "Future brand 6" → "FB". */
export function brandMonogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const first = words[0]!;
  if (words.length === 1 && first.length <= 3 && first === first.toUpperCase()) return first;
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/**
 * Brand logo: the uploaded image when there is one, otherwise a typographic mark built from the brand name in
 * the brand colour (no third-party artwork is bundled with the application).
 */
export function BrandLogo({
  brand,
  size = "md",
  showName = true,
  className,
}: {
  brand: LogoBrand;
  size?: "sm" | "md";
  showName?: boolean;
  className?: string;
}) {
  const color = brandColor(brand);
  const box = size === "sm" ? "h-6 min-w-6 text-[10px]" : "h-7 min-w-7 text-[11px]";
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} title={`${brand.name} (${brand.code})`} data-testid="brand-logo" data-brand={brand.code}>
      {brand.hasLogo ? (
        // eslint-disable-next-line @next/next/no-img-element -- logo from our own API
        <img src={`/api/v1/brands/${brand.id}/logo`} alt={`${brand.name} logo`} className={cn("max-w-[96px] rounded bg-white object-contain p-0.5", size === "sm" ? "h-6" : "h-7")} />
      ) : (
        <span aria-hidden className={cn("inline-flex items-center justify-center rounded-md px-1 font-extrabold tracking-tight text-white shadow-sm", box)} style={{ backgroundColor: color }}>
          {brandMonogram(brand.name)}
        </span>
      )}
      {showName ? (
        <span className="hidden truncate text-[13px] font-semibold sm:inline" style={{ color }}>
          {brand.name}
        </span>
      ) : (
        <span className="sr-only">{brand.name}</span>
      )}
    </span>
  );
}

/** The signed-in user's brands (or the one selected in the switcher) as logos; extra brands collapse into "+N". */
export function BrandLogoStrip({ brands, max = 3 }: { brands: LogoBrand[]; max?: number }) {
  if (!brands.length) return null;
  const shown = brands.slice(0, max);
  const rest = brands.slice(max);
  return (
    <div className="flex min-w-0 items-center gap-2" data-testid="brand-logos" aria-label="Your brands">
      {shown.map((b) => (
        <BrandLogo key={b.id} brand={b} showName={brands.length === 1} size={brands.length === 1 ? "md" : "sm"} />
      ))}
      {rest.length ? (
        <span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground" title={rest.map((b) => b.name).join(", ")}>
          +{rest.length}
        </span>
      ) : null}
    </div>
  );
}

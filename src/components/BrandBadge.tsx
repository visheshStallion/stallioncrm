import { cn } from "@/lib/utils";

const FALLBACK = ["#1d4ed8", "#be123c", "#047857", "#7c3aed", "#b45309", "#0e7490", "#4d7c0f", "#a21caf"];

export function brandColor(brand: { code: string; color?: string | null }): string {
  if (brand.color) return brand.color;
  let h = 0;
  for (const ch of brand.code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length]!;
}

/** Brand chip shown on every brand-owned row and record header. */
export function BrandBadge({
  brand,
  className,
  size = "sm",
}: {
  brand?: { code: string; name?: string; color?: string | null } | null;
  className?: string;
  size?: "sm" | "lg";
}) {
  if (!brand) return <span className="text-muted-foreground">—</span>;
  const color = brandColor(brand);
  return (
    <span
      title={brand.name ?? brand.code}
      data-testid="brand-badge"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border font-semibold tracking-wide",
        size === "lg" ? "px-2.5 py-1 text-sm" : "px-1.5 py-0.5 text-[11px]",
        className,
      )}
      style={{ color, borderColor: `${color}55`, backgroundColor: `color-mix(in srgb, ${color} 7%, var(--surface))` }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {brand.code}
    </span>
  );
}

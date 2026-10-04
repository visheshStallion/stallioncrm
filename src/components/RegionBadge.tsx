import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

export function RegionBadge({ region, className }: { region?: { name: string } | null; className?: string }) {
  if (!region) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      data-testid="region-badge"
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      <MapPin className="h-3 w-3" />
      {region.name}
    </span>
  );
}

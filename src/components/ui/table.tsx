import * as React from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}
export const TableHeader = (p: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <thead {...p} className={cn("border-b border-border bg-muted/50", p.className)} />
);
export const TableBody = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody {...p} />;
export const TableRow = (p: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr {...p} className={cn("border-b border-border last:border-0 hover:bg-muted/40", p.className)} />
);
export const TableHead = (p: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th {...p} className={cn("h-10 px-3 text-left align-middle font-medium text-muted-foreground", p.className)} />
);
export const TableCell = (p: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td {...p} className={cn("px-3 py-2 align-middle", p.className)} />
);

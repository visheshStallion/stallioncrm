import * as React from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("crm-table caption-bottom", className)} {...props} />
    </div>
  );
}
export const TableHeader = (p: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <thead {...p} className={cn(p.className)} />
);
export const TableBody = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody {...p} />;
export const TableRow = (p: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr {...p} className={cn(p.className)} />
);
export const TableHead = (p: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th {...p} className={cn("align-middle", p.className)} />
);
export const TableCell = (p: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td {...p} className={cn("align-middle", p.className)} />
);

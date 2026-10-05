"use client";

import { Bell, Calendar, KeyRound, LogOut, Settings, ShieldCheck, UserCog } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toastResult } from "@/components/Toaster";
import { cn } from "@/lib/utils";
import { markNotificationsReadAction } from "@/server/modules/notifications/actions";
import { setPreferenceAction } from "@/server/modules/preferences/actions";
import type { Preferences } from "@/server/modules/preferences/schema";
import { DropdownMenu } from "./overlays";
import { Avatar } from "./primitives";

const iconBtn = "crm-icon-btn";

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  at: string;
}

/** Notifications bell: unread counter and the latest reminders, mentions and assignments. */
export function NotificationsBell({ count, items = [] }: { count: number; items?: NotificationItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const markRead = () =>
    start(async () => {
      await markNotificationsReadAction();
      router.refresh();
    });
  return (
    <DropdownMenu
      label="Notifications"
      trigger={({ toggle, open, id }) => (
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls={id} aria-label={`Notifications (${count})`} className={iconBtn}>
          <Bell />
          {count > 0 ? <span className="crm-count">{count > 99 ? "99+" : count}</span> : null}
        </button>
      )}
    >
      {items.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-text-muted">
          You&apos;re all caught up.{" "}
          <Link href="/notifications" className="text-primary underline">
            Notification centre
          </Link>
        </p>
      ) : (
        <div className="w-80" data-testid="notifications">
          <div className="flex items-center border-b border-border px-3 py-2">
            <span className="text-[13px] font-semibold">Notifications</span>
            <Link href="/notifications" className="ml-auto text-xs text-primary underline">
              See all
            </Link>
            {count > 0 ? (
              <button type="button" onClick={markRead} disabled={pending} className="ml-3 text-xs text-primary hover:underline">
                Mark all read
              </button>
            ) : null}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {items.map((n) => {
              const content = (
                <>
                  <span className={cn("block text-[13px]", !n.read && "font-semibold")}>{n.title}</span>
                  {n.body ? <span className="block truncate text-xs text-text-muted">{n.body}</span> : null}
                </>
              );
              return (
                <li key={n.id} className={cn("border-b border-border px-3 py-2 last:border-0", !n.read && "bg-primary/5")}>
                  {n.href ? (
                    <Link href={n.href} className="block hover:underline">
                      {content}
                    </Link>
                  ) : (
                    content
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </DropdownMenu>
  );
}

export function CalendarShortcut() {
  return (
    <Link href="/activities?view=calendar" className={iconBtn} aria-label="Calendar" title="Calendar">
      <Calendar />
    </Link>
  );
}

export function SetupGear() {
  return (
    <Link href="/setup" className={iconBtn} aria-label="Setup" title="Setup" data-testid="setup-gear">
      <Settings />
    </Link>
  );
}

/** Avatar menu: profile, preferences (theme, density, date format), sign out. */
export function AvatarMenu({
  user,
  prefs,
  logout,
}: {
  user: { name: string; email: string; roleName: string; profileName: string };
  prefs: Pick<Preferences, "theme" | "density" | "dateFormat" | "nav">;
  logout: () => Promise<void>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (key: string, value: string) =>
    start(async () => {
      const res = await setPreferenceAction(key, value);
      toastResult(res);
      router.refresh();
    });
  const seg = (key: keyof typeof prefs, options: Array<[string, string]>) => (
    <div className="flex rounded-md border border-border p-0.5" role="radiogroup" aria-label={key}>
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={prefs[key] === value}
          disabled={pending}
          onClick={() => set(key, value)}
          className={cn("flex-1 rounded px-2 py-1 text-xs", prefs[key] === value ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <DropdownMenu
      label="Account"
      className="w-72"
      trigger={({ toggle, open, id }) => (
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls={id} aria-label="Account menu" className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted" data-testid="avatar-menu">
          <Avatar name={user.name} size={28} />
          <span className="hidden text-left leading-tight xl:block">
            <span className="block text-[13px] font-medium" data-testid="current-user">
              {user.name}
            </span>
            <span className="block text-[11px] text-text-muted">{user.roleName}</span>
          </span>
        </button>
      )}
    >
      <div className="flex items-center gap-3 border-b border-border px-3 pb-3 pt-2">
        <Avatar name={user.name} size={36} />
        <div className="min-w-0">
          <div className="truncate font-semibold">{user.name}</div>
          <div className="truncate text-xs text-text-muted">{user.email}</div>
          <div className="text-xs text-text-muted">{user.profileName} profile</div>
        </div>
      </div>
      <div className="space-y-2 px-3 py-3">
        <div className="text-[11px] font-semibold uppercase text-text-muted">Theme</div>
        {seg("theme", [
          ["light", "Light"],
          ["dark", "Dark"],
          ["system", "System"],
        ])}
        <div className="text-[11px] font-semibold uppercase text-text-muted">Density</div>
        {seg("density", [
          ["standard", "Standard"],
          ["comfortable", "Comfortable"],
          ["compact", "Compact"],
        ])}
        <div className="text-[11px] font-semibold uppercase text-text-muted">Navigation</div>
        {seg("nav", [
          ["sidebar", "Sidebar"],
          ["classic", "Classic tabs"],
        ])}
        <div className="text-[11px] font-semibold uppercase text-text-muted">Date format</div>
        {seg("dateFormat", [
          ["DD/MM/YYYY", "DD/MM"],
          ["MM/DD/YYYY", "MM/DD"],
          ["YYYY-MM-DD", "ISO"],
        ])}
      </div>
      <div className="border-t border-border p-1">
        <Link href="/setup/personal" role="menuitem" className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 hover:bg-muted">
          <UserCog className="h-4 w-4" /> Personal settings
        </Link>
        <Link href="/tokens" role="menuitem" className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 hover:bg-muted">
          <KeyRound className="h-4 w-4" /> My API tokens
        </Link>
        <Link href="/security" role="menuitem" className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 hover:bg-muted">
          <ShieldCheck className="h-4 w-4" /> Sign-in security
        </Link>
      </div>
      <form action={logout} className="border-t border-border p-1">
        <button type="submit" role="menuitem" className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left hover:bg-muted" aria-label="Sign out">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </form>
    </DropdownMenu>
  );
}

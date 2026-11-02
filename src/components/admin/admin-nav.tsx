"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Boxes, Settings2, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/models", label: "Models", icon: Boxes },
  { href: "/admin/settings", label: "Settings", icon: Settings2 },
  { href: "/admin/usage", label: "Usage", icon: BarChart3 },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="scrollbar-thin flex gap-1 overflow-x-auto border-b">
      {TABS.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="size-4" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PanelLeft, SquarePen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/app/sidebar";
import { UserContext, type ShellUser } from "@/components/app/user-context";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const COLLAPSE_KEY = "obot:sidebar-collapsed";

export function AppShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate persisted preference
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- close the mobile drawer on navigation
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function toggle() {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      return !c;
    });
  }

  return (
    <UserContext value={user}>
      <div className="flex h-dvh overflow-hidden bg-sidebar">
        <aside
          className={cn(
            "hidden shrink-0 transition-[width] duration-200 ease-out md:block",
            collapsed ? "w-0" : "w-64",
          )}
        >
          <div inert={collapsed} className={cn("h-full w-64 transition-opacity", collapsed && "pointer-events-none opacity-0")}>
            <Sidebar onCollapse={toggle} />
          </div>
        </aside>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-72 p-0" showCloseButton={false}>
            <SheetTitle className="sr-only">Threads</SheetTitle>
            <Sidebar onCollapse={() => setMobileOpen(false)} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        <main
          className={cn(
            "relative flex min-w-0 flex-1 flex-col bg-background md:my-2 md:mr-2 md:rounded-2xl md:border",
            collapsed && "md:ml-2",
          )}
        >
          <div className={cn("absolute top-2 left-2 z-20 flex gap-1", !collapsed && "md:hidden")}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Toggle sidebar"
                  onClick={() => (window.matchMedia("(min-width: 768px)").matches ? toggle() : setMobileOpen(true))}
                >
                  <PanelLeft />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Toggle sidebar (⌘B)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="New thread" asChild>
                  <Link href="/">
                    <SquarePen />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">New thread</TooltipContent>
            </Tooltip>
          </div>
          {children}
        </main>
      </div>
    </UserContext>
  );
}

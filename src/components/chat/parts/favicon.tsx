"use client";

import { useState } from "react";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";

export function domainOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function Favicon({ url, className }: { url?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const domain = domainOf(url);
  if (!domain || failed) {
    return <Globe className={cn("size-3.5 text-muted-foreground", className)} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny external favicons, no optimization needed
    <img
      src={`https://icons.duckduckgo.com/ip3/${domain}.ico`}
      alt=""
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("size-3.5 rounded-sm bg-white object-contain p-px", className)}
    />
  );
}

"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Infinity as InfinityIcon, Link2, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { formatUsd, microsToDollars } from "@/lib/money";
import { useShellUser } from "@/components/app/user-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "DISABLED";
  createdAt: string;
  limitMode: "INHERIT" | "CUSTOM" | "UNLIMITED";
  weeklyLimitMicros: number | null;
  monthlyLimitMicros: number | null;
  effective: { unlimited: boolean; weeklyMicros: number | null; monthlyMicros: number | null };
  spentWeekMicros: number;
  spentMonthMicros: number;
};

type Invite = {
  id: string;
  email: string | null;
  role: "USER" | "ADMIN";
  note: string | null;
  createdAt: string;
  expiresAt: string;
  usedBy: string | null;
  state: "active" | "used" | "expired" | "revoked";
};

function SpendCell({ spent, limit, unlimited }: { spent: number; limit: number | null; unlimited: boolean }) {
  if (unlimited || limit == null) {
    return (
      <span className="tabular-nums">
        {formatUsd(spent)} <span className="text-muted-foreground">/ ∞</span>
      </span>
    );
  }
  const pct = Math.min(1, spent / Math.max(1, limit));
  return (
    <div className="w-32 space-y-1">
      <div className="text-xs tabular-nums">
        {formatUsd(spent)} <span className="text-muted-foreground">/ {formatUsd(limit)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={pct >= 1 ? "h-full bg-destructive" : pct >= 0.8 ? "h-full bg-amber-500" : "h-full bg-primary"} style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}

export function AdminUsers() {
  const me = useShellUser();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api<{ users: AdminUser[] }>("/api/admin/users").then((r) => r.users) });
  const invites = useQuery({ queryKey: ["admin-invites"], queryFn: () => api<{ invites: Invite[] }>("/api/admin/invites").then((r) => r.invites) });
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api(`/api/admin/users/${id}`, { method: "PATCH", json: body }),
    onSuccess: () => {
      toast.success("User updated");
      void qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/admin/invites/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-invites"] }),
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">People</CardTitle>
            <CardDescription>Spend shown for the current week (Mon 00:00 UTC) and month (1st 00:00 UTC).</CardDescription>
          </div>
          <Button onClick={() => setInviteOpen(true)}>
            <Plus /> Invite
          </Button>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">User</TableHead>
                <TableHead className="hidden sm:table-cell">Role</TableHead>
                <TableHead className="hidden md:table-cell">Limits</TableHead>
                <TableHead className="hidden md:table-cell">This week</TableHead>
                <TableHead>This month</TableHead>
                <TableHead className="w-10 pr-6" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(users.data ?? []).map((u) => (
                <TableRow key={u.id} className={u.status === "DISABLED" ? "opacity-60" : undefined}>
                  <TableCell className="pl-6">
                    <div className="font-medium">
                      {u.name} {u.id === me.id && <span className="text-xs text-muted-foreground">(you)</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex gap-1">
                      <Badge variant={u.role === "ADMIN" ? "default" : "secondary"}>{u.role === "ADMIN" ? "Admin" : "User"}</Badge>
                      {u.status === "DISABLED" && <Badge variant="outline">Disabled</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {u.limitMode === "UNLIMITED" ? (
                      <span className="inline-flex items-center gap-1">
                        <InfinityIcon className="size-3.5" /> Unlimited
                      </span>
                    ) : u.limitMode === "CUSTOM" ? (
                      "Custom"
                    ) : (
                      <span className="text-muted-foreground">Default{u.effective.unlimited ? " (unlimited)" : ""}</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <SpendCell spent={u.spentWeekMicros} limit={u.effective.weeklyMicros} unlimited={u.effective.unlimited} />
                  </TableCell>
                  <TableCell>
                    <SpendCell spent={u.spentMonthMicros} limit={u.effective.monthlyMicros} unlimited={u.effective.unlimited} />
                  </TableCell>
                  <TableCell className="pr-6">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="User actions">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing(u)}>Edit spend limits</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => patch.mutate({ id: u.id, body: { role: u.role === "ADMIN" ? "USER" : "ADMIN" } })}>
                          {u.role === "ADMIN" ? "Make regular user" : "Make admin"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {u.id !== me.id && (
                          <DropdownMenuItem
                            variant={u.status === "ACTIVE" ? "destructive" : "default"}
                            onSelect={() => patch.mutate({ id: u.id, body: { status: u.status === "ACTIVE" ? "DISABLED" : "ACTIVE" } })}
                          >
                            {u.status === "ACTIVE" ? "Disable account" : "Enable account"}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invites</CardTitle>
          <CardDescription>Invite links are single-use. The link is shown once, when you create it.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">For</TableHead>
                <TableHead className="hidden sm:table-cell">Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="pr-6" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(invites.data ?? []).map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="pl-6">
                    <div>{i.email ?? <span className="text-muted-foreground">Anyone with the link</span>}</div>
                    {i.note && <div className="text-xs text-muted-foreground">{i.note}</div>}
                  </TableCell>
                  <TableCell>{i.role === "ADMIN" ? "Admin" : "User"}</TableCell>
                  <TableCell>
                    <Badge variant={i.state === "active" ? "default" : "secondary"} className="capitalize">
                      {i.state}
                    </Badge>
                    {i.usedBy && <span className="ml-2 text-xs text-muted-foreground">{i.usedBy}</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(i.expiresAt).toLocaleDateString()}</TableCell>
                  <TableCell className="pr-6 text-right">
                    {i.state === "active" && (
                      <Button variant="ghost" size="sm" onClick={() => revoke.mutate(i.id)}>
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {invites.data?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    No invites yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editing && (
        <LimitDialog
          user={editing}
          onClose={() => setEditing(null)}
          onSave={(body) => patch.mutateAsync({ id: editing.id, body }).then(() => setEditing(null))}
        />
      )}
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}

function dollarsOrEmpty(micros: number | null) {
  return micros == null ? "" : String(microsToDollars(micros));
}

function parseDollars(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function LimitDialog({ user, onClose, onSave }: { user: AdminUser; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [mode, setMode] = useState(user.limitMode);
  const [weekly, setWeekly] = useState(dollarsOrEmpty(user.weeklyLimitMicros));
  const [monthly, setMonthly] = useState(dollarsOrEmpty(user.monthlyLimitMicros));
  const w = parseDollars(weekly);
  const m = parseDollars(monthly);
  const invalid = mode === "CUSTOM" && (Number.isNaN(w) || Number.isNaN(m));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Spend limits for {user.name}</DialogTitle>
          <DialogDescription>Limits use spend computed from API-reported tokens and your model prices.</DialogDescription>
        </DialogHeader>
        <RadioGroup value={mode} onValueChange={(v) => setMode(v as AdminUser["limitMode"])} className="gap-3">
          <label className="flex items-start gap-2 text-sm">
            <RadioGroupItem value="INHERIT" className="mt-0.5" />
            <span>
              <span className="font-medium">Use instance default</span>
              <span className="block text-xs text-muted-foreground">Follows Admin → Settings.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <RadioGroupItem value="CUSTOM" className="mt-0.5" />
            <span className="font-medium">Custom limits</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <RadioGroupItem value="UNLIMITED" className="mt-0.5" />
            <span className="font-medium">Unlimited</span>
          </label>
        </RadioGroup>
        {mode === "CUSTOM" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Weekly limit (USD)</Label>
              <Input inputMode="decimal" placeholder="No cap" value={weekly} onChange={(e) => setWeekly(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Monthly limit (USD)</Label>
              <Input inputMode="decimal" placeholder="No cap" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
            </div>
            <p className="col-span-2 text-xs text-muted-foreground">Leave a field empty for no cap in that period.</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={invalid}
            onClick={() =>
              onSave(mode === "CUSTOM" ? { limitMode: mode, weeklyLimit: w, monthlyLimit: m } : { limitMode: mode }).catch(() => undefined)
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"USER" | "ADMIN">("USER");
  const [days, setDays] = useState("7");
  const [note, setNote] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      api<{ url: string }>("/api/admin/invites", {
        method: "POST",
        json: { email: email.trim() || null, role, expiresInDays: Number(days), note: note.trim() || null },
      }),
    onSuccess: (res) => {
      setUrl(res.url);
      void qc.invalidateQueries({ queryKey: ["admin-invites"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  function close(o: boolean) {
    onOpenChange(o);
    if (!o) {
      setUrl(null);
      setEmail("");
      setNote("");
      setRole("USER");
      setCopied(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{url ? "Invite link created" : "Invite someone"}</DialogTitle>
          <DialogDescription>
            {url ? "Copy this link now. It won't be shown again." : "Create a single-use link. Optionally lock it to an email address."}
          </DialogDescription>
        </DialogHeader>
        {url ? (
          <div className="flex gap-2">
            <Input readOnly value={url} onFocus={(e) => e.target.select()} />
            <Button
              variant="outline"
              onClick={async () => {
                if (await copyText(url)) setCopied(true);
                else toast.error("Couldn't copy. Select the link and copy it manually.");
              }}
            >
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label>Email (optional)</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Anyone with the link" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as "USER" | "ADMIN")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USER">User</SelectItem>
                    <SelectItem value="ADMIN">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Expires in</Label>
                <Select value={days} onValueChange={setDays}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["1", "3", "7", "14", "30", "90"].map((d) => (
                      <SelectItem key={d} value={d}>
                        {d} day{d === "1" ? "" : "s"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Note (optional)</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Design team" />
            </div>
          </div>
        )}
        <DialogFooter>
          {url ? (
            <Button onClick={() => close(false)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button onClick={() => create.mutate()} disabled={create.isPending}>
                <Link2 /> Create link
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

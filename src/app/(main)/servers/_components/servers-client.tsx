"use client";

import { Network, Search, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useServers } from "@/hooks/use-servers";
import {
  formatUptime,
  matchesServerFilter,
  NEXUS_ROLE_LABELS,
  PROTOCOL_LABELS,
  SCOPE_LABELS,
  SERVERS_POLL_INTERVAL_MS,
  type ServerListener,
  type ServersPayload,
  serviceName,
} from "@/lib/servers";
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

import { PageHeader } from "../../_components/page-header";

/**
 * Servers: what is listening on the host, read from procfs by the collector and
 * polled every few seconds. Rows come and go with the host — a service that
 * stops disappears on the next tick — and a collector that cannot be read is
 * shown as an error, never as an empty list.
 */
export function ServersClient({ initialServers }: { initialServers: ServersPayload }) {
  const { servers, refreshFailed } = useServers(initialServers);
  const [query, setQuery] = useState("");

  const visible = useMemo(
    () => servers.listeners.filter((listener) => matchesServerFilter(listener, query)),
    [servers.listeners, query],
  );
  const publicCount = servers.listeners.filter((listener) => listener.scope === "public").length;
  const filtered = query.trim() !== "";

  return (
    <>
      <PageHeader
        title="Servers"
        description={`Listening sockets on the host, read from /proc and refreshed every ${SERVERS_POLL_INTERVAL_MS / 1000}s.`}
        actions={
          servers.available ? (
            <Badge variant={publicCount > 0 ? "secondary" : "outline"} className="gap-1">
              <Network className="size-3" />
              {servers.listeners.length} listening · {publicCount} on all interfaces
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <TriangleAlert className="size-3" />
              collector unreachable
            </Badge>
          )
        }
      />

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
        {!servers.available ? (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <TriangleAlert className="mt-0.5 size-4 text-destructive" />
            <div>
              <p className="font-medium">The host collector is not reachable</p>
              <p className="text-muted-foreground">
                {servers.error ?? "The host's /proc could not be read."} This is not a list of what is listening —
                nothing was read.
              </p>
            </div>
          </div>
        ) : null}

        {refreshFailed ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            <TriangleAlert className="mt-0.5 size-4 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-medium">Refreshing failed</p>
              <p className="text-muted-foreground">
                Showing the last snapshot{servers.collectedAt ? ` from ${relativeTime(servers.collectedAt)}` : ""}. The
                host may have changed since.
              </p>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by port, process, pid, address…"
              className="pl-8"
              aria-label="Filter listeners by port or name"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {filtered ? `${visible.length} of ${servers.listeners.length}` : `${servers.listeners.length}`} listener
            {servers.listeners.length === 1 ? "" : "s"}
            {servers.collectedAt ? ` · collected ${relativeTime(servers.collectedAt)}` : ""}
          </p>
        </div>

        {servers.available && servers.listeners.length === 0 && !refreshFailed ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nothing is listening on the host right now.
          </p>
        ) : null}

        {servers.listeners.length > 0 && visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No listener matches “{query}”.
          </p>
        ) : null}

        {visible.length > 0 ? (
          <>
            {/* A phone cannot read a six-column table; the same fields as a card list. */}
            <div className="space-y-2 md:hidden">
              {visible.map((listener) => (
                <ServerCard
                  key={`${listener.protocol}:${listener.address}:${listener.port}:${listener.pid ?? "?"}`}
                  listener={listener}
                />
              ))}
            </div>

            <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
              <table className="w-full min-w-[46rem] text-sm">
                <thead className="bg-muted/40 text-left text-[11px] tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th className="px-3 py-2 font-medium">Service</th>
                    <th className="px-3 py-2 font-medium">Port</th>
                    <th className="px-3 py-2 font-medium">Proto</th>
                    <th className="px-3 py-2 font-medium">Bind</th>
                    <th className="px-3 py-2 font-medium">PID</th>
                    <th className="px-3 py-2 font-medium">Uptime</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((listener) => (
                    <ServerRow
                      key={`${listener.protocol}:${listener.address}:${listener.port}:${listener.pid ?? "?"}`}
                      listener={listener}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}

/** Phone-sized listener row: the same fields the table shows, stacked instead of columnar. */
function ServerCard({ listener }: { listener: ServerListener }) {
  return (
    <article
      className={cn(
        "rounded-xl border border-border bg-card p-3",
        listener.nexusRole ? "border-primary/40 bg-primary/5" : undefined,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{serviceName(listener)}</span>
        {listener.nexusRole ? <Badge variant="default">{NEXUS_ROLE_LABELS[listener.nexusRole]}</Badge> : null}
        <Badge variant={listener.scope === "public" ? "destructive" : "outline"} className="ml-auto">
          {SCOPE_LABELS[listener.scope]}
        </Badge>
      </div>

      <p className="mt-1.5 font-mono text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {listener.address}:{listener.port}
        </span>{" "}
        · {PROTOCOL_LABELS[listener.protocol]}
      </p>

      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {listener.uid === null ? null : <span>uid {listener.uid}</span>}
        {listener.pid === null ? null : <span>pid {listener.pid}</span>}
        <span>up {formatUptime(listener.uptimeSeconds)}</span>
      </p>
    </article>
  );
}

function ServerRow({ listener }: { listener: ServerListener }) {
  return (
    <tr className={cn("border-t border-border", listener.nexusRole ? "bg-primary/5" : undefined)}>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{serviceName(listener)}</span>
          {listener.nexusRole ? <Badge variant="default">{NEXUS_ROLE_LABELS[listener.nexusRole]}</Badge> : null}
          {listener.uid === null ? null : <span className="text-xs text-muted-foreground">uid {listener.uid}</span>}
        </div>
      </td>
      <td className="px-3 py-2 font-mono font-medium">{listener.port}</td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{PROTOCOL_LABELS[listener.protocol]}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs">{listener.address}</span>
          <Badge variant={listener.scope === "public" ? "destructive" : "outline"}>
            {SCOPE_LABELS[listener.scope]}
          </Badge>
        </div>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
        {listener.pid === null ? "—" : listener.pid}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{formatUptime(listener.uptimeSeconds)}</td>
    </tr>
  );
}

"use client";

import { ChevronRight, Container, Network, Search, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useServers } from "@/hooks/use-servers";
import {
  formatUptime,
  groupListeners,
  KIND_LABELS,
  type ListenerGroup,
  matchesGroupFilter,
  NEXUS_ROLE_LABELS,
  PROTOCOL_LABELS,
  SCOPE_LABELS,
  SERVERS_POLL_INTERVAL_MS,
  type ServersPayload,
  summarizeServers,
} from "@/lib/servers";
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

import { PageHeader } from "../../_components/page-header";

/**
 * Servers: what is listening on the host, read from procfs by the collector and
 * polled every few seconds. One row per app, not per socket — a service's TCP
 * and per-address variants collapse into one row — split into the operator's
 * web apps and the host's own daemons. Rows come and go with the host, and a
 * collector that cannot be read is shown as an error, never as an empty list.
 */
export function ServersClient({ initialServers }: { initialServers: ServersPayload }) {
  const { servers, refreshFailed } = useServers(initialServers);
  const [query, setQuery] = useState("");
  const [showServices, setShowServices] = useState(false);

  const summary = useMemo(() => summarizeServers(servers.listeners), [servers.listeners]);
  const groups = useMemo(() => groupListeners(servers.listeners), [servers.listeners]);
  const visible = useMemo(() => groups.filter((group) => matchesGroupFilter(group, query)), [groups, query]);
  const searching = query.trim() !== "";
  // A search is an explicit request, so it reaches hidden host services too.
  const servicesShown = showServices || searching;

  const apps = visible.filter((group) => group.kind === "app");
  const services = visible.filter((group) => group.kind === "service");

  return (
    <>
      <PageHeader
        title="Servers"
        description={`One row per app, read from the host's /proc and refreshed every ${SERVERS_POLL_INTERVAL_MS / 1000}s.`}
        actions={
          servers.available ? (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <Badge variant="secondary" className="gap-1">
                <Network className="size-3" />
                {summary.apps} web app{summary.apps === 1 ? "" : "s"} · {summary.listeners} listener
                {summary.listeners === 1 ? "" : "s"}
              </Badge>
              {summary.dockerListeners > 0 ? (
                <Badge variant="outline" className="gap-1">
                  <Container className="size-3" />
                  {summary.dockerListeners} Docker
                </Badge>
              ) : null}
              {summary.publicListeners > 0 ? (
                <Badge variant="destructive">{summary.publicListeners} on all interfaces</Badge>
              ) : null}
            </div>
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
              placeholder="Filter by app, folder, port, container…"
              className="pl-8"
              aria-label="Filter apps by name, folder, or port"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {searching ? `${visible.length} of ${groups.length}` : `${groups.length}`} row
            {groups.length === 1 ? "" : "s"}
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
            No app matches “{query}”.
          </p>
        ) : null}

        {visible.length > 0 ? (
          <>
            {/* A phone cannot read a seven-column table; the same fields as cards. */}
            <div className="space-y-2 md:hidden">
              <SectionHeading kind="app" count={apps.length} />
              {apps.map((group) => (
                <ServerCard key={group.key} group={group} />
              ))}
              {servicesShown ? (
                <>
                  <SectionHeading kind="service" count={services.length} />
                  {services.map((group) => (
                    <ServerCard key={group.key} group={group} />
                  ))}
                </>
              ) : (
                <HiddenServices services={services.length} onShow={() => setShowServices(true)} />
              )}
            </div>

            <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
              <table className="w-full min-w-[56rem] text-sm">
                <thead className="bg-muted/40 text-left text-[11px] tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th className="px-3 py-2 font-medium">App</th>
                    <th className="px-3 py-2 font-medium">Folder / container</th>
                    <th className="px-3 py-2 font-medium">Ports</th>
                    <th className="px-3 py-2 font-medium">Bind</th>
                    <th className="px-3 py-2 font-medium">Owner</th>
                    <th className="px-3 py-2 font-medium">Uptime</th>
                  </tr>
                </thead>
                <tbody>
                  <SectionRow kind="app" count={apps.length} columns={6} />
                  {apps.map((group) => (
                    <ServerRow key={group.key} group={group} />
                  ))}
                  {servicesShown ? (
                    <>
                      <SectionRow kind="service" count={services.length} columns={6} />
                      {services.map((group) => (
                        <ServerRow key={group.key} group={group} />
                      ))}
                    </>
                  ) : (
                    <tr className="border-t border-border">
                      <td colSpan={6} className="px-3 py-2">
                        <HiddenServices services={services.length} onShow={() => setShowServices(true)} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {servicesShown && !searching && services.length > 0 ? (
              <div className="md:block">
                <Button variant="ghost" size="sm" onClick={() => setShowServices(false)}>
                  Hide {services.length} host service{services.length === 1 ? "" : "s"}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}

function SectionHeading({ kind, count }: { kind: ListenerGroup["kind"]; count: number }) {
  return (
    <h2 className="pt-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {KIND_LABELS[kind]} · {count}
    </h2>
  );
}

function SectionRow({ kind, count, columns }: { kind: ListenerGroup["kind"]; count: number; columns: number }) {
  return (
    <tr className="border-t border-border bg-muted/30">
      <td
        colSpan={columns}
        className="px-3 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
      >
        {KIND_LABELS[kind]} · {count}
      </td>
    </tr>
  );
}

/** The card's rule: host services are hidden behind one control that always states the count. */
function HiddenServices({ services, onShow }: { services: number; onShow: () => void }) {
  if (services === 0) {
    return <p className="px-1 py-2 text-xs text-muted-foreground">No host services hidden.</p>;
  }
  return (
    <button
      type="button"
      onClick={onShow}
      className="flex w-full items-center gap-1.5 rounded-lg px-1 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
    >
      <ChevronRight className="size-3.5" />
      {services} host service{services === 1 ? "" : "s"} hidden — show
    </button>
  );
}

/** Phone-sized row: the same fields the table shows, stacked instead of columnar. */
function ServerCard({ group }: { group: ListenerGroup }) {
  return (
    <article
      className={cn(
        "rounded-xl border border-border bg-card p-3",
        group.nexusRole ? "border-primary/40 bg-primary/5" : undefined,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{group.name}</span>
        {group.container ? (
          <Badge variant="secondary" className="gap-1">
            <Container className="size-3" />
            Docker
          </Badge>
        ) : null}
        {group.nexusRole ? <Badge variant="default">{NEXUS_ROLE_LABELS[group.nexusRole]}</Badge> : null}
        <Badge variant={group.scope === "public" ? "destructive" : "outline"} className="ml-auto">
          {SCOPE_LABELS[group.scope]}
        </Badge>
      </div>

      <p className="mt-1.5 font-mono text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{group.ports.join(", ")}</span> ·{" "}
        {group.protocols.map((protocol) => PROTOCOL_LABELS[protocol]).join("/")}
        {group.sockets > 1 ? ` · ${group.sockets} sockets` : ""}
      </p>

      <p className="mt-1.5 text-xs break-all text-muted-foreground">{group.detail}</p>
      {group.runtime ? <p className="mt-0.5 text-xs text-muted-foreground">{group.runtime}</p> : null}

      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {group.uid === null ? null : <span>uid {group.uid}</span>}
        {group.pids.length === 0 ? null : <span>{ownerLabel(group)}</span>}
        <span>up {formatUptime(group.uptimeSeconds)}</span>
      </p>
    </article>
  );
}

function ServerRow({ group }: { group: ListenerGroup }) {
  return (
    <tr className={cn("border-t border-border", group.nexusRole ? "bg-primary/5" : undefined)}>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{group.name}</span>
          {group.container ? (
            <Badge variant="secondary" className="gap-1">
              <Container className="size-3" />
              Docker
            </Badge>
          ) : null}
          {group.nexusRole ? <Badge variant="default">{NEXUS_ROLE_LABELS[group.nexusRole]}</Badge> : null}
        </div>
      </td>
      <td className="max-w-[18rem] px-3 py-2">
        <span className="font-mono text-xs break-all text-muted-foreground">{group.detail}</span>
        {group.runtime ? <span className="block text-xs text-muted-foreground">{group.runtime}</span> : null}
      </td>
      <td className="px-3 py-2">
        <span className="font-mono font-medium">{group.ports.join(", ")}</span>
        {group.sockets > 1 ? (
          <span className="block text-[11px] text-muted-foreground">{group.sockets} sockets</span>
        ) : null}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs break-all">{group.addresses.join(" · ")}</span>
          <Badge variant={group.scope === "public" ? "destructive" : "outline"}>{SCOPE_LABELS[group.scope]}</Badge>
        </div>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
        {ownerLabel(group)}
        {group.uid === null ? "" : ` · uid ${group.uid}`}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{formatUptime(group.uptimeSeconds)}</td>
    </tr>
  );
}

function ownerLabel(group: ListenerGroup): string {
  if (group.pids.length === 0) return "owner not identified";
  if (group.pids.length === 1) return `pid ${group.pids[0]}`;
  return `pids ${group.pids.join(", ")}`;
}

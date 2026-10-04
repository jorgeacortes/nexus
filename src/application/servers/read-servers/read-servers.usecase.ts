import type { ContainerIdentity, ContainerInventoryPort } from "@/infrastructure/docker/container-inventory";
import type {
  ContainerAttribution,
  HostListener,
  NexusPorts,
  ServerCollectorPort,
} from "@/infrastructure/servers/server-collector";

/** Which Nexus port a listener is, when it is one of ours. */
export type NexusRole = "board" | "dev";

/**
 * A Docker container as the row shows it: the procfs proof (published mapping,
 * container id) plus whatever the daemon could add (name, compose identity,
 * image). The identity fields are null when the daemon is unreachable, and a
 * name is never guessed — the row falls back to the published mapping.
 */
export interface ServerContainer extends ContainerAttribution {
  name: string | null;
  image: string | null;
  composeProject: string | null;
  composeService: string | null;
  /** `com.docker.compose.project.working_dir` — the folder compose ran in. */
  workingDir: string | null;
}

/** A host listener enriched with Nexus knowledge (JSON-safe for the UI). */
export type ServerListener = Omit<HostListener, "container"> & {
  nexusRole: NexusRole | null;
  container: ServerContainer | null;
};

/** Whether the container-name lookup behind the Docker rows is answering. */
export interface DockerInventoryStatus {
  available: boolean;
  error: string | null;
}

export interface ServersPayload {
  /** False when the host could not be read at all — never confused with an empty list. */
  available: boolean;
  error: string | null;
  collectedAt: string | null;
  /** The Docker daemon proxy, which only enriches rows; its failure is not fatal. */
  docker: DockerInventoryStatus;
  listeners: ServerListener[];
}

export const EMPTY_SERVERS: ServersPayload = {
  available: false,
  error: null,
  collectedAt: null,
  docker: { available: false, error: null },
  listeners: [],
};

const NO_IDENTITY = {
  name: null,
  image: null,
  composeProject: null,
  composeService: null,
  workingDir: null,
} as const;

/**
 * Read-only view of what is listening on the host. The collector is best-effort
 * in the same way Herdr is: a failure reports `available: false` with the reason
 * instead of throwing, so a dead collector can never render as "nothing is
 * listening". Container names come from the Docker API proxy and degrade to the
 * procfs facts alone when that proxy is down. Listener rows are marked when
 * their port is one of Nexus' own.
 */
export class ReadServersUseCase {
  constructor(
    private readonly collector: ServerCollectorPort,
    private readonly nexusPorts: NexusPorts,
    private readonly containers: ContainerInventoryPort,
  ) {}

  async execute(): Promise<ServersPayload> {
    let snapshot: Awaited<ReturnType<ServerCollectorPort["collect"]>>;
    try {
      snapshot = await this.collector.collect();
    } catch (error) {
      return { ...EMPTY_SERVERS, error: reasonOf(error) };
    }

    const { containers, docker } = await this.loadContainers();
    const byIp = new Map<string, ContainerIdentity>();
    const byId = new Map<string, ContainerIdentity>();
    for (const container of containers) {
      byId.set(container.id, container);
      for (const ip of container.ips) byIp.set(ip, container);
    }

    return {
      available: true,
      error: null,
      collectedAt: snapshot.collectedAt,
      docker,
      listeners: snapshot.listeners.map((listener) => this.enrich(listener, byIp, byId)),
    };
  }

  /** A dead Docker proxy costs the names, never the screen. */
  private async loadContainers(): Promise<{ containers: ContainerIdentity[]; docker: DockerInventoryStatus }> {
    try {
      return { containers: await this.containers.collect(), docker: { available: true, error: null } };
    } catch (error) {
      return { containers: [], docker: { available: false, error: reasonOf(error) } };
    }
  }

  /**
   * Joins a listener to its container. `docker-proxy`'s `-container-ip` is the
   * container's network address, which is the reliable key; a container-run
   * process with no published mapping is matched by the id its cgroup names.
   */
  private enrich(
    listener: HostListener,
    byIp: Map<string, ContainerIdentity>,
    byId: Map<string, ContainerIdentity>,
  ): ServerListener {
    const attribution = listener.container;
    const identity = attribution
      ? ((attribution.publish ? byIp.get(attribution.publish.containerIp) : undefined) ??
        (attribution.id ? byId.get(attribution.id) : undefined))
      : undefined;

    return {
      ...listener,
      nexusRole: this.roleOf(listener),
      container: attribution
        ? {
            ...attribution,
            name: identity?.name ?? NO_IDENTITY.name,
            image: identity?.image ?? NO_IDENTITY.image,
            composeProject: identity?.composeProject ?? NO_IDENTITY.composeProject,
            composeService: identity?.composeService ?? NO_IDENTITY.composeService,
            workingDir: identity?.workingDir ?? NO_IDENTITY.workingDir,
          }
        : null,
    };
  }

  private roleOf(listener: HostListener): NexusRole | null {
    if (listener.port === this.nexusPorts.board) return "board";
    if (listener.port === this.nexusPorts.dev) return "dev";
    return null;
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : "Host listeners unavailable";
}

/**
 * Read-only view of the Docker daemon's containers, used to put a name and a
 * compose identity on the Servers screen's published-port rows.
 *
 * Names and labels live in the daemon, not procfs, so this talks to a
 * `docker-socket-proxy` (see `docker-compose.yml`) that holds the real socket
 * with only `CONTAINERS=1` and `POST=0` enabled. Nexus itself never mounts
 * `/var/run/docker.sock`: a read-only bind of a unix socket still gives the
 * holder root-equivalent Docker API access.
 */
export interface ContainerIdentity {
  /** 12-character short container id. */
  id: string;
  /** Container name without Docker's leading slash (`nexus-nexus-1`). */
  name: string | null;
  /** Image as the daemon reports it; resolved through `/containers/<id>/json` when it only reports an id. */
  image: string | null;
  /** `com.docker.compose.project`. */
  composeProject: string | null;
  /** `com.docker.compose.service`. */
  composeService: string | null;
  /** `com.docker.compose.project.working_dir` — the folder compose ran in. */
  workingDir: string | null;
  /** Every network address the container holds, for joining to `docker-proxy`'s `-container-ip`. */
  ips: string[];
}

/**
 * Port: how Nexus asks the Docker daemon what containers exist. Mirrors
 * `ServerCollectorPort`/`HerdrPort`; the adapter is `HttpContainerInventory`.
 */
export interface ContainerInventoryPort {
  collect(): Promise<ContainerIdentity[]>;
}

export interface DockerApiOptions {
  /** Daemon proxy base URL; defaults to `DOCKER_API_URL` or the compose service. */
  baseUrl?: string;
  /** Per-request timeout; a slow daemon must never stall the Servers screen. */
  timeoutMs?: number;
}

const DEFAULT_DOCKER_API_URL = "http://docker-socket-proxy:2375";
const DEFAULT_TIMEOUT_MS = 2000;

/** `DOCKER_API_URL` when set, else the in-network compose service. */
export function resolveDockerApiUrl(env: NodeJS.Dict<string> = process.env): string {
  const url = env.DOCKER_API_URL?.trim();
  return url ? url.replace(/\/+$/, "") : DEFAULT_DOCKER_API_URL;
}

/** The `/containers/json` summary fields this adapter reads. */
interface ContainerSummary {
  Id?: string;
  Names?: string[];
  Image?: string;
  Labels?: Record<string, string>;
  Config?: { Labels?: Record<string, string> };
  NetworkSettings?: { Networks?: Record<string, { IPAddress?: string } | null> };
}

export class HttpContainerInventory implements ContainerInventoryPort {
  /** Image names resolved by inspect, keyed by container id so each is fetched once. */
  private readonly images = new Map<string, string | null>();

  constructor(private readonly options: DockerApiOptions = {}) {}

  async collect(): Promise<ContainerIdentity[]> {
    const summaries = await this.get<ContainerSummary[]>("/containers/json");
    if (!Array.isArray(summaries)) throw new Error("Docker API /containers/json did not return a list");

    const containers: ContainerIdentity[] = [];
    for (const summary of summaries) {
      const id = (summary.Id ?? "").slice(0, 12);
      if (id === "") continue;
      const labels = summary.Labels ?? summary.Config?.Labels ?? {};
      containers.push({
        id,
        name: cleanName(summary.Names),
        image: await this.resolveImage(id, summary.Image),
        composeProject: labels["com.docker.compose.project"] ?? null,
        composeService: labels["com.docker.compose.service"] ?? null,
        workingDir: labels["com.docker.compose.project.working_dir"] ?? null,
        ips: networkIps(summary.NetworkSettings?.Networks),
      });
    }

    // Drop cache entries for containers that are gone, so the map cannot grow forever.
    const live = new Set(containers.map((container) => container.id));
    for (const id of this.images.keys()) {
      if (!live.has(id)) this.images.delete(id);
    }
    return containers;
  }

  /**
   * A compose-built image is reported as a bare `sha256:…`, which says nothing
   * on screen; `/containers/<id>/json` carries the real tag. One inspect per
   * container, remembered until that container disappears.
   */
  private async resolveImage(id: string, reported: string | undefined): Promise<string | null> {
    if (reported && !reported.startsWith("sha256:")) return reported;
    const cached = this.images.get(id);
    if (cached !== undefined) return cached;

    let image: string | null = null;
    try {
      const detail = await this.get<{ Config?: { Image?: string } }>(`/containers/${id}/json`);
      image = detail.Config?.Image ?? null;
    } catch {
      image = null; // A container that vanished mid-collect is not an error.
    }
    this.images.set(id, image);
    return image;
  }

  private async get<T>(path: string): Promise<T> {
    const baseUrl = this.options.baseUrl ?? resolveDockerApiUrl();
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        headers: { accept: "application/json" },
      });
    } catch (error) {
      // "fetch failed" alone says nothing on screen; name the proxy and the reason.
      const reason = error instanceof Error ? error.message : "unknown error";
      throw new Error(`Docker API proxy unreachable at ${baseUrl}: ${reason}`);
    }
    if (!response.ok) throw new Error(`Docker API ${path} failed: HTTP ${response.status}`);
    return (await response.json()) as T;
  }
}

function cleanName(names: string[] | undefined): string | null {
  const name = names?.[0]?.replace(/^\//, "");
  return name ? name : null;
}

function networkIps(networks: Record<string, { IPAddress?: string } | null> | undefined): string[] {
  if (!networks) return [];
  return Object.values(networks)
    .map((network) => network?.IPAddress)
    .filter((ip): ip is string => typeof ip === "string" && ip !== "");
}

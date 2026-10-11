import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import {
  canonicalQueryString,
  EMPTY_PAYLOAD_SHA256,
  sha256FileHex,
  signAwsV4Request,
} from "@/infrastructure/backup/aws-signature-v4";
import { type BackupR2Config, r2Endpoint } from "@/infrastructure/backup/config";

const R2_REGION = "auto";
const R2_SERVICE = "s3";

export type R2Object = {
  key: string;
  lastModified: Date;
  size: number;
};

export class R2Client {
  constructor(
    private readonly config: BackupR2Config,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async putFile(key: string, filePath: string, contentType = "application/gzip"): Promise<void> {
    const fileStat = await stat(filePath);
    const payloadHash = await sha256FileHex(filePath);
    const body = createReadStream(filePath);
    const { status, body: responseBody } = await this.request({
      method: "PUT",
      key,
      payloadHash,
      extraHeaders: {
        "content-type": contentType,
        "content-length": String(fileStat.size),
      },
      body,
    });
    if (status < 200 || status >= 300) {
      throw new Error(`R2 upload failed (${status}): ${responseBody.toString("utf8").trim() || "no body"}`);
    }
  }

  async listObjects(prefix: string): Promise<R2Object[]> {
    const objects: R2Object[] = [];
    let continuationToken: string | undefined;
    do {
      const query: Record<string, string> = {
        "list-type": "2",
        prefix,
      };
      if (continuationToken) query["continuation-token"] = continuationToken;
      const { status, body } = await this.request({
        method: "GET",
        query,
        payloadHash: EMPTY_PAYLOAD_SHA256,
      });
      if (status < 200 || status >= 300) {
        throw new Error(`R2 list failed (${status}): ${body.toString("utf8").trim() || "no body"}`);
      }
      const page = parseListBucketResult(body.toString("utf8"));
      objects.push(...page.objects);
      continuationToken = page.nextContinuationToken;
    } while (continuationToken);
    return objects;
  }

  async deleteObject(key: string): Promise<void> {
    const { status, body } = await this.request({
      method: "DELETE",
      key,
      payloadHash: EMPTY_PAYLOAD_SHA256,
    });
    if (status < 200 || status >= 300) {
      throw new Error(`R2 delete failed (${status}): ${body.toString("utf8").trim() || "no body"}`);
    }
  }

  private request(input: {
    method: string;
    key?: string;
    query?: Record<string, string>;
    extraHeaders?: Record<string, string>;
    payloadHash: string;
    body?: NodeJS.ReadableStream;
  }): Promise<{ status: number; body: Buffer }> {
    const endpoint = new URL(r2Endpoint(this.config));
    const pathname = input.key ? `/${this.config.bucket}/${input.key}` : `/${this.config.bucket}`;
    const query = input.query ?? {};
    const search = canonicalQueryString(query);

    const signed = signAwsV4Request({
      method: input.method,
      pathname,
      query,
      headers: {
        host: endpoint.host,
        ...input.extraHeaders,
      },
      payloadHash: input.payloadHash,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: R2_REGION,
      service: R2_SERVICE,
      timestamp: this.now(),
    });

    return sendHttpRequest({
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port,
      path: pathname + (search ? `?${search}` : ""),
      method: input.method,
      headers: signed.headers,
      body: input.body,
    });
  }
}

export function parseListBucketResult(xml: string): {
  objects: R2Object[];
  nextContinuationToken?: string;
} {
  const objects: R2Object[] = [];
  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const block = match[1] ?? "";
    const key = textContent(block, "Key");
    const lastModifiedRaw = textContent(block, "LastModified");
    const sizeRaw = textContent(block, "Size");
    if (!key || !lastModifiedRaw) continue;
    objects.push({
      key: decodeXml(key),
      lastModified: new Date(lastModifiedRaw),
      size: Number.parseInt(sizeRaw ?? "0", 10) || 0,
    });
  }

  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
  const nextContinuationToken = truncated ? textContent(xml, "NextContinuationToken") : undefined;
  return { objects, nextContinuationToken };
}

function textContent(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match?.[1]?.trim();
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function sendHttpRequest(options: {
  protocol: string;
  hostname: string;
  port: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: NodeJS.ReadableStream;
}): Promise<{ status: number; body: Buffer }> {
  const send = options.protocol === "http:" ? httpRequest : httpsRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      {
        protocol: options.protocol,
        hostname: options.hostname,
        port: options.port || undefined,
        path: options.path,
        method: options.method,
        headers: options.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) });
        });
      },
    );
    req.on("error", reject);
    if (options.body) {
      options.body.pipe(req);
      return;
    }
    req.end();
  });
}

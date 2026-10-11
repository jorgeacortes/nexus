import { createHash, createHmac } from "node:crypto";
import { createReadStream } from "node:fs";

export const EMPTY_PAYLOAD_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function sha256FileHex(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** Percent-encode a string per AWS SigV4 (RFC 3986, with uppercase hex). */
export function awsUriEncode(value: string, encodeSlash: boolean): string {
  let encoded = "";
  for (const char of value) {
    if (isUnreserved(char)) {
      encoded += char;
    } else if (char === "/" && !encodeSlash) {
      encoded += "/";
    } else {
      for (const byte of Buffer.from(char, "utf8")) {
        encoded += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
      }
    }
  }
  return encoded;
}

function isUnreserved(char: string): boolean {
  return /[A-Za-z0-9\-._~]/.test(char);
}

export function formatAmzDate(timestamp: Date): string {
  return timestamp
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export function canonicalQueryString(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${awsUriEncode(key, true)}=${awsUriEncode(params[key] ?? "", true)}`)
    .join("&");
}

export type SignAwsV4Input = {
  method: string;
  pathname: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  timestamp: Date;
};

export type SignedAwsV4Request = {
  headers: Record<string, string>;
  amzDate: string;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
};

export function signAwsV4Request(input: SignAwsV4Input): SignedAwsV4Request {
  const amzDate = formatAmzDate(input.timestamp);
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    headers[name.toLowerCase()] = value.trim().replace(/\s+/g, " ");
  }
  headers["x-amz-date"] = amzDate;
  headers["x-amz-content-sha256"] = input.payloadHash;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    input.method.toUpperCase(),
    awsUriEncode(input.pathname, false),
    canonicalQueryString(input.query),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = deriveSigningKey(input.secretAccessKey, dateStamp, input.region, input.service);
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  const credential = `${input.accessKeyId}/${credentialScope}`;

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${credential}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { headers, amzDate, canonicalRequest, stringToSign, signature };
}

export function deriveSigningKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

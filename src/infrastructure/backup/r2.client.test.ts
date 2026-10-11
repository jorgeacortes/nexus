import { describe, expect, it, type MockInstance, vi } from "vitest";

import { R2Client } from "./r2.client";

type R2RequestSpy = MockInstance<(input: unknown) => Promise<{ status: number; body: Buffer }>>;

function spyRequest(client: R2Client): R2RequestSpy {
  return vi.spyOn(client as never, "request") as unknown as R2RequestSpy;
}

const config = {
  accountId: "acct",
  accessKeyId: "key",
  secretAccessKey: "secret",
  bucket: "backups",
};

function listXml(keys: string[], truncated = false, token?: string): string {
  const contents = keys
    .map(
      (key) =>
        `<Contents><Key>${key}</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified><Size>12</Size></Contents>`,
    )
    .join("");
  const truncation = truncated
    ? `<IsTruncated>true</IsTruncated><NextContinuationToken>${token}</NextContinuationToken>`
    : "";
  return `<ListBucketResult>${contents}${truncation}</ListBucketResult>`;
}

describe("R2Client.listObjects", () => {
  it("pages until the listing is complete", async () => {
    const client = new R2Client(config);
    const request = spyRequest(client)
      .mockResolvedValueOnce({ status: 200, body: Buffer.from(listXml(["a"], true, "tok-2")) })
      .mockResolvedValueOnce({ status: 200, body: Buffer.from(listXml(["b"])) });

    const objects = await client.listObjects("prefix/");
    expect(objects.map((object) => object.key)).toEqual(["a", "b"]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0]).toMatchObject({
      query: expect.objectContaining({ "continuation-token": "tok-2" }),
    });
  });

  it("throws on a failed list", async () => {
    const client = new R2Client(config);
    spyRequest(client).mockResolvedValue({ status: 500, body: Buffer.from("nope") });
    await expect(client.listObjects("prefix/")).rejects.toThrow(/R2 list failed \(500\)/);
  });

  it("uses a fallback error body when the response is empty", async () => {
    const client = new R2Client(config);
    spyRequest(client).mockResolvedValue({ status: 403, body: Buffer.from("   ") });
    await expect(client.listObjects("prefix/")).rejects.toThrow(/no body/);
  });
});

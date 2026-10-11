import { describe, expect, it } from "vitest";

import {
  awsUriEncode,
  canonicalQueryString,
  EMPTY_PAYLOAD_SHA256,
  sha256Hex,
  signAwsV4Request,
} from "@/infrastructure/backup/aws-signature-v4";

describe("awsUriEncode", () => {
  it("leaves unreserved characters and slashes when asked", () => {
    expect(awsUriEncode("/bucket/nexus/file.tar.gz", false)).toBe("/bucket/nexus/file.tar.gz");
  });

  it("encodes slashes when asked", () => {
    expect(awsUriEncode("nexus/", true)).toBe("nexus%2F");
  });
});

describe("canonicalQueryString", () => {
  it("sorts and encodes keys and values", () => {
    expect(canonicalQueryString({ prefix: "nexus/", "list-type": "2" })).toBe("list-type=2&prefix=nexus%2F");
  });
});

describe("signAwsV4Request", () => {
  it("matches the AWS S3 GET Object example signature", () => {
    const signed = signAwsV4Request({
      method: "GET",
      pathname: "/test.txt",
      query: {},
      headers: {
        host: "examplebucket.s3.amazonaws.com",
        range: "bytes=0-9",
      },
      payloadHash: EMPTY_PAYLOAD_SHA256,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      service: "s3",
      timestamp: new Date("2013-05-24T00:00:00.000Z"),
    });

    expect(sha256Hex(signed.canonicalRequest)).toBe("7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972");
    expect(signed.signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });
});

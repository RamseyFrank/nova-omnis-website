import { createHash, createHmac } from "node:crypto";

const emptyHash = createHash("sha256").update("").digest("hex");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();

export function createR2Client({ accountId, bucket, accessKeyId, secretAccessKey,
  jurisdiction = "", fetchImpl = fetch, now = () => new Date() }) {
  if (!/^[a-f0-9]{32}$/i.test(accountId || "") || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket || "")
    || !accessKeyId || !secretAccessKey || !["", "eu", "us", "fedramp"].includes(jurisdiction)) {
    throw new Error("Set R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY before starting the server.");
  }
  const host = `${accountId.toLowerCase()}.${jurisdiction ? `${jurisdiction}.` : ""}r2.cloudflarestorage.com`;

  async function object(method, id) {
    const pathname = `/${bucket}/${id}.stl`;
    const timestamp = now().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = timestamp.slice(0, 8);
    const scope = `${date}/auto/s3/aws4_request`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonical = `${method}\n${pathname}\n\nhost:${host}\nx-amz-content-sha256:${emptyHash}\nx-amz-date:${timestamp}\n\n${signedHeaders}\n${emptyHash}`;
    const stringToSign = `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${hash(canonical)}`;
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), "auto"), "s3"), "aws4_request");
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    return fetchImpl(`https://${host}${pathname}`, {
      method,
      headers: {
        "x-amz-date": timestamp,
        "x-amz-content-sha256": emptyHash,
        Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
    });
  }

  return {
    async exists(id) {
      const response = await object("HEAD", id);
      if (response.status === 404) return false;
      if (!response.ok) throw new Error(`R2 HEAD failed: ${response.status}`);
      return Number(response.headers.get("content-length")) > 0;
    },
    async get(id) {
      const response = await object("GET", id);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`R2 GET failed: ${response.status}`);
      return response;
    },
  };
}

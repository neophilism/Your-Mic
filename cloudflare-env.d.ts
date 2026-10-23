declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    AI?: {run(model: string, input: Record<string, unknown>): Promise<ReadableStream>};
    MC_CLOUDFLARE_ACCOUNT_ID?: string;
    MC_CLOUDFLARE_API_TOKEN?: string;
  }
}

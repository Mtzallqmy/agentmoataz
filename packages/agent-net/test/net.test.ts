import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { buildHttpTools } from "../src/index.js";
import { nodePlatform } from "@agentmoataz/agent-platform/node";

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/hello") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("hello world");
    } else if (req.url === "/big") {
      res.writeHead(200);
      res.end("x".repeat(6 * 1024 * 1024));
    } else if (req.url === "/redirect") {
      res.writeHead(302, { location: "/hello" });
      res.end();
    } else if (req.url === "/loop") {
      res.writeHead(302, { location: "/loop" });
      res.end();
    } else if (req.url === "/file.bin") {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end("FILEDATA");
    } else {
      res.writeHead(404);
      res.end("nope");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const ctx = { runId: "t", workspaceRoot: "" };

describe("http tools", () => {
  // Localhost is enabled only for the local test server. Production default is false.
  const tools = buildHttpTools(nodePlatform, { allowPrivateNetwork: true });
  const get = tools.find((tool) => tool.name === "http_get")!;
  const request = tools.find((tool) => tool.name === "http_request")!;
  const exec = (tool: (typeof tools)[number], input: unknown, context?: Partial<typeof ctx>) =>
    tool.execute(input as never, { ...ctx, ...context });

  it("blocks private-network SSRF by default", async () => {
    const restricted = buildHttpTools(nodePlatform).find((tool) => tool.name === "http_get")!;
    await expect(restricted.execute({ url: `${baseUrl}/hello` } as never, ctx)).rejects.toThrow(/private\/local network destination is blocked/);
  });

  it("rejects non-http schemes and embedded credentials", async () => {
    const restricted = buildHttpTools(nodePlatform).find((tool) => tool.name === "http_get")!;
    await expect(restricted.execute({ url: "ftp://example.com/file" } as never, ctx)).rejects.toThrow(/scheme/);
    await expect(restricted.execute({ url: "https://user:pass@example.com/" } as never, ctx)).rejects.toThrow(/credentials embedded/);
  });

  it("http_get fetches text", async () => {
    const res = await exec(get, { url: `${baseUrl}/hello` }) as { status: number; body: string };
    expect(res.status).toBe(200);
    expect(res.body).toBe("hello world");
  });

  it("http_get caps oversized responses with truncation flag", async () => {
    const res = await exec(get, { url: `${baseUrl}/big` }) as { bytesTruncated: boolean; body: string };
    expect(res.bytesTruncated).toBe(true);
    expect(res.body.length).toBeLessThan(6 * 1024 * 1024);
  }, 20_000);

  it("http_get follows bounded redirects", async () => {
    const res = await exec(get, { url: `${baseUrl}/redirect` }) as { status: number; body: string };
    expect(res.status).toBe(200);
    expect(res.body).toBe("hello world");
  });

  it("http_get rejects redirect loops", async () => {
    await expect(exec(get, { url: `${baseUrl}/loop` })).rejects.toThrow(/too many redirects/);
  });

  it("http_request performs POST", async () => {
    let received = "";
    server.on("request", (req) => {
      if (req.url === "/echo-post") received = req.method ?? "";
    });
    const res = await exec(request, { url: `${baseUrl}/echo-post`, method: "POST", body: "hi" }) as { status: number };
    expect([200, 404]).toContain(res.status);
    expect(received).toBe("POST");
  });

  it("download_file sanitizes unsafe filenames and writes into exports/", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const fsp = await import("node:fs/promises");
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "dl-"));
    const download = tools.find((tool) => tool.name === "download_file")!;
    const res = await exec(download, {
      url: `${baseUrl}/file.bin`,
      fileName: "../../evil<name>.bin",
    }, { workspaceRoot: tmp }) as { path: string; sizeBytes: number };
    expect(res.path.replace(/\\/g, "/")).toBe("exports/evil_name_.bin");
    expect(res.sizeBytes).toBe(8);
    expect(await fsp.readFile(path.join(tmp, "exports", "evil_name_.bin"), "utf8")).toBe("FILEDATA");
    await fsp.rm(tmp, { recursive: true, force: true });
  });
});

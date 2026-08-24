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
      res.end("x".repeat(6 * 1024 * 1024)); // > 5 MB cap
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
  await new Promise<void>((r) => server.listen(0, () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const ctx = { runId: "t", workspaceRoot: "" };

describe("http tools", () => {
  const tools = buildHttpTools(nodePlatform);
  const get = tools.find((t) => t.name === "http_get")!;
  const request = tools.find((t) => t.name === "http_request")!;
  const exec = (t: (typeof tools)[number], input: unknown, c?: Partial<typeof ctx>) =>
    t.execute(input as never, { ...ctx, ...c });

  it("http_get fetches text", async () => {
    const res = await exec(get, { url: `${baseUrl}/hello` }) as {
      status: number;
      body: string;
    };
    expect(res.status).toBe(200);
    expect(res.body).toBe("hello world");
  });

  it("http_get caps oversized responses with truncation flag", async () => {
    const res = await exec(get, { url: `${baseUrl}/big` }) as {
      bytesTruncated: boolean;
      body: string;
    };
    expect(res.bytesTruncated).toBe(true);
    expect(res.body.length).toBeLessThan(6 * 1024 * 1024);
  }, 20_000);

  it("http_get follows bounded redirects", async () => {
    const res = await exec(get, { url: `${baseUrl}/redirect` }) as {
      status: number;
      body: string;
    };
    expect(res.status).toBe(200);
    expect(res.body).toBe("hello world");
  });

  it("http_get rejects redirect loops", async () => {
    await expect(exec(get, { url: `${baseUrl}/loop` })).rejects.toThrow(
      /too many redirects/
    );
  });

  it("http_request performs POST", async () => {
    let received = "";
    server.on("request", (req) => {
      if (req.url === "/echo-post") received = req.method ?? "";
    });
    const res = await exec(request, {
      url: `${baseUrl}/echo-post`,
      method: "POST",
      body: "hi",
    }) as { status: number };
    expect([200, 404]).toContain(res.status); // server returns 404 for unknown path; method observed
    expect(received).toBe("POST");
  });

  it("download_file sanitizes unsafe filenames and writes into exports/", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const fsp = await import("node:fs/promises");
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "dl-"));
    const download = tools.find((t) => t.name === "download_file")!;
    const res = (await exec(download, {
      url: `${baseUrl}/file.bin`,
      fileName: "../../evil<name>.bin",
    }, { workspaceRoot: tmp })) as { path: string; sizeBytes: number };
    expect(res.path.replace(/\\/g, "/")).toBe("exports/evil_name_.bin");
    expect(res.sizeBytes).toBe(8);
    expect(await fsp.readFile(path.join(tmp, "exports", "evil_name_.bin"), "utf8")).toBe("FILEDATA");
  });
});

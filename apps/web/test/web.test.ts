import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/og/[handle]/route";
import { requestedAgo } from "../app/device/Device";
import { parseHandle } from "../lib/api";
import { plainText } from "../lib/text";

const og = (path: string) => {
  const handle = new URL(path, "http://x").pathname.split("/").at(-1)!;
  return GET(new Request(`http://x${path}`), { params: Promise.resolve({ handle }) });
};

afterEach(() => vi.unstubAllGlobals());

describe("parseHandle", () => {
  it("accepts handles with or without @, in any case", () => {
    expect(parseHandle("alice")).toBe("alice");
    expect(parseHandle("%40Alice")).toBe("alice");
    expect(parseHandle("@user-77")).toBe("user-77");
  });

  it("rejects malformed percent-encoding and non-handles instead of throwing", () => {
    expect(parseHandle("%E0%A4%A")).toBeNull();
    expect(parseHandle("bad..handle")).toBeNull();
    expect(parseHandle("-x")).toBeNull();
    expect(parseHandle("a".repeat(40))).toBeNull();
  });
});

describe("OG image route", () => {
  it.each([
    ["/api/og/alice?period=30d&x=1", "/api/og/alice?period=30d"],
    ["/api/og/alice?period=7d&period=30d", "/api/og/alice?period=7d"],
    ["/api/og/alice?period=bogus", "/api/og/alice?period=30d"],
    ["/api/og/alice", "/api/og/alice?period=30d"],
    ["/api/og/%40Alice?period=year", "/api/og/alice?period=year"],
  ])("redirects %s to the one canonical URL", async (path, location) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const res = await og(path);
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(location);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("caches a 404 for a minute at the CDN, for unknown and malformed handles", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    for (const path of ["/api/og/nobody?period=30d", "/api/og/bad..handle?period=30d"]) {
      const res = await og(path);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60");
    }
  });
});

describe("plainText", () => {
  it("drops bidi, zero-width and control characters from names and machine labels", () => {
    expect(plainText("work\u202Etop\u2066 laptop\u0007")).toBe("worktop laptop");
    expect(plainText("line\nbreak\ttab\u2028end")).toBe("line break tab end");
    expect(plainText("\u200B\u202E\u0000")).toBe("");
  });
});

describe("device approval", () => {
  it("says how long ago the request was made", () => {
    const now = Date.parse("2026-11-09T12:00:00Z");
    expect(requestedAgo("2026-11-09T11:59:30Z", now)).toBe("just now");
    expect(requestedAgo("2026-11-09T12:00:30Z", now)).toBe("just now");
    expect(requestedAgo("2026-11-09T11:59:00Z", now)).toBe("1 minute ago");
    expect(requestedAgo("2026-11-09T11:53:10Z", now)).toBe("6 minutes ago");
  });
});

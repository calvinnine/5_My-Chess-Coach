import { describe, expect, it } from "vitest";
import { requesterHashOf } from "@/lib/auth/requester";

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://example.test/api/auth/challenge", { headers });
}

describe("identifying a caller for rate limiting", () => {
  it("does not keep the address itself", () => {
    // An address is personal data, and equality is all the cap needs.
    const address = "203.0.113.9";
    const hash = requesterHashOf(requestWith({ "x-forwarded-for": address }));
    expect(hash).not.toContain(address);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("gives the same caller the same bucket", () => {
    const a = requesterHashOf(requestWith({ "x-forwarded-for": "203.0.113.9" }));
    const b = requesterHashOf(requestWith({ "x-forwarded-for": "203.0.113.9" }));
    expect(a).toBe(b);
  });

  it("separates different callers", () => {
    const a = requesterHashOf(requestWith({ "x-forwarded-for": "203.0.113.9" }));
    const b = requesterHashOf(requestWith({ "x-forwarded-for": "198.51.100.4" }));
    expect(a).not.toBe(b);
  });

  it("reads only the client address from a proxy chain", () => {
    /*
     * x-forwarded-for accumulates proxies left to right. Taking the whole
     * string would give every hop through a different proxy its own bucket.
     */
    const direct = requesterHashOf(requestWith({ "x-forwarded-for": "203.0.113.9" }));
    const proxied = requesterHashOf(
      requestWith({ "x-forwarded-for": "203.0.113.9, 70.41.3.18, 150.172.238.178" }),
    );
    expect(proxied).toBe(direct);
  });

  it("puts callers with no address in one shared bucket", () => {
    // Limited together is the safe direction; unlimited is not.
    const a = requesterHashOf(requestWith({}));
    const b = requesterHashOf(requestWith({ "x-forwarded-for": "  " }));
    expect(a).toBe(b);
  });
});

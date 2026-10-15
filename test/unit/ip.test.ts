import { describe, expect, it } from "vitest";
import { clientIp, ipInCidr } from "../../src/core/ip.js";

describe("ip", () => {
  it("matches IPv4 and IPv6 CIDRs", () => {
    expect(ipInCidr("160.79.106.167", "160.79.104.0/21")).toBe(true);
    expect(ipInCidr("160.79.112.1", "160.79.104.0/21")).toBe(false);
    expect(ipInCidr("::ffff:10.1.2.3", "10.0.0.0/8")).toBe(true);
    expect(ipInCidr("fd00::1", "fc00::/7")).toBe(true);
    expect(ipInCidr("2001:db8::1", "fc00::/7")).toBe(false);
  });
  it("trusts proxy headers only from trusted peers", () => {
    const h = new Headers({ "x-real-ip": "160.79.104.1" });
    expect(clientIp("10.0.0.5", h, ["10.0.0.0/8"])).toBe("160.79.104.1");
    expect(clientIp("203.0.113.9", h, ["10.0.0.0/8"])).toBe("203.0.113.9"); // spoof attempt from the internet
  });
});

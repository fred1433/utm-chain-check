import { describe, expect, it } from "vitest";
import { classifyAddressText, parseIp, formatIp } from "@/lib/net/address";

describe("address classification", () => {
  const blocked = [
    ["127.0.0.1", "loopback"],
    ["127.1.2.3", "loopback"],
    ["10.0.0.7", "private"],
    ["172.16.5.4", "private"],
    ["172.31.255.255", "private"],
    ["192.168.1.1", "private"],
    ["169.254.169.254", "cloud metadata"],
    ["100.64.0.1", "carrier grade NAT"],
    ["0.0.0.0", "this network"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "reserved"],
    ["::1", "IPv6 loopback"],
    ["::", "unspecified"],
    ["fe80::1", "IPv6 link local"],
    ["fc00::1", "IPv6 unique local"],
    ["fd12:3456::1", "IPv6 unique local"],
    ["ff02::1", "IPv6 multicast"],
    ["::ffff:127.0.0.1", "IPv4 mapped loopback"],
    ["::ffff:169.254.169.254", "IPv4 mapped metadata"],
    ["64:ff9b::127.0.0.1", "IPv4 translated loopback"],
    ["2002:7f00:1::", "6to4 wrapping loopback"],
    ["2001:db8::1", "documentation"],
  ] as const;

  for (const [address, why] of blocked) {
    it(`refuses ${address} (${why})`, () => {
      const verdict = classifyAddressText(address);
      expect(verdict.allowed).toBe(false);
    });
  }

  const allowed = ["93.184.216.34", "1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "2a00:1450:4001:80e::200e"];
  for (const address of allowed) {
    it(`allows the public address ${address}`, () => {
      expect(classifyAddressText(address).allowed).toBe(true);
    });
  }

  it("refuses anything it cannot parse rather than letting it through", () => {
    for (const junk of ["", "not-an-address", "999.1.1.1", "1.2.3", "12345::::1"]) {
      expect(classifyAddressText(junk).allowed).toBe(false);
    }
  });

  it("reads the compressed, zoned and bracketed spellings of one address", () => {
    expect(formatIp(parseIp("[2001:db8::1]")!)).toBe("2001:db8:0:0:0:0:0:1");
    expect(parseIp("fe80::1%en0")).not.toBeNull();
  });
});

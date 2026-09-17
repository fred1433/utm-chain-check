/**
 * Address classification.
 *
 * The checker connects to an address only after that exact address has been
 * classified as public. Parsing is done on bytes, not on the text form, so the
 * decimal, octal and IPv4 mapped spellings of a private address all land on the
 * same verdict.
 */

export type IpAddress = { family: 4 | 6; bytes: Uint8Array };

export function parseIp(input: string): IpAddress | null {
  const value = input.trim();
  if (value.includes(":")) return parseIpv6(value);
  return parseIpv4(value);
}

function parseIpv4(value: string): IpAddress | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) {
    const part = parts[i];
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes[i] = n;
  }
  return { family: 4, bytes };
}

function parseIpv6(value: string): IpAddress | null {
  let text = value;
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);

  let embeddedV4: Uint8Array | null = null;
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    embeddedV4 = v4.bytes;
    text = text.slice(0, lastColon + 1) + "0:0";
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tailGroups = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : null;

  const groups: number[] = [];
  const toGroup = (g: string): number | null => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    return Number.parseInt(g, 16);
  };

  for (const g of head) {
    const n = toGroup(g);
    if (n === null) return null;
    groups.push(n);
  }
  if (tailGroups === null) {
    if (groups.length !== 8) return null;
  } else {
    const tailValues: number[] = [];
    for (const g of tailGroups) {
      const n = toGroup(g);
      if (n === null) return null;
      tailValues.push(n);
    }
    const missing = 8 - groups.length - tailValues.length;
    if (missing < 0) return null;
    for (let i = 0; i < missing; i += 1) groups.push(0);
    groups.push(...tailValues);
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    bytes[i * 2] = (groups[i] >> 8) & 0xff;
    bytes[i * 2 + 1] = groups[i] & 0xff;
  }
  if (embeddedV4) bytes.set(embeddedV4, 12);
  return { family: 6, bytes };
}

export function formatIp(ip: IpAddress): string {
  if (ip.family === 4) return Array.from(ip.bytes).join(".");
  const groups: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    groups.push(((ip.bytes[i * 2] << 8) | ip.bytes[i * 2 + 1]).toString(16));
  }
  return groups.join(":");
}

type Range4 = { prefix: [number, number, number, number]; bits: number; label: string };

const BLOCKED_V4: Range4[] = [
  { prefix: [0, 0, 0, 0], bits: 8, label: "a this network" },
  { prefix: [10, 0, 0, 0], bits: 8, label: "a private" },
  { prefix: [100, 64, 0, 0], bits: 10, label: "a carrier grade NAT" },
  { prefix: [127, 0, 0, 0], bits: 8, label: "a loopback" },
  { prefix: [169, 254, 0, 0], bits: 16, label: "a link local or cloud metadata" },
  { prefix: [172, 16, 0, 0], bits: 12, label: "a private" },
  { prefix: [192, 0, 0, 0], bits: 24, label: "a protocol assignments" },
  { prefix: [192, 0, 2, 0], bits: 24, label: "a documentation" },
  { prefix: [192, 168, 0, 0], bits: 16, label: "a private" },
  { prefix: [198, 18, 0, 0], bits: 15, label: "a benchmarking" },
  { prefix: [198, 51, 100, 0], bits: 24, label: "a documentation" },
  { prefix: [203, 0, 113, 0], bits: 24, label: "a documentation" },
  { prefix: [224, 0, 0, 0], bits: 4, label: "a multicast" },
  { prefix: [240, 0, 0, 0], bits: 4, label: "a reserved" },
];

function inRange4(bytes: Uint8Array, range: Range4): boolean {
  let bits = range.bits;
  for (let i = 0; i < 4; i += 1) {
    if (bits <= 0) return true;
    const take = Math.min(8, bits);
    const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff;
    if ((bytes[i] & mask) !== (range.prefix[i] & mask)) return false;
    bits -= take;
  }
  return true;
}

export type AddressVerdict = { allowed: true } | { allowed: false; reason: string };

export function classifyAddress(ip: IpAddress): AddressVerdict {
  if (ip.family === 4) return classifyV4(ip.bytes);

  const b = ip.bytes;
  const isZeroPrefix = (n: number) => b.slice(0, n).every((x) => x === 0);

  // IPv4 mapped (::ffff:0:0/96) and IPv4 translated (64:ff9b::/96): judge the embedded address.
  if (isZeroPrefix(10) && b[10] === 0xff && b[11] === 0xff) {
    return classifyV4(b.slice(12));
  }
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) {
    return classifyV4(b.slice(12));
  }
  // 6to4 (2002::/16) carries an IPv4 address in the next 32 bits.
  if (b[0] === 0x20 && b[1] === 0x02) {
    const inner = classifyV4(b.slice(2, 6));
    if (!inner.allowed) return { allowed: false, reason: `a 6to4 address wrapping ${inner.reason}` };
  }

  if (b.every((x) => x === 0)) return { allowed: false, reason: "the unspecified address" };
  if (isZeroPrefix(15) && b[15] === 1) return { allowed: false, reason: "an IPv6 loopback address" };
  if ((b[0] & 0xfe) === 0xfc) return { allowed: false, reason: "an IPv6 unique local address" };
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return { allowed: false, reason: "an IPv6 link local address" };
  if (b[0] === 0xff) return { allowed: false, reason: "an IPv6 multicast address" };
  if (b[0] === 0x01 && b[1] === 0x00 && b.slice(2, 8).every((x) => x === 0)) {
    return { allowed: false, reason: "an IPv6 discard prefix address" };
  }
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) {
    return { allowed: false, reason: "an IPv6 documentation address" };
  }
  return { allowed: true };
}

function classifyV4(bytes: Uint8Array): AddressVerdict {
  for (const range of BLOCKED_V4) {
    if (inRange4(bytes, range)) {
      return { allowed: false, reason: `${range.label} address` };
    }
  }
  return { allowed: true };
}

export function classifyAddressText(text: string): AddressVerdict {
  const ip = parseIp(text);
  if (!ip) return { allowed: false, reason: "an address that could not be read" };
  return classifyAddress(ip);
}

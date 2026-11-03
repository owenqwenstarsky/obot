/**
 * SSRF protection for server-side fetches. Pure apart from the injected DNS resolver, so it
 * is unit-testable. Every hostname is resolved by us and *all* its addresses must be public
 * unicast; the socket then connects to exactly the validated address (no second lookup, so
 * DNS rebinding can't swap in a private address between check and connect).
 */
import ipaddr from "ipaddr.js";
import { isIP } from "node:net";

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

/** True only for globally routable unicast addresses (IPv4 or IPv6, incl. IPv4-mapped). */
export function isPublicAddress(address: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(address.replace(/^\[|\]$/g, "").split("%")[0]);
  } catch {
    return false;
  }
  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) addr = v6.toIPv4Address();
  }
  if (addr.kind() === "ipv4") {
    const v4 = addr as ipaddr.IPv4;
    if (v4.range() !== "unicast") return false;
    const [a, b] = v4.octets;
    // Ranges ipaddr.js still calls "unicast" but that are not publicly routable.
    if (a === 0) return false; // "this" network
    if (a === 192 && b === 0 && v4.octets[2] === 0) return false; // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    return true;
  }
  const v6 = addr as ipaddr.IPv6;
  // NAT64 / 6to4 / Teredo embed IPv4 addresses that may be private; refuse them outright.
  return v6.range() === "unicast";
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Parse and validate a URL before fetching. Literal IPs are checked here (no DNS lookup happens for them). */
export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new BlockedUrlError("That isn't a valid URL.");
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) throw new BlockedUrlError("Only http and https URLs can be fetched.");
  if (url.username || url.password) throw new BlockedUrlError("URLs with embedded credentials can't be fetched.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new BlockedUrlError("That URL has no host.");
  if (isIP(host) && !isPublicAddress(host)) {
    throw new BlockedUrlError("Private, local, and internal network addresses can't be fetched.");
  }
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) {
    throw new BlockedUrlError("Private, local, and internal network addresses can't be fetched.");
  }
  url.hash = "";
  return url;
}

export type ResolvedAddress = { address: string; family: number };
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | ResolvedAddress[], family?: number) => void;

/**
 * A `lookup` function for `net.connect` / `tls.connect` that refuses non-public addresses.
 * Node calls it with `{ all: true }` when happy-eyeballs is on, so both shapes are handled.
 */
export function createPinnedLookup(resolve: Resolver) {
  return (hostname: string, options: { all?: boolean } | number | undefined, callback: LookupCallback) => {
    const all = typeof options === "object" && options != null && options.all === true;
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0) {
          callback(Object.assign(new Error(`Could not resolve ${hostname}`), { code: "ENOTFOUND" }), "", 0);
          return;
        }
        if (addresses.some((a) => !isPublicAddress(a.address))) {
          callback(
            Object.assign(new BlockedUrlError(`${hostname} resolves to a private or internal address.`), { code: "EBLOCKED" }),
            "",
            0,
          );
          return;
        }
        if (all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
      (err: NodeJS.ErrnoException) => callback(err, "", 0),
    );
  };
}

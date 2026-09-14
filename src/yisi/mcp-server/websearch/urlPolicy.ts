/**
 * URL policy for the bundled web tools.
 *
 * Every rule here comes from the behaviour-level specification already recorded in
 * this repository (docs/14, the fetch-tool constraints) — the design was studied
 * from public documentation, and this is an independent implementation of it.
 * No reference implementation was read or copied (docs/04 clean-room rule).
 *
 * Why a policy module rather than checks scattered through the fetcher: these
 * rules are the difference between "the model can read a page" and "the model can
 * make this machine probe its own network". They belong somewhere they can be
 * unit-tested exhaustively and reasoned about in one place.
 *
 * The rules, and what each one is for:
 *
 *  - **http/https only** — a fetch tool that accepts `file:` or `ftp:` is a file
 *    reader with extra steps.
 *  - **no embedded credentials** — `https://user:pass@host/` smuggles secrets into
 *    a URL that ends up in logs and in the session transcript.
 *  - **length bound** — a bounded tool argument stays a bounded argument.
 *  - **public addresses only** — a page the model reads must not be able to make
 *    the machine talk to `127.0.0.1`, `10.x`, the cloud metadata endpoint
 *    `169.254.169.254`, or an IPv6 link-local address. This is the SSRF boundary.
 *  - **resolve once, then pin** — if the hostname resolved to a public address when
 *    it was checked, the request must go to *that* address; otherwise a second DNS
 *    answer can point somewhere else after the check (DNS rebinding).
 *  - **same-origin redirects only** — otherwise an allowed host redirects the
 *    request to an address that was never checked.
 */

export interface FetchLimits {
  maxUrlCharacters: number;
  maxResponseBytes: number;
  maxBodyCharacters: number;
  timeoutMs: number;
  maxRedirects: number;
}

export const DEFAULT_FETCH_LIMITS: FetchLimits = {
  maxUrlCharacters: 2_048,
  maxResponseBytes: 5 * 1024 * 1024,
  maxBodyCharacters: 100_000,
  timeoutMs: 30_000,
  maxRedirects: 5
};

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Validates the URL itself, before any network work happens. */
export function checkUrl(raw: string, limits: FetchLimits = DEFAULT_FETCH_LIMITS): UrlCheck {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'A URL is required.' };
  const text = raw.trim();
  if (text.length > limits.maxUrlCharacters) {
    return { ok: false, reason: `The URL is longer than ${limits.maxUrlCharacters} characters.` };
  }
  if (/[\s\u0000-\u001f]/.test(text)) return { ok: false, reason: 'The URL contains whitespace or control characters.' };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: 'The URL is not a valid absolute URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `Only http and https are supported, not ${url.protocol}` };
  }
  if (url.username || url.password) return { ok: false, reason: 'Credentials in a URL are not allowed.' };
  if (!url.hostname) return { ok: false, reason: 'The URL has no host.' };
  return { ok: true, url };
}

/**
 * Whether a resolved address may be connected to.
 *
 * Denies loopback, private, link-local, carrier-grade NAT, unspecified, multicast
 * and reserved ranges, for IPv4 and IPv6, plus IPv4-mapped IPv6 forms and the
 * IPv6 transition prefixes that can carry an IPv4 address. Anything not a public
 * unicast address is refused — the safe default is to refuse, so an address family
 * this function does not recognise is a denial, not a pass.
 */
export function isPublicAddress(address: string): boolean {
  const value = address.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!value) return false;
  if (value.includes(':')) return isPublicIpv6(value);
  return isPublicIpv4(value);
}

function isPublicIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map(part => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return false;            // this-network, private, loopback
  if (a === 169 && b === 254) return false;                       // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;              // private
  if (a === 192 && b === 168) return false;                       // private
  if (a === 192 && b === 0) return false;                         // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return false;             // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return false;          // benchmarking
  if (a >= 224) return false;                                      // multicast and reserved
  return true;
}

function isPublicIpv6(value: string): boolean {
  const groups = expandIpv6(value);
  if (!groups) return false;
  const [first] = groups;
  if (first === 0x0000) {
    // ::/128 unspecified and ::1/128 loopback.
    if (groups.every(group => group === 0)) return false;
    if (groups.slice(0, 7).every(group => group === 0) && groups[7] === 1) return false;
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible addresses carry an IPv4
    // address; judge that address instead of trusting the wrapper.
    if (groups.slice(0, 5).every(group => group === 0) && (groups[5] === 0xffff || groups[5] === 0)) {
      const embedded = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
      return isPublicIpv4(embedded);
    }
    return false;
  }
  if ((first & 0xfe00) === 0xfc00) return false;                   // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false;                   // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return false;                   // ff00::/8 multicast
  if (first === 0x2001 && groups[1] === 0x0db8) return false;      // 2001:db8::/32 documentation
  return true;
}

/** Expands an IPv6 literal to eight 16-bit groups, or undefined when malformed. */
function expandIpv6(value: string): number[] | undefined {
  // A dotted-quad tail (::ffff:8.8.8.8) is legal IPv6 and carries an IPv4 address
  // in its last two groups, so it has to be converted before the hex parse.
  const dotted = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(value);
  const normalized = dotted ? `${dotted[1]}${dottedQuadToGroups(dotted[2])}` : value;
  if (dotted && normalized === value) return undefined;
  const [head, tail, ...rest] = normalized.split('::');
  if (rest.length) return undefined;
  const left = head ? head.split(':') : [];
  const right = tail !== undefined && tail ? tail.split(':') : [];
  const total = left.length + right.length;
  if (normalized.includes('::') ? total > 7 : total !== 8) return undefined;
  const groups = [
    ...left.map(parseGroup),
    ...Array.from({ length: 8 - total }, () => 0),
    ...right.map(parseGroup)
  ];
  return groups.some(group => group === undefined) ? undefined : (groups as number[]);
}

function dottedQuadToGroups(quad: string): string {
  const octets = quad.split('.').map(part => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return '';
  const high = ((octets[0] << 8) | octets[1]).toString(16);
  const low = ((octets[2] << 8) | octets[3]).toString(16);
  return `${high}:${low}`;
}

function parseGroup(part: string): number | undefined {
  if (!/^[0-9a-f]{1,4}$/.test(part)) return undefined;
  return Number.parseInt(part, 16);
}

/** Whether a redirect target stays on the origin that was checked and approved. */
export function isSameOrigin(from: URL, to: URL): boolean {
  return from.protocol === to.protocol && from.hostname.toLowerCase() === to.hostname.toLowerCase()
    && effectivePort(from) === effectivePort(to);
}

function effectivePort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === 'https:' ? '443' : '80';
}

/** Collapses HTML to readable text: scripts and styles dropped, tags stripped. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    // A collapsed tag leaves a stray leading space on the next line; strip it so
    // the text reads as lines rather than as one indented blob.
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Bounds fetched text, keeping both ends and marking what was dropped. */
export function boundBody(text: string, maxCharacters: number = DEFAULT_FETCH_LIMITS.maxBodyCharacters): string {
  if (text.length <= maxCharacters) return text;
  const head = Math.floor(maxCharacters * 0.75);
  const tail = maxCharacters - head;
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n\n[${omitted} characters omitted]\n\n${text.slice(-tail)}`;
}

'use strict';

// shucky SSRF guard — validate a remote URL before any fetch.
// shucky is a security tool that now reaches out to the network; this is the gate that
// keeps an attacker-controlled "source" from pointing the fetcher at internal services
// or the cloud-metadata endpoint. NO sockets here — pure validation + DNS lookup, so it
// is unit-testable with an injected resolver. The redirect re-guard lives in fetch.js,
// which calls assertSafeHttpsUrl() again on every hop.

const dns = require('dns');
const net = require('net');

// ---- IPv4 ----------------------------------------------------------------

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (let i = 0; i < 4; i++) {
    const p = Number(parts[i]);
    if (!Number.isInteger(p) || p < 0 || p > 255) return null;
    n = (n << 8) + p;
  }
  return n >>> 0;
}

function inCidr4(intIp, cidr) {
  const slash = cidr.split('/');
  const baseInt = ipv4ToInt(slash[0]);
  const bits = Number(slash[1]);
  if (baseInt === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (intIp & mask) === (baseInt & mask);
}

// Private, loopback, link-local (incl. 169.254.169.254 metadata), CGNAT, reserved, multicast.
const BLOCKED_V4 = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
  '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.168.0.0/16',
  '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4'
];

function isBlockedIPv4(ip) {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparseable → block (fail closed)
  for (const c of BLOCKED_V4) if (inCidr4(n, c)) return true;
  return false;
}

// ---- IPv6 ----------------------------------------------------------------

function isBlockedIPv6(ip) {
  let s = ip.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  // IPv4-mapped / -embedded (::ffff:1.2.3.4, ::1.2.3.4) → validate the v4 part.
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4 && (s.indexOf('::ffff:') === 0 || s.indexOf('::') === 0)) return isBlockedIPv4(v4[1]);
  if (s === '::1' || s === '::') return true;            // loopback / unspecified
  if (/^fe[89ab]/.test(s)) return true;                  // fe80::/10 link-local
  if (s[0] === 'f' && (s[1] === 'c' || s[1] === 'd')) return true; // fc00::/7 unique-local
  if (s[0] === 'f' && s[1] === 'f') return true;         // ff00::/8 multicast
  return false;
}

function isBlockedIp(ip) {
  return ip.indexOf(':') !== -1 ? isBlockedIPv6(ip) : isBlockedIPv4(ip);
}

// ---- hostnames -----------------------------------------------------------

const BLOCKED_HOSTNAMES = [
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'metadata' // common k8s/cloud alias
];

function isBlockedHostname(host) {
  host = host.toLowerCase();
  if (BLOCKED_HOSTNAMES.indexOf(host) !== -1) return true;
  if (/\.(internal|local|localhost|home\.arpa)$/.test(host)) return true;
  return false;
}

// ---- public API ----------------------------------------------------------

function resolveAll(host, resolver) {
  const lookup = resolver || dns.lookup;
  return new Promise(function (res, rej) {
    lookup(host, { all: true }, function (err, addrs) {
      if (err) return rej(err);
      if (!Array.isArray(addrs)) addrs = addrs ? [{ address: addrs }] : [];
      res(addrs.map(function (a) { return typeof a === 'string' ? a : a.address; }));
    });
  });
}

// Throws if `input` is unsafe to fetch; resolves to the parsed URL otherwise.
// opts: { allowHttp?:bool, resolver?:fn } — resolver is injectable for tests.
async function assertSafeHttpsUrl(input, opts) {
  opts = opts || {};
  let u;
  try { u = new URL(input); }
  catch (e) { throw new Error('invalid URL: ' + input); }

  if (u.protocol !== 'https:' && !(opts.allowHttp && u.protocol === 'http:')) {
    throw new Error('refusing non-https URL: ' + input);
  }

  const bareHost = u.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (!bareHost) throw new Error('URL has no host: ' + input);
  if (isBlockedHostname(bareHost)) throw new Error('refusing internal host: ' + u.hostname);

  // Literal IP → check directly (no DNS).
  if (net.isIP(bareHost)) {
    if (isBlockedIp(bareHost)) throw new Error('refusing internal/reserved IP: ' + u.hostname);
    return u;
  }

  // Hostname → resolve and reject if ANY address is internal (DNS-rebind defense).
  let addrs;
  try { addrs = await resolveAll(bareHost, opts.resolver); }
  catch (e) { throw new Error('DNS resolution failed for ' + u.hostname + ': ' + e.message); }
  if (!addrs.length) throw new Error('no DNS records for ' + u.hostname);
  for (const ip of addrs) {
    if (isBlockedIp(ip)) {
      throw new Error('host ' + u.hostname + ' resolves to internal IP ' + ip + ' — SSRF blocked');
    }
  }
  return u;
}

module.exports = {
  assertSafeHttpsUrl,
  isBlockedIp,
  isBlockedIPv4,
  isBlockedIPv6,
  isBlockedHostname
};

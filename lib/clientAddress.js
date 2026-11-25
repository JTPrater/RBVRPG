// The address a request or a game connection came from: the player's own.
//
// The site runs on Render, whose web services sit behind Cloudflare: a request
// comes player -> Cloudflare -> Render's proxy -> this server. Cloudflare adds
// the player's address to the end of the X-Forwarded-For list, and Render's
// proxy adds the Cloudflare address it was reached from, so the list ends
// "..., <player>, <Cloudflare>" (and the connection itself is Render's proxy).
// Read from the right, past those ways in (the connection itself, then
// Cloudflare's and private addresses), the first address is the player's.
// Anything further left was written by the player, and is not believed.
//
// Until 2026-11-25 the last address of the list was taken for the player's:
// it was Cloudflare's. Strangers who came in through the same Cloudflare
// machine were linked as "the same network" on the moderation panel, and
// shared one count in the rate limits (twenty wrong passwords from one player
// locked out everyone else on that machine).

const net = require("net");

// Cloudflare's addresses, as it publishes them (https://www.cloudflare.com/ips/)
const CLOUDFLARE = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];
// Addresses that are never a player's own on the internet: private networks
// (a host's inner hops among them), the carriers' shared space, loopback,
// link-local, "this network", and IPv6's unique-local
const NOT_PUBLIC = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "::/127",
  "fc00::/7",
  "fe80::/10",
];

function blockList(ranges) {
  const list = new net.BlockList();
  for (const range of ranges) {
    const [address, bits] = range.split("/");
    list.addSubnet(address, Number(bits), net.isIPv6(address) ? "ipv6" : "ipv4");
  }
  return list;
}
const cloudflare = blockList(CLOUDFLARE);
const notPublic = blockList(NOT_PUBLIC);

// An address as written (a zone "%eth0" dropped, an IPv4 one written the
// IPv6 way, "::ffff:1.2.3.4", read as IPv4): { address, family }, or null
// if it is not an address at all
function parse(addr) {
  if (typeof addr !== "string") return null;
  let a = addr.trim().replace(/%.*$/, "");
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(a);
  if (mapped) a = mapped[1];
  const version = net.isIP(a);
  if (!version) return null;
  return { address: a.toLowerCase(), family: version === 4 ? "ipv4" : "ipv6" };
}

const isCloudflare = (addr) => {
  const p = parse(addr);
  return !!p && cloudflare.check(p.address, p.family);
};
const isNotPublic = (addr) => {
  const p = parse(addr);
  return !!p && notPublic.check(p.address, p.family);
};

// Can this be a player's own address? (not a way in, nor a private one)
function isPlayerAddress(addr) {
  const p = parse(addr);
  return !!p && !cloudflare.check(p.address, p.family) && !notPublic.check(p.address, p.family);
}

// Is this hop a way in that passes the player's address on? i: its place
// counted from this server, 0 being the connection itself (Render's proxy; on
// a PC, whatever connects). server.js gives Express this as "trust proxy", so
// req.ip is the player's address too.
function isProxyHop(addr, i) {
  return i === 0 || isCloudflare(addr) || isNotPublic(addr);
}

// The player's address, from a connection's own address and its headers.
// Read as Express reads req.ip with "trust proxy" isProxyHop: from the right,
// the first address that is not a way in (or the furthest, if all are).
function clientAddress(headers, peer) {
  const forwarded = String((headers && headers["x-forwarded-for"]) || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .reverse();
  const hops = [peer, ...forwarded];
  for (let i = 0; i < hops.length - 1; i++) {
    if (!isProxyHop(hops[i], i)) return hops[i];
  }
  return hops[hops.length - 1];
}

module.exports = { clientAddress, isProxyHop, isPlayerAddress, isCloudflare, parse };

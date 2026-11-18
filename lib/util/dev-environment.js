// Runtime detection of the local dev server as the dashboard's host. IS_DEV_ENVIRONMENT (constants/settings)
// only knows what esbuild defined at build time, so a production-built bundle opened from `npm run dev` reads
// as production. This module answers the complementary question — "did this page come from the dev server?" —
// from window.location, which is available however the bundle was built.

// The dev server proxies the dashboard on 3030 and esbuild's own servedir answers on 3031 (dev/dev-server.js). They
// default off 3000, which Rails and its port-forwards commonly hold.
const DEV_SERVER_PORTS = ["3030", "3031"];
const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "::1", "[::1]"];
// A private (RFC 1918) address, which is how the dev dashboard is reached from another device on the network, or when
// another process holds the dev port on localhost and the machine's LAN IP has to stand in for it.
const PRIVATE_NETWORK_HOSTNAME = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)\d/;

// ----------------------------------------------------------------------------------------------
// @desc Whether this page is being served by the local dev server, judged from its own URL. True for any
//   loopback hostname, and for a private LAN address on a dev-server port (reached from another device, or when
//   another process holds the dev port on localhost). The production embed runs from a data: URL whose location carries
//   no hostname or port, so it never matches.
// @returns {boolean}
export function servedFromDevServer() {
  const pageLocation = typeof window === "undefined" ? null : window.location;
  if (!pageLocation) return false;
  const hostname = String(pageLocation.hostname || "").toLowerCase();
  if (!hostname) return false;
  if (LOOPBACK_HOSTNAMES.includes(hostname)) return true;
  const port = String(pageLocation.port || "");
  return DEV_SERVER_PORTS.includes(port) && PRIVATE_NETWORK_HOSTNAME.test(hostname);
}

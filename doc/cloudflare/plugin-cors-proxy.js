// --------------------------------------------------------------------------
// CORS proxy Worker for plugins that call APIs which refuse browser origins. Deployed at
// aged-sunset-proxy.amplenote.workers.dev. This copy extends the Tinify-only Worker kept in the
// ample-agent-pro repo (docs/cloudflare/workers/plugin-cors-proxy.js) with TypeSafe's Jev endpoint, and
// replaces it when deployed: the Tinify route behaves exactly as before.
//
// A plugin calls this Worker with the real target in an `apiurl` query param; the Worker fetches it server
// side and echoes the response back with an Access-Control-Allow-Origin header. Only the hosts listed in
// ALLOWED_TARGETS are forwarded, and cookies are always stripped so this can't be abused as a credentialed
// first-party request.
//
// - api.tinify.com: the Tinify key is injected here (HTTP Basic auth with the literal username "api"), so
//   the plugin never holds it.
// - api.typesafe.ai: the caller's own `Authorization: Bearer <TypeSafe key>` is passed through untouched;
//   nothing is injected, so the Worker spends no quota of its own. The browser's Origin and Referer are
//   removed, because TypeSafe rejects requests that carry a browser origin it does not allow.
//
// SECURITY: hardcoding the Tinify key means anyone who can read this file can use your Tinify quota. Prefer
// a Cloudflare secret instead: run
//   wrangler secret put TINIFY_API_KEY
// and read it from `env.TINIFY_API_KEY`.
//
// Based on https://developers.cloudflare.com/workers/examples/cors-header-proxy/
// --------------------------------------------------------------------------
const TINIFY_API_KEY = "REPLACE_WITH_YOUR_TINIFY_API_KEY";

const ALLOWED_TARGETS = {
  "api.tinify.com": { prepareHeaders: headers => headers.set("Authorization", `Basic ${ btoa(`api:${ TINIFY_API_KEY }`) }`) },
  "api.typesafe.ai": { prepareHeaders: headers => { headers.delete("Origin"); headers.delete("Referer"); } },
};

export default {
  async fetch(request /*, env */) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), request);
    }

    const apiUrl = url.searchParams.get("apiurl");
    const target = apiUrl ? ALLOWED_TARGETS[targetHostname(apiUrl)] : null;
    if (!target) {
      return new Response(null, { status: 400, statusText: "Bad Request" });
    }

    // Rewrite to the target, dropping cookies so we can't be used first-party.
    const proxied = new Request(apiUrl, request);
    proxied.headers.delete("cookie");
    target.prepareHeaders(proxied.headers);

    const response = await fetch(proxied);
    return withCors(new Response(response.body, response), request);
  },
};

// --------------------------------------------------------------------------
// @desc Read a target URL's hostname, treating an unparseable URL as no host at all.
// @param {string} apiUrl - The `apiurl` query param.
// @returns {string} Hostname, or "" when the URL cannot be parsed.
function targetHostname(apiUrl) {
  try {
    return new URL(apiUrl).hostname;
  } catch (_error) {
    return "";
  }
}

// --------------------------------------------------------------------------
// @desc Add the headers a browser needs to read a cross-origin response.
// @param {Response} response - Response to return to the browser.
// @param {Request} request - The browser's request, whose Origin and requested headers are echoed back.
// @returns {Response} The same response, with CORS headers set.
function withCors(response, request) {
  response.headers.set("Access-Control-Allow-Origin", request.headers.get("Origin") || "*");
  response.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", request.headers.get("Access-Control-Request-Headers") || "Authorization,Content-Type");
  response.headers.append("Vary", "Origin");
  return response;
}

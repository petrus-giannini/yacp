/**
 * main.ts — CORS Proxy (Deno Deploy)
 *
 * Usato da: Flight Tracker, GeoViewer (e progetti futuri)
 *
 * Endpoint: GET /proxy?url=<encoded_target_url>
 *
 * ── Sicurezza ────────────────────────────────────────────────
 *
 * La whitelist dei domini autorizzati è gestita tramite la variabile
 * d'ambiente ALLOWED_DOMAINS (configurabile nel dashboard Deno Deploy,
 * senza modificare il codice):
 *
 *   ALLOWED_DOMAINS = opensky-network.org,wms.example.com,geoserver.myorg.it
 *
 * Sono sempre bloccati:
 *   - URL con schema diverso da https://
 *   - Indirizzi privati / loopback (127.x, 10.x, 192.168.x, ::1, …)
 *   - Domini non presenti nella whitelist → HTTP 403
 *
 * ── Aggiungere un nuovo dominio ──────────────────────────────
 *
 *   1. Aprire il progetto su https://dash.deno.com
 *   2. Settings → Environment Variables → ALLOWED_DOMAINS
 *   3. Aggiungere il nuovo hostname separato da virgola
 *   4. Salvare — il proxy si aggiorna in pochi secondi, senza redeploy
 */

// ── Whitelist ─────────────────────────────────────────────────

/**
 * Domini sempre autorizzati (hardcoded per retrocompatibilità
 * con il Flight Tracker, indipendentemente dalla env var).
 */
const HARDCODED: string[] = [
 // "opensky-network.org",   // Flight Tracker
];

/**
 * Legge ALLOWED_DOMAINS dalla variabile d'ambiente.
 * Formato atteso: lista di hostname separati da virgola.
 * Esempio: "wms.cartografia.it,geoserver.comune.roma.it"
 */
function loadAllowedDomains(): Set<string> {
  const env = Deno.env.get("ALLOWED_DOMAINS") ?? "";
  const fromEnv = env
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  return new Set([...HARDCODED, ...fromEnv]);
}

// Caricata una volta all'avvio del worker (rimane stabile per tutta la vita
// dell'istanza; Deno Deploy riavvia automaticamente dopo ogni modifica alla env).
const ALLOWED_DOMAINS = loadAllowedDomains();

// ── Blocklist indirizzi privati ───────────────────────────────
const PRIVATE_HOST =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|0\.0\.0\.0)/i;

// ── Header da non ritrasmettere al client ─────────────────────
const STRIP_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "strict-transport-security",
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
]);

// ── Helpers ───────────────────────────────────────────────────
function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function err(msg: string, status: number): Response {
  return json({ error: msg }, status);
}

// ── Server ────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (req.method !== "GET") {
    return err("Only GET requests are supported", 405);
  }

  const reqUrl = new URL(req.url);

  // ── /proxy ────────────────────────────────────────────────────
  if (reqUrl.pathname === "/proxy") {
    const targetParam = reqUrl.searchParams.get("url");

    if (!targetParam) {
      return err("Missing required query parameter: url", 400);
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(targetParam);
    } catch {
      return err("Invalid value for 'url' parameter", 400);
    }

    // Solo HTTPS
    if (targetUrl.protocol !== "https:") {
      return err("Only https:// targets are allowed", 403);
    }

    const hostname = targetUrl.hostname.toLowerCase();

    // Blocca indirizzi privati / loopback
    if (PRIVATE_HOST.test(hostname)) {
      return err("Private or loopback addresses are not allowed", 403);
    }

    // Controlla whitelist
    if (!ALLOWED_DOMAINS.has(hostname)) {
      console.warn(`[proxy] BLOCKED domain: ${hostname}`);
      return err(
        `Domain '${hostname}' is not in the allowed list. ` +
        `Add it to the ALLOWED_DOMAINS environment variable in the Deno Deploy dashboard.`,
        403,
      );
    }

    console.log(`[proxy] → ${hostname}${targetUrl.pathname}`);

    try {
      const upstream = await fetch(targetUrl.toString(), {
        headers: { "User-Agent": "CORSProxy/2.0 (personal)" },
      });

      // Costruisce gli header di risposta
      const responseHeaders = new Headers(corsHeaders());
      upstream.headers.forEach((value, key) => {
        if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
          responseHeaders.set(key, value);
        }
      });

      // Forza il content-type corretto
      const ct = upstream.headers.get("content-type") ?? "application/octet-stream";
      responseHeaders.set("Content-Type", ct);

      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      });

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[proxy] fetch error: ${msg}`);
      return err(`Upstream fetch failed: ${msg}`, 502);
    }
  }

  // ── / (health check) ─────────────────────────────────────────
  if (reqUrl.pathname === "/" || reqUrl.pathname === "") {
    return json({
      status: "ok",
      service: "CORS Proxy",
      endpoint: "/proxy?url=<encoded_https_url>",
      allowed_domains: [...ALLOWED_DOMAINS].sort(),
      note: "To add domains: set ALLOWED_DOMAINS env var in Deno Deploy dashboard.",
    });
  }

  return err("Not found", 404);
});

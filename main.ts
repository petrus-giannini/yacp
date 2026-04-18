Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (url.pathname === "/") {
    return new Response(
      "CORS Proxy attivo. Uso: /proxy?url=https://...",
      { headers: { "Content-Type": "text/plain" } }
    );
  }

  if (url.pathname === "/proxy") {
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
      return new Response(
        JSON.stringify({ error: "Parametro ?url= mancante" }),
        { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return new Response(
        JSON.stringify({ error: "URL non valido" }),
        { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    const allowed = ["opensky-network.org"];
    if (!allowed.some(d => parsed.hostname.endsWith(d))) {
      return new Response(
        JSON.stringify({ error: "Dominio non consentito: " + parsed.hostname }),
        { status: 403, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; cors-proxy/1.0)",
          "Accept": "application/json",
        },
      });

      const body = await response.text();
      const contentType = response.headers.get("content-type") ?? "application/json";

      return new Response(body, {
        status: response.status,
        headers: {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
        },
      });

    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Fetch fallita: " + (err as Error).message }),
        { status: 502, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }
  }

  return new Response("Not found", { status: 404 });
});

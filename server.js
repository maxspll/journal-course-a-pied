/*
 * Proxy optionnel pour l'API COROS.
 *
 * L'API COROS (https://open.coros.com) nécessite un compte développeur validé
 * par COROS. Une fois obtenu, ce petit proxy sans dépendance permet à la
 * webapp (qui tourne dans le navigateur) d'appeler l'API sans blocage CORS.
 *
 * Usage :
 *   node server.js            # écoute sur http://localhost:8787
 *
 * La webapp doit être configurée avec :
 *   URL du proxy : http://localhost:8787
 *   Jeton d'accès : le token OAuth renvoyé par COROS
 */
"use strict";

const http = require("http");
const https = require("https");

const PORT = process.env.PORT || 8787;
const COROS_API = "https://api.coros.com";

function proxyRequest(path, method, headers, body, res) {
  const url = new URL(path, COROS_API);
  const req = https.request(
    {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        ...Object.fromEntries(
          Object.entries(headers).filter(([k]) =>
            ["authorization", "accesstoken", "token", "x-coros-*"].some(p =>
              p.endsWith("*") ? k.toLowerCase().startsWith(p.slice(0, -1)) : k.toLowerCase() === p
            )
          )
        )
      }
    },
    apiRes => {
      res.writeHead(apiRes.statusCode, { "Content-Type": "application/json" });
      apiRes.pipe(res);
    }
  );
  req.on("error", err => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  });
  if (body) req.write(body);
  req.end();
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, AccessToken, Token");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  if (req.url.startsWith("/api/coros/")) {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      const target = "/v2" + req.url.replace("/api/coros", "");
      proxyRequest(target, req.method, req.headers, body || null, res);
    });
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Route inconnue. Utilise /api/coros/..." }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Proxy COROS sur http://127.0.0.1:${PORT} (local uniquement)`);
});

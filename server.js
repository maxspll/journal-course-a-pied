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
 *
 * Strava (COROS → Strava → webapp) :
 *   1. Dans l'app COROS, relie ton compte Strava (Réglages → Connexions)
 *   2. Crée une app gratuite sur https://www.strava.com/settings/api
 *      (Callback Domain : localhost)
 *   3. Colle Client ID et Client Secret dans l'onglet COROS de la webapp
 *   4. Clique « Connecter mon compte Strava » puis « Synchroniser »
 *   Les jetons sont stockés localement dans tokens.json (jamais envoyés ailleurs).
 */
"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8787;
const COROS_API = "https://api.coros.com";
const STRAVA_OAUTH = "https://www.strava.com/oauth";
const STRAVA_API = "https://www.strava.com/api/v3";
const TOKENS_FILE = path.join(__dirname, "tokens.json");

function loadTokens() {
  try { return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8")); }
  catch { return {}; }
}

function saveTokens(t) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(t, null, 2));
}

function httpsReq(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, res => {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function parseQuery(urlStr) {
  const q = {};
  const qs = new URL(urlStr, "http://x").searchParams;
  for (const [k, v] of qs) q[k] = v;
  return q;
}

function sendJSON(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

async function refreshStravaToken(tokens) {
  const body = new URLSearchParams({
    client_id: tokens.strava.client_id,
    client_secret: tokens.strava.client_secret,
    grant_type: "refresh_token",
    refresh_token: tokens.strava.refresh_token
  }).toString();
  const r = await httpsReq(STRAVA_OAUTH + "/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) }
  }, body);
  const data = JSON.parse(r.body);
  if (r.status !== 200) throw new Error(data.message || "refresh échoué");
  tokens.strava.access_token = data.access_token;
  tokens.strava.refresh_token = data.refresh_token;
  tokens.strava.expires_at = data.expires_at;
  saveTokens(tokens);
  return data.access_token;
}

async function stravaAccessToken() {
  const tokens = loadTokens();
  if (!tokens.strava || !tokens.strava.access_token) return null;
  if (tokens.strava.expires_at && Date.now() / 1000 > tokens.strava.expires_at - 60) {
    return refreshStravaToken(tokens);
  }
  return tokens.strava.access_token;
}

async function handleStrava(req, res, urlStr) {
  const tokens = loadTokens();
  const route = urlStr.split("?")[0];

  if (req.method === "POST" && route === "/api/strava/config") {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      try {
        const cfg = JSON.parse(body);
        tokens.strava = Object.assign(tokens.strava || {}, {
          client_id: cfg.client_id, client_secret: cfg.client_secret
        });
        saveTokens(tokens);
        sendJSON(res, 200, { ok: true });
      } catch (e) {
        sendJSON(res, 400, { error: e.message });
      }
    });
    return;
  }

  if (route === "/api/strava/authorize") {
    if (!tokens.strava || !tokens.strava.client_id) {
      return sendJSON(res, 400, { error: "Configure d'abord Client ID et Client Secret." });
    }
    const q = parseQuery(urlStr);
    const params = new URLSearchParams({
      client_id: tokens.strava.client_id,
      redirect_uri: "http://localhost:" + PORT + "/api/strava/callback",
      response_type: "code",
      approval_prompt: "auto",
      scope: "read,activity:read_all",
      state: q.state || ""
    });
    res.writeHead(302, { Location: STRAVA_OAUTH + "/authorize?" + params.toString() });
    return res.end();
  }

  if (route === "/api/strava/callback") {
    const q = parseQuery(urlStr);
    if (q.error || !q.code) {
      return sendJSON(res, 400, { error: q.error || "code manquant" });
    }
    const body = new URLSearchParams({
      client_id: tokens.strava.client_id,
      client_secret: tokens.strava.client_secret,
      code: q.code,
      grant_type: "authorization_code"
    }).toString();
    try {
      const r = await httpsReq(STRAVA_OAUTH + "/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) }
      }, body);
      const data = JSON.parse(r.body);
      if (r.status !== 200) throw new Error(data.message || "échange de token échoué");
      tokens.strava = Object.assign(tokens.strava || {}, {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at
      });
      saveTokens(tokens);
      const back = q.state || "/";
      res.writeHead(302, { Location: back + (back.includes("?") ? "&" : "?") + "strava=connecte" });
      return res.end();
    } catch (e) {
      return sendJSON(res, 502, { error: e.message });
    }
  }

  if (route === "/api/strava/activities") {
    try {
      const token = await stravaAccessToken();
      if (!token) return sendJSON(res, 401, { error: "Compte Strava non connecté. Clique d'abord sur « Connecter mon compte Strava »." });
      let all = [];
      for (let page = 1; page <= 3; page++) {
        const r = await httpsReq(STRAVA_API + "/athlete/activities?per_page=100&page=" + page, {
          headers: { Authorization: "Bearer " + token }
        });
        if (r.status !== 200) {
          const err = JSON.parse(r.body || "{}");
          throw new Error(err.message || "HTTP " + r.status);
        }
        const batch = JSON.parse(r.body);
        all = all.concat(batch);
        if (batch.length < 100) break;
      }
      sendJSON(res, 200, { activities: all });
    } catch (e) {
      sendJSON(res, 502, { error: e.message });
    }
    return;
  }

  sendJSON(res, 404, { error: "Route Strava inconnue." });
}

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
  if (req.url.startsWith("/api/strava/")) {
    return handleStrava(req, res, req.url);
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

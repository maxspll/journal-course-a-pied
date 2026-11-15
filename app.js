/* Journal Course à Pied — stockage local, import/export, données COROS */
"use strict";

const STORE_KEY = "coros_running_journal_v1";

const state = {
  entries: [],
  settings: { corosProxyUrl: "", corosToken: "" }
};

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      state.entries = Array.isArray(data.entries) ? data.entries : [];
      state.settings = Object.assign(state.settings, data.settings || {});
    }
  } catch (e) {
    console.error("Chargement impossible :", e);
  }
}

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) || "id-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---------------- Dates ---------------- */

function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function toISODate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function fmtDate(v) {
  const d = parseDate(v);
  if (!d) return v || "";
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/* ---------------- CSV ---------------- */

function detectDelimiter(text) {
  const line = text.split(/\r?\n/).find(l => l.trim());
  if (!line) return ",";
  const counts = { ",": 0, ";": 0, "\t": 0 };
  for (const ch of line) if (ch in counts) counts[ch]++;
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
}

function parseCSV(text) {
  const delim = detectDelimiter(text);
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(f => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f.trim() !== "")) rows.push(row);
  return rows;
}

/* ---------------- Mapping COROS ---------------- */

const FIELD_ALIASES = {
  date: ["date", "start time", "activity time", "workout date", "date de début", "heure de début", "timestamp"],
  title: ["title", "name", "activity name", "workout name", "titre", "nom"],
  type: ["type", "activity type", "sport", "workout type", "activité", "sport type"],
  distance: ["distance", "distance (km)", "distance(km)", "total distance", "distance totale"],
  duration: ["duration", "time", "moving time", "total time", "durée", "temps"],
  pace: ["pace", "avg pace", "average pace", "allure", "allure moyenne"],
  hr: ["avg hr", "average hr", "avg heart rate", "average heart rate", "fc moy", "fréquence cardiaque moyenne"],
  maxHr: ["max hr", "maximum heart rate", "fc max", "fréquence cardiaque max"],
  elevation: ["elevation gain", "total ascent", "elev gain", "climb", "dénivelé", "dénivelé positif"],
  calories: ["calories", "kcal", "calorie"],
  cadence: ["avg cadence", "cadence", "cadence moyenne"]
};

function normKey(k) {
  return String(k || "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function matchField(key) {
  const n = normKey(key);
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.some(a => n === normKey(a) || n.includes(normKey(a)))) return field;
  }
  return null;
}

function parseDuration(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  let m = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?/);
  if (m) return +m[1] * 3600 + +m[2] * 60 + (m[3] ? +m[3] : 0);
  m = s.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*min)?\s*(?:(\d+)\s*s)?$/i);
  if (m && (m[1] || m[2] || m[3])) return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  const n = parseFloat(s.replace(",", "."));
  return isNaN(n) ? null : n;
}

function parseNumber(v) {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return isNaN(n) ? null : n;
}

function fmtDuration(sec) {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function fmtPace(secPerKm) {
  if (!secPerKm || !isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) return "—";
  const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
  if (s === 60) return `${m + 1}:00 /km`;
  return `${m}:${String(s).padStart(2, "0")} /km`;
}

function finalizeActivity(a) {
  const act = {
    id: uid(),
    date: a.date || todayISO(),
    title: a.title || "",
    type: a.type || "Course",
    distance: parseNumber(a.distance),
    duration: parseDuration(a.duration),
    pace: null,
    hr: parseNumber(a.hr),
    maxHr: parseNumber(a.maxHr),
    elevation: parseNumber(a.elevation),
    calories: parseNumber(a.calories),
    cadence: parseNumber(a.cadence),
    source: a.source || "import"
  };
  if (act.distance != null && act.duration > 0) {
    act.pace = act.duration / act.distance;
  } else if (a.pace) {
    const p = String(a.pace).trim();
    const m = p.match(/^(\d+):(\d{1,2})/);
    if (m) act.pace = +m[1] * 60 + +m[2];
    else {
      const n = parseNumber(p);
      if (n != null) act.pace = n * 60;
    }
  }
  if (!act.title) {
    act.title = act.type || "Activité";
  }
  return act;
}

function normalizeActivity(raw) {
  const a = {};
  for (const [k, v] of Object.entries(raw)) {
    const f = matchField(k);
    if (f && !a[f]) a[f] = v;
  }
  return finalizeActivity(a);
}

function activitiesFromParsed(raws, source) {
  return raws.map(r => finalizeActivity({
    date: r.Date, title: "", type: r.Type,
    distance: r.Distance, duration: r.Duration,
    hr: r["Avg HR"], maxHr: r["Max HR"],
    elevation: r["Elevation Gain"], calories: r.Calories,
    source
  })).filter(a => a.distance != null || a.duration != null || parseDate(a.date));
}

const STRAVA_TYPES = {
  Run: "Course à pied", VirtualRun: "Course virtuelle", Walk: "Marche",
  Ride: "Vélo", VirtualRide: "Vélo virtuel", Swim: "Natation", Hike: "Randonnée"
};

function activitiesFromStrava(list) {
  return list.map(s => finalizeActivity({
    date: (s.start_date || "").slice(0, 10) || null,
    title: s.name || "",
    type: STRAVA_TYPES[s.type] || s.type || "Course",
    distance: s.distance != null ? s.distance / 1000 : null,
    duration: s.moving_time || s.elapsed_time || null,
    hr: s.average_heartrate || null,
    maxHr: s.max_heartrate || null,
    elevation: s.total_elevation_gain || null,
    calories: s.calories || null,
    source: "Strava"
  })).filter(a => a.distance != null || a.duration != null || parseDate(a.date));
}

function stravaProxy() {
  return document.getElementById("coros-proxy-url").value.trim().replace(/\/$/, "");
}

function stravaConnect() {
  const report = document.getElementById("strava-report");
  const proxy = stravaProxy();
  if (!proxy) {
    report.textContent = "Renseigne d'abord l'URL du proxy (ex. http://localhost:8787).";
    report.classList.add("error");
    return;
  }
  report.classList.remove("error");
  const back = encodeURIComponent(location.origin + location.pathname);
  location.href = proxy + "/api/strava/authorize?state=" + back;
}

async function stravaSaveConfig() {
  const report = document.getElementById("strava-report");
  const proxy = stravaProxy();
  const clientId = document.getElementById("strava-client-id").value.trim();
  const clientSecret = document.getElementById("strava-client-secret").value.trim();
  if (!proxy || !clientId || !clientSecret) {
    report.textContent = "Proxy, Client ID et Client Secret sont tous nécessaires.";
    report.classList.add("error");
    return;
  }
  try {
    const res = await fetch(proxy + "/api/strava/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret })
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    report.textContent = "Réglages Strava enregistrés. Tu peux connecter ton compte.";
    report.classList.remove("error");
  } catch (e) {
    report.textContent = "Impossible d'enregistrer : " + e.message + " (proxy lancé ? node server.js)";
    report.classList.add("error");
  }
}

async function stravaSync() {
  const report = document.getElementById("strava-report");
  const proxy = stravaProxy();
  if (!proxy) {
    report.textContent = "Renseigne d'abord l'URL du proxy (ex. http://localhost:8787).";
    report.classList.add("error");
    return;
  }
  report.classList.remove("error");
  report.textContent = "Synchronisation Strava en cours…";
  try {
    const res = await fetch(proxy + "/api/strava/activities");
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "HTTP " + res.status);
    }
    const data = await res.json();
    const acts = activitiesFromStrava(data.activities || []);
    importCorosActivities(acts, report);
    renderActivitiesTable();
  } catch (e) {
    report.textContent = "Échec de synchronisation Strava : " + e.message + " (proxy lancé ? node server.js)";
    report.classList.add("error");
  }
}

async function parseActivityFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".fit")) {
    return activitiesFromParsed(parseFIT(await file.arrayBuffer()), file.name);
  }
  if (name.endsWith(".tcx")) {
    return activitiesFromParsed(parseTCX(await file.text()), file.name);
  }
  return activitiesFromCSV(await file.text(), file.name);
}

function isKeyValueFormat(rows) {
  return rows.length > 1 && rows[0].length === 2 && rows.slice(1, 6).every(r => r.length === 2);
}

function activitiesFromCSV(text, source) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const out = [];
  if (isKeyValueFormat(rows)) {
    const kv = {};
    for (const r of rows.slice(1)) kv[r[0]] = r[1];
    kv.__source = source;
    out.push(normalizeActivity(kv));
  } else {
    const headers = rows[0];
    for (const r of rows.slice(1)) {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = r[i]; });
      obj.__source = source;
      out.push(normalizeActivity(obj));
    }
  }
  return out.filter(a => a.distance != null || a.duration != null || parseDate(a.date));
}

/* ---------------- Entries ---------------- */

function addEntry(entry) {
  state.entries.push(entry);
  save();
  renderAll();
}

function deleteEntry(id) {
  state.entries = state.entries.filter(e => e.id !== id);
  save();
  renderAll();
}

function sortedEntries() {
  return [...state.entries].sort((a, b) => (parseDate(b.date) || 0) - (parseDate(a.date) || 0));
}

/* ---------------- Journal ---------------- */

function renderJournal() {
  const q = document.getElementById("journal-search").value.toLowerCase();
  const filter = document.querySelector("#journal-filters .chip.active").dataset.filter;
  const feed = document.getElementById("journal-feed");
  feed.innerHTML = "";
  const entries = sortedEntries().filter(e => {
    if (filter !== "all" && e.type !== filter) return false;
    if (!q) return true;
    const hay = JSON.stringify(e).toLowerCase();
    return hay.includes(q);
  });
  if (!entries.length) {
    feed.innerHTML = '<p class="hint">Aucune entrée. Importe des notes, des tableaux ou des données COROS pour commencer.</p>';
    return;
  }
  const typeLabels = { note: "Note", table: "Tableau", activity: "Activité COROS", plan: "Programme" };
  for (const e of entries) {
    const div = document.createElement("article");
    div.className = "entry type-" + e.type;
    div.dataset.entry = e.id;
    let body = "";
    if (e.type === "note") body = `<p class="entry-body">${esc(e.content)}</p>`;
    if (e.type === "table") body = renderHTMLTable(e.table);
    if (e.type === "activity") body = activitySummaryHTML(e.activity);
    if (e.type === "plan") body = planSummaryHTML(e);
    const tableActions = e.type === "table"
      ? `<button class="btn" data-edit="${e.id}">Modifier</button><button class="btn" data-csv="${e.id}">Export CSV</button>`
      : "";
    div.innerHTML = `
      <div class="entry-head">
        <div>
          <p class="entry-title">${esc(e.title || typeLabels[e.type])}</p>
          <span class="entry-meta">${esc(fmtDate(e.date))} · ${typeLabels[e.type] || e.type}</span>
        </div>
        <div class="entry-actions">${tableActions}<button class="btn" data-del="${e.id}">Supprimer</button></div>
      </div>
      ${body}`;
    feed.appendChild(div);
  }
}

function tableToCSV(table) {
  const cell = c => {
    const s = String(c == null ? "" : c);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [table.headers, ...table.rows].map(r => r.map(cell).join(",")).join("\n");
}

function editTableEntry(id) {
  const e = state.entries.find(x => x.id === id);
  const art = document.querySelector('[data-entry="' + id + '"]');
  if (!e || !art || e.type !== "table") return;
  const t = e.table;
  const ths = t.headers.map(h => `<th contenteditable="true">${esc(h)}</th>`).join("");
  const rows = t.rows.map(r => `<tr>${r.map(c => `<td contenteditable="true">${esc(c)}</td>`).join("")}</tr>`).join("");
  art.querySelector(".table-wrap").innerHTML = `
    <table class="editing"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>
    <div class="row" style="margin-top:.5rem">
      <button class="btn primary" data-save="${id}">Enregistrer</button>
      <button class="btn" data-cancel="${id}">Annuler</button>
      <button class="btn" data-addrow="${id}">+ Ligne</button>
      <button class="btn" data-addcol="${id}">+ Colonne</button>
    </div>`;
}

function saveTableEntry(id, art) {
  const e = state.entries.find(x => x.id === id);
  const table = art.querySelector("table.editing");
  if (!e || !table) return;
  const trs = [...table.querySelectorAll("tr")];
  const cells = tr => [...tr.children].map(td => td.textContent.trim());
  const headers = cells(trs[0]);
  const rows = trs.slice(1).map(cells);
  e.table = { headers, rows };
  save();
  renderJournal();
}

function renderHTMLTable(table) {
  if (!table || !table.headers) return "";
  const thead = table.headers.map(h => `<th>${esc(h)}</th>`).join("");
  const rows = table.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("");
  return `<div class="table-wrap"><table><thead><tr>${thead}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function activitySummaryHTML(a) {
  const items = [
    ["Distance", a.distance != null ? a.distance.toFixed(2) + " km" : "—"],
    ["Durée", fmtDuration(a.duration)],
    ["Allure", fmtPace(a.pace)],
    ["FC moy.", a.hr != null ? Math.round(a.hr) + " bpm" : "—"],
    ["D+ ", a.elevation != null ? a.elevation + " m" : "—"]
  ];
  return `<div class="table-wrap"><table><tbody><tr>${items.map(i => `<td><strong>${i[0]}</strong><br>${esc(i[1])}</td>`).join("")}</tr></tbody></table></div>`;
}

/* ---------------- Notes ---------------- */

function setupNotes() {
  document.getElementById("note-date").value = todayISO();
  document.getElementById("note-save").addEventListener("click", () => {
    const content = document.getElementById("note-content").value.trim();
    if (!content) return;
    addEntry({
      id: uid(), type: "note",
      date: document.getElementById("note-date").value || todayISO(),
      title: document.getElementById("note-title").value.trim() || content.split("\n")[0].slice(0, 60),
      content, createdAt: Date.now()
    });
    document.getElementById("note-title").value = "";
    document.getElementById("note-content").value = "";
    switchView("journal");
  });
  document.getElementById("note-file").addEventListener("change", async ev => {
    for (const file of ev.target.files) {
      const text = await file.text();
      addEntry({
        id: uid(), type: "note",
        date: todayISO(),
        title: file.name.replace(/\.(txt|md|markdown)$/i, ""),
        content: text.trim(), createdAt: Date.now()
      });
    }
    ev.target.value = "";
    switchView("journal");
  });
}

/* ---------------- Tableaux ---------------- */

function setupTables() {
  document.getElementById("table-date").value = todayISO();
  const ta = document.getElementById("table-csv");
  const preview = document.getElementById("table-preview");
  const showPreview = () => {
    const rows = parseCSV(ta.value);
    preview.innerHTML = "";
    if (rows.length > 1) {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = "<h3>Aperçu</h3>" + renderHTMLTable({ headers: rows[0], rows: rows.slice(1) });
      preview.appendChild(card);
    }
  };
  ta.addEventListener("input", showPreview);
  document.getElementById("table-save").addEventListener("click", () => {
    const rows = parseCSV(ta.value);
    if (rows.length < 2) return;
    addEntry({
      id: uid(), type: "table",
      date: document.getElementById("table-date").value || todayISO(),
      title: document.getElementById("table-title").value.trim() || "Tableau",
      table: { headers: rows[0], rows: rows.slice(1) },
      createdAt: Date.now()
    });
    ta.value = "";
    document.getElementById("table-title").value = "";
    preview.innerHTML = "";
    switchView("journal");
  });
  document.getElementById("table-file").addEventListener("change", async ev => {
    for (const file of ev.target.files) {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length < 2) continue;
      addEntry({
        id: uid(), type: "table",
        date: todayISO(),
        title: file.name.replace(/\.csv$/i, ""),
        table: { headers: rows[0], rows: rows.slice(1) },
        createdAt: Date.now()
      });
    }
    ev.target.value = "";
    switchView("journal");
  });
}

/* ---------------- COROS ---------------- */

function importCorosActivities(acts, reportEl) {
  if (!acts.length) {
    reportEl.textContent = "Aucune activité reconnue dans ce fichier. Vérifie le format (CSV COROS).";
    reportEl.classList.add("error");
    return 0;
  }
  reportEl.classList.remove("error");
  for (const a of acts) {
    addEntry({
      id: uid(), type: "activity",
      date: a.date, title: a.title || a.type || "Activité COROS",
      activity: a, createdAt: Date.now()
    });
  }
  reportEl.textContent = `${acts.length} activité(s) importée(s) et ajoutée(s) au Journal.`;
  return acts.length;
}

function setupCoros() {
  const report = document.getElementById("coros-import-report");
  document.getElementById("coros-file").addEventListener("change", async ev => {
    let total = 0;
    for (const file of ev.target.files) total += importCorosActivities(await parseActivityFile(file), report);
    ev.target.value = "";
    renderActivitiesTable();
    if (total) switchView("coros");
  });
  document.getElementById("coros-parse-paste").addEventListener("click", () => {
    const text = document.getElementById("coros-paste").value.trim();
    if (!text) return;
    importCorosActivities(activitiesFromCSV(text, "collé"), report);
    renderActivitiesTable();
  });

  const proxyInput = document.getElementById("coros-proxy-url");
  const tokenInput = document.getElementById("coros-token");
  proxyInput.value = state.settings.corosProxyUrl || "";
  tokenInput.value = state.settings.corosToken || "";
  document.getElementById("coros-save-settings").addEventListener("click", () => {
    state.settings.corosProxyUrl = proxyInput.value.trim();
    state.settings.corosToken = tokenInput.value.trim();
    save();
  });
  document.getElementById("strava-connect").addEventListener("click", stravaConnect);
  document.getElementById("strava-sync").addEventListener("click", stravaSync);
  document.getElementById("strava-save").addEventListener("click", stravaSaveConfig);
  document.getElementById("coros-sync").addEventListener("click", async () => {
    const apiReport = document.getElementById("coros-api-report");
    const url = proxyInput.value.trim();
    const token = tokenInput.value.trim();
    if (!url || !token) {
      apiReport.textContent = "Renseigne l'URL du proxy et le jeton d'accès (voir server.js).";
      apiReport.classList.add("error");
      return;
    }
    apiReport.classList.remove("error");
    apiReport.textContent = "Synchronisation en cours…";
    try {
      const res = await fetch(url.replace(/\/$/, "") + "/api/coros/activities", {
        headers: { "Authorization": "Bearer " + token }
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.activities || data.data || []);
      const acts = list.map(a => normalizeActivity({
        "Date": a.startTime || a.date || a.start_time,
        "Title": a.title || a.name,
        "Type": a.type || a.sport,
        "Distance": a.distance != null ? (a.distance > 1000 ? a.distance / 1000 : a.distance) : null,
        "Duration": a.duration || a.movingTime || a.moving_time,
        "Avg HR": a.avgHr || a.averageHeartRate || a.avg_hr,
        "Elevation Gain": a.elevationGain || a.totalAscent || a.elevation_gain,
        "Calories": a.calories,
        "__source": "API COROS"
      }));
      importCorosActivities(acts, apiReport);
      renderActivitiesTable();
    } catch (e) {
      apiReport.textContent = "Échec de synchronisation : " + e.message;
      apiReport.classList.add("error");
    }
  });
}

function renderActivitiesTable() {
  const wrap = document.getElementById("coros-activities");
  const acts = sortedEntries().filter(e => e.type === "activity").map(e => e.activity);
  if (!acts.length) {
    wrap.innerHTML = '<p class="hint">Aucune activité pour le moment.</p>';
    return;
  }
  const headers = ["Date", "Titre", "Type", "Distance", "Durée", "Allure", "FC moy.", "D+"];
  const rows = acts.map(a => [
    fmtDate(a.date), a.title || "", a.type || "",
    a.distance != null ? a.distance.toFixed(2) + " km" : "—",
    fmtDuration(a.duration), fmtPace(a.pace),
    a.hr != null ? Math.round(a.hr) + " bpm" : "—",
    a.elevation != null ? a.elevation + " m" : "—"
  ]);
  wrap.innerHTML = renderHTMLTable({ headers, rows });
}

/* ---------------- Stats ---------------- */

function runningActivities() {
  return state.entries.filter(e => e.type === "activity").map(e => e.activity)
    .filter(a => a.distance != null && a.distance > 0);
}

function isRunning(a) {
  return /course|run|trail/i.test(a.type || "");
}

function weekStart(d) {
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  return t;
}

function aggregateBy(acts, keyFn) {
  const map = new Map();
  for (const a of acts) {
    const k = keyFn(a);
    if (!k) continue;
    if (!map.has(k)) map.set(k, { km: 0, time: 0, dplus: 0, n: 0, hrTime: 0, hrDur: 0 });
    const g = map.get(k);
    g.km += a.distance || 0;
    g.time += a.duration || 0;
    g.dplus += a.elevation || 0;
    g.n++;
    if (a.hr != null && a.hr > 0 && a.duration > 0) {
      g.hrTime += a.hr * a.duration;
      g.hrDur += a.duration;
    }
  }
  return map;
}

function deltaHTML(cur, prev, fmt, lowerIsBetter) {
  if (!prev && !cur) return '<span class="delta-flat">—</span>';
  if (!prev) return '<span class="delta-up">nouveau</span>';
  if (!cur) return '<span class="delta-flat">0</span>';
  const pct = ((cur - prev) / prev) * 100;
  if (Math.abs(pct) < 0.5) return '<span class="delta-flat">=</span>';
  const up = pct > 0;
  const good = lowerIsBetter ? !up : up;
  const cls = good ? "delta-up" : "delta-down";
  const arrow = up ? "▲" : "▼";
  return `<span class="${cls}">${arrow} ${Math.abs(pct).toFixed(0)} %</span>`;
}

function periodTable(keys, agg, labelFn) {
  const headers = ["Période", "Séances", "Distance", "Durée", "Allure moy.", "FC moy.", "D+"];
  const cell = (val, delta) => `<td>${val}${delta ? `<span class="cell-delta">${delta}</span>` : ""}</td>`;
  const body = keys.map((k, i) => {
    const g = agg.get(k) || { km: 0, time: 0, dplus: 0, n: 0, hrTime: 0, hrDur: 0 };
    const prev = i > 0 ? (agg.get(keys[i - 1]) || { km: 0, time: 0, hrTime: 0, hrDur: 0 }) : null;
    const pace = g.km > 0 ? g.time / g.km : null;
    const fc = g.hrDur > 0 ? g.hrTime / g.hrDur : null;
    const dKm = prev && (prev.km > 0 || g.km > 0) ? deltaHTML(g.km, prev.km) : "";
    const dTime = prev && (prev.time > 0 || g.time > 0) ? deltaHTML(g.time, prev.time) : "";
    const dPace = prev && pace && prev.km > 0 ? deltaHTML(pace, prev.time / prev.km, null, true) : "";
    const dFc = prev && fc && prev.hrDur > 0 ? deltaHTML(fc, prev.hrTime / prev.hrDur, null, true) : "";
    const cells = [
      esc(labelFn(k)),
      String(g.n),
      [g.km > 0 ? g.km.toFixed(1) + " km" : "—", dKm],
      [fmtDuration(g.time), dTime],
      [fmtPace(pace), dPace],
      [fc != null ? Math.round(fc) + " bpm" : "—", dFc],
      [g.dplus > 0 ? Math.round(g.dplus) + " m" : "—", ""]
    ];
    return "<tr>" + cells.map(c => Array.isArray(c) ? cell(c[0], c[1]) : `<td>${c}</td>`).join("") + "</tr>";
  }).reverse().join("");
  return `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}

function barChart(keys, agg, labelFn) {
  const values = keys.map(k => (agg.get(k) || { km: 0 }).km);
  const max = Math.max(...values, 1);
  return '<div class="chart">' + keys.map((k, i) => `
    <div class="bar-group">
      <span class="bar-value">${values[i] > 0 ? values[i].toFixed(1) : ""}</span>
      <div class="bar" style="height:${Math.max(2, (values[i] / max) * 100)}%"></div>
      <span class="bar-label">${labelFn(k)}</span>
    </div>`).join("") + "</div>";
}

function renderStats() {
  const acts = runningActivities();
  const cards = document.getElementById("stat-cards");
  const chartWeeks = document.getElementById("chart-weeks");
  const tableWeeks = document.getElementById("table-weeks");
  const chartMonths = document.getElementById("chart-months");
  const tableMonths = document.getElementById("table-months");
  if (!acts.length) {
    cards.innerHTML = '<p class="hint">Importe des activités COROS pour voir tes statistiques.</p>';
    chartWeeks.innerHTML = "";
    tableWeeks.innerHTML = "";
    chartMonths.innerHTML = "";
    tableMonths.innerHTML = "";
    return;
  }

  const runs = acts.filter(isRunning);
  const thisWeekISO = toISODate(weekStart(new Date()));
  const wk = runs.filter(a => { const d = parseDate(a.date); return d && toISODate(weekStart(d)) === thisWeekISO; });
  const wkKm = wk.reduce((s, a) => s + a.distance, 0);
  const wkTime = wk.reduce((s, a) => s + (a.duration || 0), 0);
  const wkHrRuns = wk.filter(a => a.hr != null && a.hr > 0 && a.duration > 0);
  const wkHr = wkHrRuns.length
    ? wkHrRuns.reduce((s, a) => s + a.hr * a.duration, 0) / wkHrRuns.reduce((s, a) => s + a.duration, 0)
    : null;

  cards.innerHTML = [
    [wkKm > 0 ? wkKm.toFixed(1) + " km" : "—", "Distance cette semaine"],
    [wkTime > 0 ? fmtDuration(wkTime) : "—", "Temps cette semaine"],
    [wkKm > 0 ? fmtPace(wkTime / wkKm) : "—", "Allure moyenne (semaine)"],
    [wkHr != null ? Math.round(wkHr) + " bpm" : "—", "FC moyenne (semaine)"]
  ].map(([v, l]) => `<div class="stat"><div class="value">${esc(v)}</div><div class="label">${esc(l)}</div></div>`).join("");

  const thisMonday = weekStart(new Date());
  const weekKeys = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(thisMonday);
    d.setDate(d.getDate() - i * 7);
    weekKeys.push(toISODate(d));
  }
  const weekAgg = aggregateBy(acts.filter(isRunning), a => {
    const d = parseDate(a.date);
    return d ? toISODate(weekStart(d)) : null;
  });
  const weekLabel = k => {
    const start = new Date(k + "T00:00:00");
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const opts = { day: "numeric", month: "short" };
    return start.toLocaleDateString("fr-FR", opts) + " – " + end.toLocaleDateString("fr-FR", opts);
  };
  chartWeeks.innerHTML = barChart(weekKeys, weekAgg, k => {
    const start = new Date(k + "T00:00:00");
    return start.getDate() + "/" + String(start.getMonth() + 1).padStart(2, "0");
  });
  tableWeeks.innerHTML = periodTable(weekKeys, weekAgg, weekLabel);

  const monthKeys = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
  }
  const monthAgg = aggregateBy(acts.filter(isRunning), a => {
    const d = parseDate(a.date);
    if (!d) return null;
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  });
  const monthLabel = k => {
    const [y, m] = k.split("-");
    return new Date(+y, +m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  };
  const monthShort = k => {
    const [y, m] = k.split("-");
    return new Date(+y, +m - 1, 1).toLocaleDateString("fr-FR", { month: "short" });
  };
  chartMonths.innerHTML = barChart(monthKeys, monthAgg, monthShort);
  tableMonths.innerHTML = periodTable(monthKeys, monthAgg, monthLabel);
}

/* ---------------- Export / Import ---------------- */

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportJSON() {
  download("journal-course-a-pied-" + todayISO() + ".json", JSON.stringify(state, null, 2), "application/json");
}

function exportMarkdown() {
  const lines = ["# Journal Course à Pied", "", "_Exporté le " + new Date().toLocaleString("fr-FR") + "_", ""];
  for (const e of sortedEntries()) {
    lines.push("## " + fmtDate(e.date) + " — " + (e.title || e.type));
    lines.push("");
    if (e.type === "note") lines.push(e.content);
    if (e.type === "table" && e.table) {
      lines.push("| " + e.table.headers.join(" | ") + " |");
      lines.push("|" + e.table.headers.map(() => "---").join("|") + "|");
      for (const r of e.table.rows) lines.push("| " + r.join(" | ") + " |");
    }
    if (e.type === "activity" && e.activity) {
      const a = e.activity;
      lines.push(`- **Type** : ${a.type || "—"}  `);
      lines.push(`- **Distance** : ${a.distance != null ? a.distance.toFixed(2) + " km" : "—"}  `);
      lines.push(`- **Durée** : ${fmtDuration(a.duration)}  `);
      lines.push(`- **Allure** : ${fmtPace(a.pace)}  `);
      if (a.hr != null) lines.push(`- **FC moyenne** : ${Math.round(a.hr)} bpm  `);
      if (a.elevation != null) lines.push(`- **D+** : ${a.elevation} m  `);
    }
    lines.push("");
  }
  download("journal-course-a-pied-" + todayISO() + ".md", lines.join("\n"), "text/markdown");
}

function exportCSV() {
  const acts = runningActivities();
  const headers = ["Date", "Titre", "Type", "Distance (km)", "Durée (s)", "Allure (min/km)", "FC moy.", "D+ (m)"];
  const rows = acts.map(a => [
    a.date, a.title || "", a.type || "",
    a.distance != null ? a.distance.toFixed(2) : "",
    a.duration || "",
    a.pace ? (a.pace / 60).toFixed(2) : "",
    a.hr != null ? Math.round(a.hr) : "",
    a.elevation != null ? a.elevation : ""
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => {
    const s = String(c == null ? "" : c);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(",")).join("\n");
  download("activites-coros-" + todayISO() + ".csv", csv, "text/csv");
}

function setupData() {
  document.getElementById("export-json").addEventListener("click", exportJSON);
  document.getElementById("export-markdown").addEventListener("click", exportMarkdown);
  document.getElementById("export-csv").addEventListener("click", exportCSV);
  document.getElementById("import-json").addEventListener("change", async ev => {
    const file = ev.target.files[0];
    ev.target.value = "";
    const report = document.getElementById("data-report");
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.entries)) throw new Error("format invalide");
      state.entries = data.entries;
      state.settings = Object.assign(state.settings, data.settings || {});
      save();
      renderAll();
      report.textContent = `Sauvegarde importée : ${state.entries.length} entrée(s).`;
      report.classList.remove("error");
    } catch (e) {
      report.textContent = "Import impossible : " + e.message;
      report.classList.add("error");
    }
  });
  document.getElementById("clear-all").addEventListener("click", () => {
    if (!confirm("Effacer définitivement toutes les entrées ? Exporte une sauvegarde avant !")) return;
    state.entries = [];
    save();
    renderAll();
  });
}

/* ---------------- Programme (plan d'entraînement) ---------------- */

const MONTHS_FR = {
  "janv": 0, "jan": 0, "janvier": 0,
  "fevr": 1, "fev": 1, "f\u00e9vr": 1, "f\u00e9v": 1, "f\u00e9vrier": 1, "fevrier": 1,
  "mars": 2, "mar": 2,
  "avr": 3, "avril": 3,
  "mai": 4,
  "juin": 5, "jun": 5,
  "juil": 6, "juill": 6, "jul": 6, "juillet": 6,
  "aout": 7, "ao\u00fbt": 7,
  "sept": 8, "sep": 8, "septembre": 8,
  "oct": 9, "octobre": 9,
  "nov": 10, "novembre": 10,
  "dec": 11, "d\u00e9c": 11, "d\u00e9cembre": 11, "decembre": 11
};

function inferYear(d, today, adjust) {
  if (adjust && d < new Date(today.getFullYear(), today.getMonth(), today.getDate() - 180)) {
    d = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate());
  }
  return d;
}

function cutAt(s, idx, len) {
  return s.slice(0, idx) + " " + s.slice(idx + len);
}

function cleanLabel(s) {
  return s
    .replace(/[\u2013\u2014]+/g, "-")
    .replace(/,\s+/g, " ").replace(/,$/, "")
    .replace(/[\s\u00b7;|]+/g, " ")
    .replace(/:\s+/g, " ")
    .replace(/\(\s*\)/g, "")
    .replace(/^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+/i, "")
    .replace(/^[-\s:]+|[-\s:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractKm(text) {
  let km = null;
  const parRe = /\(([^)]*)\)/g;
  let pm;
  while ((pm = parRe.exec(text))) {
    const m = pm[1].match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:kms|km|k)\b/i);
    if (m) km = parseFloat(m[1].replace(",", "."));
  }
  if (km == null) {
    const m = text.match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:kms|km|k)\b/i);
    if (m) km = parseFloat(m[1].replace(",", "."));
  }
  return km != null && km > 0 && km < 500 ? km : null;
}

function extractDuration(text) {
  let best = null;
  const hRe = /(\d{1,2})\s*h(\d{1,2})?(?!\d)/gi;
  let m;
  while ((m = hRe.exec(text))) {
    const sec = (+m[1]) * 3600 + (m[2] ? +m[2] * 60 : 0);
    if (sec > 0 && (best == null || sec > best)) best = sec;
  }
  const minRe = /(\d{1,3})\s*(?:min|minutes)\b/gi;
  while ((m = minRe.exec(text))) {
    const sec = +m[1] * 60;
    if (sec > 0 && (best == null || sec > best)) best = sec;
  }
  return best;
}

function fmtDurShort(sec) {
  if (!sec) return "\u2014";
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  if (h && m) return h + "h" + String(m).padStart(2, "0");
  if (h) return h + "h";
  return m + " min";
}

function parseDayMonth(text, today) {
  let m = text.match(/(\d{1,2})(?:er)?\s*[/.–-]\s*(\d{1,2})(?:\s*[/.–-]\s*(\d{2,4}))?/);
  if (m) {
    const day = +m[1], mon = +m[2];
    if (day < 1 || day > 31 || mon < 1 || mon > 12) return null;
    let year = m[3] ? +m[3] : today.getFullYear();
    if (year < 100) year += 2000;
    return inferYear(new Date(year, mon - 1, day), today, !m[3]);
  }
  m = text.match(/(\d{1,2})(?:er)?\s+(janvier|f\u00e9vrier|fevrier|mars|avril|mai|juin|juillet|ao\u00fbt|aout|septembre|octobre|novembre|d\u00e9cembre|decembre|janv|jan|f\u00e9vr|fevr|f\u00e9v|fev|avr|juin|juil|juill|sept|oct|nov|d\u00e9c|dec)\b/i);
  if (m) {
    const mon = MONTHS_FR[m[2].toLowerCase().replace(".", "")];
    if (mon == null) return null;
    return inferYear(new Date(today.getFullYear(), mon, +m[1]), today, true);
  }
  return null;
}

function parseDateRange(text, today) {
  const parts = text.split(/\s*[\u2013\u2014-]\s*/);
  if (parts.length < 2) return null;
  const end = parseDayMonth(parts[parts.length - 1], today);
  if (!end) return null;
  let start;
  const headDay = parts[0].match(/^\s*(\d{1,2})\s*$/);
  if (headDay) {
    start = new Date(end.getFullYear(), end.getMonth(), +headDay[1]);
  } else {
    start = parseDayMonth(parts[0], today);
  }
  if (!start) return null;
  if (start > end) start = new Date(end.getFullYear() - 1, start.getMonth(), start.getDate());
  return { start, end };
}

function mkSession(date, week, label, km, dur) {
  return {
    date, week,
    label: label || "S\u00e9ance",
    km: km != null && km > 0 && km < 500 ? km : null,
    dur: dur != null && dur > 0 && dur < 86400 ? dur : null,
    done: false, doneId: null, manual: false
  };
}

function parsePlanLine(line, today, week) {
  const s = line.trim();
  if (!s) return null;
  let d = null, rest = s, m;
  m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    d = new Date(+m[1], +m[2] - 1, +m[3]);
    rest = cutAt(s, m.index, m[0].length);
  }
  if (!d) {
    m = s.match(/(\d{1,2})(?:er)?\s*[/.–-]\s*(\d{1,2})(?:\s*[/.–-]\s*(\d{2,4}))?/);
    if (m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) {
      let year = m[3] ? +m[3] : today.getFullYear();
      if (year < 100) year += 2000;
      d = inferYear(new Date(year, +m[2] - 1, +m[1]), today, !m[3]);
      rest = cutAt(s, m.index, m[0].length);
    }
  }
  if (!d) {
    m = s.match(/(\d{1,2})(?:er)?\s+(?:[a-z\u00e9\u00fb\u00f4\u00e0\u00e8\u00f90-9'.’-]+\s+)?(janvier|f\u00e9vrier|fevrier|mars|avril|mai|juin|juillet|ao\u00fbt|aout|septembre|octobre|novembre|d\u00e9cembre|decembre|janv|jan|f\u00e9vr|fevr|f\u00e9v|fev|avr|juin|juil|juill|sept|oct|nov|d\u00e9c|dec)\b/i);
    if (m) {
      const mon = MONTHS_FR[m[2].toLowerCase().replace(".", "")];
      if (mon != null) {
        d = inferYear(new Date(today.getFullYear(), mon, +m[1]), today, true);
        rest = cutAt(s, m.index, m[0].length);
      }
    }
  }
  if (!d && week) {
    m = s.match(/\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+(\d{1,2})\b/i);
    if (m) {
      const num = +m[2];
      const ws = new Date(week + "T00:00:00");
      for (let i = 0; i < 7 && !d; i++) {
        const cand = new Date(ws);
        cand.setDate(cand.getDate() + i);
        if (cand.getDate() === num) d = cand;
      }
      if (d) rest = cutAt(s, m.index, m[0].length);
    }
  }
  if (!d) return null;
  return mkSession(toISODate(d), week || toISODate(weekStart(d)), cleanLabel(rest), extractKm(rest), extractDuration(rest));
}

function parsePlanText(text) {
  const today = new Date();
  const sessions = [];
  let skipped = 0;
  let cursor = null, week = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^total\b/i.test(line) || /^week-?end\b/i.test(line)) { skipped++; continue; }
    let m = line.match(/^mois\b[^()]*\(([^)]+)\)/i);
    if (m) {
      const r = parseDateRange(m[1], today);
      if (r) cursor = toISODate(r.start);
      continue;
    }
    if (/^semaine\b/i.test(line)) {
      const par = line.match(/\(([^)]+)\)/);
      let start = null;
      if (par) {
        const r = parseDateRange(par[1], today);
        if (r) start = r.start;
      }
      if (!start) start = cursor ? new Date(cursor + "T00:00:00") : weekStart(today);
      week = toISODate(start);
      const next = new Date(start);
      next.setDate(next.getDate() + 7);
      cursor = toISODate(next);
      continue;
    }
    const rep = line.match(/^(\d{1,2})\s*x\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:kms|km|k)\b/i);
    if (rep) {
      if (!week) { skipped++; continue; }
      const n = +rep[1];
      const dist = parseFloat(rep[2].replace(",", "."));
      const restClean = cleanLabel(line.slice(rep[0].length));
      for (let j = 0; j < n; j++) {
        sessions.push(mkSession(null, week, dist + " km" + (restClean ? " \u2014 " + restClean : ""), dist));
      }
      continue;
    }
    if (/^\+/.test(line) && week) {
      const addKm = line.match(/\+?\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*(km|m)\b/i);
      let km = null;
      if (addKm) {
        const unit = addKm[2].toLowerCase();
        km = parseFloat(addKm[1].replace(",", ".")) * (unit === "km" ? 1 : 0.001);
      }
      sessions.push(mkSession(null, week, cleanLabel(line), km, extractDuration(line)));
      continue;
    }
    const dated = parsePlanLine(line, today, week);
    if (dated) { sessions.push(dated); continue; }
    if (week) {
      const label = cleanLabel(line);
      const km = extractKm(line);
      if (sessions.length && sessions[sessions.length - 1].label === "S\u00e9ance") {
        sessions[sessions.length - 1].label = label || "S\u00e9ance";
      } else {
        sessions.push(mkSession(null, week, label, km, extractDuration(line)));
      }
      continue;
    }
    skipped++;
  }
  sessions.sort((a, b) => (a.date || a.week || "").localeCompare(b.date || b.week || ""));
  return { sessions, skipped };
}

function planSummaryHTML(e) {
  const total = e.sessions.length;
  const done = e.sessions.filter(s => s.done).length;
  const km = e.sessions.reduce((s, x) => s + (x.km || 0), 0);
  return `<p class="entry-body">${done}/${total} séances faites${km ? " · " + km.toFixed(1) + " km prévus" : ""}</p>`;
}

function findSessionActivity(s) {
  if (s.doneId) {
    const en = state.entries.find(x => x.type === "activity" && x.id === s.doneId);
    if (en) return en.activity;
  }
  const en = state.entries.find(x => {
    if (x.type !== "activity" || !x.activity) return false;
    const d = parseDate(x.activity.date);
    return d && toISODate(d) === s.date && isRunning(x.activity);
  });
  return en ? en.activity : null;
}

function autoCheckPlan() {
  let changed = false;
  const acts = state.entries.filter(e => e.type === "activity").map(e => e.activity);
  for (const e of state.entries.filter(x => x.type === "plan")) {
    const used = new Set();
    for (const s of e.sessions) {
      if (s.manual) { if (s.doneId) used.add(s.doneId); continue; }
      if (!s.date) continue;
      const match = acts.find(a => {
        if (used.has(a.id)) return false;
        const d = parseDate(a.date);
        return d && toISODate(d) === s.date && isRunning(a);
      });
      const newDone = !!match;
      const newId = match ? match.id : null;
      if (match) used.add(match.id);
      if (s.done !== newDone || (s.doneId || null) !== newId) {
        s.done = newDone;
        s.doneId = newId;
        changed = true;
      }
    }
    for (const s of e.sessions) {
      if (s.manual || s.date || (s.km == null && !s.dur) || !s.week) continue;
      const match = acts.find(a => {
        if (used.has(a.id) || !isRunning(a)) return false;
        const d = parseDate(a.date);
        if (!d) return false;
        const ws = new Date(s.week + "T00:00:00");
        const wen = new Date(ws);
        wen.setDate(wen.getDate() + 6);
        if (d < ws || d > wen) return false;
        if (s.km != null) return Math.abs(a.distance - s.km) <= Math.max(0.8, s.km * 0.15);
        return a.duration > 0 && Math.abs(a.duration - s.dur) <= Math.max(300, s.dur * 0.20);
      });
      const newDone = !!match;
      const newId = match ? match.id : null;
      if (match) used.add(match.id);
      if (s.done !== newDone || (s.doneId || null) !== newId) {
        s.done = newDone;
        s.doneId = newId;
        changed = true;
      }
    }
  }
  if (changed) save();
}

function renderPlan() {
  const wrap = document.getElementById("plan-list");
  if (!wrap) return;
  const plans = sortedEntries().filter(e => e.type === "plan");
  if (!plans.length) {
    wrap.innerHTML = '<p class="hint">Aucun programme importé. Colle ton programme ci-dessus ou importe un fichier .txt / .csv, une séance par ligne avec sa date.</p>';
    return;
  }
  wrap.innerHTML = "";
  for (const e of plans) {
    const card = document.createElement("div");
    card.className = "card plan-card";
    const byWeek = new Map();
    e.sessions.forEach((s, idx) => {
      const k = s.week || (parseDate(s.date) ? toISODate(weekStart(parseDate(s.date))) : "\u2014");
      if (!byWeek.has(k)) byWeek.set(k, []);
      byWeek.get(k).push({ s, idx });
    });
    let html = `
      <div class="entry-head">
        <div><p class="entry-title">${esc(e.title || "Programme")}</p>
        <span class="entry-meta">${e.sessions.length} séances · ${e.sessions.filter(s => s.done).length} faites</span></div>
        <div class="entry-actions">
          <button class="btn" data-precheck="${e.id}">Revérifier les séances faites</button>
          <button class="btn danger" data-pdel="${e.id}">Supprimer</button>
        </div>
      </div>`;
    for (const [wk, list] of [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const kmPrev = list.reduce((s, x) => s + (x.s.km || 0), 0);
      const durPrev = list.reduce((s, x) => s + (x.s.dur || 0), 0);
      let kmFait = 0, durFait = 0, nFait = 0;
      for (const x of list) {
        const act = findSessionActivity(x.s);
        if (x.s.done && act) {
          nFait++;
          if (act.distance != null) kmFait += act.distance;
          if (act.duration != null) durFait += act.duration;
        }
      }
      const start = new Date(wk + "T00:00:00");
      const end = new Date(start); end.setDate(end.getDate() + 6);
      const opts = { day: "numeric", month: "short" };
      html += `<p class="plan-week">Semaine du ${start.toLocaleDateString("fr-FR", opts)} au ${end.toLocaleDateString("fr-FR", opts)} \u2014 pr\u00e9vu ${kmPrev ? kmPrev.toFixed(1) + " km" : "\u2014"}${durPrev ? " \u00b7 " + fmtDurShort(durPrev) : ""} \u00b7 r\u00e9alis\u00e9 ${kmFait ? kmFait.toFixed(1) + " km" : "\u2014"}${durFait ? " \u00b7 " + fmtDurShort(durFait) : ""} \u00b7 ${nFait}/${list.length} s\u00e9ances</p>`;
      html += '<div class="table-wrap"><table><thead><tr><th>Fait</th><th>Date</th><th>Séance prévue</th><th>Prévu</th><th>Réalisé</th><th>Écart</th></tr></thead><tbody>';
      for (const x of list) {
        const act = findSessionActivity(x.s);
        const real = act
          ? [act.distance != null ? act.distance.toFixed(1) + " km" : "", act.duration ? fmtDurShort(act.duration) : ""].filter(Boolean).join(" \u00b7 ")
          : "";
        const prevTxt = x.s.km != null ? x.s.km.toFixed(1) + " km" : (x.s.dur ? fmtDurShort(x.s.dur) : "\u2014");
        const ecart = act && act.distance != null && x.s.km != null
          ? (act.distance - x.s.km > 0 ? "+" : "") + (act.distance - x.s.km).toFixed(1) + " km"
          : "";
        html += `<tr class="${x.s.done ? "session-done" : ""}">
          <td><button class="check-btn" data-ptoggle="${e.id}:${x.idx}" aria-label="Cocher la séance">${x.s.done ? "✓" : ""}</button></td>
          <td>${x.s.date ? esc(fmtDate(x.s.date)) : '<span class="delta-flat">\u00e0 planifier</span>'}</td>
          <td>${esc(x.s.label)}</td>
          <td>${prevTxt}</td>
          <td>${act ? esc((act.title || "Séance") + (real ? " · " + real : "")) : '<span class="delta-flat">—</span>'}</td>
          <td>${ecart ? esc(ecart) : ""}</td>
        </tr>`;
      }
      html += "</tbody></table></div>";
    }
    card.innerHTML = html;
    wrap.appendChild(card);
  }
}

function importPlanText(text, name, report) {
  const { sessions, skipped } = parsePlanText(text);
  if (!sessions.length) {
    report.textContent = "Aucune séance trouvée. Chaque ligne doit contenir une date (ex. « 03/11 Footing 8 km » ou « 3 novembre, sortie longue 90 min »).";
    report.classList.add("error");
    return;
  }
  report.classList.remove("error");
  state.entries.push({
    id: uid(), type: "plan", date: todayISO(),
    title: name || "Programme",
    sessions
  });
  save();
  autoCheckPlan();
  renderAll();
  report.textContent = `Programme importé : ${sessions.length} séance(s)${skipped ? `, ${skipped} ligne(s) ignorée(s) (sans date)` : ""}. Les séances déjà réalisées sont cochées automatiquement.`;
}

function setupPlan() {
  const ta = document.getElementById("plan-text");
  const preview = document.getElementById("plan-preview");
  const showPreview = () => {
    preview.innerHTML = "";
    if (!ta.value.trim()) return;
    const { sessions, skipped } = parsePlanText(ta.value);
    if (!sessions.length) {
      preview.innerHTML = '<p class="hint">Aucune séance reconnue pour le moment. Vérifie qu’il y a des en-têtes « Semaine … » ou des dates (ex. « 03/11 », « 3 novembre »).</p>';
      preview.classList.add("error");
      return;
    }
    preview.classList.remove("error");
    const weeks = [...new Set(sessions.map(s => s.week || s.date))];
    const sample = sessions.slice(0, 8).map(s =>
      `<li>${s.date ? esc(fmtDate(s.date)) : "à planifier"} — ${esc(s.label)}${s.km != null ? " (" + s.km + " km)" : ""}</li>`).join("");
    preview.innerHTML = `<p><strong>${sessions.length} séance(s) reconnue(s)</strong> dans ${weeks.length} semaine(s)${skipped ? " · " + skipped + " ligne(s) ignorée(s)" : ""}</p><ul class="plan-preview-list">${sample}</ul>${sessions.length > 8 ? '<p class="hint">…</p>' : ""}`;
  };
  ta.addEventListener("input", showPreview);
  document.getElementById("plan-import").addEventListener("click", () => {
    importPlanText(document.getElementById("plan-text").value, document.getElementById("plan-name").value.trim(), document.getElementById("plan-report"));
  });
  document.getElementById("plan-file").addEventListener("change", async ev => {
    const files = [...ev.target.files];
    ev.target.value = "";
    const report = document.getElementById("plan-report");
    if (!files.length) return;
    let text = "";
    for (const f of files) text += (await f.text()) + "\n";
    importPlanText(text, files[0].name.replace(/\.[^.]+$/, ""), report);
  });
  document.getElementById("plan-list").addEventListener("click", ev => {
    const btn = ev.target.closest("button");
    if (!btn) return;
    if (btn.dataset.ptoggle) {
      const [pid, idx] = btn.dataset.ptoggle.split(":");
      const e = state.entries.find(x => x.id === pid);
      const s = e && e.sessions[+idx];
      if (!s) return;
      s.manual = true;
      s.done = !s.done;
      s.doneId = s.done ? (findSessionActivity(s) || {}).id || null : null;
      save();
      renderPlan();
      renderJournal();
    } else if (btn.dataset.pdel) {
      if (!confirm("Supprimer ce programme ?")) return;
      state.entries = state.entries.filter(x => x.id !== btn.dataset.pdel);
      save();
      renderAll();
    } else if (btn.dataset.precheck) {
      const e = state.entries.find(x => x.id === btn.dataset.precheck);
      if (!e) return;
      for (const s of e.sessions) s.manual = false;
      autoCheckPlan();
      renderPlan();
      renderJournal();
    }
  });
}

/* ---------------- Navigation ---------------- */

function switchView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById("view-" + name).classList.add("active");
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.view === name));
}

function renderAll() {
  autoCheckPlan();
  renderJournal();
  renderActivitiesTable();
  renderStats();
  renderPlan();
}

function setup() {
  load();
  document.querySelectorAll(".tab").forEach(t =>
    t.addEventListener("click", () => switchView(t.dataset.view)));
  document.querySelectorAll("#journal-filters .chip").forEach(c =>
    c.addEventListener("click", () => {
      document.querySelectorAll("#journal-filters .chip").forEach(x => x.classList.remove("active"));
      c.classList.add("active");
      renderJournal();
    }));
  document.getElementById("journal-search").addEventListener("input", renderJournal);
  document.getElementById("journal-feed").addEventListener("click", ev => {
    const btn = ev.target.closest("button");
    if (!btn) return;
    const art = btn.closest(".entry");
    if (btn.dataset.del) deleteEntry(btn.dataset.del);
    else if (btn.dataset.edit) editTableEntry(btn.dataset.edit);
    else if (btn.dataset.csv) {
      const e = state.entries.find(x => x.id === btn.dataset.csv);
      if (e) download((e.title || "tableau") + ".csv", tableToCSV(e.table), "text/csv");
    }
    else if (btn.dataset.save) saveTableEntry(btn.dataset.save, art);
    else if (btn.dataset.cancel) renderJournal();
    else if (btn.dataset.addrow) {
      const table = art.querySelector("table.editing");
      const tr = document.createElement("tr");
      for (let i = 0; i < table.querySelectorAll("thead th").length; i++) {
        const td = document.createElement("td");
        td.setAttribute("contenteditable", "true");
        tr.appendChild(td);
      }
      table.querySelector("tbody").appendChild(tr);
    }
    else if (btn.dataset.addcol) {
      const table = art.querySelector("table.editing");
      const th = document.createElement("th");
      th.setAttribute("contenteditable", "true");
      table.querySelector("thead tr").appendChild(th);
      table.querySelectorAll("tbody tr").forEach(tr => {
        const td = document.createElement("td");
        td.setAttribute("contenteditable", "true");
        tr.appendChild(td);
      });
    }
  });
  setupNotes();
  setupTables();
  setupCoros();
  setupData();
  setupPlan();
  renderAll();
}

document.addEventListener("DOMContentLoaded", setup);

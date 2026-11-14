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

function normalizeActivity(raw) {
  const a = {};
  for (const [k, v] of Object.entries(raw)) {
    const f = matchField(k);
    if (f && !a[f]) a[f] = v;
  }
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
    source: raw.__source || "import"
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
  const typeLabels = { note: "Note", table: "Tableau", activity: "Activité COROS" };
  for (const e of entries) {
    const div = document.createElement("article");
    div.className = "entry type-" + e.type;
    let body = "";
    if (e.type === "note") body = `<p class="entry-body">${esc(e.content)}</p>`;
    if (e.type === "table") body = renderHTMLTable(e.table);
    if (e.type === "activity") body = activitySummaryHTML(e.activity);
    div.innerHTML = `
      <div class="entry-head">
        <div>
          <p class="entry-title">${esc(e.title || typeLabels[e.type])}</p>
          <span class="entry-meta">${esc(fmtDate(e.date))} · ${typeLabels[e.type] || e.type}</span>
        </div>
        <div class="entry-actions"><button class="btn" data-del="${e.id}">Supprimer</button></div>
      </div>
      ${body}`;
    feed.appendChild(div);
  }
  feed.querySelectorAll("[data-del]").forEach(btn =>
    btn.addEventListener("click", () => deleteEntry(btn.dataset.del)));
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
    for (const file of ev.target.files) total += importCorosActivities(activitiesFromCSV(await file.text(), file.name), report);
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

function renderStats() {
  const acts = runningActivities();
  const cards = document.getElementById("stat-cards");
  const chart = document.getElementById("chart-weeks");
  if (!acts.length) {
    cards.innerHTML = '<p class="hint">Importe des activités COROS pour voir tes statistiques.</p>';
    chart.innerHTML = "";
    return;
  }
  const totalKm = acts.reduce((s, a) => s + a.distance, 0);
  const totalTime = acts.reduce((s, a) => s + (a.duration || 0), 0);
  const totalD = acts.reduce((s, a) => s + (a.elevation || 0), 0);
  const avgPace = totalTime > 0 ? totalTime / totalKm : null;
  const bestPace = Math.min(...acts.filter(a => a.pace).map(a => a.pace));

  const weekKey = d => { const dt = parseDate(d); if (!dt) return null; const t = new Date(dt); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
  const weeks = {};
  for (const a of acts) { const k = weekKey(a.date); if (k) weeks[k] = (weeks[k] || 0) + a.distance; }
  const lastWeeks = Object.keys(weeks).sort().slice(-8);

  cards.innerHTML = [
    [totalKm.toFixed(1) + " km", "Distance totale"],
    [fmtDuration(totalTime), "Temps total"],
    [fmtPace(avgPace), "Allure moyenne"],
    [fmtPace(bestPace), "Meilleure allure"],
    [Math.round(totalD) + " m", "Dénivelé positif"],
    [acts.length, "Activités"]
  ].map(([v, l]) => `<div class="stat"><div class="value">${esc(v)}</div><div class="label">${esc(l)}</div></div>`).join("");

  const max = Math.max(...lastWeeks.map(k => weeks[k]), 1);
  chart.innerHTML = '<div class="chart">' + lastWeeks.map(k => `
    <div class="bar-group">
      <span class="bar-value">${weeks[k].toFixed(1)}</span>
      <div class="bar" style="height:${Math.max(2, (weeks[k] / max) * 100)}%"></div>
      <span class="bar-label">${k.slice(8)}/${k.slice(5, 7)}</span>
    </div>`).join("") + "</div>";
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

/* ---------------- Navigation ---------------- */

function switchView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById("view-" + name).classList.add("active");
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.view === name));
}

function renderAll() {
  renderJournal();
  renderActivitiesTable();
  renderStats();
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
  setupNotes();
  setupTables();
  setupCoros();
  setupData();
  renderAll();
}

document.addEventListener("DOMContentLoaded", setup);

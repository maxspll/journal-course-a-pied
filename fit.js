/* Décodeur FIT (binaire, format Garmin/COROS) et parseur TCX (XML) — sans dépendance. */
"use strict";

const FIT_EPOCH_OFFSET = 631065600; // secondes entre 1970 et le 31/12/1989 (epoch FIT)

const FIT_BASE_TYPES = {
  0:  { size: 1 }, 1:  { size: 1, signed: true }, 2:  { size: 1 },
  3:  { size: 2, signed: true }, 4:  { size: 2 }, 5:  { size: 4, signed: true },
  6:  { size: 4 }, 7:  { size: 0, string: true }, 8:  { size: 4, float: true },
  9:  { size: 8, float: true }, 10: { size: 1 }, 11: { size: 2 },
  12: { size: 4 }, 13: { size: 0 }, 14: { size: 8, signed: true },
  15: { size: 8 }, 16: { size: 8 }
};

const FIT_INVALID = {
  0: 0xFF, 1: 0x80, 2: 0xFF, 3: 0x8000, 4: 0xFFFF, 5: 0x7FFFFFFF, 6: 0xFFFFFFFF,
  7: null, 8: NaN, 9: NaN, 10: 0xFF, 11: 0xFFFF, 12: 0xFFFFFFFF, 13: 0xFF,
  14: "9223372036854775807", 15: "18446744073709551615", 16: 0
};

const FIT_SPORTS = {
  0: "Manuel", 1: "Course à pied", 2: "Vélo", 3: "Natation", 4: "Marche",
  5: "Transition", 6: "Appareil fitness", 7: "Randonnée", 8: "Multisport",
  9: "Tapis roulant", 10: "Vélo d'appartement", 53: "Trail", 76: "Virtuel"
};

function fitTimestamp(seconds) {
  if (seconds == null || seconds <= 0) return null;
  return new Date((seconds + FIT_EPOCH_OFFSET) * 1000);
}

function fitISO(seconds) {
  const d = fitTimestamp(seconds);
  if (!d || isNaN(d)) return null;
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function parseFIT(buffer) {
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const sessions = [], laps = [], hrSamples = [];
  let fileTimeCreated = null;
  const definitions = {};
  let lastTimestamp = null;

  function readBase(pos, baseType, endian) {
    const bt = FIT_BASE_TYPES[baseType];
    if (!bt) return { value: null, next: pos + 1 };
    if (bt.string) {
      let end = pos;
      while (end < bytes.length && bytes[end] !== 0) end++;
      let s = "";
      for (let i = pos; i < end; i++) s += String.fromCharCode(bytes[i]);
      return { value: s, next: end + 1 };
    }
    const size = bt.size;
    if (pos + size > bytes.length) return { value: null, next: bytes.length };
    let v;
    const le = endian === 0;
    if (bt.float) {
      v = size === 4 ? dv.getFloat32(pos, le) : dv.getFloat64(pos, le);
      if (isNaN(v)) v = null;
    } else if (size === 1) {
      v = bt.signed ? dv.getInt8(pos) : dv.getUint8(pos);
    } else if (size === 2) {
      v = bt.signed ? dv.getInt16(pos, le) : dv.getUint16(pos, le);
    } else if (size === 4) {
      v = bt.signed ? dv.getInt32(pos, le) : dv.getUint32(pos, le);
    } else if (size === 8) {
      v = bt.signed ? dv.getBigInt64(pos, le) : dv.getBigUint64(pos, le);
      v = v > 9007199254740991n ? null : Number(v);
    } else {
      v = null;
    }
    if (v != null && FIT_INVALID[baseType] !== undefined) {
      const inv = FIT_INVALID[baseType];
      if (typeof inv === "string" ? String(v) === inv : v === inv) v = null;
      if (baseType === 16 && v === 0) v = null;
    }
    return { value: v, next: pos + size };
  }

  function handleDefinition(pos, header) {
    const localType = header & 0xF;
    if (pos + 6 > bytes.length) return bytes.length;
    const architecture = bytes[pos + 1];
    const globalMsg = architecture === 0 ? dv.getUint16(pos + 2, true) : dv.getUint16(pos + 2, false);
    const numFields = bytes[pos + 4];
    let p = pos + 5;
    const fields = [];
    for (let i = 0; i < numFields; i++) {
      if (p + 3 > bytes.length) return bytes.length;
      fields.push({ num: bytes[p], size: bytes[p + 1], baseType: bytes[p + 2] & 0x1F });
      p += 3;
    }
    if (header & 0x20) {
      const devCount = bytes[p];
      p++;
      const devSizes = [];
      for (let i = 0; i < devCount; i++) {
        if (p + 3 > bytes.length) return bytes.length;
        devSizes.push(bytes[p + 1]);
        p += 3;
      }
      definitions[localType] = { globalMsg, fields, devSizes, endian: architecture };
      return p;
    }
    definitions[localType] = { globalMsg, fields, devSizes: [], endian: architecture };
    return p;
  }

  function handleData(pos, header) {
    const localType = header & 0xF;
    const def = definitions[localType];
    if (!def) return bytes.length;
    const msg = {};
    let p = pos + 1;
    for (const f of def.fields) {
      if (f.size === 0) continue;
      const r = readBase(p, f.baseType, def.endian);
      msg[f.num] = r.value;
      p += f.size;
    }
    p += def.devSizes.reduce((s, n) => s + n, 0);
    if (msg[253] != null) lastTimestamp = msg[253];
    switch (def.globalMsg) {
      case 0:
        if (msg[4] != null) fileTimeCreated = msg[4];
        break;
      case 18:
        sessions.push(msg);
        break;
      case 19:
        laps.push(msg);
        break;
      case 20:
        if (msg[3] != null && msg[3] > 0) hrSamples.push(msg[3]);
        break;
    }
    return p;
  }

  function defSize(def) {
    return def.fields.reduce((s, f) => s + f.size, 0);
  }

  let pos = 0;
  while (pos + 12 <= bytes.length) {
    const headerSize = bytes[pos];
    if (headerSize !== 12 && headerSize !== 14 || bytes[pos + 8] !== 0x2E || bytes[pos + 9] !== 0x46 || bytes[pos + 10] !== 0x49 || bytes[pos + 11] !== 0x54) {
      pos++;
      continue;
    }
    const dataSize = dv.getUint32(pos + 4, true);
    let p = pos + headerSize;
    const dataEnd = Math.min(p + dataSize, bytes.length);
    definitions.length = 0;
    for (const k in definitions) delete definitions[k];
    lastTimestamp = null;
    while (p < dataEnd) {
      const header = bytes[p];
      let next;
      if (header & 0x80) {
        const localType = (header >> 5) & 0x3;
        const def = definitions[localType];
        if (!def) { p++; continue; }
        const offset = header & 0x1F;
        let ts = lastTimestamp == null ? offset : (lastTimestamp - (lastTimestamp % 32)) + offset;
        if (lastTimestamp != null && ts < lastTimestamp) ts += 32;
        const msg = { 253: ts };
        let q = p + 1;
        for (const f of def.fields) {
          if (f.size === 0) continue;
          const r = readBase(q, f.baseType, def.endian);
          if (msg[f.num] === undefined) msg[f.num] = r.value;
          q += f.size;
        }
        if (msg[3] != null && msg[3] > 0) hrSamples.push(msg[3]);
        p = q;
      } else if (header & 0x40) {
        next = handleDefinition(p + 1, header);
        p = next;
      } else {
        next = handleData(p, header);
        p = next <= p ? p + 1 : next;
      }
    }
    pos = dataEnd;
  }

  function buildActivity(s) {
    let sport = s[4];
    if (sport == null || sport < 0 || sport > 100 || !FIT_SPORTS[sport] || (sport === 0 && s[5])) {
      sport = s[5] != null && s[5] >= 0 && s[5] <= 100 ? s[5] : null;
    }
    const raw = {
      "Date": fitISO(s[2] != null ? s[2] : s[253] != null ? s[253] : fileTimeCreated),
      "Type": FIT_SPORTS[sport] || (sport != null ? "Sport " + sport : "Course"),
      "Distance": s[9] != null ? s[9] / 100000 : null,
      "Duration": s[8] != null ? s[8] / 1000 : (s[7] != null ? s[7] / 1000 : null),
      "Avg HR": s[16] != null && s[16] > 0 ? s[16] : null,
      "Max HR": s[17] != null && s[17] > 0 ? s[17] : null,
      "Elevation Gain": s[22] != null ? s[22] : null,
      "Calories": s[11] != null && s[11] > 0 ? s[11] : null
    };
    if (raw["Avg HR"] == null && hrSamples.length) {
      raw["Avg HR"] = Math.round(hrSamples.reduce((a, b) => a + b, 0) / hrSamples.length);
    }
    return raw;
  }

  const activities = [];
  for (const s of sessions) activities.push(buildActivity(s));
  if (!activities.length && laps.length) {
    const agg = laps.reduce((acc, l) => {
      acc.d += (l[9] || 0) / 100000;
      acc.t += (l[8] || l[7] || 0) / 1000;
      acc.cal = Math.max(acc.cal, l[11] || 0);
      acc.hrMax = Math.max(acc.hrMax, l[16] || 0);
      if (l[15]) acc.hrSum += l[15], acc.hrN++;
      if (l[21]) acc.ascent = Math.max(acc.ascent, l[21]);
      if (!acc.date && l[2]) acc.date = fitISO(l[2]);
      return acc;
    }, { d: 0, t: 0, cal: 0, hrMax: 0, hrSum: 0, hrN: 0, ascent: 0, date: null });
    activities.push({
      "Date": agg.date,
      "Type": "Course à pied",
      "Distance": agg.d || null,
      "Duration": agg.t || null,
      "Avg HR": agg.hrN ? Math.round(agg.hrSum / agg.hrN) : (hrSamples.length ? Math.round(hrSamples.reduce((a, b) => a + b, 0) / hrSamples.length) : null),
      "Max HR": agg.hrMax || null,
      "Elevation Gain": agg.ascent || null,
      "Calories": agg.cal || null
    });
  }
  return activities.filter(a => a.Date || a.Distance != null || a.Duration != null);
}

function parseTCX(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) return [];
  const out = [];
  const activities = doc.getElementsByTagName("Activity");
  for (const act of activities) {
    const sport = act.getAttribute("Sport") || "Course";
    const idEl = act.getElementsByTagName("Id")[0];
    const date = idEl ? idEl.textContent.trim().slice(0, 10) : null;
    let distance = 0, duration = 0, calories = 0, maxHr = 0, hrSum = 0, hrN = 0;
    const laps = act.getElementsByTagName("Lap");
    for (const lap of laps) {
      const get = tag => {
        const el = lap.getElementsByTagName(tag)[0];
        return el ? parseFloat(el.textContent) : 0;
      };
      distance += get("DistanceMeters") / 1000;
      duration += get("TotalTimeSeconds");
      calories += get("Calories");
      const mh = lap.getElementsByTagName("MaximumHeartRateBpm")[0];
      if (mh) maxHr = Math.max(maxHr, parseFloat(mh.textContent) || 0);
      const ah = lap.getElementsByTagName("AverageHeartRateBpm")[0];
      if (ah) { hrSum += parseFloat(ah.textContent) || 0; hrN++; }
    }
    if (!hrN) {
      const points = act.getElementsByTagName("HeartRateBpm");
      for (const p of points) { hrSum += parseFloat(p.textContent) || 0; hrN++; }
    }
    const sportLabels = { Running: "Course à pied", Biking: "Vélo", Swimming: "Natation", Walking: "Marche", Other: "Autre" };
    out.push({
      "Date": date,
      "Type": sportLabels[sport] || sport,
      "Distance": distance || null,
      "Duration": duration || null,
      "Avg HR": hrN ? Math.round(hrSum / hrN) : null,
      "Max HR": maxHr || null,
      "Elevation Gain": null,
      "Calories": calories || null
    });
  }
  return out;
}

if (typeof module !== "undefined") {
  module.exports = { parseFIT, parseTCX, fitISO };
}

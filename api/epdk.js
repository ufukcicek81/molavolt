export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(204).end();

  const https = await import("https");

  function epdkRequest(bodyValue, label) {
    return new Promise((resolve) => {
      const body = bodyValue;
      const headers = {
        Accept: "application/json,text/plain,*/*",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "User-Agent": "MolaVolt/1.0"
      };
      const options = {
        hostname: "apigateway.epdk.gov.tr",
        path: "/sarjIstasyonlari/",
        method: "GET",
        headers,
        timeout: 45000
      };
      const request = https.request(options, (response) => {
        let data = "";
        response.on("data", chunk => { data += chunk; });
        response.on("end", () => {
          let json = null;
          try { json = JSON.parse(data); } catch (e) {}
          resolve({label, statusCode: response.statusCode || 500, raw: data, json});
        });
      });
      request.on("timeout", () => request.destroy(new Error("EPDK timeout")));
      request.on("error", (error) => resolve({
        label,
        statusCode: 502,
        raw: JSON.stringify({ok:false,error:"EPDK bağlantı hatası",detail:error.message}),
        json: null
      }));
      request.write(body);
      request.end();
    });
  }

  function getRows(json) {
    if (!json) return [];
    if (Array.isArray(json)) return json;
    if (Array.isArray(json.result)) return json.result;
    if (json.result && Array.isArray(json.result.rows)) return json.result.rows;
    if (json.data && Array.isArray(json.data)) return json.data;
    if (json.data && Array.isArray(json.data.result)) return json.data.result;
    return [];
  }

  function rowObject(row, cols) {
    if (!Array.isArray(row)) return row || {};
    const o = {};
    (cols || []).forEach((c, i) => o[c] = row[i]);
    return o;
  }

  function parseMaybe(v) {
    if (typeof v !== "string") return v;
    const t = v.trim();
    if (!t) return v;
    try { return JSON.parse(t); } catch (e) {}
    return v;
  }

  function firstValue(o, keys) {
    for (const key of keys) {
      if (o && o[key] !== undefined && o[key] !== null && String(o[key]).trim() !== "") return o[key];
    }
    return "";
  }

  function num(v) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const m = String(v ?? "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : NaN;
  }

  function priceValue(o) {
    if (!o || typeof o !== "object") return NaN;
    const direct = firstValue(o, [
      "soketFiyati", "soketFiyat", "birimFiyat", "birimFiyatTl", "birimFiyatTL",
      "sarjHizmetiFiyati", "sarjHizmetiFiyat", "hizmetFiyati", "hizmetFiyat",
      "fiyat", "fiyatTl", "fiyatTL", "price", "tarife", "ucret", "ücret"
    ]);
    const n = num(direct);
    return Number.isFinite(n) ? n : NaN;
  }

  function power(o) {
    return firstValue(o, ["soketGucu", "soketGücü", "guc", "güç", "kw", "power", "gucKw"]);
  }

  function addPriceToPower(p, price) {
    const base = String(p ?? "").trim();
    if (!Number.isFinite(price)) return base;
    const priceText = `${price.toFixed(2)} TL/kWh`;
    if (base && /TL\s*\/\s*kWh/i.test(base)) return base;
    return base ? `${base} · ${priceText}` : priceText;
  }

  function enrichRow(raw, cols) {
    const r = rowObject(parseMaybe(raw), cols);
    const brand = firstValue(r, [
      "markaAdi", "marka", "tescilliMarka", "markaAd", "sarjAgiMarka",
      "sarjAgiIsletmecisiMarka", "saglayiciMarka", "operatorMarka",
      "sarjAgiIsletmecisiUnvan", "sarjIstasyonuIsletmecisi"
    ]);
    if (brand) {
      r.marka = String(brand).trim();
      r.markaAdi = String(brand).trim();
    }

    const socketKey = ["soketler", "sockets", "socketler", "sarjSoketleri", "sarjIstasyonuSoketleri", "sarjUniteleri"]
      .find(k => r[k] !== undefined && r[k] !== null);
    let sockets = socketKey ? parseMaybe(r[socketKey]) : [];
    if (!Array.isArray(sockets)) sockets = sockets ? [sockets] : [];

    const stationPrice = priceValue(r);
    if (sockets.length) {
      r.soketler = sockets.map((rawSocket) => {
        const s = typeof rawSocket === "object" ? {...rawSocket} : {soketTipi: String(rawSocket)};
        const p = Number.isFinite(priceValue(s)) ? priceValue(s) : stationPrice;
        const pw = power(s);
        if (pw || Number.isFinite(p)) s.soketGucu = addPriceToPower(pw, p);
        if (Number.isFinite(p)) {
          s.soketFiyati = p;
          s.birimFiyat = p;
          s.fiyat = p;
        }
        return s;
      });
    } else if (Number.isFinite(stationPrice)) {
      r.soketler = [{soketGucu:`${stationPrice.toFixed(2)} TL/kWh`,soketFiyati:stationPrice,birimFiyat:stationPrice}];
    }
    return r;
  }

  function normalizeResponse(json) {
    const cols = json && Array.isArray(json.columnNames) ? json.columnNames : [];
    const rows = getRows(json);
    if (!rows.length) return json;
    const normalizedRows = rows.map(row => enrichRow(row, cols));
    if (Array.isArray(json)) return normalizedRows;
    if (json && Array.isArray(json.result)) return {...json, result: normalizedRows};
    if (json && json.result && Array.isArray(json.result.rows)) return {...json, result: {...json.result, rows: normalizedRows}};
    if (json && Array.isArray(json.data)) return {...json, data: normalizedRows};
    if (json && json.data && Array.isArray(json.data.result)) return {...json, data: {...json.data, result: normalizedRows}};
    return json;
  }

  function hasData(r) {
    const rows = getRows(r.json);
    if (rows.length > 0) return true;
    return !!(r.json && typeof r.json.numRows === "number" && r.json.numRows > 0);
  }

  const attempts = [
    {label:"GET body boş obje", body:"{}"},
    {label:"GET body boş string", body:JSON.stringify("")},
    {label:"GET body string obje", body:JSON.stringify("{}")},
    {label:"GET body null alanlar", body:JSON.stringify({lisansNo:null,sarjIstasyonuAdi:null,sarjIstasyonuNo:null,markaAdi:null,yesilSarjIstasyonuMu:null,hizmetSekli:null})},
    {label:"GET body boş alanlar", body:JSON.stringify({lisansNo:"",sarjIstasyonuAdi:"",sarjIstasyonuNo:"",markaAdi:"",yesilSarjIstasyonuMu:"",hizmetSekli:""})}
  ];

  const logs = [];
  for (const attempt of attempts) {
    const r = await epdkRequest(attempt.body, attempt.label);
    logs.push({label:r.label,statusCode:r.statusCode,numRows:r.json&&typeof r.json.numRows==="number"?r.json.numRows:getRows(r.json).length,sample:r.raw.slice(0,300)});
    if (r.statusCode === 200 && hasData(r)) {
      const normalized = normalizeResponse(r.json);
      return res.status(200).send(JSON.stringify(normalized));
    }
  }

  return res.status(502).send(JSON.stringify({
    ok:false,
    error:"EPDK bağlantısı çalıştı ama veri dönmedi",
    note:"Tüm GET body formatları denendi. EPDK geçici kota/boş cevap dönmüş olabilir.",
    attempts:logs
  }, null, 2));
}

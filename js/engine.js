/* ================= Datasets ================= */
const DATASETS = {
  villages:   { file: "villages.csv", cols: ["village","block","district","lat","lng","population","households"],   need: ["village","lat","lng","population","households"], num: ["lat","lng","population","households"],
                about: "One row per village or hamlet: centre point and Census population/households. Used for market reach." },
  businesses: { file: "businesses.csv", cols: ["name","category","lat","lng","source","verified","ref"], need: ["name","category","lat","lng","source"], num: ["lat","lng"],
                about: "Every existing business you know of, from OSM, FSSAI, Udyam and your field survey. Used for competitors and opportunities. Approved entries are added on top; businesses marked closed are left out." },
  categories: { file: "categories.csv", cols: ["category","label_en","label_hi","label_mr","households_per_unit","setup_cost_min","setup_cost_typical","monthly_profit_typical","monthly_running_cost","channels","strength","weakness"], need: ["category","label_en","households_per_unit","setup_cost_min","setup_cost_typical","monthly_profit_typical","monthly_running_cost"],
                num: ["households_per_unit","setup_cost_min","setup_cost_typical","monthly_profit_typical","monthly_running_cost"],
                about: "One row per business type: how many households one unit needs, setup cost, typical profit and running cost, sales channels, strength and weakness." },
  prices:     { file: "prices.csv", cols: ["category","item","unit","low","high","source"],     need: ["category","item","unit","low","high"], num: ["low","high"],
                about: "Local price ranges per business type. Approved price entries are added on top." },
  threats:    { file: "threats.csv", cols: ["category","threat","months","source"],    need: ["category","threat"], num: [],
                about: "Known risks per business type. 'months' lists risky months as numbers separated by ; (e.g. 4;5;6)." }
};

const Data = {
  raw: {}, rows: {}, origin: {}, errors: {}, cache: null,

  async loadAll() {
    for (const [key, ds] of Object.entries(DATASETS)) {
      let txt = null, origin = "embedded";
      if (location.protocol !== "file:") {
        try {
          const r = await fetch("data/" + ds.file, { cache: "no-store" });
          if (r.ok) { txt = await r.text(); origin = "folder"; }
        } catch (e) {}
      }
      if (txt === null) txt = (window.SAMPLE_CSV || {})[key] || "";
      this.set(key, txt, origin);
    }
  },

  parse(key, text) {
    const ds = DATASETS[key];
    const res = Papa.parse(String(text).replace(/^\ufeff/, "").trim(), { header: true, skipEmptyLines: true, transformHeader: h => h.trim().toLowerCase() });
    const cols = res.meta.fields || [];
    const missing = ds.need.filter(c => !cols.includes(c));
    const rows = [], bad = [];
    res.data.forEach((r, i) => {
      const o = {};
      for (const k in r) o[k] = typeof r[k] === "string" ? r[k].trim() : r[k];
      ds.num.forEach(c => { const v = String(o[c] ?? "").replace(/[,₹\s]/g, ""); o[c] = v === "" ? NaN : Number(v); });
      const okGeo = !("lat" in o) || (isFinite(o.lat) && isFinite(o.lng) && Math.abs(o.lat) <= 90 && Math.abs(o.lng) <= 180 && o.lat !== 0 && o.lng !== 0);
      const okReq = ds.need.every(c => o[c] !== undefined && o[c] !== "" && !(ds.num.includes(c) && !isFinite(o[c])));
      if (okGeo && okReq) rows.push(o); else bad.push(i + 2);   // i + 2 = spreadsheet row number
    });
    return { cols, missing, rows, bad };
  },

  set(key, text, origin) {
    const p = this.parse(key, text);
    this.errors[key] = p.missing.length ? "Missing columns: " + p.missing.join(", ") : "";
    this.raw[key] = text; this.rows[key] = p.rows; this.origin[key] = origin; this.cache = null;
  },

  isPlaceholder() { return (this.rows.villages || []).some(v => v.block === "Sample Block"); },

  /* Base CSV data + approved entries (single records and CSV batches) − businesses marked closed */
  view() {
    if (this.cache) return this.cache;
    const sub = Store.db.submissions.filter(s => s.status === "approved");
    const one = type => sub.filter(s => s.type === type).map(s => ({ ...s.data, _key: s.id, surveyId: s.id }));
    const batch = k => sub.filter(s => s.type === "batch" && s.data.dataset === k)
      .flatMap(s => s.data.rows.map((r, i) => ({ ...r, _key: s.id + ":" + i, batchId: s.id })));
    const closed = new Set(Store.db.closed.map(c => c.key));
    const villages = this.rows.villages.concat(one("village"), batch("villages"));
    const businesses = this.rows.businesses.map(b => ({ ...b, _key: "csv:" + b.name + "|" + b.lat + "|" + b.lng }))
      .concat(one("business").map(b => ({ ...b, verified: "yes" })), batch("businesses"))
      .filter(b => !closed.has(b._key));
    const prices = this.rows.prices.concat(one("price").map(p => ({ ...p, source: (p.source || "") + (p.village ? " (" + p.village + ")" : "") })), batch("prices"));
    const threats = this.rows.threats.concat(one("threat"), batch("threats"));
    const catBy = {};
    this.rows.categories.concat(batch("categories")).forEach(c => { catBy[c.category] = c; });
    const categories = Object.values(catBy);
    const catMap = Object.fromEntries(categories.map(c => [c.category, c]));
    return (this.cache = { villages, businesses, prices, threats, categories, catMap });
  },

  toCSV(key) {
    const clean = r => { const o = {}; DATASETS[key].cols.forEach(c => { o[c] = r[c] ?? ""; }); return o; };
    return Papa.unparse(this.view()[key].map(clean), { columns: DATASETS[key].cols });
  },
  template(key) { return Papa.unparse({ fields: DATASETS[key].cols, data: [] }); }
};

/* ================= Geo ================= */
function distKm(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* ================= Scheme rules (admin-editable) ================= */
const RULES = {
  marginShare: 0.10,
  projectCeiling: 5000000,
  schemes: {
    micro: { maxCost: 140000,  loanCap: 125000,  rate: 0.065, years: 3, morMonths: 3 },
    term:  { maxCost: 5000000, loanCap: 4500000, rate: 0.08,  years: 7, morMonths: 6 }
  },
  wcMonths: 3
};

function structure(cost) {
  const key = cost <= RULES.schemes.micro.maxCost ? "micro" : "term", sc = RULES.schemes[key];
  const loan = Math.min(cost * (1 - RULES.marginShare), sc.loanCap);
  return { key, sc, cost, loan, contrib: cost - loan };
}

function schedule(loan, sc, capitalise) {
  const r = sc.rate / 4, mq = sc.morMonths / 3, n = sc.years * 4 - mq, rows = [];
  let bal = loan, q = 0;
  for (let i = 0; i < mq; i++) {
    const open = bal, int = bal * r;
    if (capitalise) { bal += int; rows.push({ q: ++q, open, int, prin: 0, pay: 0, close: bal, mor: true }); }
    else rows.push({ q: ++q, open, int, prin: 0, pay: int, close: bal, mor: true });
  }
  const emi = bal * r / (1 - Math.pow(1 + r, -n));
  for (let i = 0; i < n; i++) {
    const open = bal, int = bal * r;
    const prin = i === n - 1 ? bal : emi - int;
    bal = Math.max(0, bal - prin);
    rows.push({ q: ++q, open, int, prin, pay: int + prin, close: bal });
  }
  const totalPay = rows.reduce((a, x) => a + x.pay, 0);
  return { rows, emi, totalPay, totalInt: totalPay - loan };
}

function maxPlan(m) {
  const notes = [];
  let cost = Math.min(m / RULES.marginShare, RULES.projectCeiling);
  if (m / RULES.marginShare > RULES.projectCeiling) notes.push(["info", "ceiling", {}]);
  let p = structure(cost);
  if (p.key === "micro" && cost * (1 - RULES.marginShare) > p.sc.loanCap) {
    cost = m + p.sc.loanCap; p = structure(cost);
    notes.push(["warn", "capMicro", { p: cost, m }]);
  }
  return { p, notes };
}

function buildPlan(m, need, capitalise) {
  const max = maxPlan(m);
  let p = max.p, notes = max.notes.slice();
  if (need > 0) {
    if (need > RULES.projectCeiling) notes.unshift(["bad", "over50", {}]);
    else {
      const pn = structure(need);
      if (pn.contrib > m) notes.unshift(["bad", "tooBig", { n: need, req: pn.contrib, gap: pn.contrib - m }]);
      else {
        const full = schedule(p.loan, p.sc, capitalise), own = schedule(pn.loan, pn.sc, capitalise);
        notes = [];
        if (pn.cost < p.cost - 1) notes.push(["good", "right", { n: need, max: p.cost, save: full.totalInt - own.totalInt }]);
        p = pn;
      }
    }
  }
  return { p, notes, max: max.p, sch: schedule(p.loan, p.sc, capitalise), free: m - p.contrib };
}

/* ================= Feasibility analysis ================= */
function analyse(S, D) {
  const site = { lat: S.lat, lng: S.lng };
  const vil = D.villages.map(v => ({ ...v, d: distKm(site, v) }));
  const within = r => { const vs = vil.filter(v => v.d <= r); return { r, n: vs.length, pop: vs.reduce((a, v) => a + (v.population || 0), 0), hh: vs.reduce((a, v) => a + (v.households || 0), 0) }; };
  const radii = [...new Set([2, 5, S.R])].sort((a, b) => a - b);
  const reach = radii.map(within);
  const hhR = within(S.R).hh;

  const biz = D.businesses.map(b => ({ ...b, d: distKm(site, b) }));
  const inR = biz.filter(b => b.d <= S.R);
  const cat = D.catMap[S.cat] || {};
  const comp = biz.filter(b => b.category === S.cat).sort((a, b) => a.d - b.d);
  const compR = comp.filter(b => b.d <= S.R), comp1 = comp.filter(b => b.d <= 1);

  const supplyOf = c => {
    const n = inR.filter(b => b.category === c.category).length;
    const exp = c.households_per_unit > 0 ? hhR / c.households_per_unit : 0;
    return { c, n, exp, ratio: exp > 0 ? n / exp : (n ? Infinity : 0) };
  };
  const supply = D.categories.map(supplyOf).sort((a, b) => a.ratio - b.ratio);
  const mine = supply.find(x => x.c.category === S.cat) || { n: 0, exp: 0, ratio: 0 };
  const satKey = r => r < 0.7 ? "u" : r <= 1.2 ? "b" : "s";

  const sources = {};
  compR.forEach(b => { const s = b.source || "Unknown"; sources[s] = sources[s] || { n: 0, v: 0 }; sources[s].n++; if (/^y/i.test(b.verified || "")) sources[s].v++; });

  const plan = S.m > 0 ? buildPlan(S.m, S.cost, S.cap) : null;
  const dscr = plan && S.profit > 0 ? (S.profit * 3) / plan.sch.emi : null;

  // score, fully explained in the report
  const r = mine.ratio;
  const pDemand = r <= 0.6 ? 40 : r >= 1.6 ? 0 : 40 * (1.6 - r);
  const pProx = Math.max(0, 20 - 4 * comp1.length);
  const afford = plan ? plan.max.cost : 0;
  const cMin = cat.setup_cost_min || 0, cTyp = cat.setup_cost_typical || 0;
  const pBudget = !plan ? 0 : afford >= cTyp ? 25 : afford >= cMin && cTyp > cMin ? 12 + 13 * (afford - cMin) / (cTyp - cMin) : 0;
  const pRepay = dscr === null ? 0 : dscr >= 1.5 ? 15 : dscr >= 1.2 ? 8 : 0;
  const score = Math.round(pDemand + pProx + pBudget + pRepay);

  return {
    cat, reach, hhR, comp, compR, comp1, nearest: comp[0] ? comp[0].d : null,
    supply, mine, sat: satKey(r), satKey, sources, plan, dscr, afford,
    parts: [["p_demand", pDemand, 40], ["p_prox", pProx, 20], ["p_budget", pBudget, 25], ["p_repay", pRepay, 15]],
    score, level: score >= 70 ? "good" : score >= 50 ? "care" : "bad",
    prices: D.prices.filter(p => p.category === S.cat),
    threats: D.threats.filter(t => t.category === S.cat),
    nBiz: D.businesses.length
  };
}

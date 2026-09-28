/* ================= Helpers ================= */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rupee = n => "₹" + Math.round(n).toLocaleString("en-IN");
const numIn = v => { const n = Number(String(v).replace(/[^\d.]/g, "")); return isFinite(n) && n > 0 ? n : 0; };
const km = d => (d < 1 ? d.toFixed(2) : d.toFixed(1));
const when = ts => new Date(ts).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const App = {
  lang: "en", user: null, view: null, map: null, S: null, supportPrefill: null,
  sel: null, filter: "active", subTab: "report", addTab: "business", showAll: false
};

function t(k) { return (I18N[App.lang] && I18N[App.lang][k] !== undefined) ? I18N[App.lang][k] : (I18N.en[k] ?? k); }
function fill(k, vars) { return t(k).replace(/\{(\w+)\}/g, (_, x) => vars[x] ?? ""); }
function money(vars) { const o = {}; for (const k in vars) o[k] = typeof vars[k] === "number" ? rupee(vars[k]) : vars[k]; return o; }
function catLabel(key) {
  const c = Data.view().catMap[key]; if (!c) return key;
  return (App.lang !== "en" && c["label_" + App.lang]) || c.label_en || key;
}
function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove("on"), 2600); }
function statusPill(s) {
  const map = { pending: ["p", "Pending"], approved: ["u", "Approved"], rejected: ["s", "Rejected"],
                open: ["s", t("st_open")], progress: ["p", t("st_progress")], forwarded: ["b", t("st_forwarded")], resolved: ["u", t("st_resolved")] };
  const [c, l] = map[s] || ["g", s]; return `<span class="pill ${c}">${esc(l)}</span>`;
}
function catOptions(sel) { return Data.view().categories.map(c => `<option value="${esc(c.category)}"${c.category === sel ? " selected" : ""}>${esc(catLabel(c.category))}</option>`).join(""); }
function villageOptions(sel) { return Data.view().villages.map(v => `<option${v.village === sel ? " selected" : ""}>${esc(v.village)}</option>`).join(""); }
function nearestVillage(p) { let best = null, bd = 1e9; Data.view().villages.forEach(v => { const d = distKm(p, v); if (d < bd) { bd = d; best = v; } }); return best; }

/* ================= Map ================= */
function makeMap(el, center, zoom) {
  if (App.map) { App.map.remove(); App.map = null; }
  const map = L.map(el, { preferCanvas: true, zoomControl: true }).setView(center, zoom);
  const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
  const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Imagery &copy; Esri" });
  L.control.layers({ "Map": osm, "Satellite": sat }, null, { position: "topright" }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);
  App.map = map; return map;
}
const pin = cls => L.divIcon({ className: "", html: `<div class="${cls}"></div>`, iconSize: [22, 22], iconAnchor: [11, 26] });
function villageLayer() {
  const g = L.layerGroup();
  Data.view().villages.forEach(v => {
    L.circleMarker([v.lat, v.lng], { radius: 4, color: "#333", weight: 1.5, fillColor: "#fff", fillOpacity: 1 })
      .bindTooltip(esc(v.village), { permanent: true, direction: "right", className: "vlabel", offset: [4, 0] }).addTo(g);
  });
  return g;
}
function legend(html, pos = "bottomleft") {
  const c = L.control({ position: pos });
  c.onAdd = () => { const d = L.DomUtil.create("div", "legend"); d.innerHTML = html; L.DomEvent.disableClickPropagation(d); return d; };
  return c;
}

/* ================= Shell / routing ================= */
const NAV = {
  user: ["advisor", "support"],
  officer: ["queue", "surveymap", "data"],
  helpdesk: ["tickets"],
  dataentry: ["add", "mine"]
};
const NAVKEY = { advisor: "nav_advisor", support: "nav_support", add: "nav_add", mine: "nav_mine", queue: "nav_queue", surveymap: "nav_surveymap", data: "nav_data", tickets: "nav_tickets" };

function renderBar() {
  document.documentElement.lang = App.lang;
  $("#brandSub").textContent = t("brandSub");
  const flag = $("#sampleFlag"); flag.hidden = !Data.isPlaceholder(); flag.textContent = t("sampleFlag");
  flag.title = "Replace the CSV files in the data folder with your field data.";
  $("#lang").value = App.lang;
  const u = App.user;
  $("#who").innerHTML = u ? `<b>${esc(u.name)}</b> · ${esc(t("role_" + u.role))}` : "";
  $("#logout").hidden = !u; $("#logout").textContent = t("logout");
  const nav = $("#nav"); nav.innerHTML = "";
  if (!u) return;
  const db = Store.db;
  const counts = {
    queue: db.submissions.filter(s => s.status === "pending").length + db.tickets.filter(x => x.status === "forwarded").length,
    tickets: db.tickets.filter(x => x.status === "open").length,
    mine: db.submissions.filter(s => s.by === u.u && s.status === "rejected").length
  };
  NAV[u.role].forEach(v => {
    const b = document.createElement("button"); b.type = "button";
    b.innerHTML = esc(t(NAVKEY[v])) + (counts[v] ? `<span class="count">${counts[v]}</span>` : "");
    if (v === App.view) b.setAttribute("aria-current", "page");
    b.onclick = () => go(v); nav.appendChild(b);
  });
}

function go(view) {
  if (App.map) { App.map.remove(); App.map = null; }
  App.view = view; App.sel = null;
  renderBar();
  const V = { advisor: viewAdvisor, support: viewSupport, add: viewAdd, mine: viewMine, queue: viewQueue, surveymap: viewSurveyMap, data: viewData, tickets: viewTickets };
  (V[view] || viewLogin)();
  window.scrollTo(0, 0);
}

function start() {
  App.user = Store.current();
  if (!App.user) { App.view = null; renderBar(); viewLogin(); return; }
  go(NAV[App.user.role][0]);
}

/* ================= Login ================= */
function viewLogin() {
  const demo = Store.db.users.map(u => `<tr><td>${esc(t("role_" + u.role))}</td><td><code>${esc(u.u)}</code> / <code>${esc(u.p)}</code></td>
     <td><button type="button" class="btn-link" data-u="${esc(u.u)}" data-p="${esc(u.p)}">${esc(t("useThis"))}</button></td></tr>`).join("");
  $("#view").innerHTML = `
  <div class="login">
    <div class="about">
      <h1>${esc(t("loginTitle"))}</h1>
      <p>${esc(t("loginAbout"))}</p>
      <h2 style="font-size:15px;margin-bottom:8px">${esc(t("rolesH"))}</h2>
      <table class="roles">
        ${["user", "officer", "helpdesk", "dataentry"].map(r => `<tr><th>${esc(t("role_" + r))}</th><td>${esc(t("roleDo_" + r))}</td></tr>`).join("")}
      </table>
    </div>
    <form id="loginForm" autocomplete="on">
      <h2>${esc(t("signIn"))}</h2>
      <div class="f"><label for="lu">${esc(t("username"))}</label><input id="lu" type="text" autocomplete="username" autocapitalize="none"></div>
      <div class="f"><label for="lp">${esc(t("password"))}</label><input id="lp" type="password" autocomplete="current-password"></div>
      <p class="err" id="lerr"></p>
      <button class="btn" type="submit" style="width:100%">${esc(t("signIn"))}</button>
      <div class="demo"><b>${esc(t("demoH"))}</b><table>${demo}</table><p class="hint" style="color:var(--muted);margin:8px 0 0">${esc(t("demoNote"))}</p></div>
    </form>
  </div>`;
  $$("[data-u]").forEach(b => b.onclick = () => { $("#lu").value = b.dataset.u; $("#lp").value = b.dataset.p; $("#lp").focus(); });
  $("#loginForm").onsubmit = e => {
    e.preventDefault();
    const u = Store.login($("#lu").value, $("#lp").value);
    if (!u) { $("#lerr").textContent = t("badLogin"); return; }
    App.user = u; go(NAV[u.role][0]);
  };
}

/* ================= Entrepreneur: advisor ================= */
function defaultS() {
  const D = Data.view(), v = D.villages[0] || { lat: 20.59, lng: 78.96, village: "" };
  const cat = D.catMap.dairy ? "dairy" : (D.categories[0] || {}).category;
  const c = D.catMap[cat] || {};
  return { village: v.village, lat: v.lat, lng: v.lng, R: 5, cat, m: 100000, cost: c.setup_cost_typical || 0,
           profit: c.monthly_profit_typical || 0, run: c.monthly_running_cost || 0, cap: false };
}

function viewAdvisor() {
  if (!App.S) App.S = defaultS();
  const S = App.S;
  $("#view").innerHTML = `
  <div class="split">
    <aside class="side">
      <div class="step"><h2><i>1</i>${esc(t("s1"))}</h2>
        <div class="f"><label for="aV">${esc(t("village"))}</label><select id="aV">${villageOptions(S.village)}</select>
          <p class="hint">${esc(t("siteHint"))}</p></div>
        <div class="f"><span class="lab">${esc(t("radius"))}</span>
          <div class="range"><input id="aR" type="range" min="5" max="10" step="1" value="${S.R}" aria-label="${esc(t("radius"))}"><output id="aRo">${S.R} km</output></div></div>
      </div>
      <div class="step"><h2><i>2</i>${esc(t("s2"))}</h2>
        <div class="f"><label for="aC">${esc(t("bizType"))}</label><select id="aC">${catOptions(S.cat)}</select></div>
      </div>
      <div class="step"><h2><i>3</i>${esc(t("s3"))}</h2>
        <div class="f big"><label for="aM">${esc(t("margin"))}</label><div class="rupee"><span>₹</span><input id="aM" inputmode="numeric" value="${S.m ? S.m.toLocaleString("en-IN") : ""}"></div></div>
        <div class="f"><label for="aK">${esc(t("cost"))}</label><div class="rupee"><span>₹</span><input id="aK" inputmode="numeric" value="${S.cost ? S.cost.toLocaleString("en-IN") : ""}"></div>
          <p class="hint">${esc(t("costHint"))}</p></div>
        <div class="row2">
          <div class="f"><label for="aP">${esc(t("profit"))}</label><div class="rupee"><span>₹</span><input id="aP" inputmode="numeric" value="${S.profit ? S.profit.toLocaleString("en-IN") : ""}"></div></div>
          <div class="f"><label for="aU">${esc(t("running"))}</label><div class="rupee"><span>₹</span><input id="aU" inputmode="numeric" value="${S.run ? S.run.toLocaleString("en-IN") : ""}"></div></div>
        </div>
        <div class="f radios"><span class="lab">${esc(t("morL"))}</span>
          <label><input type="radio" name="aMor" value="0"${S.cap ? "" : " checked"}> ${esc(t("morPaid"))}</label>
          <label><input type="radio" name="aMor" value="1"${S.cap ? " checked" : ""}> ${esc(t("morCap"))}</label></div>
      </div>
      <div class="step" id="scoreBox"></div>
    </aside>
    <section class="main">
      <div class="mapbox"><div class="map" id="map"></div></div>
      <div class="pane">
        <div class="subtabs" role="tablist">
          <button type="button" role="tab" data-t="report" aria-selected="${App.subTab === "report"}">${esc(t("tabReport"))}</button>
          <button type="button" role="tab" data-t="loan" aria-selected="${App.subTab === "loan"}">${esc(t("tabLoan"))}</button>
        </div>
        <div id="tabBody"></div>
      </div>
    </section>
  </div>`;

  // map
  const map = makeMap("map", [S.lat, S.lng], 12);
  villageLayer().addTo(map);
  App.dyn = L.layerGroup().addTo(map);
  App.site = L.marker([S.lat, S.lng], { icon: pin("site-pin"), draggable: true, zIndexOffset: 1000 }).addTo(map);
  App.site.on("dragend", e => { const p = e.target.getLatLng(); setSite(p.lat, p.lng); });
  map.on("click", e => setSite(e.latlng.lat, e.latlng.lng));
  legend(`<div><i style="background:#0A58A8"></i>${esc(t("lgSite"))}</div>
    <div><i style="background:#C62828"></i>${esc(t("lgComp"))}</div>
    <div><i style="background:#8A94A3"></i>${esc(t("lgOther"))}</div>
    <div><i style="background:#fff;border:1.5px solid #333"></i>${esc(t("lgVill"))}</div>
    <label><input type="checkbox" id="showAll"${App.showAll ? " checked" : ""}> ${esc(t("showAll"))}</label>`).addTo(map);
  $("#showAll").onchange = e => { App.showAll = e.target.checked; update(); };

  // inputs
  $("#aV").onchange = e => { const v = Data.view().villages.find(x => x.village === e.target.value); if (v) { setSite(v.lat, v.lng, true); map.setView([v.lat, v.lng], 12); } };
  $("#aR").oninput = e => { S.R = +e.target.value; $("#aRo").textContent = S.R + " km"; update(); };
  $("#aC").onchange = e => {
    S.cat = e.target.value; const c = Data.view().catMap[S.cat] || {};
    S.cost = c.setup_cost_typical || 0; S.profit = c.monthly_profit_typical || 0; S.run = c.monthly_running_cost || 0;
    $("#aK").value = S.cost ? S.cost.toLocaleString("en-IN") : ""; $("#aP").value = S.profit ? S.profit.toLocaleString("en-IN") : ""; $("#aU").value = S.run ? S.run.toLocaleString("en-IN") : "";
    update();
  };
  [["aM", "m"], ["aK", "cost"], ["aP", "profit"], ["aU", "run"]].forEach(([id, k]) => {
    const el = $("#" + id);
    el.oninput = () => { S[k] = numIn(el.value); update(); };
    el.onblur = () => { el.value = S[k] ? S[k].toLocaleString("en-IN") : ""; };
  });
  $$('input[name="aMor"]').forEach(r => r.onchange = () => { S.cap = r.value === "1" && r.checked; update(); });
  $$(".subtabs [data-t]").forEach(b => b.onclick = () => { App.subTab = b.dataset.t; $$(".subtabs [data-t]").forEach(x => x.setAttribute("aria-selected", x === b)); renderTab(); });
  update();
}

function setSite(lat, lng, fromSelect) {
  const S = App.S; S.lat = lat; S.lng = lng; App.site.setLatLng([lat, lng]);
  if (!fromSelect) { const v = nearestVillage(S); if (v) { S.village = v.village; $("#aV").value = v.village; } }
  else S.village = $("#aV").value;
  update();
}

function update() {
  const S = App.S, D = Data.view();
  App.A = analyse(S, D);
  const A = App.A;
  // map layers
  App.dyn.clearLayers();
  L.circle([S.lat, S.lng], { radius: S.R * 1000, color: "#0A58A8", weight: 1.5, fillOpacity: 0.04 }).addTo(App.dyn);
  L.circle([S.lat, S.lng], { radius: 1000, color: "#0A58A8", weight: 1, dashArray: "4 4", fill: false }).addTo(App.dyn);
  if (App.showAll) D.businesses.filter(b => b.category !== S.cat).forEach(b =>
    L.circleMarker([b.lat, b.lng], { radius: 3, stroke: false, fillColor: "#8A94A3", fillOpacity: .8 }).bindTooltip(esc(b.name) + " · " + esc(catLabel(b.category))).addTo(App.dyn));
  A.comp.forEach(b => L.circleMarker([b.lat, b.lng], { radius: 5, color: "#fff", weight: 1, fillColor: "#C62828", fillOpacity: .95 })
    .bindTooltip(`${esc(b.name)}<br>${km(b.d)} km · ${esc(b.source)}${/^y/i.test(b.verified || "") ? " ✓" : ""}`).addTo(App.dyn));
  // score
  $("#scoreBox").innerHTML = `
    <h2 style="font-size:14px;margin-bottom:8px">${esc(t("scoreH"))}</h2>
    <div class="score ${A.level}"><span class="num">${A.score}</span><span><span class="lvl">${esc(t("lv_" + A.level))}</span><br><span style="font-size:13px;color:var(--muted)">/ 100</span></span></div>
    <table class="parts">${A.parts.map(([k, v, max]) => `<tr><td>${esc(t(k))}<span class="bar-mini"><i style="width:${v / max * 100}%"></i></span></td><td>${Math.round(v)} / ${max}</td></tr>`).join("")}</table>`;
  renderTab();
}

function renderTab() { $("#tabBody").innerHTML = App.subTab === "loan" ? loanHTML(App.A) : reportHTML(App.A); bindReportLink(); }

function reportHTML(A) {
  const S = App.S, cl = catLabel(S.cat), c = A.cat;
  const sat = `<span class="pill ${A.sat}">${esc(t("sat_" + A.sat))}</span>`;
  const channels = String(c.channels || "").split(";").map(s => s.trim()).filter(Boolean);
  const gaps = A.supply.filter(x => x.c.category !== S.cat && x.ratio < 0.7 && x.exp >= 1).slice(0, 3).map(x => catLabel(x.c.category));
  const split = s => String(s || "").split(";").map(x => x.trim()).filter(Boolean);
  const budOk = A.plan && A.afford >= (c.setup_cost_typical || 0);
  const Sw = [...split(c.strength)], W = [...split(c.weakness)], O = [], T = [];
  if (A.sat === "u") Sw.push(fill("sw_under", { s: A.mine.ratio.toFixed(2) }));
  if (A.sat === "b") W.push(fill("sw_bal", { s: A.mine.ratio.toFixed(2) }));
  if (A.sat === "s") W.push(fill("sw_sat", { s: A.mine.ratio.toFixed(2) }));
  if (A.comp1.length) W.push(fill("sw_near", { n: A.comp1.length })); else Sw.push(t("sw_none"));
  if (A.plan) (budOk ? Sw : W).push(fill(budOk ? "sw_budOk" : "sw_budLow", { p: rupee(A.afford), c: rupee(c.setup_cost_typical || 0) }));
  O.push(fill("sw_hh", { hh: A.hhR.toLocaleString("en-IN"), r: S.R }));
  if (gaps.length) O.push(fill("sw_opp", { list: gaps.join(", ") }));
  A.threats.slice(0, 4).forEach(x => T.push(x.threat));
  if (!T.length) T.push(t("noThreat"));
  const li = arr => arr.map(x => `<li>${esc(x)}</li>`).join("");
  const mon = t("mon");

  return `<div class="doc">
  <section>
    <h3 style="font-size:20px">${esc(fill("repTitle", { cat: cl, village: S.village }))}</h3>
    <p class="srcnote">${esc(fill("repMeta", { lat: S.lat.toFixed(5), lng: S.lng.toFixed(5), r: S.R, n: A.nBiz }))}</p>
  </section>

  <section><h3>1. ${esc(t("r1"))}</h3>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t("within"))}</th><th class="n">${esc(t("villages"))}</th><th class="n">${esc(t("population"))}</th><th class="n">${esc(t("households"))}</th></tr></thead>
    <tbody>${A.reach.map(r => `<tr${r.r === S.R ? ' class="hl"' : ""}><td>${r.r} km</td><td class="n">${r.n}</td><td class="n">${r.pop.toLocaleString("en-IN")}</td><td class="n">${r.hh.toLocaleString("en-IN")}</td></tr>`).join("")}</tbody></table></div>
    ${channels.length ? `<p style="margin-top:10px"><b>${esc(t("channels"))}:</b></p><ul>${li(channels)}</ul>` : ""}
    <p class="srcnote" style="margin-top:8px">villages.csv, categories.csv</p>
  </section>

  <section><h3>2. ${esc(t("r2"))} ${sat}</h3>
    <p>${esc(A.compR.length ? fill("compTxt", { n: A.compR.length, cat: cl, r: S.R, n1: A.comp1.length, d: km(A.nearest) }) : fill("noComp", { cat: cl, r: S.R }))}</p>
    <p>${esc(fill("benchTxt", { hpu: c.households_per_unit, hh: A.hhR.toLocaleString("en-IN"), r: S.R, exp: A.mine.exp.toFixed(1), s: A.mine.ratio.toFixed(2) }))}</p>
    ${Object.keys(A.sources).length ? `<p style="margin-top:10px"><b>${esc(t("srcH"))}</b></p>
    <table class="tbl" style="max-width:460px"><thead><tr><th>${esc(t("source"))}</th><th class="n">${esc(t("records"))}</th><th class="n">${esc(t("verified"))}</th></tr></thead>
    <tbody>${Object.entries(A.sources).sort((a, b) => b[1].n - a[1].n).map(([s, v]) => `<tr><td>${esc(s)}</td><td class="n">${v.n}</td><td class="n">${v.v}</td></tr>`).join("")}</tbody></table>` : ""}
    <p class="srcnote" style="margin-top:8px">businesses.csv + approved field-survey entries</p>
  </section>

  <section><h3>3. ${esc(t("r3"))}</h3>
    <p class="lead">${esc(fill("oppLead", { r: S.R }))}</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t("bizCol"))}</th><th class="n">${esc(t("units"))}</th><th class="n">${esc(t("supportable"))}</th><th class="n">${esc(t("ratio"))}</th><th></th></tr></thead>
    <tbody>${A.supply.map(x => `<tr${x.c.category === S.cat ? ' class="hl"' : ""}><td>${esc(catLabel(x.c.category))}</td><td class="n">${x.n}</td><td class="n">${x.exp.toFixed(1)}</td><td class="n">${isFinite(x.ratio) ? x.ratio.toFixed(2) : "–"}</td><td><span class="pill ${A.satKey(x.ratio)}">${esc(t("sat_" + A.satKey(x.ratio)))}</span></td></tr>`).join("")}</tbody></table></div>
  </section>

  <section><h3>4. ${esc(t("r4"))}</h3>
    <div class="swot">
      <div><h4 style="color:var(--green)">${esc(t("S"))}</h4><ul>${li(Sw)}</ul></div>
      <div><h4 style="color:var(--amber)">${esc(t("W"))}</h4><ul>${li(W)}</ul></div>
      <div><h4 style="color:var(--accent)">${esc(t("O"))}</h4><ul>${li(O)}</ul></div>
      <div><h4 style="color:var(--red)">${esc(t("T"))}</h4><ul>${li(T)}</ul></div>
    </div>
  </section>

  <section><h3>5. ${esc(t("r5"))}</h3>
    ${A.threats.length ? `<div class="tbl-wrap"><div class="months">
      <div class="t hd"></div>${mon.map(m => `<div class="hd">${esc(m)}</div>`).join("")}
      ${A.threats.map(x => { const ms = String(x.months || "").split(";").map(Number).filter(Boolean);
        return `<div class="t">${esc(x.threat)}${ms.length ? "" : ` <span class="srcnote">(${esc(t("anyTime"))})</span>`}</div>` +
          mon.map((_, i) => `<div class="${ms.includes(i + 1) ? "on" : ""}"></div>`).join(""); }).join("")}
    </div></div>` : `<p>${esc(t("noThreat"))}</p>`}
    <p class="srcnote" style="margin-top:8px">threats.csv</p>
  </section>

  <section><h3>6. ${esc(t("r6"))}</h3>
    ${A.prices.length ? `<table class="tbl"><thead><tr><th>${esc(t("item"))}</th><th>${esc(t("unit"))}</th><th class="n">${esc(t("localPrice"))}</th><th>${esc(t("source"))}</th></tr></thead>
    <tbody>${A.prices.map(p => `<tr><td>${esc(p.item)}</td><td>${esc(p.unit)}</td><td class="n">₹${p.low}–${p.high}</td><td class="srcnote">${esc(p.source || "")}</td></tr>`).join("")}</tbody></table>` : `<p>${esc(t("noPrice"))}</p>`}
  </section>

  <section><h3>7. ${esc(t("scoreH2"))}</h3>
    <table class="tbl" style="max-width:460px"><tbody>${A.parts.map(([k, v, max]) => `<tr><td>${esc(t(k))}</td><td class="n">${Math.round(v)} / ${max}</td></tr>`).join("")}
      <tr><td><b>${esc(t("scoreH"))}</b></td><td class="n"><b>${A.score} / 100</b></td></tr></tbody></table>
    <p class="srcnote" style="margin-top:8px">${esc(t("scoreExp"))}</p>
  </section>
  <p class="report-link">${esc(t("reportIssue"))} <button type="button" class="btn-link" id="toSupport">${esc(t("reportIssueLink"))}</button></p>
  </div>`;
}

function loanHTML(A) {
  const S = App.S;
  if (!A.plan) return `<div class="doc"><section><p>${esc(t("emptyMoney"))}</p></section></div>`;
  const { p, sch, free } = A.plan, sc = p.sc;
  const notes = A.plan.notes.map(([c, k, v]) => [c, fill(k, money(v))]);
  if (free > 0.5) notes.push(["info", fill("freeNote", { s: rupee(free) })]);
  if (S.run) { const wc = S.run * RULES.wcMonths; notes.push(free >= wc ? ["good", fill("wcOk", { wc: rupee(wc) })] : ["warn", fill("wcShort", { wc: rupee(wc), gap: rupee(wc - free) })]); }
  if (A.dscr !== null) {
    const lv = A.dscr >= 1.5 ? "good" : A.dscr >= 1.2 ? "care" : "bad";
    notes.push([lv === "good" ? "good" : lv === "care" ? "warn" : "bad", fill("dscrTxt", { q: rupee(S.profit * 3), x: A.dscr.toFixed(2) }) + " " + t("d_" + lv)]);
  }
  return `<div class="doc"><section>
    <div class="verdict"><span class="srcnote">${esc(t("schemeLbl"))}</span><b>${esc(t(p.key))}</b>
      <span>${esc(fill("schemeSub", { rate: +(sc.rate * 100).toFixed(2), yrs: sc.years, mor: sc.morMonths }))}</span></div>
    <div class="figs">
      <div><span>${esc(t("fCost"))}</span><b>${rupee(p.cost)}</b></div>
      <div><span>${esc(t("fLoan"))}</span><b>${rupee(p.loan)}</b></div>
      <div><span>${esc(t("fYou"))}</span><b>${rupee(p.contrib)}</b></div>
      <div class="key"><span>${esc(t("fEmi"))}</span><b>${rupee(sch.emi)}</b></div>
      <div><span>${esc(t("fInt"))}</span><b>${rupee(sch.totalInt)}</b></div>
      <div><span>${esc(t("fPay"))}</span><b>${rupee(sch.totalPay)}</b></div>
    </div>
    <ul class="notes">${notes.map(([c, s]) => `<li class="${c}">${esc(s)}</li>`).join("")}</ul>
    <h3 style="margin-top:14px">${esc(t("ledH"))}</h3>
    <div class="ledger"><table class="tbl">
      <thead><tr><th>${esc(t("cQ"))}</th><th class="n">${esc(t("cOpen"))}</th><th class="n">${esc(t("cInt"))}</th><th class="n">${esc(t("cPrin"))}</th><th class="n">${esc(t("cPay"))}</th><th class="n">${esc(t("cClose"))}</th></tr></thead>
      <tbody>${sch.rows.map(r => `<tr${r.mor ? ' class="mor"' : ""}><td>Q${r.q}${r.mor ? ` <span class="srcnote">${esc(t("morTag"))}</span>` : ""}</td><td class="n">${rupee(r.open)}</td><td class="n">${rupee(r.int)}</td><td class="n">${rupee(r.prin)}</td><td class="n"><b>${rupee(r.pay)}</b></td><td class="n">${rupee(r.close)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>${esc(t("total"))}</td><td></td><td class="n">${rupee(sch.totalInt)}</td><td class="n">${rupee(p.loan)}</td><td class="n">${rupee(sch.totalPay)}</td><td></td></tr></tfoot>
    </table></div>
    <p class="srcnote" style="margin-top:10px">${esc(t("disc"))}</p>
  </section>
  <p class="report-link">${esc(t("reportIssue"))} <button type="button" class="btn-link" id="toSupport">${esc(t("reportIssueLink"))}</button></p>
  </div>`;
}

function bindReportLink() {
  const b = $("#toSupport"); if (!b) return;
  b.onclick = () => { App.supportPrefill = { type: App.subTab === "loan" ? "loan" : "data" }; go("support"); };
}

/* ================= Entrepreneur: help & support ================= */
function viewSupport() {
  const u = App.user, pre = App.supportPrefill || {}; App.supportPrefill = null;
  const mine = Store.db.tickets.filter(x => x.by === u.u);
  const types = ["data", "loan", "app", "other"];
  $("#view").innerHTML = `<div class="pane"><div class="doc" style="margin:0 auto">
    <section><h3>${esc(t("supH"))}</h3>
      <form id="tkForm">
        <div class="f"><label for="tkT">${esc(t("supType"))}</label><select id="tkT">${types.map(x => `<option value="${x}"${pre.type === x ? " selected" : ""}>${esc(t("tt_" + x))}</option>`).join("")}</select></div>
        <div class="f"><label for="tkX">${esc(t("supText"))}</label><textarea id="tkX"></textarea></div>
        <div class="f radios"><label><input type="checkbox" id="tkC"${App.S ? " checked" : " disabled"}> ${esc(t("supCtx"))}</label></div>
        <p class="err" id="tkE"></p>
        <button class="btn" type="submit">${esc(t("supSend"))}</button>
      </form>
    </section>
    <section><h3>${esc(t("myTickets"))}</h3>
      ${mine.length ? mine.map(tk => ticketBlock(tk, true)).join("") : `<p>${esc(t("noTickets"))}</p>`}
    </section>
  </div></div>`;
  $("#tkForm").onsubmit = e => {
    e.preventDefault();
    const text = $("#tkX").value.trim(); if (!text) { $("#tkE").textContent = t("supNeedText"); return; }
    let context = null;
    if ($("#tkC").checked && App.S) { const S = App.S; context = { village: S.village, category: S.cat, margin: S.m, score: App.A ? App.A.score : null, lat: S.lat, lng: S.lng }; }
    Store.addTicket({ by: u.u, type: $("#tkT").value, text, context });
    toast(t("supSent")); go("support");
  };
  $$("[data-addinfo]").forEach(f => f.onsubmit = e => {
    e.preventDefault(); const v = f.querySelector("textarea").value.trim(); if (!v) return;
    const tk = Store.db.tickets.find(x => x.id === f.dataset.addinfo);
    Store.reply(tk.id, u.u, v, tk.status === "resolved" ? "open" : null); go("support");
  });
}

function ctxHTML(c) {
  if (!c) return "";
  return `<dl class="kv" style="margin:8px 0"><dt>${esc(t("attached"))}</dt><dd>${esc(c.village || "")}, ${esc(catLabel(c.category))}, ${c.margin ? rupee(c.margin) : "–"}${c.score != null ? ", score " + c.score : ""}</dd></dl>`;
}
function whoLabel(by) {
  const u = Store.db.users.find(x => x.u === by); if (!u) return esc(by);
  if (u.role === "user") return esc(u.u === (App.user || {}).u ? t("you") : u.name);
  return esc(u.name) + " (" + esc(u.role === "officer" ? t("surveyTeam") : t("helpdesk")) + ")";
}
function ticketBlock(tk, forUser) {
  return `<div style="${forUser ? "border-top:1px solid var(--soft);" : ""}padding:12px 0 4px">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><b>${esc(t("tt_" + tk.type))}</b>${forUser ? `<span>${statusPill(tk.status)} <span class="srcnote">${esc(tk.id)} · ${when(tk.at)}</span></span>` : ""}</div>
    <p style="margin:6px 0">${esc(tk.text)}</p>${ctxHTML(tk.context)}
    ${tk.replies.length ? `<div class="thread">${tk.replies.map(r => { const staff = (Store.db.users.find(x => x.u === r.by) || {}).role !== "user";
      return `<div class="msg${staff ? " staff" : ""}"><div class="by">${whoLabel(r.by)} · ${when(r.at)}</div>${esc(r.text)}</div>`; }).join("")}</div>` : ""}
    ${forUser ? `<form data-addinfo="${esc(tk.id)}" style="margin-top:6px"><div class="f"><label class="sr" for="ai${esc(tk.id)}">${esc(t("addInfo"))}</label>
      <textarea id="ai${esc(tk.id)}" placeholder="${esc(t("addInfo"))}" style="min-height:48px"></textarea></div><button class="btn sec" type="submit">${esc(t("send"))}</button></form>` : ""}
  </div>`;
}

/* ================= Record types (shared by data entry and survey officer) ================= */
const SOURCES = ["Field survey", "OSM", "FSSAI", "Udyam", "Census 2011", "Gram Panchayat", "Agmarknet", "Other"];
const TYPE_LABEL = { business: "Business", village: "Village", price: "Price", threat: "Risk", batch: "CSV upload" };
const FIELDS = {
  business: [["name", "Business name (as on board)", "text"], ["category", "Business type", "cat"], ["source", "Source of this record", "source"],
             ["ref", "Reference (licence no., link or survey form no.)", "text"], ["lat", "Latitude", "num"], ["lng", "Longitude", "num"],
             ["phone", "Owner phone (optional)", "text"], ["note", "Notes", "area"]],
  village:  [["village", "Village name", "text"], ["block", "Block / taluka", "text"], ["district", "District", "text"], ["lat", "Latitude", "num"], ["lng", "Longitude", "num"],
             ["population", "Population", "num"], ["households", "Households", "num"], ["source", "Source of this record", "source"]],
  price:    [["village", "Village", "village"], ["category", "Business type", "cat"], ["item", "Item", "text"], ["unit", "Unit (litre, kg, piece…)", "text"],
             ["low", "Lowest price (₹)", "num"], ["high", "Highest price (₹)", "num"], ["source", "Source of this record", "source"]],
  threat:   [["category", "Business type", "cat"], ["threat", "Risk (e.g. milk yield drops in summer)", "text"], ["months", "Risky months as numbers, e.g. 4;5;6 (empty = any time)", "text"],
             ["source", "Source of this record", "source"]]
};
const HINT = {
  business: "Enter a business found in a source list or on a field visit. Use GPS at the shop, or tap its location on the map.",
  village: "Enter a village with its Census population and households. Tap the village centre on the map.",
  price: "Enter a local price range seen on a field visit or in a price list.",
  threat: "Enter a risk for a business type, for example a seasonal drop in demand."
};

function fieldsHTML(type, d, pre) {
  const one = ([k, lab, kind]) => {
    const id = pre + k, v = d[k] ?? "";
    let input;
    if (kind === "cat") input = `<select id="${id}">${catOptions(v)}</select>`;
    else if (kind === "village") input = `<select id="${id}">${villageOptions(v)}</select>`;
    else if (kind === "source") input = `<select id="${id}">${SOURCES.map(s => `<option${s === v ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>`;
    else if (kind === "area") input = `<textarea id="${id}" style="min-height:60px">${esc(v)}</textarea>`;
    else input = `<input id="${id}" type="text"${kind === "num" ? ' inputmode="decimal"' : ""} value="${esc(v)}">`;
    return `<div class="f"><label for="${id}">${esc(lab)}</label>${input}</div>`;
  };
  const F = FIELDS[type], out = [];
  for (let i = 0; i < F.length; i++) {
    if (F[i][0] === "lat" && F[i + 1] && F[i + 1][0] === "lng") { out.push(`<div class="row2">${one(F[i])}${one(F[i + 1])}</div>`); i++; }
    else if (F[i][0] === "low" && F[i + 1] && F[i + 1][0] === "high") { out.push(`<div class="row2">${one(F[i])}${one(F[i + 1])}</div>`); i++; }
    else out.push(one(F[i]));
  }
  return out.join("");
}
function readFields(type, pre) {
  const o = {};
  FIELDS[type].forEach(([k, , kind]) => {
    const el = $("#" + pre + k); if (!el) return;
    const v = el.value.trim();
    o[k] = kind === "num" ? (v === "" ? NaN : Number(v.replace(/[,₹\s]/g, ""))) : v;
  });
  return o;
}
function validate(type, d) {
  const geo = () => isFinite(d.lat) && isFinite(d.lng) && Math.abs(d.lat) <= 90 && Math.abs(d.lng) <= 180 ? "" : "Set the location: use GPS, tap the map, or type latitude and longitude.";
  if (type === "business") return !d.name ? "Enter the business name." : geo();
  if (type === "village") return !d.village ? "Enter the village name." : geo() || (!(d.population > 0) || !(d.households > 0) ? "Enter population and households as numbers." : "");
  if (type === "price") return !d.item || !d.unit ? "Enter the item and unit." : !(d.low > 0) || !(d.high >= d.low) ? "Enter a valid price range (highest must be at least the lowest)." : "";
  if (type === "threat") return !d.threat ? "Describe the risk." : d.months && !/^\s*(1[0-2]|[1-9])(\s*;\s*(1[0-2]|[1-9]))*\s*$/.test(d.months) ? "Months must be numbers 1–12 separated by ; (e.g. 4;5;6)." : "";
  return "";
}
function subTitle(s) {
  const d = s.data;
  return s.type === "business" ? d.name : s.type === "village" ? d.village : s.type === "price" ? d.item : s.type === "threat" ? d.threat : `${d.file} (${d.rows.length} rows)`;
}
function subMeta(s) {
  const d = s.data;
  const what = s.type === "batch" ? "into " + DATASETS[d.dataset].file : s.type === "village" ? (d.block || "") : catLabel(d.category);
  return `${TYPE_LABEL[s.type]}, ${what}${d.source ? " · " + d.source : ""}`;
}
function downloadText(name, text) {
  const blob = new Blob(["\ufeff" + text], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ================= Data entry operator: enter data ================= */
function viewAdd() {
  const D = Data.view(), v0 = D.villages[0] || { lat: 20.59, lng: 78.96 };
  App.draft = App.draft || {};
  const tabs = [["business", "Business"], ["village", "Village"], ["price", "Price"], ["threat", "Risk"], ["csv", "CSV upload"]];
  $("#view").innerHTML = `
  <div class="split">
    <aside class="side">
      <div class="subtabs" role="tablist" style="overflow-x:auto">${tabs.map(([k, l]) => `<button type="button" role="tab" data-a="${k}" aria-selected="${App.addTab === k}">${l}</button>`).join("")}</div>
      <div id="addBody"></div>
    </aside>
    <section class="main"><div class="mapbox tall"><div class="map" id="map"></div></div></section>
  </div>`;
  const map = makeMap("map", [v0.lat, v0.lng], 13);
  villageLayer().addTo(map);
  D.businesses.forEach(b => L.circleMarker([b.lat, b.lng], { radius: 3.5, stroke: false, fillColor: "#8A94A3", fillOpacity: .85 }).bindTooltip(esc(b.name) + " · " + esc(catLabel(b.category))).addTo(map));
  const colors = { pending: "#E07B00", approved: "#2E7D32", rejected: "#C62828" };
  Store.db.submissions.filter(s => s.by === App.user.u && (s.type === "business" || s.type === "village")).forEach(s =>
    L.circleMarker([s.data.lat, s.data.lng], { radius: 6, color: "#fff", weight: 1.5, fillColor: colors[s.status], fillOpacity: 1 }).bindTooltip(esc(subTitle(s)) + " · " + s.status).addTo(map));
  legend(`<div><i style="background:#E07B00;border-radius:2px"></i>Location you are entering</div><div><i style="background:#8A94A3"></i>Records already in the system</div>
    <div><i style="background:#E07B00"></i>Your entries: pending</div><div><i style="background:#2E7D32"></i>Your entries: approved</div><div><i style="background:#C62828"></i>Your entries: rejected</div>`).addTo(map);
  App.newPin = null;
  App.place = (lat, lng) => {
    App.draft.lat = lat; App.draft.lng = lng;
    if (!App.newPin) { App.newPin = L.marker([lat, lng], { icon: pin("new-pin"), draggable: true, zIndexOffset: 1000 }).addTo(map); App.newPin.on("dragend", e => { const p = e.target.getLatLng(); App.place(p.lat, p.lng); }); }
    else App.newPin.setLatLng([lat, lng]);
    if ($("#e_lat")) { $("#e_lat").value = lat.toFixed(6); $("#e_lng").value = lng.toFixed(6); dupCheck("e_"); }
  };
  map.on("click", e => { if ($("#e_lat")) App.place(e.latlng.lat, e.latlng.lng); });
  $$("[data-a]").forEach(b => b.onclick = () => { App.addTab = b.dataset.a; $$("[data-a]").forEach(x => x.setAttribute("aria-selected", x === b)); addBody(); });
  if (!tabs.some(([k]) => k === App.addTab)) App.addTab = "business";
  addBody();
}

function addBody() {
  const el = $("#addBody"), type = App.addTab;
  if (type === "csv") return csvBody(el);
  const D = Data.view(), v0 = D.villages[0] || {};
  const defaults = { business: { category: "dairy", source: "Field survey" }, village: { block: v0.block, district: v0.district, source: "Census 2011" },
                     price: { category: "dairy", source: "Field survey" }, threat: { category: "dairy", source: "Field survey" } }[type];
  if (App.draft.lat && (type === "business" || type === "village")) Object.assign(defaults, { lat: App.draft.lat.toFixed(6), lng: App.draft.lng.toFixed(6) });
  const hasGeo = FIELDS[type].some(f => f[0] === "lat");
  el.innerHTML = `<form id="eForm" class="step">
    <p class="hint" style="margin:0 0 10px;color:var(--muted);font-size:13px">${esc(HINT[type])} The survey officer checks every entry before it is used in reports.</p>
    ${hasGeo ? `<div class="btns" style="margin-bottom:10px"><button type="button" class="btn sec" id="gps">Use my GPS location</button></div>` : ""}
    ${fieldsHTML(type, defaults, "e_")}
    <div id="dup"></div><p class="err" id="eE"></p>
    <button class="btn" type="submit">Send for approval</button>
  </form>`;
  if (hasGeo) {
    $("#gps").onclick = () => {
      if (!navigator.geolocation) { toast("GPS is not available on this device."); return; }
      const b = $("#gps"); b.disabled = true; b.textContent = "Finding location…";
      navigator.geolocation.getCurrentPosition(p => {
        App.place(p.coords.latitude, p.coords.longitude); App.map.setView([p.coords.latitude, p.coords.longitude], 17);
        b.disabled = false; b.textContent = `Use my GPS location (±${Math.round(p.coords.accuracy)} m)`;
      }, err => { b.disabled = false; b.textContent = "Use my GPS location"; toast("Location not available: " + err.message); }, { enableHighAccuracy: true, timeout: 15000 });
    };
    ["e_lat", "e_lng"].forEach(id => $("#" + id).onchange = () => { const la = parseFloat($("#e_lat").value), ln = parseFloat($("#e_lng").value); if (isFinite(la) && isFinite(ln)) App.place(la, ln); });
  }
  if ($("#e_category") && type === "business") $("#e_category").onchange = () => dupCheck("e_");
  $("#eForm").onsubmit = e => {
    e.preventDefault();
    const d = readFields(type, "e_"), err = validate(type, d);
    if (err) { $("#eE").textContent = err; return; }
    Store.addSubmission(type, d, App.user.u);
    App.draft = {}; toast("Sent to the survey officer for approval."); go("add");
  };
  if (type === "business") dupCheck("e_");
}

function csvBody(el) {
  el.innerHTML = `<div class="step">
    <p class="hint" style="margin:0 0 10px;color:var(--muted);font-size:13px">Upload many records at once, for example an OSM export, an FSSAI list or a typed-up survey sheet. The survey officer approves the whole file.</p>
    <div class="f"><label for="cD">Which file is this?</label><select id="cD">${Object.entries(DATASETS).map(([k, d]) => `<option value="${k}">${esc(d.file)}</option>`).join("")}</select></div>
    <p class="hint" id="cAbout" style="font-size:13px;color:var(--muted)"></p>
    <div class="btns" style="margin-bottom:12px"><button type="button" class="btn sec" id="cT">Download empty template</button></div>
    <div class="f"><label for="cF">Choose CSV file</label><input id="cF" type="file" accept=".csv,text/csv"></div>
    <div id="cP"></div>
    <button type="button" class="btn" id="cS" disabled>Send for approval</button>
  </div>`;
  const about = () => { const k = $("#cD").value; $("#cAbout").innerHTML = esc(DATASETS[k].about) + "<br>Required columns: " + DATASETS[k].need.map(c => `<code>${esc(c)}</code>`).join(", "); };
  about(); App.csvDraft = null;
  $("#cD").onchange = () => { about(); $("#cF").value = ""; $("#cP").innerHTML = ""; $("#cS").disabled = true; App.csvDraft = null; };
  $("#cT").onclick = () => { const k = $("#cD").value; downloadText(DATASETS[k].file, Data.template(k)); };
  $("#cF").onchange = () => {
    const f = $("#cF").files[0]; if (!f) return; const k = $("#cD").value;
    f.text().then(txt => {
      const p = Data.parse(k, txt), box = $("#cP");
      if (p.missing.length) { box.innerHTML = `<div class="warnbox">This file is missing required columns: ${p.missing.map(esc).join(", ")}. Download the template to see the right column names.</div>`; $("#cS").disabled = true; return; }
      if (p.rows.length > 3000) { box.innerHTML = `<div class="warnbox">This demo accepts up to 3,000 rows per file. Split the file and upload it in parts.</div>`; $("#cS").disabled = true; return; }
      const show = p.cols.filter(c => DATASETS[k].cols.includes(c)).slice(0, 5);
      box.innerHTML = `<div class="${p.bad.length ? "warnbox" : "okbox"}">${p.rows.length} ${p.rows.length === 1 ? "row" : "rows"} ready.${p.bad.length ? ` ${p.bad.length} ${p.bad.length === 1 ? "row" : "rows"} will be skipped because of missing or invalid values (spreadsheet ${p.bad.length === 1 ? "row" : "rows"} ${p.bad.slice(0, 10).join(", ")}${p.bad.length > 10 ? "…" : ""}).` : ""}</div>
        <div class="tbl-wrap"><table class="tbl" style="font-size:12.5px"><thead><tr>${show.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
        <tbody>${p.rows.slice(0, 5).map(r => `<tr>${show.map(c => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
        ${p.rows.length > 5 ? `<p class="srcnote">Showing 5 of ${p.rows.length} rows.</p>` : ""}`;
      App.csvDraft = { dataset: k, file: f.name, rows: p.rows, cols: p.cols, skipped: p.bad.length };
      $("#cS").disabled = !p.rows.length;
      if ("lat" in (p.rows[0] || {})) { const g = L.featureGroup(p.rows.slice(0, 2000).map(r => L.circleMarker([r.lat, r.lng], { radius: 4, stroke: false, fillColor: "#E07B00", fillOpacity: .9 }))).addTo(App.map); try { App.map.fitBounds(g.getBounds().pad(0.2)); } catch (e) {} }
    });
  };
  $("#cS").onclick = () => { if (!App.csvDraft) return; Store.addSubmission("batch", App.csvDraft, App.user.u); App.csvDraft = null; toast("File sent to the survey officer for approval."); go("add"); };
}

function dupNear(lat, lng, cat, exclude) {
  const D = Data.view(); let best = null;
  D.businesses.forEach(b => { if (b.category !== cat || (exclude && b._key === exclude)) return; const d = distKm({ lat, lng }, b); if (!best || d < best.d) best = { b, d }; });
  Store.db.submissions.filter(s => s.status === "pending" && s.type === "business" && s.id !== exclude && s.data.category === cat).forEach(s => {
    const d = distKm({ lat, lng }, s.data); if (!best || d < best.d) best = { b: { name: s.data.name + " (waiting for approval, " + s.id + ")" }, d };
  });
  return best;
}
function dupCheck(pre, exclude) {
  const box = $("#dup"); if (!box || !$("#" + pre + "lat")) return;
  const lat = parseFloat($("#" + pre + "lat").value), lng = parseFloat($("#" + pre + "lng").value);
  if (!isFinite(lat) || !isFinite(lng)) { box.innerHTML = ""; return; }
  const cat = $("#" + pre + "category").value, n = dupNear(lat, lng, cat, exclude);
  box.innerHTML = n && n.d <= 0.1
    ? `<div class="warnbox">Possible duplicate: <b>${esc(n.b.name)}</b> (same business type) is ${Math.round(n.d * 1000)} m away. Check it is a different shop.</div>`
    : exclude ? `<div class="okbox">No other ${esc(catLabel(cat))} record within 100 m${n ? `; the nearest is ${km(n.d)} km away` : ""}.</div>` : "";
}

/* ================= Data entry operator: my entries ================= */
function viewMine() {
  const mine = Store.db.submissions.filter(s => s.by === App.user.u);
  const c = st => mine.filter(s => s.status === st).length;
  $("#view").innerHTML = `<div class="pane"><div class="doc" style="margin:0 auto;max-width:1100px">
    <section><h3>My entries <small>${c("pending")} waiting, ${c("approved")} approved, ${c("rejected")} rejected</small></h3>
    ${mine.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Type</th><th>Details</th><th>Sent</th><th>Status</th><th>Survey officer's remark</th><th></th></tr></thead><tbody>
      ${mine.map(s => `<tr><td>${esc(s.id)}</td><td>${TYPE_LABEL[s.type]}</td>
        <td><b>${esc(subTitle(s))}</b><br><span class="srcnote">${esc(subMeta(s))}</span>${s.editedBy ? `<br><span class="srcnote">Corrected by ${esc(Store.userName(s.editedBy))}</span>` : ""}</td>
        <td class="srcnote">${when(s.at)}</td><td>${statusPill(s.status)}</td><td>${esc(s.remark || "")}</td>
        <td>${s.status === "pending" ? `<button type="button" class="btn-link" data-wd="${esc(s.id)}">Withdraw</button>` : ""}</td></tr>`).join("")}
    </tbody></table></div>` : `<p>No entries yet. Use “Enter data” to add a record or upload a CSV file.</p>`}
    </section></div></div>`;
  $$("[data-wd]").forEach(b => b.onclick = () => { Store.withdraw(b.dataset.wd); toast("Withdrawn."); go("mine"); });
}

/* ================= Survey officer: approval queue ================= */
function viewQueue() {
  const db = Store.db;
  const pend = db.submissions.filter(s => s.status === "pending");
  const fwd = db.tickets.filter(x => x.status === "forwarded");
  const done = db.submissions.filter(s => s.status !== "pending").sort((a, b) => (b.reviewedAt || 0) - (a.reviewedAt || 0)).slice(0, 10);
  if (!App.sel) App.sel = pend[0] ? { k: "s", id: pend[0].id } : fwd[0] ? { k: "t", id: fwd[0].id } : null;
  const item = s => `<li><button type="button" data-sel="s:${esc(s.id)}"${App.sel && App.sel.k === "s" && App.sel.id === s.id ? ' aria-current="true"' : ""}>
      <span class="t1"><span>${esc(subTitle(s))}</span>${statusPill(s.status)}</span>
      <span class="t2">${esc(subMeta(s))} · ${esc(Store.userName(s.by))} · ${when(s.at)}</span></button></li>`;
  $("#view").innerHTML = `
  <div class="split wide-side">
    <aside class="side">
      <div class="list-h">Waiting for approval (${pend.length})</div>
      <ul class="list">${pend.map(item).join("") || `<li class="empty">Nothing waiting. New entries from data entry will appear here.</li>`}</ul>
      <div class="list-h">Data problems from help desk (${fwd.length})</div>
      <ul class="list">${fwd.map(x => `<li><button type="button" data-sel="t:${esc(x.id)}"${App.sel && App.sel.k === "t" && App.sel.id === x.id ? ' aria-current="true"' : ""}>
        <span class="t1"><span>${esc(x.id)} · ${esc(I18N.en["tt_" + x.type])}</span>${statusPill(x.status)}</span><span class="t2">${esc(x.text.slice(0, 80))}</span></button></li>`).join("") || `<li class="empty">No data problems forwarded.</li>`}</ul>
      <div class="list-h">Recently reviewed (click to correct)</div>
      <ul class="list">${done.map(item).join("") || `<li class="empty">None yet.</li>`}</ul>
    </aside>
    <section class="main"><div class="mapbox"><div class="map" id="map"></div></div><div class="pane" id="detail"></div></section>
  </div>`;
  $$("[data-sel]").forEach(b => b.onclick = () => { const [k, id] = b.dataset.sel.split(":"); App.sel = { k, id }; go2queue(); });
  const v0 = Data.view().villages[0] || { lat: 20.59, lng: 78.96 };
  makeMap("map", [v0.lat, v0.lng], 13); villageLayer().addTo(App.map);
  App.qLayer = L.layerGroup().addTo(App.map);
  queueDetail();
}
function go2queue() { if (App.map) { App.map.remove(); App.map = null; } renderBar(); viewQueue(); }

function queueDetail() {
  const el = $("#detail"), sel = App.sel, D = Data.view();
  App.qLayer.clearLayers();
  if (!sel) { el.innerHTML = `<div class="doc"><section><p>Select an entry on the left.</p></section></div>`; return; }
  if (sel.k === "t") return ticketDetailHead(el);
  const s = Store.db.submissions.find(x => x.id === sel.id); if (!s) return;
  if (s.type === "batch") return batchDetail(el, s);
  const pending = s.status === "pending", approved = s.status === "approved", hasGeo = FIELDS[s.type].some(f => f[0] === "lat");
  const excludeKey = approved ? s.id : null;

  el.innerHTML = `<div class="doc"><section>
    <h3>${esc(s.id)} ${statusPill(s.status)} <small>${TYPE_LABEL[s.type]} entered by ${esc(Store.userName(s.by))}, ${when(s.at)}</small></h3>
    ${s.status === "rejected" ? `<p>Rejected by ${esc(Store.userName(s.reviewedBy))} on ${when(s.reviewedAt)}. Remark: ${esc(s.remark || "")}</p>` : `
    <p class="srcnote" style="margin-bottom:10px">${pending ? "Check the details. You can correct any field before approving." : "This record is already in use. Correct it here if something is wrong."}
      ${hasGeo ? " Drag the orange pin on the map to fix the location." : ""}</p>
    <form id="qForm">${fieldsHTML(s.type, s.data, "q_")}
      <div id="dup"></div>
      ${s.editedBy ? `<p class="srcnote">Last corrected by ${esc(Store.userName(s.editedBy))} on ${when(s.editedAt)}.</p>` : ""}
      ${pending ? `<div class="f"><label for="rm">Remark for data entry</label><textarea id="rm" style="min-height:50px" placeholder="Required when rejecting"></textarea></div>` : ""}
      <p class="err" id="qE"></p>
      <div class="btns">${pending ? `<button type="button" class="btn green" id="ap">Approve</button><button type="button" class="btn red" id="rj">Reject</button>`
        : `<button type="button" class="btn" id="sv">Save correction</button>`}</div>
    </form>`}
  </section></div>`;
  if (s.status === "rejected") { drawQueueGeo(s.data, s.type); return; }

  // map pin that edits the form
  const refresh = () => {
    App.qLayer.clearLayers();
    const d = readFields(s.type, "q_");
    if (s.type === "business") dupCheck("q_", excludeKey || s.id);
    drawQueueGeo(d, s.type, hasGeo ? (lat, lng) => { $("#q_lat").value = lat.toFixed(6); $("#q_lng").value = lng.toFixed(6); refresh(); } : null);
  };
  FIELDS[s.type].forEach(([k]) => { const f = $("#q_" + k); if (f && ["lat", "lng", "category", "village"].includes(k)) f.onchange = refresh; });
  refresh();
  const collect = () => { const d = readFields(s.type, "q_"), err = validate(s.type, d); if (err) { $("#qE").textContent = err; return null; } return d; };
  const changed = d => JSON.stringify(d) !== JSON.stringify(Object.fromEntries(FIELDS[s.type].map(([k]) => [k, s.data[k] ?? (FIELDS[s.type].find(f => f[0] === k)[2] === "num" ? NaN : "")])));
  const next = () => { const p = Store.db.submissions.find(x => x.status === "pending"); App.sel = p ? { k: "s", id: p.id } : null; go2queue(); };
  if (pending) {
    $("#ap").onclick = () => { const d = collect(); if (!d) return; if (changed(d)) Store.edit(s.id, d, App.user.u);
      Store.review(s.id, "approved", $("#rm").value.trim(), App.user.u); toast("Approved. It is now used in entrepreneur reports."); next(); };
    $("#rj").onclick = () => { const r = $("#rm").value.trim(); if (!r) { $("#qE").textContent = "Add a remark so data entry knows what to fix."; return; }
      Store.review(s.id, "rejected", r, App.user.u); toast("Rejected. Data entry can see your remark."); next(); };
  } else {
    $("#sv").onclick = () => { const d = collect(); if (!d) return; if (!changed(d)) { $("#qE").textContent = "Nothing was changed."; return; }
      Store.edit(s.id, d, App.user.u); toast("Correction saved. Reports now use the corrected record."); go2queue(); };
  }
}

function drawQueueGeo(d, type, onDrag) {
  const D = Data.view();
  let at = null;
  if ((type === "business" || type === "village") && isFinite(d.lat) && isFinite(d.lng)) at = [d.lat, d.lng];
  if ((type === "price") && d.village) { const v = D.villages.find(x => x.village === d.village); if (v) at = [v.lat, v.lng]; }
  if (!at) return;
  if (type === "business") {
    L.circle(at, { radius: 100, color: "#E07B00", weight: 1, dashArray: "4 4", fill: false }).addTo(App.qLayer);
    D.businesses.forEach(b => { if (distKm({ lat: at[0], lng: at[1] }, b) > 2) return; const same = b.category === d.category;
      L.circleMarker([b.lat, b.lng], { radius: same ? 5 : 3, stroke: same, color: "#fff", weight: 1, fillColor: same ? "#C62828" : "#8A94A3", fillOpacity: .9 }).bindTooltip(esc(b.name)).addTo(App.qLayer); });
  }
  const m = L.marker(at, { icon: pin("new-pin"), draggable: !!onDrag, zIndexOffset: 1000 }).addTo(App.qLayer);
  if (onDrag) m.on("dragend", e => { const p = e.target.getLatLng(); onDrag(p.lat, p.lng); });
  if (!App.qCentered || App.qCentered !== App.sel.id) { App.map.setView(at, type === "business" ? 16 : 14); App.qCentered = App.sel.id; }
}

function batchDetail(el, s) {
  const d = s.data, ds = DATASETS[d.dataset], show = d.cols.filter(c => ds.cols.includes(c)).slice(0, 7);
  const pending = s.status === "pending";
  let dupes = 0;
  if (pending && d.dataset === "businesses") d.rows.forEach(r => { const n = dupNear(r.lat, r.lng, r.category); if (n && n.d <= 0.05) dupes++; });
  el.innerHTML = `<div class="doc"><section>
    <h3>${esc(s.id)} ${statusPill(s.status)} <small>CSV upload by ${esc(Store.userName(s.by))}, ${when(s.at)}</small></h3>
    <dl class="kv"><dt>File</dt><dd>${esc(d.file)}</dd><dt>Adds to</dt><dd>${esc(ds.file)}</dd><dt>Rows</dt><dd>${d.rows.length}${d.skipped ? ` (${d.skipped} invalid ${d.skipped === 1 ? "row was" : "rows were"} left out at upload)` : ""}</dd></dl>
    ${dupes ? `<div class="warnbox">${dupes} ${dupes === 1 ? "row has" : "rows have"} a same-type business already recorded within 50 m. Check for duplicates before approving.</div>` : pending && d.dataset === "businesses" ? `<div class="okbox">No likely duplicates found (same type within 50 m).</div>` : ""}
    <div class="tbl-wrap" style="margin-top:10px;max-height:300px;overflow:auto"><table class="tbl" style="font-size:13px"><thead><tr><th>#</th>${show.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${d.rows.slice(0, 100).map((r, i) => `<tr><td>${i + 1}</td>${show.map(c => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    ${d.rows.length > 100 ? `<p class="srcnote">Showing the first 100 of ${d.rows.length} rows.</p>` : ""}
    ${pending ? `<div class="f" style="margin-top:12px"><label for="rm">Remark for data entry</label><textarea id="rm" style="min-height:50px" placeholder="Required when rejecting"></textarea></div><p class="err" id="qE"></p>
      <div class="btns"><button type="button" class="btn green" id="ap">Approve all ${d.rows.length} rows</button><button type="button" class="btn red" id="rj">Reject file</button></div>`
      : `<p style="margin-top:10px">${s.status === "approved" ? "Approved" : "Rejected"} by ${esc(Store.userName(s.reviewedBy))} on ${when(s.reviewedAt)}.${s.remark ? " Remark: " + esc(s.remark) : ""}</p>`}
  </section></div>`;
  if ("lat" in (d.rows[0] || {})) {
    const g = L.featureGroup(d.rows.slice(0, 2000).map(r => L.circleMarker([r.lat, r.lng], { radius: 5, color: "#fff", weight: 1, fillColor: "#E07B00", fillOpacity: .95 }).bindTooltip(esc(r.name || r.village || "")))).addTo(App.qLayer);
    try { App.map.fitBounds(g.getBounds().pad(0.3)); } catch (e) {}
  }
  if (pending) {
    const next = () => { const p = Store.db.submissions.find(x => x.status === "pending"); App.sel = p ? { k: "s", id: p.id } : null; go2queue(); };
    $("#ap").onclick = () => { Store.review(s.id, "approved", $("#rm").value.trim(), App.user.u); toast(`Approved. ${d.rows.length} rows added to ${ds.file}.`); next(); };
    $("#rj").onclick = () => { const r = $("#rm").value.trim(); if (!r) { $("#qE").textContent = "Add a remark so data entry knows what to fix."; return; } Store.review(s.id, "rejected", r, App.user.u); toast("File rejected."); next(); };
  }
}

function ticketDetailHead(el) {
  const tk = Store.db.tickets.find(x => x.id === App.sel.id); if (!tk) return;
  if (tk.context && tk.context.lat) { L.marker([tk.context.lat, tk.context.lng], { icon: pin("new-pin") }).addTo(App.qLayer); App.map.setView([tk.context.lat, tk.context.lng], 14); }
  el.innerHTML = `<div class="doc"><section>
    <h3>${esc(tk.id)} ${statusPill(tk.status)} <small>from ${esc(Store.userName(tk.by))}, ${when(tk.at)}</small></h3>
    ${ticketBlock(tk, false)}
    <p class="srcnote">To fix it: open <b>Records map</b> to mark a business as closed, or pick a record under “Recently reviewed” to correct it.</p>
    <div class="f"><label for="hr">Reply (the entrepreneur and help desk will see it)</label><textarea id="hr" style="min-height:60px"></textarea></div>
    <div class="btns"><button type="button" class="btn green" id="hRes">Fixed: mark resolved</button><button type="button" class="btn sec" id="hBack">Send back to help desk</button><button type="button" class="btn sec" id="hMap">Open records map</button></div>
  </section></div>`;
  $("#hRes").onclick = () => { Store.reply(tk.id, App.user.u, $("#hr").value.trim() || "The data has been corrected.", "resolved"); toast("Marked resolved."); App.sel = null; go2queue(); };
  $("#hBack").onclick = () => { Store.reply(tk.id, App.user.u, $("#hr").value.trim(), "progress"); toast("Sent back to help desk."); App.sel = null; go2queue(); };
  $("#hMap").onclick = () => { App.mapFocus = tk.context || null; go("surveymap"); };
}

/* ================= Survey officer: records map ================= */
function viewSurveyMap() {
  const D = Data.view(), cats = D.categories.map(c => c.category);
  const srcs = [...new Set(D.businesses.map(b => b.source || "Unknown"))];
  const count = (c, s) => D.businesses.filter(b => b.category === c && (b.source || "Unknown") === s).length;
  const closed = Store.db.closed;
  $("#view").innerHTML = `
  <div class="split wide-side">
    <aside class="side"><div class="step">
      <div class="f"><label for="smC">Show business type</label><select id="smC"><option value="">All types</option>${catOptions(App.mapFocus ? App.mapFocus.category : "")}</select></div>
      <p class="hint" style="font-size:13px;color:var(--muted)">Click a business on the map to see its details or mark it as closed. Closed businesses are removed from entrepreneur reports.</p>
      <div class="tbl-wrap"><table class="tbl" style="font-size:13px"><thead><tr><th>Type</th>${srcs.map(s => `<th class="n">${esc(s)}</th>`).join("")}<th class="n">Total</th></tr></thead><tbody>
        ${cats.map(c => `<tr><td>${esc(catLabel(c))}</td>${srcs.map(s => `<td class="n">${count(c, s)}</td>`).join("")}<td class="n"><b>${D.businesses.filter(b => b.category === c).length}</b></td></tr>`).join("")}
      </tbody></table></div>
      <p class="srcnote" style="margin-top:8px">${D.businesses.length} active business records.</p>
    </div>
    <div class="list-h">Marked closed (${closed.length})</div>
    <ul class="list">${closed.map(c => `<li style="padding:8px 16px;display:flex;justify-content:space-between;gap:8px;font-size:14px"><span><b>${esc(c.name)}</b><br><span class="srcnote">${esc(c.reason || "")} · ${esc(Store.userName(c.by))}, ${when(c.at)}</span></span>
      <button type="button" class="btn-link" data-restore="${esc(c.key)}">Restore</button></li>`).join("") || `<li class="empty">None.</li>`}</ul>
    </aside>
    <section class="main"><div class="mapbox tall"><div class="map" id="map"></div></div></section>
  </div>`;
  const f = App.mapFocus, v0 = (f && D.villages.find(v => v.village === f.village)) || D.villages[0] || { lat: 20.59, lng: 78.96 };
  App.mapFocus = null;
  const map = makeMap("map", [v0.lat, v0.lng], f ? 14 : 13); villageLayer().addTo(map);
  const lay = L.layerGroup().addTo(map);
  const col = { "OSM": "#6A4C93", "FSSAI": "#0A58A8", "Udyam": "#00897B", "Field survey": "#2E7D32" };
  legend(Object.entries(col).map(([k, c]) => `<div><i style="background:${c}"></i>${k}</div>`).join("") + `<div><i style="background:#8A94A3"></i>Other source</div><div><i style="background:#E07B00"></i>Waiting for approval</div>`).addTo(map);
  const draw = () => {
    lay.clearLayers(); const c = $("#smC").value;
    D.businesses.filter(b => !c || b.category === c).forEach(b => L.circleMarker([b.lat, b.lng], { radius: 5, color: "#fff", weight: .8, fillColor: col[b.source] || "#8A94A3", fillOpacity: .95 })
      .bindPopup(`<b>${esc(b.name)}</b><br>${esc(catLabel(b.category))}<br>Source: ${esc(b.source || "–")}${b.ref ? "<br>Ref: " + esc(b.ref) : ""}
        <br><button type="button" class="btn red" style="margin-top:8px;padding:3px 10px" data-close="${esc(b._key)}" data-name="${esc(b.name)}">Mark as closed</button>`).addTo(lay));
    Store.db.submissions.filter(s => s.status === "pending" && s.type === "business" && (!c || s.data.category === c)).forEach(s =>
      L.circleMarker([s.data.lat, s.data.lng], { radius: 6, color: "#fff", weight: 1.5, fillColor: "#E07B00", fillOpacity: 1 }).bindTooltip(esc(s.data.name) + " (waiting for approval)").addTo(lay));
  };
  map.on("popupopen", e => {
    const b = e.popup.getElement().querySelector("[data-close]"); if (!b) return;
    b.onclick = () => { const reason = prompt(`Why is “${b.dataset.name}” being marked closed?`, "Closed, confirmed on field visit"); if (reason === null) return;
      Store.closeBiz(b.dataset.close, b.dataset.name, reason.trim(), App.user.u); toast("Marked closed. It no longer appears in reports."); go("surveymap"); };
  });
  $$("[data-restore]").forEach(b => b.onclick = () => { Store.restoreBiz(b.dataset.restore); toast("Restored."); go("surveymap"); });
  $("#smC").onchange = draw; draw();
}

/* ================= Survey officer: data files ================= */
function viewData() {
  const origin = k => Data.origin[k] === "folder" ? "base file from data/" + DATASETS[k].file : "built-in placeholder (js/sample-data.js)";
  const approvedRows = k => Store.db.submissions.filter(s => s.status === "approved" && ((s.type === "batch" && s.data.dataset === k) || ({ villages: "village", businesses: "business", prices: "price", threats: "threat" })[k] === s.type))
    .reduce((a, s) => a + (s.type === "batch" ? s.data.rows.length : 1), 0);
  $("#view").innerHTML = `<div class="pane"><div class="doc" style="margin:0 auto;max-width:1000px">
    <section><h3>Data files</h3>
      <p>Every number in the entrepreneur's report comes from these five files. Each file = the base CSV in the <code>data</code> folder + entries you approved. Data entry adds new records or uploads CSV files; they reach the reports only after you approve them.</p>
      ${Data.isPlaceholder() ? `<div class="warnbox">Placeholder data is loaded. Village names like “Village A” and all counts are made up for the demo. Replace the CSV files in the data folder with real data.</div>` : ""}
    </section>
    ${Object.entries(DATASETS).map(([k, ds]) => `<section>
      <h3>${esc(ds.file)} <small>${Data.view()[k].length} rows in use: ${Data.rows[k].length} from the ${esc(origin(k))}${approvedRows(k) ? ` + ${approvedRows(k)} approved` : ""}${k === "businesses" && Store.db.closed.length ? ` − ${Store.db.closed.length} closed` : ""}</small></h3>
      <p>${esc(ds.about)}</p>
      <p class="srcnote">Columns: ${ds.cols.map(c => `<code>${esc(c)}</code>`).join(", ")} (required: ${ds.need.map(esc).join(", ")})</p>
      ${Data.errors[k] ? `<div class="warnbox">${esc(Data.errors[k])}</div>` : ""}
      <div class="btns" style="margin-top:8px"><button type="button" class="btn sec" data-dl="${k}">Download everything in use (CSV)</button></div></section>`).join("")}
    <section><h3>Scheme rules</h3>
      <table class="tbl"><thead><tr><th>Scheme</th><th class="n">Project cost up to</th><th class="n">Loan cap</th><th class="n">Interest</th><th class="n">Tenure</th><th class="n">Moratorium</th></tr></thead><tbody>
      ${Object.entries(RULES.schemes).map(([k, s]) => `<tr><td>${esc(I18N.en[k])}</td><td class="n">${rupee(s.maxCost)}</td><td class="n">${rupee(s.loanCap)}</td><td class="n">${(s.rate * 100).toFixed(1)}%</td><td class="n">${s.years} yrs</td><td class="n">${s.morMonths} months</td></tr>`).join("")}
      </tbody></table>
      <p class="srcnote" style="margin-top:8px">Margin ${RULES.marginShare * 100}% of project cost. Rules live in one place (RULES in js/engine.js) so they can be changed without touching the calculations.</p>
    </section>
    <section><h3>Demo records</h3><p>Resets accounts, entries, approvals, closed businesses and tickets to the starting demo state in this browser.</p>
      <button type="button" class="btn red" id="rst">Reset demo records</button></section>
  </div></div>`;
  $$("[data-dl]").forEach(b => b.onclick = () => downloadText(DATASETS[b.dataset.dl].file, Data.toCSV(b.dataset.dl)));
  $("#rst").onclick = () => { if (confirm("Reset all demo records in this browser?")) { Store.reset(); App.user = Store.db.users.find(u => u.u === App.user.u) || null; App.S = null; toast("Demo records reset."); App.user ? go("data") : start(); } };
}

/* ================= Help desk ================= */
function viewTickets() {
  const all = Store.db.tickets;
  const F = { active: x => x.status === "open" || x.status === "progress", forwarded: x => x.status === "forwarded", resolved: x => x.status === "resolved", all: () => true };
  const list = all.filter(F[App.filter]);
  if (!App.sel || !all.find(x => x.id === App.sel.id)) App.sel = list[0] ? { id: list[0].id } : null;
  $("#view").innerHTML = `
  <div class="split wide-side">
    <aside class="side">
      <div class="list-h"><span>Reports from entrepreneurs</span>
        <select id="tf" aria-label="Filter"><option value="active">Open and in progress</option><option value="forwarded">With survey team</option><option value="resolved">Resolved</option><option value="all">All</option></select></div>
      <ul class="list">${list.map(x => `<li><button type="button" data-tk="${esc(x.id)}"${App.sel && App.sel.id === x.id ? ' aria-current="true"' : ""}>
        <span class="t1"><span>${esc(x.id)} · ${esc(I18N.en["tt_" + x.type])}</span>${statusPill(x.status)}</span>
        <span class="t2">${esc(Store.userName(x.by))} · ${when(x.at)} · ${esc(x.text.slice(0, 60))}</span></button></li>`).join("") || `<li class="empty">No reports in this list.</li>`}</ul>
    </aside>
    <section class="main"><div class="pane" id="tkd"></div></section>
  </div>`;
  $("#tf").value = App.filter;
  $("#tf").onchange = e => { App.filter = e.target.value; App.sel = null; viewTickets(); };
  $$("[data-tk]").forEach(b => b.onclick = () => { App.sel = { id: b.dataset.tk }; viewTickets(); });
  const tk = App.sel && all.find(x => x.id === App.sel.id), el = $("#tkd");
  if (!tk) { el.innerHTML = `<div class="doc"><section><p>Select a report on the left.</p></section></div>`; return; }
  el.innerHTML = `<div class="doc"><section>
    <h3>${esc(tk.id)} ${statusPill(tk.status)} <small>from ${esc(Store.userName(tk.by))}, ${when(tk.at)}</small></h3>
    ${ticketBlock(tk, false)}
    <div class="f"><label for="rp">Reply to the entrepreneur</label><textarea id="rp" style="min-height:70px"></textarea></div>
    <div class="f" style="max-width:260px"><label for="rs">Status</label><select id="rs">
      ${["open", "progress", "forwarded", "resolved"].map(s => `<option value="${s}"${s === tk.status ? " selected" : ""}>${esc(I18N.en["st_" + s])}</option>`).join("")}</select></div>
    <p class="err" id="rpE"></p>
    <div class="btns"><button type="button" class="btn" id="rpS">Save reply and status</button>
      ${tk.status !== "forwarded" ? `<button type="button" class="btn sec" id="rpF">Forward to survey officer</button>` : ""}</div>
    <p class="srcnote" style="margin-top:10px">Forward reports about wrong or missing business data. They appear in the survey officer's approval queue, and the officer corrects the record.</p>
  </section></div>`;
  $("#rpS").onclick = () => { const txt = $("#rp").value.trim(), st = $("#rs").value;
    if (!txt && st === tk.status) { $("#rpE").textContent = "Write a reply or change the status."; return; }
    Store.reply(tk.id, App.user.u, txt, st); toast("Saved."); renderBar(); viewTickets(); };
  const f = $("#rpF"); if (f) f.onclick = () => { Store.reply(tk.id, App.user.u, $("#rp").value.trim() || "We have passed this to the survey officer to check and correct.", "forwarded"); toast("Forwarded to the survey officer."); renderBar(); viewTickets(); };
}

/* ================= Boot ================= */
$("#lang").onchange = e => { App.lang = e.target.value; try { localStorage.setItem("bizwise-lang", App.lang); } catch (x) {} App.user ? go(App.view) : (renderBar(), viewLogin()); };
$("#logout").onclick = () => { Store.logout(); App.user = null; App.S = null; App.view = null; renderBar(); viewLogin(); };

(async function boot() {
  try { const l = localStorage.getItem("bizwise-lang"); if (l && I18N[l]) App.lang = l; } catch (e) {}
  Store.load();
  $("#view").innerHTML = `<p class="empty">Loading data…</p>`;
  await Data.loadAll();
  start();
})();

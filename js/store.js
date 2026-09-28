/* Demo data layer.
   Everything the four roles create (data entries, approvals, edits, tickets) is kept in this
   browser's localStorage so the full workflow can be shown without a server.
   For real use, replace these functions with calls to a backend (for example Firebase Auth +
   Firestore, both on a free tier) — the rest of the app only talks to Store. */
const Store = {
  KEY: "bizwise-db-v3",
  db: null,

  seed() {
    const now = Date.now(), h = 3600e3;
    return {
      seq: 1100,
      users: [
        // DEMO ONLY: plain passwords in the browser are not secure. Use real authentication in production.
        { u: "user",      p: "user123",    role: "user",      name: "Ramesh Pawar" },
        { u: "officer",   p: "officer123", role: "officer",   name: "Anil Deshmukh" },
        { u: "helpdesk",  p: "help123",    role: "helpdesk",  name: "Priya Kulkarni" },
        { u: "dataentry", p: "data123",    role: "dataentry", name: "Sunita Jadhav" }
      ],
      closed: [],
      submissions: [
        { id: "S1001", type: "business", by: "dataentry", at: now - 5*h, status: "pending",
          data: { name: "Shree Dudh Dairy", category: "dairy", source: "FSSAI", ref: "FSSAI reg. 21524000000123", lat: 18.9072, lng: 73.9031, phone: "", note: "Registration found on FoSCoS; location from field visit." } },
        { id: "S1002", type: "business", by: "dataentry", at: now - 4*h, status: "pending",
          data: { name: "Dairy 3 (re-survey)", category: "dairy", source: "Field survey", ref: "Survey form 14", lat: 18.90132, lng: 73.90475, phone: "", note: "Board looks new. Could be the same owner as an existing record." } },
        { id: "S1003", type: "price", by: "dataentry", at: now - 3*h, status: "pending",
          data: { village: "Village A", category: "dairy", item: "Curd – village retail", unit: "kg", low: 70, high: 90, source: "Field survey" } },
        { id: "S1004", type: "business", by: "dataentry", at: now - 30*h, status: "approved", reviewedBy: "officer", reviewedAt: now - 26*h, remark: "Checked on phone call.",
          data: { name: "Laxmi Tailors", category: "tailoring", source: "Field survey", ref: "Survey form 9", lat: 18.9101, lng: 73.9082, phone: "", note: "" } },
        { id: "S1005", type: "batch", by: "dataentry", at: now - 2*h, status: "pending",
          data: { dataset: "businesses", file: "osm_export_khed.csv", skipped: 1,
            cols: ["name","category","lat","lng","source","verified"],
            rows: [
              { name: "Om Kirana Stores", category: "kirana", lat: 18.9215, lng: 73.9302, source: "OSM", verified: "no" },
              { name: "Ganesh Flour Mill", category: "flour_mill", lat: 18.9198, lng: 73.9281, source: "OSM", verified: "no" },
              { name: "Sai Mobile Point", category: "mobile_repair", lat: 18.9223, lng: 73.9318, source: "OSM", verified: "no" },
              { name: "Balaji Medical", category: "medical", lat: 18.9207, lng: 73.9290, source: "OSM", verified: "no" },
              { name: "Mauli Tea House", category: "tea_stall", lat: 18.9211, lng: 73.9296, source: "OSM", verified: "no" }
            ] } }
      ],
      tickets: [
        { id: "T1001", by: "user", at: now - 20*h, type: "data", status: "open",
          text: "The report shows a flour mill in Village C but it closed last year.",
          context: { village: "Village C", category: "flour_mill", margin: 50000, score: 58 },
          replies: [] }
      ]
    };
  },

  load() {
    try { this.db = JSON.parse(localStorage.getItem(this.KEY)); } catch (e) { this.db = null; }
    if (!this.db || !this.db.users) { this.db = this.seed(); this.save(); }
    this.db.closed = this.db.closed || [];
  },
  save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.db)); } catch (e) { alert("Browser storage is full. Remove some uploaded files or reset demo records."); }
    if (typeof Data !== "undefined") Data.cache = null;
  },
  reset() { this.db = this.seed(); this.save(); },
  nextId(prefix) { this.db.seq += 1; return prefix + this.db.seq; },

  // ---- auth ----
  login(u, p) {
    const user = this.db.users.find(x => x.u === String(u).trim().toLowerCase() && x.p === p);
    if (!user) return null;
    try { sessionStorage.setItem("bizwise-session", user.u); } catch (e) {}
    return user;
  },
  current() {
    let u = null; try { u = sessionStorage.getItem("bizwise-session"); } catch (e) {}
    return this.db.users.find(x => x.u === u) || null;
  },
  logout() { try { sessionStorage.removeItem("bizwise-session"); } catch (e) {} },
  userName(u) { const x = this.db.users.find(y => y.u === u); return x ? x.name : u; },

  // ---- data entries ----
  addSubmission(type, data, by) {
    const s = { id: this.nextId("S"), type, data, by, at: Date.now(), status: "pending" };
    this.db.submissions.unshift(s); this.save(); return s;
  },
  review(id, status, remark, by) {
    const s = this.db.submissions.find(x => x.id === id); if (!s) return;
    Object.assign(s, { status, remark, reviewedBy: by, reviewedAt: Date.now() }); this.save();
  },
  edit(id, data, by) {
    const s = this.db.submissions.find(x => x.id === id); if (!s) return;
    s.data = data; s.editedBy = by; s.editedAt = Date.now(); this.save();
  },
  withdraw(id) { this.db.submissions = this.db.submissions.filter(x => x.id !== id); this.save(); },

  // ---- closing businesses that no longer exist ----
  closeBiz(key, name, reason, by) { this.db.closed.push({ key, name, reason, by, at: Date.now() }); this.save(); },
  restoreBiz(key) { this.db.closed = this.db.closed.filter(c => c.key !== key); this.save(); },

  // ---- tickets ----
  addTicket(t) {
    const tk = Object.assign({ id: this.nextId("T"), at: Date.now(), status: "open", replies: [] }, t);
    this.db.tickets.unshift(tk); this.save(); return tk;
  },
  reply(id, by, text, status) {
    const t = this.db.tickets.find(x => x.id === id); if (!t) return;
    if (text) t.replies.push({ by, at: Date.now(), text });
    if (status) t.status = status;
    this.save();
  }
};

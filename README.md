# BizWise – prototype for SIH26091

Business feasibility report + loan planner for rural micro-entrepreneurs, with four roles:

| Role | Demo login | What they do |
|---|---|---|
| 1. Entrepreneur | `user` / `user123` | Picks a site on the map, gets the feasibility report and loan plan (English / Hindi / Marathi), reports problems to the help desk |
| 2. Survey officer | `officer` / `officer123` | Checks every data entry, **corrects any field (or drags the pin) before approving**, rejects with a remark, corrects records already in use, marks closed businesses, fixes data problems forwarded by the help desk |
| 3. Help desk | `helpdesk` / `help123` | Replies to entrepreneur reports, changes status, forwards data problems to the survey officer |
| 4. Data entry operator | `dataentry` / `data123` | Enters data gathered from Census, OSM, FSSAI, Udyam, Agmarknet or field surveys: one business / village / price / risk at a time (GPS or map tap), or a whole CSV file |

Nothing entered by data entry reaches the entrepreneur until the survey officer approves it.

**Demo flow for judges (3 minutes):**
1. `dataentry`: add a kirana store near Village A (tap the map), or upload a CSV file.
2. `officer`: open it in the approval queue, correct the name or drag the pin, approve. Then open Records map, click a business and mark it closed.
3. `user`: choose Kirana store – the competitor count has changed.
4. `user` reports a wrong record → `helpdesk` forwards it → `officer` fixes it and marks it resolved → the user sees the reply.

## Put your field data in

All numbers come from five CSV files in `data/`. Open them in Excel, replace the rows, keep the column names, save as CSV (UTF-8).

| File | One row per | Columns |
|---|---|---|
| `villages.csv` | village / hamlet | `village, block, district, lat, lng, population, households` |
| `businesses.csv` | existing business | `name, category, lat, lng, source, verified` (source: OSM / FSSAI / Udyam / Field survey; verified: yes / no) |
| `categories.csv` | business type | `category, label_en, label_hi, label_mr, households_per_unit, setup_cost_min, setup_cost_typical, monthly_profit_typical, monthly_running_cost, channels, strength, weakness` (use `;` to separate several channels/strengths) |
| `prices.csv` | price observation | `category, item, unit, low, high, source` |
| `threats.csv` | risk | `category, threat, months, source` (months as numbers separated by `;`, e.g. `4;5;6`, empty = any time) |

`category` must match between files (e.g. `dairy`). `households_per_unit` = how many households one unit of that business needs to survive – get it from your field survey (households in a village ÷ number of such shops in well-balanced villages).

Tips: get lat/lng from Google Maps (long-press → copy coordinates) or the GPS button on the data entry screen. Population/households from the Census 2011 village directory.

The placeholder data uses the block name `Sample Block`; once your `villages.csv` no longer contains it, the "Placeholder data" label disappears. Data entry can also upload a CSV from the app (Enter data → CSV upload); the rows are added after the survey officer approves the file.

## Run it

* Locally: in this folder run `python -m http.server 8000`, open http://localhost:8000 (opening index.html directly also works, but then it uses the built-in copy in `js/sample-data.js` instead of `data/`).
* Online (free): push this folder to a GitHub repo → Settings → Pages → Deploy from branch → `main` / root. Your link: `https://<username>.github.io/<repo>/`.

## Honest limits of this prototype

* **Login and records are demo-only.** Accounts, entries, approvals and tickets live in the browser's localStorage, so each device has its own copy and passwords are not secure. For the real system, replace `js/store.js` with Firebase Authentication + Firestore (free tier) – no other file needs to change much.
* The SWOT is rule-based from the calculated numbers and the text in `categories.csv` / `threats.csv`. The planned AI layer will write it as natural language using only these numbers.
* Maps: OpenStreetMap tiles (free, attribution required) and Esri satellite imagery.

## Files

```
index.html          page shell
css/style.css       styles
js/engine.js        CSV loading, distance maths, supply ratio, score, scheme router + EMI
js/app.js           screens for the four roles
js/store.js         demo login and records (replace with a real backend)
js/i18n.js          English / Hindi / Marathi text
js/sample-data.js   fallback copy of data/*.csv for file:// use
data/*.csv          YOUR DATA GOES HERE
```

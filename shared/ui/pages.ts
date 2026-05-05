// Auto-extracted from _legacy-main.ts. Edit the source there if you need
// pixel-perfect parity, then re-extract.

export const sharedThemeCss = `
:root{
  --bg:#0b1210;
  --panel:#0f1b17;
  --panel2:#10221c;
  --panel3:#132a23;
  --border:#2a3b36;
  --text:#d7dde0;
  --muted:#98a6ad;
  --muted2:#7f8b91;
  --silver:#c3ccd1;
  --accent:#19c37d;
  --accent2:#0ea86b;
  --accentHi:#27e39a;
  --danger:#ff4757;
  --warning:#ff9f43;
  --shadow:0 10px 30px rgba(0,0,0,.35);
  box-sizing:border-box;
}
*{box-sizing:inherit;margin:0;padding:0}
body{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  background:
    radial-gradient(1200px 700px at 20% 0%, rgba(25,195,125,.12), transparent 60%),
    radial-gradient(900px 600px at 80% 30%, rgba(195,204,209,.08), transparent 55%),
    var(--bg);
  color:var(--text);
  min-height:100vh;
  padding:20px;
}
.container{max-width:1200px;margin:0 auto}
h1{text-align:center;margin-bottom:10px;color:var(--silver);font-size:2rem;letter-spacing:.2px}
.subtitle{text-align:center;color:var(--muted2);margin-bottom:30px}
.nav-links{text-align:center;margin-bottom:30px}
.nav-links a{
  color:var(--accent);
  text-decoration:none;
  margin:0 10px;
  padding:8px 16px;
  border:1px solid rgba(25,195,125,.45);
  border-radius:8px;
  transition:all .18s ease;
  display:inline-block;
  margin-bottom:10px;
  background:rgba(15,27,23,.35);
  backdrop-filter:blur(4px);
}
.nav-links a:hover{
  background:rgba(25,195,125,.16);
  border-color:rgba(25,195,125,.75);
  color:var(--accentHi);
  transform:translateY(-1px);
}
.panel{
  background:linear-gradient(180deg, rgba(16,34,28,.92), rgba(15,27,23,.92));
  border:1px solid rgba(42,59,54,.85);
  border-radius:12px;
  padding:20px;
  box-shadow:var(--shadow);
}
.filters{display:flex;gap:20px;flex-wrap:wrap;align-items:flex-end}
.filter-group{display:flex;flex-direction:column;gap:6px}
.filter-group label{font-size:.85rem;color:var(--muted)}
input[type="text"], input[type="date"], select{
  padding:10px 14px;
  font-size:1rem;
  border:1px solid rgba(42,59,54,.95);
  border-radius:10px;
  background:rgba(11,18,16,.75);
  color:var(--text);
  outline:none;
  transition:border-color .18s ease, box-shadow .18s ease;
}
input[type="text"]:focus, input[type="date"]:focus, select:focus{
  border-color:rgba(25,195,125,.95);
  box-shadow:0 0 0 3px rgba(25,195,125,.18);
}
input::placeholder{color:rgba(152,166,173,.75)}
button{
  padding:10px 22px;
  font-size:1rem;
  background:linear-gradient(180deg, var(--accentHi), var(--accent));
  color:#08110e;
  border:none;
  border-radius:10px;
  cursor:pointer;
  font-weight:700;
  transition:transform .1s ease, filter .15s ease, opacity .15s ease;
  height:42px;
}
button:hover{filter:brightness(1.02);transform:translateY(-1px)}
button:disabled{opacity:.45;cursor:not-allowed;transform:none}
button.secondary{
  background:transparent;
  border:1px solid rgba(195,204,209,.35);
  color:var(--silver);
}
button.secondary:hover{
  background:rgba(195,204,209,.10);
  border-color:rgba(195,204,209,.55);
  color:#e7eef2;
}
.table{width:100%;border-collapse:collapse;margin-top:10px}
.table th,.table td{padding:12px 15px;text-align:left;border-bottom:1px solid rgba(42,59,54,.9)}
.table th{color:var(--muted);font-weight:700;font-size:.82rem;text-transform:uppercase;letter-spacing:.06em}
.table tr:hover{background:rgba(25,195,125,.06)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace}
.badge{display:inline-block;padding:4px 10px;border-radius:999px;font-size:.78rem;font-weight:800;letter-spacing:.02em}
.badge.danger{background:rgba(255,71,87,.18);color:#ffd1d7;border:1px solid rgba(255,71,87,.35)}
.badge.ok{background:rgba(25,195,125,.16);color:#b8ffe2;border:1px solid rgba(25,195,125,.35)}
.loading{text-align:center;padding:60px;color:var(--muted)}
.spinner{width:50px;height:50px;border:4px solid rgba(42,59,54,.85);border-top-color:rgba(25,195,125,.95);border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 18px}
@keyframes spin{to{transform:rotate(360deg)}}
.error{background:rgba(255,71,87,.18);border:1px solid rgba(255,71,87,.35);color:#ffd1d7;padding:14px 16px;border-radius:12px;margin-bottom:16px}
.muted{color:var(--muted)}
`;

export const homePageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📱</text></svg>">
<title>Google Sheets KV - Home</title>
<style>
${sharedThemeCss}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-top:14px}
.card{
  background:linear-gradient(180deg, rgba(16,34,28,.92), rgba(15,27,23,.92));
  border:1px solid rgba(42,59,54,.85);
  border-radius:14px;
  padding:18px;
  box-shadow:var(--shadow);
}
.card h2{color:var(--silver);font-size:1.05rem;margin-bottom:6px}
.card p{color:var(--muted);line-height:1.45;margin-bottom:12px}
.actions{display:flex;gap:10px;flex-wrap:wrap}
a.btn{
  display:inline-block;
  padding:10px 16px;
  border-radius:10px;
  text-decoration:none;
  font-weight:800;
  border:1px solid rgba(25,195,125,.45);
  background:rgba(25,195,125,.10);
  color:var(--accentHi);
  transition:all .18s ease;
}
a.btn:hover{background:rgba(25,195,125,.16);transform:translateY(-1px);border-color:rgba(25,195,125,.75)}
a.btn.secondary{
  border-color:rgba(195,204,209,.35);
  color:var(--silver);
  background:rgba(195,204,209,.06);
}
a.btn.secondary:hover{background:rgba(195,204,209,.10);border-color:rgba(195,204,209,.55)}
.small{font-size:.85rem}
hr{border:none;border-top:1px solid rgba(42,59,54,.75);margin:18px 0}
.code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;color:var(--muted2)}
</style>
</head>
<body>
  <div class="container">
    <h1>Google Sheets KV Service</h1>
    <p class="subtitle">Pick a UI page below (or hit an API endpoint directly).</p>

    <div class="panel">
      <div class="nav-links">
        <a href="/dashboard">Dashboard</a>
        <a href="/search">Conversation Search</a>
        <a href="/audit">Audit Search</a>
    <a href="/injections">Injections</a>
    <a href="/review">Review</a>
    <a href="/test">🧪 Test</a>
      </div>

      <div class="grid">
        <div class="card">
          <h2>SMS Analytics Dashboard</h2>
          <p>Stats + KV breakdown + recent activity, with an appointments drill-in overlay.</p>
          <div class="actions">
            <a class="btn" href="/dashboard">Open Dashboard</a>
            <a class="btn secondary" href="/api/dashboard/stats">API: /api/dashboard/stats</a>
          </div>
        </div>

        <div class="card">
          <h2>Conversation Search</h2>
          <p>Search conversations by phone, with optional filters (callId/sender/nodeTag/message contains).</p>
          <div class="actions">
            <a class="btn" href="/search">Open Search</a>
            <a class="btn secondary" href="/api/conversations/search?phone=5551234567">API: legacy search</a>
          </div>
          <p class="small muted" style="margin-top:10px">
            Tip: improved endpoint is <span class="code">/api/conversations/search2</span>.
          </p>
        </div>

        <div class="card">
          <h2>Audit Record Search</h2>
          <p>Lookup a record ID quickly or browse paged results (optional stage browsing).</p>
          <div class="actions">
            <a class="btn" href="/audit">Open Audit</a>
            <a class="btn secondary" href="/api/audit/browse">API: /api/audit/browse</a>
          </div>
        </div>

        <div class="card">
          <h2>Cron Trigger</h2>
          <p>Manually run scheduled injection processing (external cron mode).</p>
          <div class="actions">
            <a class="btn" href="/api/cron/trigger">GET /api/cron/trigger</a>
            <a class="btn secondary" href="/api/state">GET /api/state</a>
          </div>
        </div>

        <div class="card">
          <h2>Guest Endpoints</h2>
          <p>POST /api/guests/activate (bulk SHA phone matching) and POST /api/guests/answered (mark answered).</p>
          <div class="actions">
            <a class="btn secondary" href="#">POST /api/guests/activate</a>
            <a class="btn secondary" href="#">POST /api/guests/answered</a>
          </div>
        </div>

        <div class="card">
          <h2>Nightly Report</h2>
          <p>Send a daily summary email with dashboard stats + conversations CSV via Postmark.</p>
          <div class="actions">
            <a class="btn" href="/api/report/nightly">GET /api/report/nightly</a>
          </div>
          <p class="small muted" style="margin-top:10px">
            Requires env var: <span class="code">POSTMARK_SERVER</span>. Sends to adamp@monsterrg.com. Optional: <span class="code">?date=YYYY-MM-DD</span>
          </p>
        </div>
      </div>

      <hr />
      <p class="muted small">
        This page handles <span class="code">GET /</span> when there is no legacy <span class="code">recordId</span> query param.
      </p>
    </div>
  </div>
</body>
</html>`;

export const auditSearchHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📱</text></svg>">
<title>Audit Search</title>
<style>
${sharedThemeCss}
.stats-bar{display:flex;gap:40px;flex-wrap:wrap;margin-bottom:16px}
.stat-item{text-align:center;min-width:140px}
.stat-item .value{font-size:2rem;font-weight:900;color:var(--silver)}
.stat-item .label{font-size:.85rem;color:var(--muted)}
.results-section{margin-top:16px}
.pagination{display:flex;justify-content:center;gap:10px;margin-top:14px;align-items:center}
</style>
</head>
<body>
<div class="container">
  <h1>Audit Record Search</h1>
  <p class="subtitle">Search and browse deduplication audit records.</p>

  <div class="nav-links">
    <a href="/search">SMS Search</a>
    <a href="/dashboard">SMS Dashboard</a>
    <a href="/audit">Audit Search</a>
    <a href="/injections">Injections</a>
    <a href="/review">Review</a>
    <a href="/test">🧪 Test</a>
  </div>

  <div class="panel" style="margin-bottom:16px">
    <h3 style="color:var(--silver); margin-bottom:12px">Quick Lookup</h3>
    <div class="filters">
      <div class="filter-group" style="flex:1">
        <label>Record ID</label>
        <input type="text" id="singleRecordId" placeholder="Enter record ID to check..." />
      </div>
      <div class="filter-group">
        <label>Stage (optional)</label>
        <input type="text" id="singleStage" placeholder="e.g. landing, live" />
      </div>
      <button onclick="checkSingleRecord()">Check</button>
    </div>
    <div id="singleResult" style="display:none; margin-top:12px" class="panel"></div>
  </div>

  <div class="panel" style="margin-bottom:16px">
    <div class="filters">
      <div class="filter-group">
        <label>Start Date</label>
        <input type="date" id="startDate" />
      </div>
      <div class="filter-group">
        <label>End Date</label>
        <input type="date" id="endDate" />
      </div>
      <div class="filter-group">
        <label>Stage (optional)</label>
        <input type="text" id="stage" placeholder="(blank = legacy audit)" />
      </div>
      <div class="filter-group" style="flex:1">
        <label>Record ID contains</label>
        <input type="text" id="searchRecordId" placeholder="Filter by ID..." />
      </div>
      <button onclick="loadAuditData()">Search</button>
      <button class="secondary" onclick="resetFilters()">Reset</button>
    </div>
    <p class="muted" style="margin-top:10px">
      Tip: Stage browsing uses stage keys <span class="mono">auditstage</span>. Leaving Stage empty searches legacy <span class="mono">audit</span> keys.
    </p>
  </div>

  <div id="loading" class="loading" style="display:none">
    <div class="spinner"></div>
    <p>Loading audit data...</p>
  </div>
  <div id="error" class="error" style="display:none"></div>

  <div id="content">
    <div class="panel" style="margin-bottom:16px">
      <div class="stats-bar">
        <div class="stat-item">
          <div class="value" id="totalRecords">-</div>
          <div class="label">Total (filtered)</div>
        </div>
        <div class="stat-item">
          <div class="value" id="todayRecords">-</div>
          <div class="label">Today (filtered)</div>
        </div>
        <div class="stat-item">
          <div class="value" id="latestDate">-</div>
          <div class="label">Latest</div>
        </div>
      </div>
    </div>

    <div class="panel results-section">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap">
        <h2 style="color:var(--silver); font-size:1.25rem">Audit Records</h2>
        <span id="resultsInfo" class="muted"></span>
      </div>

      <table class="table">
        <thead>
          <tr>
            <th>Record ID</th>
            <th>Processed At</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody id="auditResults"></tbody>
      </table>

      <div id="emptyState" class="muted" style="display:none; text-align:center; padding:28px">
        No audit records found matching your filters.
      </div>

      <div class="pagination" id="pagination"></div>
    </div>
  </div>
</div>

<script>
let currentPage = 1;
let pageSize = 50;
let totalRecords = 0;

// Default dates: today
const today = new Date();
document.getElementById("endDate").value = today.toISOString().split("T")[0];
document.getElementById("startDate").value = today.toISOString().split("T")[0];

document.getElementById("singleRecordId").addEventListener("keypress", (e) => {
  if (e.key === "Enter") checkSingleRecord();
});
document.getElementById("searchRecordId").addEventListener("keypress", (e) => {
  if (e.key === "Enter") loadAuditData();
});

function formatTimestamp(iso){
  if(!iso) return "-";
  const d = new Date(iso);
  if(isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-US", { month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit", hour12:true });
}

async function checkSingleRecord(){
  const recordId = document.getElementById("singleRecordId").value.trim();
  const stage = document.getElementById("singleStage").value.trim();
  const resultDiv = document.getElementById("singleResult");

  if(!recordId){
    resultDiv.innerHTML = '<span class="badge danger">Missing</span><span style="margin-left:10px">Please enter a record ID</span>';
    resultDiv.style.display = "block";
    return;
  }

  resultDiv.style.display = "block";
  resultDiv.innerHTML = "Checking...";

  try{
    const qs = new URLSearchParams();
    qs.set("recordId", recordId);
    if(stage) qs.set("stage", stage);

    const response = await fetch("/api/audit/check?" + qs.toString());
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || "Check failed");

    if(data.exists){
      resultDiv.innerHTML =
        '<span class="badge danger">DUPLICATE</span>' +
        '<span style="margin-left:12px">Record ID <strong>' + data.recordId + '</strong></span>' +
        (data.stage ? '<span class="muted" style="margin-left:12px">Stage: ' + data.stage + '</span>' : '') +
        '<span class="muted" style="margin-left:12px">Processed: ' + formatTimestamp(data.timestamp) + '</span>';
    } else {
      resultDiv.innerHTML =
        '<span class="badge ok">FRESH</span>' +
        '<span style="margin-left:12px">Record ID <strong>' + recordId + '</strong> has not been processed</span>' +
        (stage ? '<span class="muted" style="margin-left:12px">Stage checked: ' + stage + '</span>' : '');
    }
  } catch(err){
    resultDiv.innerHTML =
      '<span class="badge danger">ERROR</span>' +
      '<span style="margin-left:10px">' + (err && err.message ? err.message : String(err)) + '</span>';
  }
}

async function loadAuditData(page = 1){
  const loadingDiv = document.getElementById("loading");
  const errorDiv = document.getElementById("error");
  const emptyState = document.getElementById("emptyState");

  loadingDiv.style.display = "block";
  errorDiv.style.display = "none";
  emptyState.style.display = "none";

  const startDate = document.getElementById("startDate").value;
  const endDate = document.getElementById("endDate").value;
  const searchRecordId = document.getElementById("searchRecordId").value.trim();
  const stage = document.getElementById("stage").value.trim();

  currentPage = page;

  try{
    const params = new URLSearchParams();
    if(startDate) params.append("startDate", startDate);
    if(endDate) params.append("endDate", endDate);
    if(searchRecordId) params.append("recordId", searchRecordId);
    if(stage) params.append("stage", stage);
    params.append("page", String(currentPage));
    params.append("pageSize", String(pageSize));

    const response = await fetch("/api/audit/browse?" + params.toString());
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || "Failed to load audit data");

    renderStats(data);
    renderTable(data);

    loadingDiv.style.display = "none";
  } catch(err){
    loadingDiv.style.display = "none";
    errorDiv.textContent = (err && err.message) ? err.message : String(err);
    errorDiv.style.display = "block";
  }
}

function renderStats(data){
  document.getElementById("totalRecords").textContent = (data.total || 0).toLocaleString();
  document.getElementById("todayRecords").textContent = (data.todayCount || 0).toLocaleString();
  document.getElementById("latestDate").textContent = data.latest ? formatTimestamp(data.latest) : "-";
}

function renderTable(data){
  const tbody = document.getElementById("auditResults");
  const emptyState = document.getElementById("emptyState");
  const resultsInfo = document.getElementById("resultsInfo");
  const paginationDiv = document.getElementById("pagination");

  tbody.innerHTML = "";

  const records = data.records || [];
  totalRecords = data.total || 0;

  if(records.length === 0){
    emptyState.style.display = "block";
    resultsInfo.textContent = "";
    paginationDiv.innerHTML = "";
    return;
  }

  emptyState.style.display = "none";

  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + records.length, totalRecords);
  resultsInfo.textContent = "Showing " + (startIdx + 1) + " - " + endIdx + " of " + totalRecords;

  for(const record of records){
    const row = document.createElement("tr");
    row.innerHTML =
      '<td class="mono" style="color:var(--accentHi)">' + record.recordId + '</td>' +
      '<td class="muted">' + formatTimestamp(record.processedAt) + '</td>' +
      '<td style="color:var(--silver)">' + (record.source || "AuditController") + '</td>';
    tbody.appendChild(row);
  }

  // Pagination
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  let html = "";
  if(totalPages > 1){
    if(currentPage > 1){
      html += '<button class="secondary" onclick="loadAuditData(' + (currentPage - 1) + ')">Prev</button>';
    }
    html += '<span class="muted">Page ' + currentPage + ' of ' + totalPages + '</span>';
    if(currentPage < totalPages){
      html += '<button class="secondary" onclick="loadAuditData(' + (currentPage + 1) + ')">Next</button>';
    }
  }
  paginationDiv.innerHTML = html;
}

function resetFilters(){
  const today = new Date();
  document.getElementById("endDate").value = today.toISOString().split("T")[0];
  document.getElementById("startDate").value = today.toISOString().split("T")[0];
  document.getElementById("searchRecordId").value = "";
  document.getElementById("stage").value = "";
  loadAuditData(1);
}

loadAuditData(1);
</script>
</body>
</html>`;

export const dashboardHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📱</text></svg>">
<title>SMS Dashboard</title>
<style>
${sharedThemeCss}
.stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:18px}
@media(max-width:900px){.stats-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:600px){.stats-grid{grid-template-columns:1fr}}
.stat-card{
  background:linear-gradient(180deg, rgba(16,34,28,.92), rgba(15,27,23,.92));
  border:1px solid rgba(42,59,54,.85);
  border-radius:14px;
  padding:22px;
  box-shadow:var(--shadow);
  position:relative;
  overflow:hidden;
}
.stat-card:before{
  content:"";
  position:absolute;top:0;left:0;right:0;height:4px;
  background:linear-gradient(90deg, rgba(25,195,125,.9), rgba(195,204,209,.55));
}
.stat-card .icon{font-size:2rem;margin-bottom:10px;opacity:.92}
.stat-card .value{font-size:2.6rem;font-weight:950;color:var(--silver);line-height:1}
.stat-card .label{color:var(--muted);margin-top:6px;font-weight:700}
.stat-card .subvalue{color:var(--muted2);margin-top:8px;font-size:.9rem}
.stat-card.clickable{cursor:pointer;transition:transform .12s ease, filter .12s ease, border-color .12s ease}
.stat-card.clickable:hover{transform:translateY(-2px);filter:brightness(1.02);border-color:rgba(25,195,125,.75)}
.stat-card .hint{margin-top:10px;font-size:.78rem;color:rgba(152,166,173,.85)}
.stat-card .explain{margin-top:10px;font-size:.78rem;line-height:1.45;color:rgba(152,166,173,.78);font-style:italic}
.section-header{margin:6px 0 12px}
.section-header h2{font-size:1.15rem;color:var(--silver);margin-bottom:4px}
.section-header .section-desc{color:var(--muted2);font-size:.88rem;line-height:1.4}
.kv-section{margin-bottom:16px}
.kv-header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px}

/* Overlay modal */
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;padding:18px;z-index:50}
.overlay.open{display:flex}
.modal{
  width:min(1100px, 96vw);
  max-height:88vh;
  overflow:hidden;
  background:linear-gradient(180deg, rgba(16,34,28,.98), rgba(15,27,23,.98));
  border:1px solid rgba(42,59,54,.92);
  border-radius:14px;
  box-shadow:var(--shadow);
  display:flex;
  flex-direction:column;
}
.modal-header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid rgba(42,59,54,.75)}
.modal-header h2{font-size:1.1rem;color:var(--silver)}
.modal-body{padding:14px 18px 18px;overflow:auto}
.modal-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.small{font-size:.82rem}
.pager{display:flex;justify-content:center;align-items:center;gap:10px;margin-top:12px}
.codechip{display:inline-block;padding:3px 9px;border-radius:999px;border:1px solid rgba(42,59,54,.85);background:rgba(11,18,16,.55);color:var(--muted2);font-size:.78rem}

/* Drill-in modal: sticky header row so column titles stay visible while
   scrolling, plus sortable column indicator. */
.modal-body table{border-collapse:separate;border-spacing:0}
.modal-body table thead th{
  position:sticky;top:0;z-index:2;
  background:linear-gradient(180deg, rgba(20,40,32,1), rgba(15,30,25,1));
  border-bottom:1px solid rgba(42,59,54,.95);
  user-select:none;
}
.modal-body table thead th.sortable{cursor:pointer}
.modal-body table thead th.sortable:hover{color:var(--accentHi)}
.modal-body table thead th .sort-arrow{color:var(--accentHi);margin-left:4px;font-size:.85em}
</style>
</head>
<body>
<div class="container">
  <h1>SMS Analytics Dashboard</h1>
  <p class="subtitle">Real-time SMS conversation metrics and KV activity</p>

  <div class="nav-links">
    <a href="/search">SMS Search</a>
    <a href="/dashboard">SMS Dashboard</a>
    <a href="/audit">Audit Search</a>
    <a href="/injections">Injections</a>
    <a href="/review">Review</a>
    <a href="/test">🧪 Test</a>
  </div>

  <div class="panel" style="margin-bottom:16px">
    <div class="filters">
      <div class="filter-group">
        <label>Start Date</label>
        <input type="date" id="startDate" />
      </div>
      <div class="filter-group">
        <label>End Date</label>
        <input type="date" id="endDate" />
      </div>
      <div class="filter-group">
        <label>KV Prefix Filter</label>
        <select id="prefixFilter">
          <option value="">All SMS Data</option>
          <option value="conversations">Conversations</option>
          <option value="scheduledinjection">Scheduled Injections</option>
          <option value="smsflowcontext">SMS Flow Context</option>
        </select>
      </div>
      <button onclick="loadDashboard()">Apply</button>
      <button class="secondary" onclick="resetFilters()">Reset</button>
      <button class="secondary" onclick="sendReport()" id="sendReportBtn" title="Email this report to adamp@monsterrg.com">📧 Send Report</button>
    </div>
    <div id="reportStatus" style="display:none;margin-top:10px"></div>
  </div>

  <div id="loading" class="loading">
    <div class="spinner"></div>
    <p>Loading dashboard data...</p>
  </div>
  <div id="error" class="error" style="display:none"></div>

  <div id="content" style="display:none">
    <div class="section-header">
      <h2>📈 Daily Activity</h2>
      <p class="section-desc">SMS funnel for the date range above. Adjust the dates and Apply to scope these numbers.</p>
    </div>
    <div class="stats-grid">
      <div class="stat-card clickable" id="textsSentCard" title="Click to view sent messages">
        <div style="display:flex;gap:16px">
          <div style="flex:1;border-right:1px solid rgba(42,59,54,.75);padding-right:16px">
            <div class="icon">📤</div>
            <div class="value" id="totalTexts">-</div>
            <div class="label">Total Texts</div>
            <div class="subvalue" id="totalTextsDetail">-</div>
            <div class="explain">Every SMS exchanged in this range — both ours and replies.</div>
          </div>
          <div style="flex:1">
            <div class="icon">🚀</div>
            <div class="value" id="initialTexts">-</div>
            <div class="label">Initial Texts Sent</div>
            <div class="subvalue" id="initialTextsDetail">First message to guest</div>
            <div class="explain">Distinct guests we reached out to (one per phone number).</div>
          </div>
        </div>
        <div class="hint">Click to drill in</div>
      </div>

      <div class="stat-card clickable" id="peopleRepliedCard" title="Click to view replies">
        <div class="icon">💬</div>
        <div class="value" id="peopleReplied">-</div>
        <div class="label">People Replied</div>
        <div class="subvalue" id="peopleRepliedDetail">-</div>
        <div class="explain">Unique guests who sent at least one reply back to us in this range.</div>
        <div class="hint">Click to drill in</div>
      </div>

      <div class="stat-card clickable" id="appointmentsCard" title="Click to view appointment entries">
        <div class="icon">📅</div>
        <div class="value" id="appointmentsSet">-</div>
        <div class="label">Appointments Booked</div>
        <div class="subvalue" id="appointmentsSetDetail">-</div>
        <div class="explain">Conversations where the bot tagged "appointment scheduled" in this range.</div>
        <div class="hint">Click to drill in</div>
      </div>
    </div>

    <div class="section-header" style="margin-top:24px">
      <h2>🏆 Lifetime Stats</h2>
      <p class="section-desc">All-time totals across the entire history of the system. Independent of the date filter above.</p>
    </div>
    <div class="stats-grid">
      <div class="stat-card clickable" id="lifetimeAppointmentsCard" title="Click to view every appointment all-time">
        <div class="icon">📅</div>
        <div class="value" id="lifetimeAppointments">-</div>
        <div class="label">Appointments Booked (lifetime)</div>
        <div class="explain">Every appointment ever scheduled via the bot, all-time.</div>
        <div class="hint">Click to drill in</div>
      </div>

      <div class="stat-card clickable" id="activatedCard" title="Click to view activated guests">
        <div class="icon">✅</div>
        <div class="value" id="activatedCount">-</div>
        <div class="label">Activated (lifetime)</div>
        <div class="explain">Guests marked as a sale — either via the daily QB sale-match cron or manual /api/sales/record calls.</div>
        <div class="hint">Click to drill in</div>
      </div>

      <div class="stat-card clickable" id="answeredCard" title="Click to view answered guests">
        <div class="icon">📞</div>
        <div class="value" id="answeredCount">-</div>
        <div class="label">Answered (lifetime)</div>
        <div class="explain">Guests who answered an inbound call from the dialer (POST /api/guests/answered).</div>
        <div class="hint">Click to drill in</div>
      </div>

      <div class="stat-card clickable" id="outsideWindowCard" title="Click to view activations that slipped past the reminder window">
        <div class="icon">⏱️</div>
        <div class="value" id="lifetimeOutsideWindow">-</div>
        <div class="label">Activations Outside Window</div>
        <div class="explain">Activations that DID have a scheduled appointment with us, but the activation landed outside the configured day-window (currently 7 days). These are guests who came in on their own — outside our reminder timing.</div>
        <div class="hint">Click to drill in</div>
      </div>

      <div class="stat-card clickable" id="lifetimeUniqueGuestsCard" title="Click to view every guest we've messaged">
        <div class="icon">👥</div>
        <div class="value" id="lifetimeUniqueGuests">-</div>
        <div class="label">Unique Guests Reached</div>
        <div class="explain">Distinct phone numbers we've ever sent at least one SMS to. Watermark of the SMS audience.</div>
        <div class="hint">Click to drill in</div>
      </div>

      <div class="stat-card clickable" id="totalKvRecordsCard" title="Jump to the per-collection breakdown">
        <div class="icon">🗄️</div>
        <div class="value" id="totalKvEntries">-</div>
        <div class="label">Total SMS Records</div>
        <div class="subvalue" id="totalKvDetail">-</div>
        <div class="explain">Sum of every Firestore doc across all SMS-related collections (full breakdown below).</div>
        <div class="hint">Click to jump to breakdown ↓</div>
      </div>
    </div>

    <!-- Injection Lookup -->
    <div class="panel" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
        <h2 style="color:var(--silver);font-size:1.2rem">Injection Lookup</h2>
        <span class="muted" style="font-size:.85rem">Check if a phone has a scheduled injection &amp; trigger it now</span>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="filter-group" style="flex:1;min-width:200px">
          <label>Phone (10 digits)</label>
          <input type="text" id="injLookupPhone" placeholder="e.g. 5551234567" />
        </div>
        <button onclick="lookupInjection()">Lookup</button>
      </div>
      <div id="injResult" style="display:none;margin-top:14px"></div>
    </div>

    <div class="panel kv-section">
      <div class="kv-header">
        <h2 style="color:var(--silver); font-size:1.2rem">SMS Storage Breakdown</h2>
        <span id="kvBreakdownInfo" class="muted"></span>
      </div>
      <table class="table">
        <thead>
          <tr><th>Prefix</th><th>Count</th><th>Latest Entry</th></tr>
        </thead>
        <tbody id="kvBreakdown"></tbody>
      </table>
    </div>

    <div class="panel kv-section">
      <div class="kv-header">
        <h2 style="color:var(--silver); font-size:1.2rem">Recent SMS Activity</h2>
        <span id="recentEntriesInfo" class="muted"></span>
      </div>
      <table class="table">
        <thead>
          <tr><th>Key</th><th>Timestamp</th><th>Preview</th></tr>
        </thead>
        <tbody id="recentEntries"></tbody>
      </table>
      <div id="emptyState" class="muted" style="display:none; text-align:center; padding:28px">
        No entries found matching your filters.
      </div>
    </div>
  </div>

  <!-- Appointments overlay -->
  <div class="overlay" id="apptOverlay" role="dialog" aria-modal="true" aria-label="Appointments detail">
    <div class="modal">
      <div class="modal-header">
        <div>
          <h2>Appointments Booked Detail</h2>
          <div class="small muted" id="apptSubtitle"></div>
        </div>
        <div class="modal-actions">
          <span class="codechip" id="apptCountChip">0</span>
          <button class="secondary" id="apptCloseBtn">Close</button>
        </div>
      </div>

      <div class="modal-body">
        <div id="apptLoading" class="loading" style="display:none">
          <div class="spinner"></div>
          <p>Loading appointment entries...</p>
        </div>
        <div id="apptError" class="error" style="display:none"></div>

        <table class="table" id="apptTable" style="display:none">
          <thead>
            <tr>
              <th>Phone</th>
              <th>Scheduled For</th>
              <th>Matched At</th>
              <th>Sender</th>
              <th>nodeTag</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody id="apptTbody"></tbody>
        </table>

        <div id="apptEmpty" class="muted" style="display:none; text-align:center; padding:28px">
          No appointment entries found for the selected filters.
        </div>

        <div class="pager" id="apptPager" style="display:none"></div>
      </div>
    </div>
  </div>
</div>

  <!-- Generic drill-in overlay -->
  <div class="overlay" id="drillOverlay" role="dialog" aria-modal="true">
    <div class="modal">
      <div class="modal-header">
        <div>
          <h2 id="drillTitle">Detail</h2>
          <div class="small muted" id="drillSubtitle"></div>
        </div>
        <div class="modal-actions">
          <span class="codechip" id="drillCountChip">0</span>
          <button class="secondary" id="drillCloseBtn">Close</button>
        </div>
      </div>
      <div class="modal-body">
        <div id="drillLoading" class="loading" style="display:none">
          <div class="spinner"></div>
          <p>Loading...</p>
        </div>
        <div id="drillError" class="error" style="display:none"></div>
        <div id="drillContent"></div>
        <div id="drillEmpty" class="muted" style="display:none; text-align:center; padding:28px">
          No entries found.
        </div>
      </div>
    </div>
  </div>

<script>
const today = new Date();
document.getElementById("endDate").value = today.toISOString().split("T")[0];
document.getElementById("startDate").value = today.toISOString().split("T")[0];

function formatTimestamp(iso){
  if(!iso) return "-";
  const d = new Date(iso);
  if(isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-US", { month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit", hour12:true });
}

function extractTimestamp(entry){
  if(entry.value && entry.value.timestamp) return entry.value.timestamp;
  if(entry.value && entry.value.processedAt) return entry.value.processedAt;
  if(entry.value && entry.value.scheduledAt) return entry.value.scheduledAt;
  if(entry.value && entry.value.createdAt) return entry.value.createdAt;
  if(Array.isArray(entry.key) && entry.key.length === 4){
    const possibleTs = entry.key[3];
    if(typeof possibleTs === "string" && possibleTs.includes("T")) return possibleTs;
  }
  return null;
}

function getPreview(value){
  if(!value) return "-";
  if(typeof value === "string") return value;
  if(value.message) return value.message;
  if(value.phone) return "Phone: " + value.phone;
  if(value.recordId) return "Record: " + value.recordId;
  try { return JSON.stringify(value).substring(0,100); } catch { return String(value); }
}

function truncate(str, len){
  if(!str) return "";
  return str.length <= len ? str : str.substring(0, len) + "…";
}

function escapeHtml(text){
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

async function loadDashboard(){
  const loadingDiv = document.getElementById("loading");
  const contentDiv = document.getElementById("content");
  const errorDiv = document.getElementById("error");

  loadingDiv.style.display = "block";
  contentDiv.style.display = "none";
  errorDiv.style.display = "none";

  const startDate = document.getElementById("startDate").value;
  const endDate = document.getElementById("endDate").value;
  const prefixFilter = document.getElementById("prefixFilter").value;

  try{
    const params = new URLSearchParams();
    if(startDate) params.append("startDate", startDate);
    if(endDate) params.append("endDate", endDate);
    if(prefixFilter) params.append("prefix", prefixFilter);

    const response = await fetch("/api/dashboard/stats?" + params.toString());
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || "Failed to load dashboard");

    renderDashboard(data);

    loadingDiv.style.display = "none";
    contentDiv.style.display = "block";
  } catch(err){
    loadingDiv.style.display = "none";
    errorDiv.textContent = (err && err.message) ? err.message : String(err);
    errorDiv.style.display = "block";
  }
}

function renderDashboard(data){
  document.getElementById("totalTexts").textContent = (data.stats.textsSent || 0).toLocaleString();
  document.getElementById("totalTextsDetail").textContent = (data.stats.uniquePhonesSent || 0) + " unique recipients";
  document.getElementById("initialTexts").textContent = (data.stats.initialTextsSent || 0).toLocaleString();
  document.getElementById("initialTextsDetail").textContent = (data.stats.initialTextsSent || 0) + " new guests reached";

  document.getElementById("peopleReplied").textContent = (data.stats.peopleReplied || 0).toLocaleString();
  const replyRate = (data.stats.uniquePhonesSent || 0) > 0
    ? ((data.stats.peopleReplied || 0) / data.stats.uniquePhonesSent * 100).toFixed(1)
    : "0";
  document.getElementById("peopleRepliedDetail").textContent = replyRate + "% reply rate";

  document.getElementById("appointmentsSet").textContent = (data.stats.appointmentsSet || 0).toLocaleString();
  const conversionRate = (data.stats.peopleReplied || 0) > 0
    ? ((data.stats.appointmentsSet || 0) / data.stats.peopleReplied * 100).toFixed(1)
    : "0";
  document.getElementById("appointmentsSetDetail").textContent = conversionRate + "% of replies booked";

  document.getElementById("totalKvEntries").textContent = (data.stats.totalKvEntries || 0).toLocaleString();
  document.getElementById("totalKvDetail").textContent = Object.keys(data.kvBreakdown || {}).length + " data types";

  // Lifetime stats (date-filter-independent)
  document.getElementById("activatedCount").textContent = (data.stats.activatedCount || 0).toLocaleString();
  document.getElementById("answeredCount").textContent = (data.stats.answeredCount || 0).toLocaleString();
  document.getElementById("lifetimeAppointments").textContent = (data.stats.lifetimeAppointmentsBooked || 0).toLocaleString();
  document.getElementById("lifetimeOutsideWindow").textContent = (data.stats.lifetimeActivationsOutsideWindow || 0).toLocaleString();
  document.getElementById("lifetimeUniqueGuests").textContent = (data.stats.lifetimeUniqueGuests || 0).toLocaleString();

  const breakdownBody = document.getElementById("kvBreakdown");
  breakdownBody.innerHTML = "";
  const entries = Object.entries(data.kvBreakdown || {}).sort((a,b) => (b[1].count||0) - (a[1].count||0));
  for(const [prefix, info] of entries){
    const row = document.createElement("tr");
    row.innerHTML =
      '<td class="mono" style="color:var(--accentHi)">' + prefix + '</td>' +
      '<td>' + ((info.count||0).toLocaleString()) + '</td>' +
      '<td class="muted">' + (info.latest ? formatTimestamp(info.latest) : "-") + '</td>';
    breakdownBody.appendChild(row);
  }
  document.getElementById("kvBreakdownInfo").textContent = entries.length + " data types";

  const recentBody = document.getElementById("recentEntries");
  const emptyState = document.getElementById("emptyState");
  recentBody.innerHTML = "";
  if(!data.recentEntries || data.recentEntries.length === 0){
    emptyState.style.display = "block";
  } else {
    emptyState.style.display = "none";
    for(const entry of data.recentEntries){
      const row = document.createElement("tr");
      const keyStr = JSON.stringify(entry.key);
      const preview = getPreview(entry.value);
      const timestamp = extractTimestamp(entry);
      row.innerHTML =
        '<td class="mono" title="' + escapeHtml(keyStr) + '" style="color:var(--accentHi)">' + escapeHtml(truncate(keyStr, 60)) + '</td>' +
        '<td class="muted">' + (timestamp ? formatTimestamp(timestamp) : "-") + '</td>' +
        '<td class="muted" title="' + escapeHtml(preview) + '">' + escapeHtml(preview) + '</td>';
      recentBody.appendChild(row);
    }
  }
  document.getElementById("recentEntriesInfo").textContent = "Showing " + ((data.recentEntries && data.recentEntries.length) ? data.recentEntries.length : 0) + " most recent";
}

function resetFilters(){
  const today = new Date();
  document.getElementById("endDate").value = today.toISOString().split("T")[0];
  document.getElementById("startDate").value = today.toISOString().split("T")[0];
  document.getElementById("prefixFilter").value = "";
  loadDashboard();
}

async function sendReport(){
  const startDate = document.getElementById("startDate").value;
  const endDate = document.getElementById("endDate").value;
  const btn = document.getElementById("sendReportBtn");
  const statusDiv = document.getElementById("reportStatus");

  btn.disabled = true;
  btn.textContent = "Sending...";
  statusDiv.style.display = "block";
  statusDiv.innerHTML = '<span class="muted">Generating and sending report email...</span>';

  try{
    var params = new URLSearchParams();
    if(startDate) params.append("startDate", startDate);
    if(endDate) params.append("endDate", endDate);

    var res = await fetch("/api/report/nightly?" + params.toString());
    var data = await res.json();

    if(res.ok && data.success){
      statusDiv.innerHTML = '<span class="badge ok">Sent!</span><span style="margin-left:10px">Report emailed to ' + escapeHtml(data.emailSentTo || "adamp@monsterrg.com") + ' — ' + escapeHtml(data.reportDate || "") + ' (' + (data.csvRows || 0) + ' conversation rows)</span>';
    } else {
      statusDiv.innerHTML = '<span class="badge danger">Failed</span><span style="margin-left:10px">' + escapeHtml(data.error || "Unknown error") + '</span>';
    }
  } catch(err){
    statusDiv.innerHTML = '<span class="badge danger">Error</span><span style="margin-left:10px">' + escapeHtml(String(err)) + '</span>';
  } finally {
    btn.disabled = false;
    btn.textContent = "📧 Send Report";
    setTimeout(function(){ statusDiv.style.display = "none"; }, 8000);
  }
}

// Appointments drill-in
const overlay = document.getElementById("apptOverlay");
const closeBtn = document.getElementById("apptCloseBtn");
const apptLoading = document.getElementById("apptLoading");
const apptError = document.getElementById("apptError");
const apptTable = document.getElementById("apptTable");
const apptTbody = document.getElementById("apptTbody");
const apptEmpty = document.getElementById("apptEmpty");
const apptPager = document.getElementById("apptPager");
const apptSubtitle = document.getElementById("apptSubtitle");
const apptCountChip = document.getElementById("apptCountChip");

let apptPage = 1;
let apptPageSize = 50;
let apptTotal = 0;

function openOverlay(){
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeOverlay(){
  overlay.classList.remove("open");
  document.body.style.overflow = "";
}
closeBtn.addEventListener("click", closeOverlay);
overlay.addEventListener("click", (e) => { if(e.target === overlay) closeOverlay(); });
document.addEventListener("keydown", (e) => { if(e.key === "Escape" && overlay.classList.contains("open")) closeOverlay(); });

document.getElementById("appointmentsCard").addEventListener("click", () => {
  apptPage = 1;
  apptLifetime = false;
  openOverlay();
  loadAppointments(apptPage);
});

document.getElementById("lifetimeAppointmentsCard").addEventListener("click", () => {
  apptPage = 1;
  apptLifetime = true;
  openOverlay();
  loadAppointments(apptPage);
});

let apptLifetime = false;

function getCurrentFiltersForAppointments(){
  if(apptLifetime){
    return { startDate: "", endDate: "", prefixFilter: "" };
  }
  const startDate = document.getElementById("startDate").value;
  const endDate = document.getElementById("endDate").value;
  const prefixFilter = document.getElementById("prefixFilter").value;
  return { startDate, endDate, prefixFilter };
}

async function loadAppointments(page){
  apptError.style.display = "none";
  apptEmpty.style.display = "none";
  apptTable.style.display = "none";
  apptPager.style.display = "none";
  apptLoading.style.display = "block";
  apptTbody.innerHTML = "";

  const { startDate, endDate, prefixFilter } = getCurrentFiltersForAppointments();
  apptSubtitle.textContent = "Filters: " +
    (startDate ? ("start " + startDate) : "start none") + ", " +
    (endDate ? ("end " + endDate) : "end none") + ", " +
    ("prefix " + (prefixFilter || "all")) + ", pageSize " + apptPageSize;

  try{
    const params = new URLSearchParams();
    if(startDate) params.append("startDate", startDate);
    if(endDate) params.append("endDate", endDate);
    if(prefixFilter) params.append("prefix", prefixFilter);
    params.append("page", String(page));
    params.append("pageSize", String(apptPageSize));

    const response = await fetch("/api/appointments?" + params.toString());
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || "Failed to load appointment entries");

    apptTotal = data.total || 0;
    apptCountChip.textContent = (apptTotal || 0).toLocaleString() + " matches";

    const items = data.items || [];
    apptLoading.style.display = "none";

    // Deduplicate by phone — keep first match per phone (most recent due to sort)
    const seenPhones = {};
    const uniqueItems = [];
    for(const it of items){
      const p = it.phoneNumber || "unknown";
      if(!seenPhones[p]){
        seenPhones[p] = true;
        uniqueItems.push(it);
      }
    }

    apptTotal = uniqueItems.length;
    apptCountChip.textContent = uniqueItems.length.toLocaleString() + " matches";

    if(uniqueItems.length === 0){
      apptEmpty.style.display = "block";
      return;
    }

    apptTable.style.display = "table";
    for(const it of uniqueItems){
      const row = document.createElement("tr");
      const scheduledForHtml = it.scheduledFor
        ? '<span style="color:var(--accentHi);font-weight:900">' + escapeHtml(formatTimestamp(it.scheduledFor)) + '</span>'
        : '<span class="muted">No injection found</span>';
      row.innerHTML =
        '<td>' + phoneLink(it.phoneNumber) + '</td>' +
        '<td>' + scheduledForHtml + '</td>' +
        '<td class="muted">' + escapeHtml(it.timestamp ? formatTimestamp(it.timestamp) : "-") + '</td>' +
        '<td>' + escapeHtml(it.sender || "-") + '</td>' +
        '<td class="muted">' + escapeHtml(it.nodeTag || "-") + '</td>' +
        '<td class="muted" title="' + escapeHtml(it.message || "") + '">' + escapeHtml(truncate(it.message || "", 120)) + '</td>';
      apptTbody.appendChild(row);
    }

    renderAppointmentsPager(data.page || page, data.pageSize || apptPageSize, data.total || 0);
  } catch(err){
    apptLoading.style.display = "none";
    apptError.textContent = (err && err.message) ? err.message : String(err);
    apptError.style.display = "block";
  }
}

function renderAppointmentsPager(page, pageSize, total){
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  apptPage = page;

  if(totalPages <= 1){
    apptPager.style.display = "none";
    apptPager.innerHTML = "";
    return;
  }

  let html = "";
  if(page > 1){
    html += '<button class="secondary" onclick="window.apptGo(' + (page - 1) + ')">Prev</button>';
  }
  html += '<span class="muted">Page ' + page + ' of ' + totalPages + '</span>';
  if(page < totalPages){
    html += '<button class="secondary" onclick="window.apptGo(' + (page + 1) + ')">Next</button>';
  }
  apptPager.innerHTML = html;
  apptPager.style.display = "flex";
}

// Expose minimal function for pager buttons
window.apptGo = (p) => loadAppointments(p);

// Injection Lookup
document.getElementById("injLookupPhone").addEventListener("keypress", (e) => {
  if(e.key === "Enter") lookupInjection();
});

async function lookupInjection(){
  const raw = (document.getElementById("injLookupPhone").value || "").replace(/\\D/g,"").slice(-10);
  const resultDiv = document.getElementById("injResult");

  if(!raw || raw.length !== 10){
    resultDiv.style.display = "block";
    resultDiv.innerHTML = '<span class="badge danger">Invalid</span><span style="margin-left:10px">Enter a valid 10-digit phone number</span>';
    return;
  }

  resultDiv.style.display = "block";
  resultDiv.innerHTML = '<span class="muted">Looking up ' + raw + '...</span>';

  try{
    const kvRes = await fetch("/api/kv/get?key=" + encodeURIComponent(JSON.stringify(["scheduledinjection", raw])));
    const kvData = await kvRes.json();

    if(!kvData.value){
      resultDiv.innerHTML =
        '<div style="padding:14px;border-radius:10px;border:1px solid rgba(42,59,54,.85);background:rgba(15,27,23,.5)">' +
        '<span class="badge danger">Not Found</span>' +
        '<span style="margin-left:12px">No scheduled injection for <strong class="mono">' + escapeHtml(raw) + '</strong></span>' +
        '</div>';
      return;
    }

    const v = kvData.value;
    const eventTime = v.eventTime || v.appointmentAt || v.scheduledAt || null;
    const scheduledAt = v.scheduledAt || null;
    const isTest = v.isTest || false;
    const phone = v.phone || raw;

    const eventDate = eventTime ? new Date(eventTime) : null;
    const now = new Date();
    const isPast = eventDate && eventDate <= now;
    const isFuture = eventDate && eventDate > now;

    let statusBadge = "";
    if(isPast) statusBadge = '<span class="badge danger" style="margin-left:10px">Past due — ready to fire</span>';
    else if(isFuture) statusBadge = '<span class="badge ok" style="margin-left:10px">Scheduled — waiting</span>';

    let html = '<div style="padding:16px;border-radius:10px;border:1px solid rgba(42,59,54,.85);background:rgba(15,27,23,.5)">';
    html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">';
    html += '<span class="badge ok">Found</span>';
    html += '<strong class="mono" style="color:var(--accentHi);font-size:1.1rem">' + escapeHtml(phone) + '</strong>';
    html += statusBadge;
    if(isTest) html += '<span class="badge" style="background:rgba(255,159,67,.18);color:#ffd1a0;border:1px solid rgba(255,159,67,.35)">TEST</span>';
    html += '</div>';

    html += '<table style="width:100%;border-collapse:collapse">';
    html += '<tr><td style="padding:8px 0;color:var(--muted);width:160px">Event Time</td><td style="padding:8px 0;color:var(--silver);font-weight:700">' + (eventTime ? formatTimestamp(eventTime) : "-") + '</td></tr>';
    html += '<tr><td style="padding:8px 0;color:var(--muted)">Scheduled At</td><td style="padding:8px 0;color:var(--text)">' + (scheduledAt ? formatTimestamp(scheduledAt) : "-") + '</td></tr>';
    html += '<tr><td style="padding:8px 0;color:var(--muted)">Is Test</td><td style="padding:8px 0;color:var(--text)">' + (isTest ? "Yes" : "No") + '</td></tr>';
    html += '</table>';

    html += '<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">';
    html += '<button onclick="triggerInjectionNow(&apos;' + escapeHtml(phone) + '&apos;)">Inject Now</button>';
    html += '<button class="secondary" onclick="cancelInjection(&apos;' + escapeHtml(phone) + '&apos;)">Cancel Injection</button>';
    html += '</div>';

    html += '</div>';
    resultDiv.innerHTML = html;
  } catch(err){
    resultDiv.innerHTML = '<span class="badge danger">Error</span><span style="margin-left:10px">' + escapeHtml(String(err)) + '</span>';
  }
}

async function triggerInjectionNow(phone){
  const resultDiv = document.getElementById("injResult");
  const prevHtml = resultDiv.innerHTML;

  resultDiv.innerHTML = '<span class="muted">Triggering injection for ' + escapeHtml(phone) + '...</span>';

  try{
    const res = await fetch("/api/cron/trigger-single?phone=" + encodeURIComponent(phone));
    const data = await res.json();

    if(res.ok && data.success){
      resultDiv.innerHTML =
        '<div style="padding:14px;border-radius:10px;border:1px solid rgba(25,195,125,.35);background:rgba(25,195,125,.08)">' +
        '<span class="badge ok">Triggered!</span>' +
        '<span style="margin-left:12px">Injection sent for <strong class="mono">' + escapeHtml(phone) + '</strong></span>' +
        '<div class="muted" style="margin-top:8px">Response: ' + escapeHtml(data.message || "OK") + '</div>' +
        '</div>';
    } else {
      resultDiv.innerHTML =
        '<div style="padding:14px;border-radius:10px;border:1px solid rgba(255,71,87,.35);background:rgba(255,71,87,.08)">' +
        '<span class="badge danger">Failed</span>' +
        '<span style="margin-left:12px">' + escapeHtml(data.error || "Unknown error") + '</span>' +
        '</div>';
    }
  } catch(err){
    resultDiv.innerHTML = '<span class="badge danger">Error</span><span style="margin-left:10px">' + escapeHtml(String(err)) + '</span>';
  }
}

async function cancelInjection(phone){
  const resultDiv = document.getElementById("injResult");

  if(!confirm("Cancel scheduled injection for " + phone + "?")) return;

  try{
    const res = await fetch("/api/injection/cancel?phone=" + encodeURIComponent(phone), { method: "DELETE" });
    const data = await res.json();

    if(res.ok && data.success){
      resultDiv.innerHTML =
        '<div style="padding:14px;border-radius:10px;border:1px solid rgba(255,159,67,.35);background:rgba(255,159,67,.08)">' +
        '<span class="badge" style="background:rgba(255,159,67,.18);color:#ffd1a0;border:1px solid rgba(255,159,67,.35)">Cancelled</span>' +
        '<span style="margin-left:12px">Injection for <strong class="mono">' + escapeHtml(phone) + '</strong> has been removed</span>' +
        '</div>';
    } else {
      resultDiv.innerHTML = '<span class="badge danger">Failed</span><span style="margin-left:10px">' + escapeHtml(data.error || "Unknown error") + '</span>';
    }
  } catch(err){
    resultDiv.innerHTML = '<span class="badge danger">Error</span><span style="margin-left:10px">' + escapeHtml(String(err)) + '</span>';
  }
}

// Generic drill-in overlay
const drillOverlay = document.getElementById("drillOverlay");
const drillCloseBtn = document.getElementById("drillCloseBtn");
const drillLoading = document.getElementById("drillLoading");
const drillError = document.getElementById("drillError");
const drillContent = document.getElementById("drillContent");
const drillEmpty = document.getElementById("drillEmpty");
const drillTitle = document.getElementById("drillTitle");
const drillSubtitle = document.getElementById("drillSubtitle");
const drillCountChip = document.getElementById("drillCountChip");

function openDrill(){ drillOverlay.classList.add("open"); document.body.style.overflow = "hidden"; }
function closeDrill(){ drillOverlay.classList.remove("open"); document.body.style.overflow = ""; }
drillCloseBtn.addEventListener("click", closeDrill);
drillOverlay.addEventListener("click", function(e){ if(e.target === drillOverlay) closeDrill(); });
document.addEventListener("keydown", function(e){
  if(e.key === "Escape" && drillOverlay.classList.contains("open")) closeDrill();
});

function drillReset(){
  drillLoading.style.display = "none";
  drillError.style.display = "none";
  drillContent.innerHTML = "";
  drillEmpty.style.display = "none";
  drillCountChip.textContent = "0";
}

// Sortable + paginated + sticky-header drill table. State is kept in module
// scope so header/pager clicks can re-render without re-fetching data.
// Sort applies to the FULL items array, then we slice for pagination so the
// ranking is consistent across pages.
var _drillItems = [];
var _drillColumns = [];
var _drillSortIdx = -1;       // index into columns
var _drillSortDir = "asc";    // "asc" | "desc"
var _drillPage = 1;           // 1-indexed
var _drillPageSize = 100;     // pager only renders when items > pageSize

function renderDrillTable(items, columns){
  _drillItems = items || [];
  _drillColumns = columns;
  _drillSortIdx = -1;
  _drillSortDir = "asc";
  _drillPage = 1;
  _renderDrillTableBody();
}

function _renderDrillTableBody(){
  if(!_drillItems || _drillItems.length === 0){
    drillEmpty.style.display = "block";
    drillContent.innerHTML = "";
    return;
  }
  // Sort the FULL set first.
  var sorted = _drillItems.slice();
  if(_drillSortIdx >= 0){
    var col = _drillColumns[_drillSortIdx];
    var sortFn = col.sortKey || function(m){ return col.key ? m[col.key] : ""; };
    sorted.sort(function(a, b){
      var av = sortFn(a), bv = sortFn(b);
      if(av == null && bv == null) return 0;
      if(av == null) return 1;
      if(bv == null) return -1;
      if(typeof av === "number" && typeof bv === "number") return av - bv;
      return String(av).localeCompare(String(bv), undefined, { numeric: true });
    });
    if(_drillSortDir === "desc") sorted.reverse();
  }
  // Slice for pagination.
  var totalPages = Math.max(1, Math.ceil(sorted.length / _drillPageSize));
  if(_drillPage > totalPages) _drillPage = totalPages;
  var start = (_drillPage - 1) * _drillPageSize;
  var pageSlice = sorted.slice(start, start + _drillPageSize);

  drillCountChip.textContent = _drillItems.length.toLocaleString() + " entries" +
    (totalPages > 1 ? " · page " + _drillPage + "/" + totalPages : "");

  var html = '<table class="table"><thead><tr>';
  _drillColumns.forEach(function(col, idx){
    var sortable = !!(col.sortKey || col.key);
    var arrow = "";
    if(sortable && idx === _drillSortIdx){
      arrow = '<span class="sort-arrow">' + (_drillSortDir === "asc" ? "▲" : "▼") + '</span>';
    }
    html += '<th' + (sortable ? ' class="sortable" data-sort-idx="' + idx + '"' : '') + '>' + col.label + arrow + '</th>';
  });
  html += '</tr></thead><tbody>';
  pageSlice.forEach(function(item){
    html += '<tr>';
    _drillColumns.forEach(function(col){
      var val = col.render ? col.render(item) : escapeHtml(item[col.key] || "-");
      html += '<td' + (col.cls ? ' class="' + col.cls + '"' : '') + (col.style ? ' style="' + col.style + '"' : '') + '>' + val + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  if(totalPages > 1){
    html += '<div class="pager">';
    if(_drillPage > 1){
      html += '<button class="secondary" data-drill-page="' + (_drillPage - 1) + '">◀ Prev</button>';
    }
    html += '<span class="muted">Showing ' + (start + 1).toLocaleString() + '–' +
      Math.min(start + _drillPageSize, sorted.length).toLocaleString() +
      ' of ' + sorted.length.toLocaleString() + '</span>';
    if(_drillPage < totalPages){
      html += '<button class="secondary" data-drill-page="' + (_drillPage + 1) + '">Next ▶</button>';
    }
    html += '</div>';
  }
  drillContent.innerHTML = html;
  // Wire click → toggle sort. Sorting resets to page 1 so the new top is visible.
  drillContent.querySelectorAll('th.sortable').forEach(function(th){
    th.addEventListener("click", function(){
      var idx = parseInt(th.getAttribute("data-sort-idx"), 10);
      if(idx === _drillSortIdx){
        _drillSortDir = _drillSortDir === "asc" ? "desc" : "asc";
      } else {
        _drillSortIdx = idx;
        _drillSortDir = "asc";
      }
      _drillPage = 1;
      _renderDrillTableBody();
    });
  });
  // Wire pager.
  drillContent.querySelectorAll('button[data-drill-page]').forEach(function(btn){
    btn.addEventListener("click", function(){
      _drillPage = parseInt(btn.getAttribute("data-drill-page"), 10);
      _renderDrillTableBody();
      var modalBody = drillContent.closest(".modal-body");
      if(modalBody) modalBody.scrollTop = 0;
    });
  });
}

function phoneLink(phone){
  if(!phone) return "-";
  var p = phone.replace(/[^0-9]/g, "").slice(-10);
  return '<a href="/search?phone=' + encodeURIComponent(p) + '" target="_blank" class="mono" style="color:var(--accentHi);text-decoration:none;border-bottom:1px dashed rgba(25,195,125,.4)" title="View full conversation">' + escapeHtml(p) + '</a>';
}

// Texts Sent drill-in
document.getElementById("textsSentCard").addEventListener("click", async function(){
  drillReset();
  drillTitle.textContent = "Texts Sent";
  drillSubtitle.textContent = "All AI Bot messages for the selected date range";
  openDrill();
  drillLoading.style.display = "block";
  try{
    var startDate = document.getElementById("startDate").value;
    var endDate = document.getElementById("endDate").value;
    var params = new URLSearchParams();
    if(startDate) params.append("startDate", startDate);
    if(endDate) params.append("endDate", endDate);
    params.append("sender", "AI Bot");
    var res = await fetch("/api/dashboard/drill?" + params.toString());
    var data = await res.json();
    if(!res.ok) throw new Error(data.error || "Failed");
    drillLoading.style.display = "none";
    renderDrillTable(data.items, [
      { label: "Phone", render: function(m){ return phoneLink(m.phoneNumber); } },
      { label: "Time", render: function(m){ return escapeHtml(formatTimestamp(m.timestamp)); }, cls: "muted" },
      { label: "nodeTag", key: "nodeTag", cls: "muted" },
      { label: "Message", render: function(m){ return escapeHtml(truncate(m.message || "", 150)); }, cls: "muted" }
    ]);
  } catch(err){
    drillLoading.style.display = "none";
    drillError.textContent = String(err.message || err);
    drillError.style.display = "block";
  }
});

// People Replied drill-in
document.getElementById("peopleRepliedCard").addEventListener("click", async function(){
  drillReset();
  drillTitle.textContent = "People Replied";
  drillSubtitle.textContent = "Unique guests who replied (with latest message)";
  openDrill();
  drillLoading.style.display = "block";
  try{
    var startDate = document.getElementById("startDate").value;
    var endDate = document.getElementById("endDate").value;
    var params = new URLSearchParams();
    if(startDate) params.append("startDate", startDate);
    if(endDate) params.append("endDate", endDate);
    params.append("sender", "Guest");
    var res = await fetch("/api/dashboard/drill?" + params.toString());
    var data = await res.json();
    if(!res.ok) throw new Error(data.error || "Failed");
    drillLoading.style.display = "none";
    // Deduplicate by phone — keep latest message per phone
    var phoneMap = {};
    (data.items || []).forEach(function(m){
      var p = m.phoneNumber || "unknown";
      if(!phoneMap[p]){
        phoneMap[p] = { phoneNumber: p, timestamp: m.timestamp, nodeTag: m.nodeTag, message: m.message, msgCount: 1 };
      } else {
        phoneMap[p].msgCount++;
        if(m.timestamp && (!phoneMap[p].timestamp || new Date(m.timestamp) > new Date(phoneMap[p].timestamp))){
          phoneMap[p].timestamp = m.timestamp;
          phoneMap[p].nodeTag = m.nodeTag;
          phoneMap[p].message = m.message;
        }
      }
    });
    var uniqueItems = Object.values(phoneMap).sort(function(a,b){
      return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
    });
    renderDrillTable(uniqueItems, [
      { label: "Phone", render: function(m){ return phoneLink(m.phoneNumber); } },
      { label: "Messages", render: function(m){ return '<span style="font-weight:900">' + m.msgCount + '</span>'; } },
      { label: "Latest Reply", render: function(m){ return escapeHtml(formatTimestamp(m.timestamp)); }, cls: "muted" },
      { label: "nodeTag", key: "nodeTag", cls: "muted" },
      { label: "Latest Message", render: function(m){ return escapeHtml(truncate(m.message || "", 120)); }, cls: "muted" }
    ]);
  } catch(err){
    drillLoading.style.display = "none";
    drillError.textContent = String(err.message || err);
    drillError.style.display = "block";
  }
});

// Activated drill-in
document.getElementById("activatedCard").addEventListener("click", async function(){
  drillReset();
  drillTitle.textContent = "Activated Guests";
  var sd = document.getElementById("startDate").value;
  var ed = document.getElementById("endDate").value;
  drillSubtitle.textContent = "Guests marked as sale via SHA phone match (" + (sd || "all") + " to " + (ed || "all") + ")";
  openDrill();
  drillLoading.style.display = "block";
  try{
    var res = await fetch("/api/kv/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: ["guestactivated"], limit: 500 })
    });
    var data = await res.json();
    if(!res.ok) throw new Error(data.error || "Failed");
    drillLoading.style.display = "none";
    var items = (data.entries || []).map(function(e){ return e.value; });
    // Date filter client-side using ET boundaries
    if(sd){
      var startMs = new Date(sd + "T00:00:00-04:00").getTime();
      items = items.filter(function(m){ return !m.activatedAt || new Date(m.activatedAt).getTime() >= startMs; });
    }
    if(ed){
      var endMs = new Date(ed + "T23:59:59-04:00").getTime();
      items = items.filter(function(m){ return !m.activatedAt || new Date(m.activatedAt).getTime() <= endMs; });
    }
    renderDrillTable(items, [
      { label: "Phone", render: function(m){ return phoneLink(m.phone10); } },
      { label: "Activated At", render: function(m){ return escapeHtml(formatTimestamp(m.activatedAt)); }, cls: "muted" },
      { label: "Event Time", render: function(m){ return escapeHtml(formatTimestamp(m.eventTime)); } },
      { label: "Status", render: function(m){ return m.Activated ? '<span class="badge ok">Activated</span>' : '-'; } }
    ]);
  } catch(err){
    drillLoading.style.display = "none";
    drillError.textContent = String(err.message || err);
    drillError.style.display = "block";
  }
});

// Answered drill-in
document.getElementById("answeredCard").addEventListener("click", async function(){
  drillReset();
  drillTitle.textContent = "Answered Guests";
  var sd = document.getElementById("startDate").value;
  var ed = document.getElementById("endDate").value;
  drillSubtitle.textContent = "Guests who answered the confirmation call (" + (sd || "all") + " to " + (ed || "all") + ")";
  openDrill();
  drillLoading.style.display = "block";
  try{
    var res = await fetch("/api/kv/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: ["guestanswered"], limit: 500 })
    });
    var data = await res.json();
    if(!res.ok) throw new Error(data.error || "Failed");
    drillLoading.style.display = "none";
    var items = (data.entries || []).map(function(e){ return e.value; });
    // Date filter client-side using ET boundaries
    if(sd){
      var startMs = new Date(sd + "T00:00:00-04:00").getTime();
      items = items.filter(function(m){ return !m.answeredAt || new Date(m.answeredAt).getTime() >= startMs; });
    }
    if(ed){
      var endMs = new Date(ed + "T23:59:59-04:00").getTime();
      items = items.filter(function(m){ return !m.answeredAt || new Date(m.answeredAt).getTime() <= endMs; });
    }
    renderDrillTable(items, [
      { label: "Phone", render: function(m){ return phoneLink(m.phone10); } },
      { label: "Answered At", render: function(m){ return escapeHtml(formatTimestamp(m.answeredAt)); }, cls: "muted" },
      { label: "Status", render: function(m){ return m.answered ? '<span class="badge ok">Answered</span>' : '-'; } }
    ]);
  } catch(err){
    drillLoading.style.display = "none";
    drillError.textContent = String(err.message || err);
    drillError.style.display = "block";
  }
});

// Unique Guests Reached drill-in (lifetime). Hits /api/guests/list which
// builds the per-phone summary (firstSeen/lastSeen/messageCount/replied).
document.getElementById("lifetimeUniqueGuestsCard").addEventListener("click", async function(){
  drillReset();
  drillTitle.textContent = "Unique Guests Reached (lifetime)";
  drillSubtitle.textContent = "Distinct phone numbers we've sent at least one SMS to (test phones excluded). Sorted most-recent contact first.";
  openDrill();
  drillLoading.style.display = "block";
  try{
    // Pull the full set so client-side sort + pagination work across every
    // record, not just the first page.
    const res = await fetch("/api/guests/list?page=1&pageSize=50000");
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || "Failed");
    drillLoading.style.display = "none";
    renderDrillTable(data.items || [], [
      { label: "Phone", render: function(m){ return phoneLink(m.phoneNumber); }, sortKey: function(m){ return m.phoneNumber; } },
      { label: "Messages", render: function(m){ return '<span style="font-weight:900">' + m.messageCount + '</span>'; }, sortKey: function(m){ return m.messageCount || 0; } },
      { label: "Replies", render: function(m){ return m.replyCount; }, cls: "muted", sortKey: function(m){ return m.replyCount || 0; } },
      { label: "Replied?", render: function(m){ return m.hasReplied ? '<span class="badge ok">Yes</span>' : '<span class="muted">No</span>'; }, sortKey: function(m){ return m.hasReplied ? 1 : 0; } },
      { label: "First Seen", render: function(m){ return escapeHtml(formatTimestamp(m.firstSeen)); }, cls: "muted", sortKey: function(m){ return m.firstSeen || ""; } },
      { label: "Last Seen", render: function(m){ return escapeHtml(formatTimestamp(m.lastSeen)); }, cls: "muted", sortKey: function(m){ return m.lastSeen || ""; } }
    ]);
  } catch(err){
    drillLoading.style.display = "none";
    drillError.textContent = String(err.message || err);
    drillError.style.display = "block";
  }
});

// Activations Outside Window drill-in. Reads salesoutsidewindow collection
// via the existing /api/kv/list endpoint (same path the activated/answered
// drills use). Each doc has activatedAt + closestAppointmentAt + closestDaysDiff.
async function _loadOutsideWindowDrill(){
  drillReset();
  drillTitle.textContent = "Activations Outside Window";
  drillSubtitle.textContent = "Phones that activated but the activation landed outside the appointment day-window (currently 8 days). Sorted by closest miss first. Click Claim to override and credit a row to our funnel.";
  openDrill();
  drillLoading.style.display = "block";
  try{
    var res = await fetch("/api/kv/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: ["salesoutsidewindow"], limit: 1000 })
    });
    var data = await res.json();
    if(!res.ok) throw new Error(data.error || "Failed");
    drillLoading.style.display = "none";
    var items = (data.entries || []).map(function(e){ return e.value; });
    items.sort(function(a, b){
      return Math.abs(a.closestDaysDiff || 0) - Math.abs(b.closestDaysDiff || 0);
    });
    renderDrillTable(items, [
      { label: "Phone", render: function(m){ return phoneLink(m.phone10); }, sortKey: function(m){ return m.phone10; } },
      { label: "Activated At", render: function(m){ return escapeHtml(formatTimestamp(m.activatedAt)); }, cls: "muted", sortKey: function(m){ return m.activatedAt || ""; } },
      { label: "Closest Appt", render: function(m){ return escapeHtml(formatTimestamp(m.closestAppointmentAt)); }, sortKey: function(m){ return m.closestAppointmentAt || ""; } },
      { label: "Days Off", render: function(m){ return '<span style="font-weight:900">' + (m.closestDaysDiff || 0) + 'd</span>'; }, sortKey: function(m){ return m.closestDaysDiff || 0; } },
      { label: "Office", render: function(m){ return escapeHtml(m.office || ""); }, sortKey: function(m){ return m.office || ""; } },
      { label: "Activator", render: function(m){ return escapeHtml(m.activator || ""); }, cls: "muted", sortKey: function(m){ return m.activator || ""; } },
      { label: "Window", render: function(m){ return (m.windowDays || 8) + 'd'; }, cls: "muted" },
      { label: "Action", render: function(m){
        return '<button class="secondary claim-btn" data-claim-phone="' + escapeHtml(m.phone10 || "") + '">Claim</button>';
      }}
    ]);
  } catch(err){
    drillLoading.style.display = "none";
    drillError.textContent = String(err.message || err);
    drillError.style.display = "block";
  }
}

document.getElementById("outsideWindowCard").addEventListener("click", _loadOutsideWindowDrill);

// Delegated handler for the per-row Claim button. Posts to the override
// endpoint then re-loads the drill so the claimed row drops out.
drillContent.addEventListener("click", async function(ev){
  var btn = ev.target.closest && ev.target.closest("button[data-claim-phone]");
  if(!btn) return;
  var phone10 = btn.getAttribute("data-claim-phone");
  if(!phone10) return;
  if(!confirm("Claim sale credit for " + phone10 + "? This moves it from Outside Window into Activated/Within7d.")) return;
  btn.disabled = true;
  btn.textContent = "Claiming…";
  try{
    var res = await fetch("/api/sales/claim-outside-window", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone10: phone10 })
    });
    var data = await res.json();
    if(!res.ok) throw new Error(data.error || "Failed");
    // Refresh both the drill (so the row drops) AND the main dashboard
    // cards behind it (so Activated/SalesWithin7d/OutsideWindow tiles
    // reflect the new totals). Without this, the user sees stale numbers.
    await Promise.all([_loadOutsideWindowDrill(), loadDashboard()]);
  } catch(err){
    btn.disabled = false;
    btn.textContent = "Claim";
    alert("Claim failed: " + (err.message || err));
  }
});

// Total SMS Records → scroll to the breakdown table that's already on the page.
document.getElementById("totalKvRecordsCard").addEventListener("click", function(){
  const el = document.querySelector(".kv-section");
  if(el){
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.style.outline = "2px solid var(--accent)";
    setTimeout(function(){ el.style.outline = ""; }, 1500);
  }
});

loadDashboard();
</script>
</body>
</html>`;

export const searchPageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📱</text></svg>">
<title>Conversation Search</title>
<style>
${sharedThemeCss}
.container{max-width:980px;margin:0 auto}
.search-box{display:flex;gap:10px;margin-bottom:14px}
.results-summary{
  background:linear-gradient(180deg, rgba(16,34,28,.92), rgba(15,27,23,.92));
  border:1px solid rgba(42,59,54,.85);
  border-radius:12px;
  padding:14px 16px;
  margin-bottom:14px;
  display:flex;
  justify-content:space-between;
  align-items:center;
  flex-wrap:wrap;
  gap:10px;
  box-shadow:var(--shadow);
}
.results-summary h2{font-size:1.05rem;color:var(--silver)}
.conversation{
  background:linear-gradient(180deg, rgba(16,34,28,.92), rgba(15,27,23,.92));
  border:1px solid rgba(42,59,54,.85);
  border-radius:12px;
  margin-bottom:12px;
  overflow:hidden;
  box-shadow:var(--shadow);
}
.conversation-header{
  background:rgba(19,42,35,.75);
  padding:14px 16px;
  cursor:pointer;
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:10px;
}
.conversation-header:hover{background:rgba(25,195,125,.10)}
.conversation-header h3{font-size:.98rem;color:var(--accentHi);word-break:break-all;user-select:text;-webkit-user-select:text}
.conversation-header .meta{color:var(--muted);font-size:.85rem;white-space:nowrap;flex-shrink:0}
.conversation-messages{display:none;padding:14px 16px;border-top:1px solid rgba(42,59,54,.85)}
.conversation.expanded .conversation-messages{display:block}
.message{
  padding:12px 14px;
  margin-bottom:10px;
  border-radius:12px;
  max-width:82%;
  border:1px solid rgba(42,59,54,.75);
}
.message:last-child{margin-bottom:0}
.message.guest{background:rgba(25,195,125,.10);margin-right:auto}
.message.ai{background:rgba(195,204,209,.08);margin-left:auto}
.message .sender{font-weight:800;font-size:.8rem;margin-bottom:6px;color:var(--silver)}
.message .content{line-height:1.45;color:var(--text)}
.message .timestamp{font-size:.75rem;color:var(--muted2);margin-top:8px}
.tag{
  display:inline-block;
  background:rgba(25,195,125,.16);
  border:1px solid rgba(25,195,125,.35);
  color:#b8ffe2;
  font-size:.7rem;
  padding:2px 8px;
  border-radius:999px;
  margin-left:8px;
  font-weight:900;
}
.opted-out{
  background:rgba(255,71,87,.18);
  border:1px solid rgba(255,71,87,.35);
  color:#ffd1d7;
  padding:4px 10px;
  border-radius:999px;
  font-size:.78rem;
  margin-left:10px;
  font-weight:900;
}
.mini-filters{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}
.mini-filters .filter-group{flex:1;min-width:160px}
.guest-status-panel{
  background:linear-gradient(180deg, rgba(16,34,28,.92), rgba(15,27,23,.92));
  border:1px solid rgba(42,59,54,.85);
  border-radius:12px;
  padding:16px;
  margin-bottom:14px;
  box-shadow:var(--shadow);
}
.guest-status-panel h3{color:var(--silver);font-size:1rem;margin-bottom:12px}
.status-row{display:flex;gap:16px;flex-wrap:wrap;align-items:center}
.status-item{
  display:flex;align-items:center;gap:8px;
  padding:8px 14px;
  border:1px solid rgba(42,59,54,.85);
  border-radius:10px;
  background:rgba(11,18,16,.5);
}
.status-item .status-label{color:var(--muted);font-size:.85rem;font-weight:600}
.status-item .status-badge{font-weight:900;font-size:.85rem}
.status-item button{
  padding:4px 12px;font-size:.8rem;height:auto;
  border-radius:8px;
}
.nodetag-row{
  display:flex;align-items:center;gap:8px;margin-top:6px;
}
.nodetag-row label{color:var(--muted);font-size:.75rem;font-weight:700;white-space:nowrap}
.nodetag-input{
  padding:3px 8px;font-size:.75rem;
  border:1px solid rgba(42,59,54,.85);
  border-radius:6px;
  background:rgba(11,18,16,.6);
  color:var(--text);
  width:140px;
  outline:none;
}
.nodetag-input:focus{border-color:rgba(25,195,125,.7);box-shadow:0 0 0 2px rgba(25,195,125,.12)}
.nodetag-save{
  padding:2px 8px;font-size:.7rem;height:auto;
  border-radius:6px;cursor:pointer;
  background:var(--accent);color:#08110e;border:none;font-weight:800;
}
.nodetag-save:hover{filter:brightness(1.1)}
.nodetag-saved{color:var(--accentHi);font-size:.7rem;font-weight:700;opacity:0;transition:opacity .3s}
</style>
</head>
<body>
<div class="container">
  <h1>Conversation Search</h1>
  <p class="subtitle">Search SMS conversations by phone number with optional filters</p>

  <div class="nav-links">
    <a href="/search">SMS Search</a>
    <a href="/dashboard">SMS Dashboard</a>
    <a href="/audit">Audit Search</a>
    <a href="/injections">Injections</a>
    <a href="/review">Review</a>
    <a href="/test">🧪 Test</a>
  </div>

  <div class="panel">
    <div class="search-box">
      <input type="text" id="phoneInput" placeholder="Phone (10 digits) e.g., 5551234567" autofocus />
      <button id="searchBtn" onclick="searchConversations()">Search</button>
    </div>

    <div class="mini-filters">
      <div class="filter-group">
        <label>Call ID contains (optional)</label>
        <input type="text" id="callIdFilter" placeholder="partial callId..." />
      </div>
      <div class="filter-group">
        <label>Sender (optional)</label>
        <input type="text" id="senderFilter" placeholder="Guest / AI Bot" />
      </div>
      <div class="filter-group">
        <label>nodeTag contains (optional)</label>
        <input type="text" id="nodeTagFilter" placeholder="e.g. appointment" />
      </div>
      <div class="filter-group">
        <label>Message contains (optional)</label>
        <input type="text" id="containsFilter" placeholder="substring..." />
      </div>
    </div>
    <p class="muted">This uses <span class="mono">/api/conversations/search2</span> stream-filtered to avoid extra client work.</p>
  </div>

  <div id="status" class="loading" style="display:none">
    <div class="spinner"></div>
    <p id="statusText">Searching...</p>
  </div>
  <div id="error" class="error" style="display:none"></div>

  <div id="results" style="margin-top:16px"></div>
</div>

<script>
const phoneInput = document.getElementById("phoneInput");
const searchBtn = document.getElementById("searchBtn");
const statusWrap = document.getElementById("status");
const statusText = document.getElementById("statusText");
const errorDiv = document.getElementById("error");
const resultsDiv = document.getElementById("results");

function normalizePhone(phone){
  return (phone || "").replace(/\\D/g,"").slice(-10);
}

function formatTimestamp(iso){
  if(!iso) return "-";
  const d = new Date(iso);
  if(isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-US", { month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit", hour12:true });
}

function escapeHtml(text){
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function truncate(str, len){
  if(!str) return "";
  return str.length <= len ? str : str.substring(0, len) + "…";
}

phoneInput.addEventListener("keypress", (e) => {
  if(e.key === "Enter") searchConversations();
});

async function searchConversations(){
  const phone = normalizePhone(phoneInput.value);
  const callId = document.getElementById("callIdFilter").value.trim();
  const sender = document.getElementById("senderFilter").value.trim();
  const nodeTag = document.getElementById("nodeTagFilter").value.trim();
  const contains = document.getElementById("containsFilter").value.trim();

  if(!phone || phone.length !== 10){
    errorDiv.textContent = "Please enter a valid 10-digit phone number";
    errorDiv.style.display = "block";
    return;
  }

  errorDiv.style.display = "none";
  resultsDiv.innerHTML = "";
  searchBtn.disabled = true;
  statusWrap.style.display = "block";
  statusText.textContent = "Searching...";

  try{
    const qs = new URLSearchParams();
    qs.set("phone", phone);
    if(callId) qs.set("callId", callId);
    if(sender) qs.set("sender", sender);
    if(nodeTag) qs.set("nodeTag", nodeTag);
    if(contains) qs.set("contains", contains);

    const response = await fetch("/api/conversations/search2?" + qs.toString());
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || "Search failed");

    if(!data.conversations || data.conversations.length === 0){
      statusText.textContent = "No results found";
      searchBtn.disabled = false;
      return;
    }

    statusWrap.style.display = "none";
    renderResults(phone, data.conversations, data.optedOut);
  } catch(err){
    statusWrap.style.display = "none";
    errorDiv.textContent = (err && err.message) ? err.message : String(err);
    errorDiv.style.display = "block";
  } finally {
    searchBtn.disabled = false;
  }
}

function renderResults(phone, conversations, optedOut){
  const grouped = {};
  conversations.forEach((msg) => {
    const id = msg.callId || "no-callId";
    if(!grouped[id]) grouped[id] = [];
    grouped[id].push(msg);
  });

  Object.values(grouped).forEach((msgs) => msgs.sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp)));

  const sortedCallIds = Object.keys(grouped).sort((a,b) => {
    const aLast = grouped[a][grouped[a].length - 1].timestamp;
    const bLast = grouped[b][grouped[b].length - 1].timestamp;
    return new Date(bLast) - new Date(aLast);
  });

  let html = '<div class="results-summary">';
  html += '<h2>Phone ' + escapeHtml(phone) + (optedOut ? ' <span class="opted-out">OPTED OUT</span>' : '') + '</h2>';
  html += '<span class="muted">' + sortedCallIds.length + ' conversations, ' + conversations.length + ' messages</span>';
  html += '</div>';

  // Guest status panel
  html += '<div class="guest-status-panel" id="guestStatusPanel">';
  html += '<h3>Guest Status for ' + escapeHtml(phone) + '</h3>';
  html += '<div class="status-row">';
  html += '<div class="status-item"><span class="status-label">Activated:</span><span class="status-badge" id="statusActivated">Loading...</span><button class="secondary" id="btnToggleActivated" style="display:none" onclick="toggleGuestStatus(&apos;activated&apos;)">Toggle</button></div>';
  html += '<div class="status-item"><span class="status-label">Answered:</span><span class="status-badge" id="statusAnswered">Loading...</span><button class="secondary" id="btnToggleAnswered" style="display:none" onclick="toggleGuestStatus(&apos;answered&apos;)">Toggle</button></div>';
  html += '<div class="status-item"><span class="status-label">Injection:</span><span class="status-badge" id="statusInjection">Loading...</span></div>';
  html += '</div>';
  html += '</div>';

  // Store phone globally for status operations
  window._currentPhone = phone;

  sortedCallIds.forEach((callId, index) => {
    const messages = grouped[callId];
    const lastMsg = messages[messages.length - 1];
    const isExpanded = index === 0 ? "expanded" : "";

    html += '<div class="conversation ' + isExpanded + '">';
    html += '<div class="conversation-header" onclick="toggleConversation(this)">';
    html += '<h3>Call ID ' + escapeHtml(callId) + '</h3>';
    html += '<div class="meta">' + messages.length + ' msgs • ' + formatTimestamp(lastMsg.timestamp) + '</div>';
    html += '</div>';

    html += '<div class="conversation-messages">';
    messages.forEach((msg, msgIdx) => {
      const isGuest = msg.sender === "Guest";
      const msgId = "msg_" + callId.substring(0, 8) + "_" + msgIdx;
      const kvKeyJson = JSON.stringify(msg._kvKey || null);
      html += '<div class="message ' + (isGuest ? "guest" : "ai") + '" data-kvkey="' + escapeHtml(kvKeyJson) + '">';
      html += '<div class="sender">' + escapeHtml(msg.sender || "Unknown") +
        (msg.nodeTag ? '<span class="tag">' + escapeHtml(msg.nodeTag) + '</span>' : '') +
        '</div>';
      html += '<div class="content">' + escapeHtml(msg.message || "") + '</div>';
      html += '<div class="timestamp">' + formatTimestamp(msg.timestamp) + '</div>';
      // Editable nodeTag row
      html += '<div class="nodetag-row">';
      html += '<label>Node Tag:</label>';
      html += '<input class="nodetag-input" id="' + msgId + '_tag" value="' + escapeHtml(msg.nodeTag || "") + '" placeholder="(none)" />';
      html += '<button class="nodetag-save" onclick="saveNodeTag(this, &apos;' + escapeHtml(phone) + '&apos;, &apos;' + escapeHtml(msg.callId || "") + '&apos;, &apos;' + escapeHtml(msg.timestamp || "") + '&apos;, &apos;' + msgId + '_tag&apos;)">Save</button>';
      html += '<span class="nodetag-saved" id="' + msgId + '_saved">Saved!</span>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div></div>';
  });

  resultsDiv.innerHTML = html;

  // Load guest statuses
  loadGuestStatus(phone);
}

function toggleConversation(header){
  const conv = header.parentElement;
  conv.classList.toggle("expanded");
}

async function loadGuestStatus(phone){
  try{
    // Fetch activated status
    const actRes = await fetch("/api/kv/get?key=" + encodeURIComponent(JSON.stringify(["guestactivated", phone])));
    const actData = await actRes.json();
    const actEl = document.getElementById("statusActivated");
    const actBtn = document.getElementById("btnToggleActivated");
    if(actData.value && actData.value.Activated){
      actEl.innerHTML = '<span class="badge ok">Yes</span> <span class="muted" style="font-size:.75rem">' + escapeHtml(formatTimestamp(actData.value.activatedAt)) + '</span>';
      actBtn.textContent = "Remove";
    } else {
      actEl.innerHTML = '<span class="badge danger">No</span>';
      actBtn.textContent = "Activate";
    }
    actBtn.style.display = "inline-block";

    // Fetch answered status
    const ansRes = await fetch("/api/kv/get?key=" + encodeURIComponent(JSON.stringify(["guestanswered", phone])));
    const ansData = await ansRes.json();
    const ansEl = document.getElementById("statusAnswered");
    const ansBtn = document.getElementById("btnToggleAnswered");
    if(ansData.value && ansData.value.answered){
      ansEl.innerHTML = '<span class="badge ok">Yes</span> <span class="muted" style="font-size:.75rem">' + escapeHtml(formatTimestamp(ansData.value.answeredAt)) + '</span>';
      ansBtn.textContent = "Remove";
    } else {
      ansEl.innerHTML = '<span class="badge danger">No</span>';
      ansBtn.textContent = "Mark Answered";
    }
    ansBtn.style.display = "inline-block";

    // Fetch injection status
    const injRes = await fetch("/api/kv/get?key=" + encodeURIComponent(JSON.stringify(["scheduledinjection", phone])));
    const injData = await injRes.json();
    const injEl = document.getElementById("statusInjection");
    if(injData.value){
      const et = injData.value.eventTime || injData.value.scheduledAt || null;
      injEl.innerHTML = '<span class="badge ok">Scheduled</span> <span class="muted" style="font-size:.75rem">' + (et ? escapeHtml(formatTimestamp(et)) : "no time") + '</span>';
    } else {
      injEl.innerHTML = '<span class="muted">None</span>';
    }
  } catch(err){
    console.log("Error loading guest status:", err);
  }
}

async function toggleGuestStatus(type){
  const phone = window._currentPhone;
  if(!phone) return;

  if(type === "activated"){
    const actRes = await fetch("/api/kv/get?key=" + encodeURIComponent(JSON.stringify(["guestactivated", phone])));
    const actData = await actRes.json();

    if(actData.value && actData.value.Activated){
      // Remove
      await fetch("/api/kv/delete?key=" + encodeURIComponent(JSON.stringify(["guestactivated", phone])), { method: "DELETE" });
    } else {
      // Activate
      await fetch("/api/kv/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: ["guestactivated", phone],
          value: { phone10: phone, Activated: true, activatedAt: new Date().toISOString(), eventTime: null }
        })
      });
    }
    loadGuestStatus(phone);
  }

  if(type === "answered"){
    const ansRes = await fetch("/api/kv/get?key=" + encodeURIComponent(JSON.stringify(["guestanswered", phone])));
    const ansData = await ansRes.json();

    if(ansData.value && ansData.value.answered){
      // Remove
      await fetch("/api/kv/delete?key=" + encodeURIComponent(JSON.stringify(["guestanswered", phone])), { method: "DELETE" });
    } else {
      // Mark answered
      await fetch("/api/kv/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: ["guestanswered", phone],
          value: { phone10: phone, answered: true, answeredAt: new Date().toISOString() }
        })
      });
    }
    loadGuestStatus(phone);
  }
}

async function saveNodeTag(btn, phone, callId, timestamp, inputId){
  const input = document.getElementById(inputId);
  const savedEl = document.getElementById(inputId.replace("_tag", "_saved"));
  const newTag = input.value.trim();

  btn.disabled = true;
  btn.textContent = "...";

  try{
    // Find the KV entry by listing conversations for this phone+callId and matching timestamp
    const listRes = await fetch("/api/kv/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: ["conversations", phone], limit: 500 })
    });
    const listData = await listRes.json();

    // Find the matching entry by callId + timestamp
    let targetEntry = null;
    for(const entry of (listData.entries || [])){
      const v = entry.value;
      if(v && v.callId === callId && v.timestamp === timestamp){
        targetEntry = entry;
        break;
      }
    }

    if(!targetEntry){
      alert("Could not find the matching KV entry for this message.");
      btn.disabled = false;
      btn.textContent = "Save";
      return;
    }

    // Update the value with the new nodeTag
    const updatedValue = Object.assign({}, targetEntry.value, { nodeTag: newTag || null });

    await fetch("/api/kv/set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: targetEntry.key, value: updatedValue })
    });

    btn.textContent = "Save";
    btn.disabled = false;

    // Flash saved indicator
    savedEl.style.opacity = "1";
    setTimeout(function(){ savedEl.style.opacity = "0"; }, 2000);

    // Update the tag badge inline
    const msgEl = btn.closest(".message");
    const senderEl = msgEl.querySelector(".sender");
    const existingTag = senderEl.querySelector(".tag");
    if(newTag){
      if(existingTag){
        existingTag.textContent = newTag;
      } else {
        const span = document.createElement("span");
        span.className = "tag";
        span.textContent = newTag;
        senderEl.appendChild(span);
      }
    } else {
      if(existingTag) existingTag.remove();
    }
  } catch(err){
    btn.textContent = "Save";
    btn.disabled = false;
    alert("Error saving nodeTag: " + String(err));
  }
}

// Auto-fill and search if ?phone= is in URL
(function(){
  const urlParams = new URLSearchParams(window.location.search);
  const phoneParam = urlParams.get("phone");
  if(phoneParam){
    phoneInput.value = phoneParam;
    searchConversations();
  }
})();
</script>
</body>
</html>`;

export const injectionsPageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📱</text></svg>">
<title>Scheduled Injections</title>
<style>
${sharedThemeCss}
.container{max-width:1100px;margin:0 auto}
.schedule-form{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}
.schedule-form .filter-group{display:flex;flex-direction:column;gap:6px}
.inj-table{width:100%;border-collapse:collapse;margin-top:12px}
.inj-table th,.inj-table td{padding:12px 15px;text-align:left;border-bottom:1px solid rgba(42,59,54,.9)}
.inj-table th{color:var(--muted);font-weight:700;font-size:.82rem;text-transform:uppercase;letter-spacing:.06em}
.inj-table tr:hover{background:rgba(25,195,125,.06)}
.time-badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:.78rem;font-weight:800}
.time-badge.past{background:rgba(255,71,87,.18);color:#ffd1d7;border:1px solid rgba(255,71,87,.35)}
.time-badge.future{background:rgba(25,195,125,.16);color:#b8ffe2;border:1px solid rgba(25,195,125,.35)}
.time-badge.soon{background:rgba(255,159,67,.18);color:#ffd1a0;border:1px solid rgba(255,159,67,.35)}
.action-btns{display:flex;gap:6px}
.action-btns button{padding:4px 10px;font-size:.8rem;height:auto;border-radius:8px}
</style>
</head>
<body>
<div class="container">
  <h1>Scheduled Injections</h1>
  <p class="subtitle">View upcoming injections and schedule new ones</p>

  <div class="nav-links">
    <a href="/search">SMS Search</a>
    <a href="/dashboard">SMS Dashboard</a>
    <a href="/audit">Audit Search</a>
    <a href="/injections">Injections</a>
    <a href="/review">Review</a>
    <a href="/test">🧪 Test</a>
  </div>

  <!-- Schedule new injection -->
  <div class="panel" style="margin-bottom:16px">
    <h3 style="color:var(--silver);margin-bottom:12px">Schedule New Injection</h3>
    <div class="schedule-form">
      <div class="filter-group" style="flex:1;min-width:180px">
        <label style="font-size:.85rem;color:var(--muted)">Phone (10 digits)</label>
        <input type="text" id="schedPhone" placeholder="e.g. 5551234567" />
      </div>
      <div class="filter-group">
        <label style="font-size:.85rem;color:var(--muted)">Date</label>
        <input type="date" id="schedDate" />
      </div>
      <div class="filter-group">
        <label style="font-size:.85rem;color:var(--muted)">Time (ET)</label>
        <input type="time" id="schedTime" value="13:00" />
      </div>
      <div class="filter-group">
        <label style="font-size:.85rem;color:var(--muted)">Test?</label>
        <select id="schedIsTest">
          <option value="false">No (Production)</option>
          <option value="true">Yes (Test)</option>
        </select>
      </div>
      <button onclick="scheduleInjection()">Schedule</button>
    </div>
    <div id="schedResult" style="display:none;margin-top:12px"></div>
  </div>

  <!-- List of all scheduled injections -->
  <div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <h3 style="color:var(--silver)">All Scheduled Injections</h3>
      <div style="display:flex;gap:10px;align-items:center">
        <span class="muted" id="injCount">Loading...</span>
        <button class="secondary" onclick="loadInjections()">Refresh</button>
      </div>
    </div>

    <div id="injLoading" class="loading">
      <div class="spinner"></div>
      <p>Loading injections...</p>
    </div>
    <div id="injError" class="error" style="display:none"></div>

    <div id="injContent" style="display:none">
      <table class="inj-table">
        <thead>
          <tr>
            <th>Phone</th>
            <th>Event Time</th>
            <th>Status</th>
            <th>Scheduled At</th>
            <th>Test</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="injTbody"></tbody>
      </table>
      <div id="injEmpty" class="muted" style="display:none;text-align:center;padding:28px">
        No scheduled injections found.
      </div>
    </div>
  </div>

  <!-- Injection History -->
  <div class="panel" style="margin-top:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <h3 style="color:var(--silver)">Injection History</h3>
      <div style="display:flex;gap:10px;align-items:center">
        <span class="muted" id="histCount">Loading...</span>
        <button class="secondary" onclick="loadHistory()">Refresh</button>
      </div>
    </div>

    <div id="histLoading" class="loading" style="display:none">
      <div class="spinner"></div>
      <p>Loading history...</p>
    </div>

    <div id="histContent" style="display:none">
      <table class="inj-table">
        <thead>
          <tr>
            <th>Phone</th>
            <th>Event Time</th>
            <th>Fired At</th>
            <th>Fired By</th>
            <th>Status</th>
            <th>Test</th>
          </tr>
        </thead>
        <tbody id="histTbody"></tbody>
      </table>
      <div id="histEmpty" class="muted" style="display:none;text-align:center;padding:28px">
        No injection history yet. History is recorded when injections fire.
      </div>
    </div>
  </div>
</div>

<script>
// Set default schedule date to today
const today = new Date();
document.getElementById("schedDate").value = today.toISOString().split("T")[0];

function formatTimestamp(iso){
  if(!iso) return "-";
  const d = new Date(iso);
  if(isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-US", { month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit", hour12:true });
}

function escapeHtml(text){
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function getTimeBadge(eventTime){
  if(!eventTime) return '<span class="time-badge past">No time</span>';
  const et = new Date(eventTime).getTime();
  const now = Date.now();
  const diffMs = et - now;
  const diffMins = Math.round(diffMs / 60000);

  if(diffMs < 0){
    return '<span class="time-badge past">Past due (' + Math.abs(diffMins) + 'm ago)</span>';
  } else if(diffMs < 3600000){
    return '<span class="time-badge soon">In ' + diffMins + 'm</span>';
  } else {
    const diffHrs = Math.round(diffMs / 3600000);
    if(diffHrs < 24){
      return '<span class="time-badge future">In ' + diffHrs + 'h</span>';
    } else {
      const diffDays = Math.round(diffMs / 86400000);
      return '<span class="time-badge future">In ' + diffDays + 'd</span>';
    }
  }
}

async function loadInjections(){
  const loadingDiv = document.getElementById("injLoading");
  const errorDiv = document.getElementById("injError");
  const contentDiv = document.getElementById("injContent");
  const emptyDiv = document.getElementById("injEmpty");
  const countEl = document.getElementById("injCount");
  const tbody = document.getElementById("injTbody");

  loadingDiv.style.display = "block";
  contentDiv.style.display = "none";
  errorDiv.style.display = "none";

  try{
    const res = await fetch("/api/kv/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: ["scheduledinjection"], limit: 500 })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || "Failed");

    const entries = (data.entries || []).map(function(e){
      return { phone: e.key[1], value: e.value };
    });

    // Sort by eventTime ascending (soonest first)
    entries.sort(function(a, b){
      const at = a.value.eventTime ? new Date(a.value.eventTime).getTime() : Infinity;
      const bt = b.value.eventTime ? new Date(b.value.eventTime).getTime() : Infinity;
      return at - bt;
    });

    loadingDiv.style.display = "none";
    contentDiv.style.display = "block";
    countEl.textContent = entries.length + " injection" + (entries.length !== 1 ? "s" : "");

    tbody.innerHTML = "";

    if(entries.length === 0){
      emptyDiv.style.display = "block";
      return;
    }
    emptyDiv.style.display = "none";

    entries.forEach(function(entry){
      const v = entry.value;
      const row = document.createElement("tr");
      row.innerHTML =
        '<td><a href="/search?phone=' + encodeURIComponent(entry.phone) + '" target="_blank" class="mono" style="color:var(--accentHi);text-decoration:none;border-bottom:1px dashed rgba(25,195,125,.4)">' + escapeHtml(entry.phone) + '</a></td>' +
        '<td style="color:var(--silver);font-weight:700">' + escapeHtml(formatTimestamp(v.eventTime)) + '</td>' +
        '<td>' + getTimeBadge(v.eventTime) + '</td>' +
        '<td class="muted">' + escapeHtml(formatTimestamp(v.scheduledAt)) + '</td>' +
        '<td>' + (v.isTest ? '<span class="time-badge soon">TEST</span>' : '<span class="muted">Prod</span>') + '</td>' +
        '<td><div class="action-btns">' +
          '<button onclick="fireInjection(&apos;' + escapeHtml(entry.phone) + '&apos;, this)">Fire Now</button>' +
          '<button class="secondary" onclick="cancelInjection(&apos;' + escapeHtml(entry.phone) + '&apos;, this)">Cancel</button>' +
        '</div></td>';
      tbody.appendChild(row);
    });
  } catch(err){
    loadingDiv.style.display = "none";
    errorDiv.textContent = String(err.message || err);
    errorDiv.style.display = "block";
  }
}

async function scheduleInjection(){
  const phone = (document.getElementById("schedPhone").value || "").replace(/[^0-9]/g, "").slice(-10);
  const date = document.getElementById("schedDate").value;
  const time = document.getElementById("schedTime").value;
  const isTest = document.getElementById("schedIsTest").value === "true";
  const resultDiv = document.getElementById("schedResult");

  if(!phone || phone.length !== 10){
    resultDiv.style.display = "block";
    resultDiv.innerHTML = '<span class="badge danger">Invalid</span><span style="margin-left:10px">Enter a valid 10-digit phone</span>';
    return;
  }
  if(!date || !time){
    resultDiv.style.display = "block";
    resultDiv.innerHTML = '<span class="badge danger">Missing</span><span style="margin-left:10px">Enter a date and time</span>';
    return;
  }

  // Build ET datetime — assume Eastern Time input, convert to ISO
  // We store the ISO string and the cron compares against Date.now()
  const eventTimeLocal = date + "T" + time + ":00";
  // Create as ET (approximate — use America/New_York offset)
  const etDate = new Date(eventTimeLocal + "-04:00"); // EDT
  const eventTimeISO = etDate.toISOString();

  resultDiv.style.display = "block";
  resultDiv.innerHTML = '<span class="muted">Scheduling...</span>';

  try{
    const res = await fetch("/api/injection/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phone, eventTime: eventTimeISO, isTest: isTest })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || "Failed");

    resultDiv.innerHTML = '<span class="badge ok">Scheduled!</span><span style="margin-left:10px">Phone ' + escapeHtml(phone) + ' at ' + escapeHtml(formatTimestamp(eventTimeISO)) + (isTest ? ' (TEST)' : '') + '</span>';
    document.getElementById("schedPhone").value = "";
    loadInjections();
  } catch(err){
    resultDiv.innerHTML = '<span class="badge danger">Error</span><span style="margin-left:10px">' + escapeHtml(String(err)) + '</span>';
  }
}

async function fireInjection(phone, btn){
  btn.disabled = true;
  btn.textContent = "...";
  try{
    const res = await fetch("/api/cron/trigger-single?phone=" + encodeURIComponent(phone));
    const data = await res.json();
    // Backend (routes/api/cron/trigger-single.ts) returns
    // { phone, fired: bool, error?: string } — no "success" field.
    if(res.ok && data.fired){
      btn.textContent = "Fired!";
      btn.style.background = "var(--accent)";
      btn.style.color = "#08110e";
      setTimeout(function(){ loadInjections(); }, 1500);
    } else {
      btn.textContent = "Failed";
      alert("Fire failed: " + (data.error || "Unknown error"));
      btn.disabled = false;
      btn.textContent = "Fire Now";
    }
  } catch(err){
    alert("Error: " + String(err));
    btn.disabled = false;
    btn.textContent = "Fire Now";
  }
}

async function cancelInjection(phone, btn){
  if(!confirm("Cancel injection for " + phone + "?")) return;
  btn.disabled = true;
  btn.textContent = "...";
  try{
    const res = await fetch("/api/injection/cancel?phone=" + encodeURIComponent(phone), { method: "DELETE" });
    const data = await res.json();
    if(res.ok && data.success){
      loadInjections();
    } else {
      alert("Cancel failed: " + (data.error || "Unknown error"));
      btn.disabled = false;
      btn.textContent = "Cancel";
    }
  } catch(err){
    alert("Error: " + String(err));
    btn.disabled = false;
    btn.textContent = "Cancel";
  }
}

async function loadHistory(){
  var loading = document.getElementById("histLoading");
  var content = document.getElementById("histContent");
  var empty = document.getElementById("histEmpty");
  var countEl = document.getElementById("histCount");
  var tbody = document.getElementById("histTbody");

  loading.style.display = "block";
  content.style.display = "none";

  try{
    var res = await fetch("/api/kv/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: ["injectionhistory"], limit: 200 })
    });
    var data = await res.json();
    if(!res.ok) throw new Error(data.error || "Failed");

    var entries = (data.entries || []).map(function(e){
      return { phone: e.key[1], firedAt: e.key[2], value: e.value };
    });

    entries.sort(function(a, b){
      return new Date(b.firedAt || 0) - new Date(a.firedAt || 0);
    });

    loading.style.display = "none";
    content.style.display = "block";
    countEl.textContent = entries.length + " record" + (entries.length !== 1 ? "s" : "");

    tbody.innerHTML = "";

    if(entries.length === 0){
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";

    entries.forEach(function(entry){
      var v = entry.value || {};
      var row = document.createElement("tr");
      var statusBadge = v.status === "success"
        ? '<span class="time-badge future">Success</span>'
        : '<span class="time-badge past">' + escapeHtml(v.status || "unknown") + '</span>';
      var firedByBadge = v.firedBy === "manual"
        ? '<span class="time-badge soon">Manual</span>'
        : '<span class="time-badge future">Cron</span>';
      row.innerHTML =
        '<td><a href="/search?phone=' + encodeURIComponent(entry.phone) + '" target="_blank" class="mono" style="color:var(--accentHi);text-decoration:none;border-bottom:1px dashed rgba(25,195,125,.4)">' + escapeHtml(entry.phone) + '</a></td>' +
        '<td class="muted">' + escapeHtml(formatTimestamp(v.eventTime)) + '</td>' +
        '<td style="color:var(--silver);font-weight:700">' + escapeHtml(formatTimestamp(v.firedAt)) + '</td>' +
        '<td>' + firedByBadge + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td>' + (v.isTest ? '<span class="time-badge soon">TEST</span>' : '<span class="muted">Prod</span>') + '</td>';
      tbody.appendChild(row);
    });
  } catch(err){
    loading.style.display = "none";
    content.style.display = "block";
    empty.style.display = "block";
    empty.textContent = "Error: " + String(err);
  }
}

loadInjections();
loadHistory();
</script>
</body>
</html>`;

export const reviewPageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📱</text></svg>">
<title>Review Responses</title>
<style>
${sharedThemeCss}
.container{max-width:1200px;margin:0 auto}
.date-bar{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px}
.date-bar .filter-group{display:flex;flex-direction:column;gap:6px}
.resp-card{
  background:linear-gradient(180deg, rgba(16,34,28,.92), rgba(15,27,23,.92));
  border:1px solid rgba(42,59,54,.85);
  border-radius:12px;
  margin-bottom:10px;
  overflow:hidden;
  box-shadow:var(--shadow);
  transition:border-color .2s;
}
.resp-card:hover{border-color:rgba(25,195,125,.45)}
.resp-header{
  display:flex;justify-content:space-between;align-items:center;
  padding:14px 18px;cursor:pointer;gap:12px;flex-wrap:wrap;
}
.resp-header:hover{background:rgba(25,195,125,.06)}
.resp-phone{font-family:monospace;font-weight:900;font-size:1.05rem;color:var(--accentHi)}
.resp-meta{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.resp-meta .chip{
  display:inline-block;padding:3px 10px;border-radius:999px;
  font-size:.78rem;font-weight:800;
  background:rgba(25,195,125,.16);color:#b8ffe2;border:1px solid rgba(25,195,125,.35);
}
.resp-meta .muted{font-size:.85rem}
.resp-preview{color:var(--text);font-size:.88rem;max-width:400px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.resp-links{display:flex;gap:8px;align-items:center}
.resp-links a{
  display:inline-flex;align-items:center;gap:5px;
  padding:5px 12px;border-radius:8px;font-size:.8rem;font-weight:700;
  text-decoration:none;transition:background .2s;
}
.link-bland{background:rgba(99,102,241,.18);color:#c4b5fd;border:1px solid rgba(99,102,241,.35)}
.link-bland:hover{background:rgba(99,102,241,.3)}
.link-search{background:rgba(25,195,125,.12);color:#b8ffe2;border:1px solid rgba(25,195,125,.3)}
.link-search:hover{background:rgba(25,195,125,.22)}
.resp-convo{display:none;padding:14px 18px;border-top:1px solid rgba(42,59,54,.85)}
.resp-card.open .resp-convo{display:block}
.msg{
  max-width:80%;padding:12px 16px;border-radius:12px;margin-bottom:10px;
  position:relative;
}
.msg.guest{background:rgba(25,195,125,.10);margin-right:auto}
.msg.ai{background:rgba(195,204,209,.08);margin-left:auto}
.msg .msg-sender{font-weight:800;font-size:.8rem;margin-bottom:4px;color:var(--silver)}
.msg .msg-tag{
  display:inline-block;background:rgba(25,195,125,.16);border:1px solid rgba(25,195,125,.35);
  color:#b8ffe2;font-size:.7rem;padding:2px 8px;border-radius:999px;margin-left:8px;font-weight:900;
}
.msg .msg-text{line-height:1.45;color:var(--text)}
.msg .msg-time{font-size:.75rem;color:var(--muted2);margin-top:6px}
.empty-state{text-align:center;padding:40px;color:var(--muted)}
</style>
</head>
<body>
<div class="container">
  <h1>Review Responses</h1>
  <p class="subtitle">Review guest replies and full conversations</p>

  <div class="nav-links">
    <a href="/search">SMS Search</a>
    <a href="/dashboard">SMS Dashboard</a>
    <a href="/audit">Audit Search</a>
    <a href="/injections">Injections</a>
    <a href="/review">Review</a>
    <a href="/test">🧪 Test</a>
  </div>

  <div class="panel" style="margin-bottom:16px">
    <div class="date-bar">
      <div class="filter-group">
        <label style="font-size:.85rem;color:var(--muted)">Date</label>
        <input type="date" id="reviewDate" />
      </div>
      <button onclick="loadReview()">Load</button>
      <span class="muted" id="reviewCount" style="font-size:.9rem"></span>
    </div>
  </div>

  <div id="reviewLoading" class="loading" style="display:none">
    <div class="spinner"></div>
    <p>Loading responses...</p>
  </div>
  <div id="reviewError" class="error" style="display:none"></div>
  <div id="reviewResults"></div>
</div>

<script>
const today = new Date().toISOString().split("T")[0];
document.getElementById("reviewDate").value = today;

function formatTimestamp(iso){
  if(!iso) return "-";
  const d = new Date(iso);
  if(isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-US", { month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit", hour12:true });
}

function escapeHtml(text){
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function truncate(str, len){
  if(!str) return "";
  return str.length <= len ? str : str.substring(0, len) + "...";
}

async function loadReview(){
  const date = document.getElementById("reviewDate").value;
  const loading = document.getElementById("reviewLoading");
  const error = document.getElementById("reviewError");
  const results = document.getElementById("reviewResults");
  const countEl = document.getElementById("reviewCount");

  loading.style.display = "block";
  error.style.display = "none";
  results.innerHTML = "";
  countEl.textContent = "";

  try{
    const params = new URLSearchParams();
    params.append("startDate", date);
    params.append("endDate", date);
    // Fetch all messages for the date
    const res = await fetch("/api/dashboard/drill?" + params.toString());
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || "Failed");

    loading.style.display = "none";
    const allMsgs = data.items || [];

    // Find phones where a Guest replied
    const guestPhones = new Set();
    allMsgs.forEach(function(m){
      if(m.sender === "Guest" && m.phoneNumber) guestPhones.add(m.phoneNumber);
    });

    if(guestPhones.size === 0){
      results.innerHTML = '<div class="empty-state">No guest responses found for ' + escapeHtml(date) + '</div>';
      countEl.textContent = "0 responses";
      return;
    }

    // Group all messages by phone (only phones that had a guest reply)
    const phoneData = {};
    allMsgs.forEach(function(m){
      if(!m.phoneNumber || !guestPhones.has(m.phoneNumber)) return;
      if(!phoneData[m.phoneNumber]) phoneData[m.phoneNumber] = { messages: [], callIds: new Set(), guestMsgCount: 0, latestGuest: null };
      phoneData[m.phoneNumber].messages.push(m);
      if(m.callId) phoneData[m.phoneNumber].callIds.add(m.callId);
      if(m.sender === "Guest"){
        phoneData[m.phoneNumber].guestMsgCount++;
        if(!phoneData[m.phoneNumber].latestGuest || new Date(m.timestamp) > new Date(phoneData[m.phoneNumber].latestGuest.timestamp)){
          phoneData[m.phoneNumber].latestGuest = m;
        }
      }
    });

    // Sort by latest guest reply time descending
    const sortedPhones = Object.keys(phoneData).sort(function(a, b){
      const at = phoneData[a].latestGuest ? new Date(phoneData[a].latestGuest.timestamp).getTime() : 0;
      const bt = phoneData[b].latestGuest ? new Date(phoneData[b].latestGuest.timestamp).getTime() : 0;
      return bt - at;
    });

    countEl.textContent = sortedPhones.length + " guest" + (sortedPhones.length !== 1 ? "s" : "") + " replied";

    let html = "";
    sortedPhones.forEach(function(phone, idx){
      const pd = phoneData[phone];
      const latestMsg = pd.latestGuest;
      const callId = pd.callIds.values().next().value || "";
      const blandUrl = callId ? "https://app.bland.ai/dashboard/sms/" + encodeURIComponent(callId) + "?tab=conversations" : "";

      html += '<div class="resp-card" id="resp_' + idx + '">';
      html += '<div class="resp-header" onclick="toggleResp(' + idx + ')">';
      html += '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">';
      html += '<span class="resp-phone">' + escapeHtml(phone) + '</span>';
      html += '<span class="resp-preview">' + escapeHtml(truncate(latestMsg ? latestMsg.message : "", 60)) + '</span>';
      html += '</div>';
      html += '<div class="resp-meta">';
      html += '<span class="chip">' + pd.guestMsgCount + ' repl' + (pd.guestMsgCount !== 1 ? 'ies' : 'y') + '</span>';
      html += '<span class="muted">' + (latestMsg ? escapeHtml(formatTimestamp(latestMsg.timestamp)) : "-") + '</span>';
      html += '<div class="resp-links">';
      if(blandUrl) html += '<a href="' + escapeHtml(blandUrl) + '" target="_blank" class="link-bland" onclick="event.stopPropagation()">Bland SMS</a>';
      html += '<a href="/search?phone=' + encodeURIComponent(phone) + '" target="_blank" class="link-search" onclick="event.stopPropagation()">Full History</a>';
      html += '</div>';
      html += '</div>';
      html += '</div>';

      // Conversation detail
      html += '<div class="resp-convo">';
      var msgs = pd.messages.sort(function(a,b){ return new Date(a.timestamp) - new Date(b.timestamp); });
      msgs.forEach(function(m){
        var isGuest = m.sender === "Guest";
        html += '<div class="msg ' + (isGuest ? "guest" : "ai") + '">';
        html += '<div class="msg-sender">' + escapeHtml(m.sender || "Unknown");
        if(m.nodeTag) html += '<span class="msg-tag">' + escapeHtml(m.nodeTag) + '</span>';
        html += '</div>';
        html += '<div class="msg-text">' + escapeHtml(m.message || "") + '</div>';
        html += '<div class="msg-time">' + escapeHtml(formatTimestamp(m.timestamp)) + '</div>';
        html += '</div>';
      });
      html += '</div>';
      html += '</div>';
    });

    results.innerHTML = html;

    // Auto-expand first card
    if(sortedPhones.length > 0){
      document.getElementById("resp_0").classList.add("open");
    }
  } catch(err){
    loading.style.display = "none";
    error.textContent = String(err.message || err);
    error.style.display = "block";
  }
}

function toggleResp(idx){
  document.getElementById("resp_" + idx).classList.toggle("open");
}

loadReview();
</script>
</body>
</html>`;

export const testPageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧪</text></svg>">
<title>Endpoint Test Console</title>
<style>
${sharedThemeCss}
.sticky-bar{
  position:sticky;top:0;z-index:30;
  background:linear-gradient(180deg, rgba(11,18,16,.96), rgba(11,18,16,.88));
  backdrop-filter:blur(8px);
  border-bottom:1px solid rgba(42,59,54,.85);
  padding:14px 0;
  margin:-20px -20px 18px;
  padding-left:20px;padding-right:20px;
}
.sticky-bar .row{display:flex;gap:16px;align-items:end;flex-wrap:wrap;max-width:1200px;margin:0 auto}
.sticky-bar .filter-group{flex:1;min-width:240px}
.sticky-bar input[type="text"]{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:1.1rem}
.danger-banner{
  background:rgba(255,71,87,.12);border:1px solid rgba(255,71,87,.45);
  color:#ffd1d7;padding:12px 16px;border-radius:10px;margin-bottom:14px;font-weight:700;
}
.section{margin-bottom:24px}
.section h2{color:var(--silver);font-size:1.15rem;margin-bottom:10px;display:flex;align-items:center;gap:8px}
.section .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:14px}
.endpoint-card{
  background:linear-gradient(180deg, rgba(16,34,28,.92), rgba(15,27,23,.92));
  border:1px solid rgba(42,59,54,.85);
  border-radius:12px;
  padding:16px;
  box-shadow:var(--shadow);
}
.endpoint-card.danger{border-color:rgba(255,71,87,.55)}
.endpoint-card .ep-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px}
.endpoint-card .ep-head .ep-title{color:var(--silver);font-weight:700;font-size:.98rem}
.endpoint-card .ep-head .ep-desc{color:var(--muted2);font-size:.82rem;margin-top:2px}
.endpoint-card .ep-method{
  display:inline-block;padding:2px 8px;border-radius:6px;font-size:.75rem;font-weight:800;
  font-family:ui-monospace,monospace;letter-spacing:.04em;
}
.method-GET{background:rgba(25,195,125,.18);color:#b8ffe2;border:1px solid rgba(25,195,125,.4)}
.method-POST{background:rgba(46,134,222,.18);color:#bfdcff;border:1px solid rgba(46,134,222,.4)}
.method-DELETE{background:rgba(255,71,87,.18);color:#ffd1d7;border:1px solid rgba(255,71,87,.4)}
.endpoint-card code.path{color:var(--accentHi);font-family:ui-monospace,monospace;font-size:.82rem;display:block;margin-bottom:10px;word-break:break-all}
.endpoint-card .params{display:flex;flex-direction:column;gap:8px;margin-bottom:10px}
.endpoint-card .params label{font-size:.78rem;color:var(--muted)}
.endpoint-card .params input,.endpoint-card .params select,.endpoint-card .params textarea{padding:8px 10px;font-size:.9rem}
.endpoint-card .params textarea{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(11,18,16,.75);color:var(--text);border:1px solid rgba(42,59,54,.95);border-radius:10px;resize:vertical;min-height:64px}
.endpoint-card .params input.phone-input{background:rgba(11,18,16,.6)}
.endpoint-card .actions{display:flex;gap:8px;align-items:center}
.endpoint-card .actions button{height:36px;padding:0 18px;font-size:.9rem}
.endpoint-card .actions .status{font-family:ui-monospace,monospace;font-size:.85rem}
.endpoint-card .resp{
  margin-top:10px;border-top:1px solid rgba(42,59,54,.55);padding-top:10px;display:none;
}
.endpoint-card .resp.show{display:block}
.endpoint-card .resp pre{
  background:rgba(11,18,16,.7);
  border:1px solid rgba(42,59,54,.65);
  border-radius:8px;
  padding:10px 12px;
  font-family:ui-monospace,monospace;font-size:.78rem;
  max-height:340px;overflow:auto;color:var(--text);white-space:pre-wrap;word-break:break-all;
}
.status-2xx{color:#b8ffe2}
.status-4xx{color:#ffe6b8}
.status-5xx{color:#ffd1d7}
details.auth{
  background:rgba(11,18,16,.5);border:1px solid rgba(42,59,54,.65);border-radius:10px;
  padding:10px 14px;margin-bottom:18px;
}
details.auth summary{cursor:pointer;color:var(--silver);font-weight:700;outline:none}
details.auth .auth-row{display:flex;gap:14px;margin-top:10px;flex-wrap:wrap}
details.auth .auth-row .filter-group{flex:1;min-width:280px}
.tag{display:inline-block;background:rgba(195,204,209,.08);border:1px solid rgba(195,204,209,.2);color:var(--muted2);padding:2px 8px;border-radius:6px;font-size:.7rem;margin-left:6px}
</style>
</head>
<body>
<div class="container">
  <div class="sticky-bar">
    <div class="row">
      <div class="filter-group">
        <label>📱 Set ALL phone fields below (any format — normalized to 10 digits)</label>
        <input type="text" id="globalPhone" placeholder="8432222986" />
      </div>
      <button class="secondary" onclick="clearAllResponses()" title="Clear all response panels">Clear all</button>
    </div>
  </div>

  <h1 style="margin-top:0">🧪 Endpoint Test Console</h1>
  <p class="subtitle">Each card has its own phone field — type once at the top to set them all, or override per card.</p>

  <div class="nav-links">
    <a href="/dashboard">Dashboard</a>
    <a href="/search">Search</a>
    <a href="/audit">Audit</a>
    <a href="/injections">Injections</a>
    <a href="/review">Review</a>
    <a href="/test">🧪 Test</a>
  </div>

  <!-- ============ 1. TRIGGER INBOUND SMS ============ -->
  <div class="section">
    <h2>🚀 Trigger inbound SMS <span class="tag">REAL BLAND SEND</span></h2>
    <div class="danger-banner">⚠️ These actually send SMS to the entered phone via Bland.ai. Confirm before clicking.</div>
    <div class="grid">

      <div class="endpoint-card" data-id="trigger-manual">
        <div class="ep-head">
          <div>
            <div class="ep-title">Manual trigger</div>
            <div class="ep-desc">Sends one Bland SMS via the configured pathway. Check "override" to bypass every gatekeeper (and use a stub guest if Quickbase isn't wired).</div>
          </div>
          <span class="ep-method method-POST">POST</span>
        </div>
        <code class="path">/trigger/manual</code>
        <div class="params">
          <label>phone</label>
          <input class="phone-input" type="text" data-param="phone" placeholder="8432222986" />
          <label>resID (passes through to the Bland pathway)</label>
          <input type="text" data-param="resID" placeholder="282383" />
          <label>domain</label>
          <select data-param="domain">
            <option>monsterrg</option><option>monsterodr</option><option>monsteract</option>
            <option>monsterods</option><option>monsterds</option>
          </select>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" data-param="override" />
            <span>override=true (bypass attempts, DNC, rate limit, opt-out, CRM)</span>
          </label>
        </div>
        <div class="actions">
          <button onclick="runTriggerManual(this)">Send pathway SMS</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

      <div class="endpoint-card" data-id="custom-sms">
        <div class="ep-head">
          <div>
            <div class="ep-title">Custom SMS (you write the body) <span class="tag">NEW</span></div>
            <div class="ep-desc">Bypasses the pathway entirely. Sends exactly the text you type via Bland's /v1/sms/send.</div>
          </div>
          <span class="ep-method method-POST">POST</span>
        </div>
        <code class="path">/trigger/test-sms</code>
        <div class="params">
          <label>phone</label>
          <input class="phone-input" type="text" data-param="phone" placeholder="8432222986" />
          <label>message text</label>
          <textarea data-param="message" rows="3" placeholder="Hey from sms-bot test console! 🧪">Hey from sms-bot test console! 🧪</textarea>
        </div>
        <div class="actions">
          <button onclick="runCustomSms(this)">Send custom SMS</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

      <div class="endpoint-card" data-id="trigger-readymode">
        <div class="ep-head">
          <div>
            <div class="ep-title">ReadyMode webhook</div>
            <div class="ep-desc">Full gatekeeper path. Won't send unless attempts ≥ 40 and DNC clear. Check "override" to bypass.</div>
          </div>
          <span class="ep-method method-POST">POST</span>
        </div>
        <code class="path">/trigger/readymode</code>
        <div class="params">
          <label>phone</label>
          <input class="phone-input" type="text" data-param="phone" placeholder="8432222986" />
          <label>attempts</label>
          <input type="number" data-param="attempts" value="45" />
          <label>resID</label>
          <input type="text" data-param="resID" placeholder="282383" />
          <label>domain</label>
          <select data-param="domain">
            <option>monsterrg</option><option>monsterodr</option><option>monsteract</option>
            <option>monsterods</option><option>monsterds</option>
          </select>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" data-param="override" />
            <span>override=true (bypass all gatekeepers)</span>
          </label>
        </div>
        <div class="actions">
          <button onclick="runTriggerReadymode(this)">Send</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

    </div>
  </div>

  <!-- ============ 2. APPOINTMENT FLOW ============ -->
  <div class="section">
    <h2>📅 Cal.com / Appointment</h2>
    <div class="grid">

      <div class="endpoint-card" data-id="appt-booked">
        <div class="ep-head">
          <div>
            <div class="ep-title">Appointment booked</div>
            <div class="ep-desc">Scrubs current source, schedules a future injection.</div>
          </div>
          <span class="ep-method method-POST">POST</span>
        </div>
        <code class="path">/sms-callback/appointment-booked</code>
        <div class="params">
          <label>phone</label>
          <input class="phone-input" type="text" data-param="phone" placeholder="8432222986" />
          <label>event_time (ISO)</label>
          <input type="datetime-local" data-param="event_time" />
        </div>
        <div class="actions">
          <button onclick="runApptBooked(this)">Schedule</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

      <div class="endpoint-card" data-id="cron-trigger-single">
        <div class="ep-head">
          <div>
            <div class="ep-title">Fire scheduled injection now</div>
            <div class="ep-desc">Runs the injection that's scheduled for this phone immediately.</div>
          </div>
          <span class="ep-method method-GET">GET</span>
        </div>
        <code class="path">/api/cron/trigger-single?phone=…</code>
        <div class="params">
          <label>phone</label>
          <input class="phone-input" type="text" data-param="phone" placeholder="8432222986" />
        </div>
        <div class="actions">
          <button onclick="runCronTriggerSingle(this)">Fire</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

      <div class="endpoint-card" data-id="injection-schedule">
        <div class="ep-head">
          <div>
            <div class="ep-title">Manual schedule injection</div>
            <div class="ep-desc">Same as Cal.com path but skips the source scrub.</div>
          </div>
          <span class="ep-method method-POST">POST</span>
        </div>
        <code class="path">/api/injection/schedule</code>
        <div class="params">
          <label>phone</label>
          <input class="phone-input" type="text" data-param="phone" placeholder="8432222986" />
          <label>eventTime</label>
          <input type="datetime-local" data-param="eventTime" />
          <label>isTest</label>
          <select data-param="isTest"><option value="true">true</option><option value="false">false</option></select>
        </div>
        <div class="actions">
          <button onclick="runInjectionSchedule(this)">Schedule</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

      <div class="endpoint-card" data-id="cal-available-times">
        <div class="ep-head">
          <div>
            <div class="ep-title">Generate available times <span class="tag">NEW</span></div>
            <div class="ep-desc">15-min slots, 9–5 ET, future-only. Pure date math, no Cal.com call.</div>
          </div>
          <span class="ep-method method-POST">POST</span>
        </div>
        <code class="path">/cal/available-times</code>
        <div class="actions">
          <button onclick="runCalAvailableTimes(this)">Generate</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

      <div class="endpoint-card" data-id="cal-schedule">
        <div class="ep-head">
          <div>
            <div class="ep-title">Book Cal.com appointment <span class="tag">NEW</span></div>
            <div class="ep-desc">Creates real Cal.com booking + schedules SMS injection + tags appointment in conversation history. Fail-safe: still schedules injection if Cal.com fails.</div>
          </div>
          <span class="ep-method method-POST">POST</span>
        </div>
        <code class="path">/cal/schedule</code>
        <div class="params">
          <label>phone</label>
          <input class="phone-input" type="text" data-param="phone" placeholder="8432222986" />
          <label>name</label>
          <input type="text" data-param="name" placeholder="Test Guest" />
          <label>email</label>
          <input type="text" data-param="email" placeholder="test@example.com" />
          <label>startTime</label>
          <input type="datetime-local" data-param="startTime" />
          <label>conversationId (optional)</label>
          <input type="text" data-param="conversationId" placeholder="appt_test_xyz" />
        </div>
        <div class="actions">
          <button onclick="runCalSchedule(this)">Book</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

      <div class="endpoint-card" data-id="cal-cancel">
        <div class="ep-head">
          <div>
            <div class="ep-title">Cancel Cal.com appointment <span class="tag">NEW</span></div>
            <div class="ep-desc">Cancels SMS injection (always) + Cal.com booking (if bookingUid given). Logs SCRUB event.</div>
          </div>
          <span class="ep-method method-POST">POST</span>
        </div>
        <code class="path">/cal/delete-scheduled-injection</code>
        <div class="params">
          <label>phone</label>
          <input class="phone-input" type="text" data-param="phone" placeholder="8432222986" />
          <label>bookingUid (optional — paste the uid from Book response)</label>
          <input type="text" data-param="bookingUid" placeholder="abc123" />
        </div>
        <div class="actions">
          <button onclick="runCalCancel(this)">Cancel</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

    </div>
  </div>

  <!-- ============ 3. DISPOSITION / HOT-PATH ============ -->
  <div class="section">
    <h2>📞 Disposition / Hot-path</h2>
    <div class="grid">

      <div class="endpoint-card" data-id="dispo">
        <div class="ep-head">
          <div>
            <div class="ep-title">Post-call disposition</div>
            <div class="ep-desc">Sale=no-op, ODR=return-to-source, else recycle.</div>
          </div>
          <span class="ep-method method-POST">POST</span>
        </div>
        <code class="path">/sms-callback/disposition</code>
        <div class="params">
          <label>phone</label>
          <input class="phone-input" type="text" data-param="phone" placeholder="8432222986" />
          <label>disposition</label>
          <select data-param="disposition">
            <option>Not Interested</option><option>No Answer</option>
            <option>sale</option><option>booked</option>
          </select>
          <label>campaign_name</label>
          <input type="text" data-param="campaign_name" value="ODR_Auto_Return" />
        </div>
        <div class="actions">
          <button onclick="runDispo(this)">Send</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

      <div class="endpoint-card" data-id="talk-now">
        <div class="ep-head">
          <div>
            <div class="ep-title">Talk-now (immediate ODR inject)</div>
            <div class="ep-desc">Scrubs source, injects into ODR Appointments now.</div>
          </div>
          <span class="ep-method method-POST">POST</span>
        </div>
        <code class="path">/sms-callback/bland/talk-now</code>
        <div class="params">
          <label>phone</label>
          <input class="phone-input" type="text" data-param="phone" placeholder="8432222986" />
        </div>
        <div class="actions">
          <button onclick="runTalkNow(this)">Fire</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

      <div class="endpoint-card" data-id="return-to-source">
        <div class="ep-head">
          <div>
            <div class="ep-title">Return to source</div>
            <div class="ep-desc">Scrub ODR, inject back to original campaign.</div>
          </div>
          <span class="ep-method method-POST">POST</span>
        </div>
        <code class="path">/sms-callback/return-to-source</code>
        <div class="params">
          <label>phone</label>
          <input class="phone-input" type="text" data-param="phone" placeholder="8432222986" />
        </div>
        <div class="actions">
          <button onclick="runReturnToSource(this)">Fire</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

    </div>
  </div>

  <!-- ============ 4. STOP / DNC ============ -->
  <div class="section">
    <h2>🛑 STOP / Opt-out</h2>
    <div class="grid">
      <div class="endpoint-card" data-id="stop">
        <div class="ep-head">
          <div>
            <div class="ep-title">STOP request</div>
            <div class="ep-desc">Marks DNC in Firestore + DNCs across all 5 ReadyMode domains.</div>
          </div>
          <span class="ep-method method-POST">POST</span>
        </div>
        <code class="path">/sms-callback/stop</code>
        <div class="params">
          <label>phone</label>
          <input class="phone-input" type="text" data-param="phone" placeholder="8432222986" />
        </div>
        <div class="actions">
          <button onclick="runStop(this)">Send STOP</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>
    </div>
  </div>

  <!-- ============ 5. INSPECT STATE ============ -->
  <div class="section">
    <h2>🔍 Inspect state (read-only)</h2>
    <div class="grid">

      <div class="endpoint-card" data-id="convo-search">
        <div class="ep-head">
          <div>
            <div class="ep-title">Conversation messages</div>
            <div class="ep-desc">All Bland-stored messages for this phone.</div>
          </div>
          <span class="ep-method method-GET">GET</span>
        </div>
        <code class="path">/api/conversations/search2?phone=…</code>
        <div class="params">
          <label>phone</label>
          <input class="phone-input" type="text" data-param="phone" placeholder="8432222986" />
        </div>
        <div class="actions">
          <button onclick="runConvoSearch(this)">Fetch</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

      <div class="endpoint-card" data-id="pointer">
        <div class="ep-head">
          <div>
            <div class="ep-title">Lead pointer</div>
            <div class="ep-desc">Current and original ReadyMode location.</div>
          </div>
          <span class="ep-method method-GET">GET</span>
        </div>
        <code class="path">/sms-flow/orchestrator/pointer/{phone}</code>
        <div class="params">
          <label>phone</label>
          <input class="phone-input" type="text" data-param="phone" placeholder="8432222986" />
        </div>
        <div class="actions">
          <button onclick="runPointer(this)">Fetch</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

      <div class="endpoint-card" data-id="events">
        <div class="ep-head">
          <div>
            <div class="ep-title">Orchestrator events</div>
            <div class="ep-desc">Audit trail of inject/scrub/dnc events.</div>
          </div>
          <span class="ep-method method-GET">GET</span>
        </div>
        <code class="path">/sms-flow/orchestrator/events/{phone}</code>
        <div class="params">
          <label>phone</label>
          <input class="phone-input" type="text" data-param="phone" placeholder="8432222986" />
        </div>
        <div class="actions">
          <button onclick="runEvents(this)">Fetch</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

      <div class="endpoint-card" data-id="state">
        <div class="ep-head">
          <div>
            <div class="ep-title">Config state</div>
            <div class="ep-desc">sms-bot/config/settings/state doc. (no phone)</div>
          </div>
          <span class="ep-method method-GET">GET</span>
        </div>
        <code class="path">/api/state</code>
        <div class="actions">
          <button onclick="runState(this)">Fetch</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

    </div>
  </div>

  <!-- ============ 6. MISC WRITES ============ -->
  <div class="section">
    <h2>📊 Misc writes</h2>
    <div class="grid">

      <div class="endpoint-card" data-id="answered">
        <div class="ep-head">
          <div>
            <div class="ep-title">Mark guest answered</div>
            <div class="ep-desc">Writes guestanswered/byPhone/{phone10}.</div>
          </div>
          <span class="ep-method method-POST">POST</span>
        </div>
        <code class="path">/api/guests/answered</code>
        <div class="params">
          <label>phone</label>
          <input class="phone-input" type="text" data-param="phone" placeholder="8432222986" />
        </div>
        <div class="actions">
          <button onclick="runAnswered(this)">Mark answered</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

      <div class="endpoint-card" data-id="store-bland-message">
        <div class="ep-head">
          <div>
            <div class="ep-title">Store Bland message <span class="tag">NEW</span></div>
            <div class="ep-desc">Simulates a Bland conversation-message webhook. Writes to conversations/messages + the callId→phone lookup index.</div>
          </div>
          <span class="ep-method method-POST">POST</span>
        </div>
        <code class="path">/sms-callback/conversation/{phone}/{callId}</code>
        <div class="params">
          <label>phone</label>
          <input class="phone-input" type="text" data-param="phone" placeholder="8432222986" />
          <label>callId</label>
          <input type="text" data-param="callId" placeholder="convo_test_xyz" />
          <label>sender</label>
          <select data-param="sender">
            <option>Guest</option>
            <option>AI Bot</option>
          </select>
          <label>message</label>
          <textarea data-param="message" rows="2" placeholder="testing reply">testing reply</textarea>
          <label>nodeTag (optional)</label>
          <input type="text" data-param="nodeTag" placeholder="appointment scheduled" />
          <label class="checkbox-label"><input type="checkbox" data-param="doNotText" /> doNotText (also marks DNC + ReadyMode opt-out)</label>
        </div>
        <div class="actions">
          <button onclick="runStoreBlandMessage(this)">Store</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

      <div class="endpoint-card" data-id="sales-record">
        <div class="ep-head">
          <div>
            <div class="ep-title">Manual sale match</div>
            <div class="ep-desc">Single-phone variant of the daily QB cron.</div>
          </div>
          <span class="ep-method method-POST">POST</span>
        </div>
        <code class="path">/api/sales/record</code>
        <div class="params">
          <label>phone</label>
          <input class="phone-input" type="text" data-param="phone" placeholder="8432222986" />
        </div>
        <div class="actions">
          <button onclick="runSalesRecord(this)">Match</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

    </div>
  </div>

  <!-- ============ 7. CRON / BATCH ============ -->
  <div class="section">
    <h2>⚙️ Cron / Batch (no phone needed)</h2>
    <div class="grid">

      <div class="endpoint-card" data-id="cron-sweep">
        <div class="ep-head">
          <div>
            <div class="ep-title">Scheduled-injection sweep</div>
            <div class="ep-desc">Fires every scheduled injection whose eventTime ≤ now.</div>
          </div>
          <span class="ep-method method-GET">GET</span>
        </div>
        <code class="path">/api/cron/trigger</code>
        <div class="actions">
          <button onclick="runCronSweep(this)">Sweep now</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

      <div class="endpoint-card" data-id="activate-from-report">
        <div class="ep-head">
          <div>
            <div class="ep-title">Daily QB sale-match cron</div>
            <div class="ep-desc">Pulls bookings from Quickbase, matches against scheduled injections. Leave reportId blank to use default (530).</div>
          </div>
          <span class="ep-method method-POST">POST</span>
        </div>
        <code class="path">/api/guests/activate-from-report</code>
        <div class="row">
          <label>reportId<input type="text" data-input="reportId" placeholder="number only — e.g. 678 — blank uses 530"></label>
          <label class="checkbox-label"><input type="checkbox" data-input="verbose"> verbose (include all skippedNoInjection phones — large response)</label>
        </div>
        <div class="actions">
          <button onclick="runActivateFromReport(this)">Run cron</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

      <div class="endpoint-card" data-id="cron-config" style="grid-column: 1 / -1">
        <div class="ep-head">
          <div>
            <div class="ep-title">⚙️ Cron Config <span class="tag">live-edit</span></div>
            <div class="ep-desc">Live-editable settings for the daily QB sale-match cron + nightly Postmark report. Schedule times are display-only (Deno.cron registers at deploy time — code change required to move them).</div>
          </div>
          <span class="ep-method method-GET">GET/POST</span>
        </div>
        <code class="path">/api/config/cron</code>
        <div id="cronConfigBody" class="params" style="margin-top:10px">
          <div class="muted">Click Load to fetch current config…</div>
        </div>
        <div class="actions" style="margin-top:10px;flex-wrap:wrap;gap:10px">
          <button onclick="loadCronConfig(this)">Load Config</button>
          <button onclick="saveCronConfig(this)">💾 Save</button>
          <button onclick="sendReportNow(this)" class="secondary">📧 Send Report Now</button>
          <button onclick="runQbCronNow(this)" class="secondary">▶️ Run QB Cron Now</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

      <div class="endpoint-card" data-id="bland-list-today">
        <div class="ep-head">
          <div>
            <div class="ep-title">Bland: list today's conversations</div>
            <div class="ep-desc">Sanity check that BLAND_API_KEY is good.</div>
          </div>
          <span class="ep-method method-GET">GET</span>
        </div>
        <code class="path">/sms-callback/list-today</code>
        <div class="actions">
          <button onclick="runListToday(this)">Fetch</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

      <div class="endpoint-card" data-id="dashboard-stats">
        <div class="ep-head">
          <div>
            <div class="ep-title">Dashboard stats</div>
            <div class="ep-desc">Firestore round-trip sanity check (lists every container).</div>
          </div>
          <span class="ep-method method-GET">GET</span>
        </div>
        <code class="path">/api/dashboard/stats</code>
        <div class="actions">
          <button onclick="runDashboardStats(this)">Fetch</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

      <div class="endpoint-card" data-id="sms-count">
        <div class="ep-head">
          <div>
            <div class="ep-title">Today's SMS count</div>
            <div class="ep-desc">Token-gated. Reads sms-bot/globalsmscount/byDate/today.</div>
          </div>
          <span class="ep-method method-POST">POST</span>
        </div>
        <code class="path">/api/sms/count</code>
        <div class="actions">
          <button onclick="runSmsCount(this)">Fetch</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

    </div>
  </div>

  <!-- ============ 8. CLEANUP (DANGEROUS) ============ -->
  <div class="section">
    <h2>🧹 Cleanup <span class="tag">IRREVERSIBLE</span></h2>
    <div class="danger-banner">These wipe Firestore docs and call ReadyMode TPI. Use only on test phones.</div>
    <div class="grid">

      <div class="endpoint-card danger" data-id="cleanup">
        <div class="ep-head">
          <div>
            <div class="ep-title">Full reset for phone</div>
            <div class="ep-desc">Deletes context, conversations, pointer, ratelimit, scheduled injection. Scrubs ODR.</div>
          </div>
          <span class="ep-method method-DELETE">DELETE</span>
        </div>
        <code class="path">/sms-callback/cleanup</code>
        <div class="params">
          <label>phone</label>
          <input class="phone-input" type="text" data-param="phone" placeholder="8432222986" />
        </div>
        <div class="actions">
          <button onclick="runCleanup(this)">Wipe everything</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

      <div class="endpoint-card danger" data-id="delete-history">
        <div class="ep-head">
          <div>
            <div class="ep-title">Delete conversation history</div>
            <div class="ep-desc">Wipes all Bland message records for this phone.</div>
          </div>
          <span class="ep-method method-DELETE">DELETE</span>
        </div>
        <code class="path">/sms-callback/conversation-history</code>
        <div class="params">
          <label>phone</label>
          <input class="phone-input" type="text" data-param="phone" placeholder="8432222986" />
        </div>
        <div class="actions">
          <button onclick="runDeleteHistory(this)">Delete</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

      <div class="endpoint-card danger" data-id="cancel-injection">
        <div class="ep-head">
          <div>
            <div class="ep-title">Cancel scheduled injection</div>
            <div class="ep-desc">Removes the scheduledinjections/byPhone/{phone10} doc.</div>
          </div>
          <span class="ep-method method-DELETE">DELETE</span>
        </div>
        <code class="path">/api/injection/cancel?phone=…</code>
        <div class="params">
          <label>phone</label>
          <input class="phone-input" type="text" data-param="phone" placeholder="8432222986" />
        </div>
        <div class="actions">
          <button onclick="runCancelInjection(this)">Cancel</button>
          <span class="status muted"></span>
        </div>
        <div class="resp"><pre></pre></div>
      </div>

    </div>
  </div>

</div>

<script>
// ===================== Helpers =====================
function normPhone(raw){
  if(!raw) return null;
  const d = String(raw).replace(/\\D/g, "");
  if(d.length === 10) return d;
  if(d.length === 11 && d.startsWith("1")) return d.slice(1);
  return null;
}
// Read phone from a card's own input. Falls back to the global phone if the
// card field is blank. Alerts on invalid input.
function getCardPhone(card){
  const cardInput = card.querySelector('[data-param="phone"]');
  const raw = (cardInput && cardInput.value) || document.getElementById("globalPhone").value;
  const p = normPhone(raw);
  if(!p){ alert("Enter a valid 10-digit phone in this card or in the top bar."); return null; }
  return p;
}
function param(card, name){
  const el = card.querySelector('[data-param="'+name+'"]');
  if(!el) return null;
  let v = el.value;
  if(!v && el.placeholder) v = el.placeholder; // fall back to placeholder so resID etc. default
  return v;
}
function showResp(card, status, ms, body){
  const resp = card.querySelector(".resp");
  const pre = resp.querySelector("pre");
  const stat = card.querySelector(".actions .status");
  resp.classList.add("show");
  let cls = "muted";
  if(status >= 200 && status < 300) cls = "status-2xx";
  else if(status >= 400 && status < 500) cls = "status-4xx";
  else if(status >= 500) cls = "status-5xx";
  stat.className = "status " + cls;
  stat.textContent = status + " · " + ms + "ms";
  let pretty;
  try { pretty = JSON.stringify(body, null, 2); } catch { pretty = String(body); }
  pre.textContent = pretty;
}
function showError(card, err){
  const resp = card.querySelector(".resp");
  const pre = resp.querySelector("pre");
  const stat = card.querySelector(".actions .status");
  resp.classList.add("show");
  stat.className = "status status-5xx";
  stat.textContent = "FETCH FAIL";
  pre.textContent = String(err && err.message ? err.message : err);
}
async function runRequest(card, opts){
  const btn = card.querySelector("button");
  btn.disabled = true;
  const stat = card.querySelector(".actions .status");
  stat.className = "status muted";
  stat.textContent = "running...";
  const t0 = performance.now();
  try {
    const res = await fetch(opts.url, {
      method: opts.method || "GET",
      headers: opts.headers || {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const ms = Math.round(performance.now() - t0);
    let body;
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = text; }
    showResp(card, res.status, ms, body);
  } catch(err){
    showError(card, err);
  } finally {
    btn.disabled = false;
  }
}
function clearAllResponses(){
  document.querySelectorAll(".endpoint-card .resp").forEach(r => {
    r.classList.remove("show");
    r.querySelector("pre").textContent = "";
  });
  document.querySelectorAll(".endpoint-card .actions .status").forEach(s => {
    s.className = "status muted";
    s.textContent = "";
  });
}

// ===================== Persistence =====================
// Global "fill all" phone input. Typing here populates every card's phone.
const globalPhoneEl = document.getElementById("globalPhone");
globalPhoneEl.value = localStorage.getItem("test.globalPhone") || "";
globalPhoneEl.addEventListener("input", () => {
  localStorage.setItem("test.globalPhone", globalPhoneEl.value);
  document.querySelectorAll('.endpoint-card [data-param="phone"]').forEach(el => {
    el.value = globalPhoneEl.value;
    const cardId = el.closest(".endpoint-card").dataset.id;
    localStorage.setItem("test.phone." + cardId, globalPhoneEl.value);
  });
});

// Per-card phone persistence: hydrate from localStorage (or global), write on edit.
document.querySelectorAll('.endpoint-card [data-param="phone"]').forEach(el => {
  const cardId = el.closest(".endpoint-card").dataset.id;
  el.value = localStorage.getItem("test.phone." + cardId) ||
             localStorage.getItem("test.globalPhone") || "";
  el.addEventListener("input", () => {
    localStorage.setItem("test.phone." + cardId, el.value);
  });
});

// Default datetime-local values to "now + 2 minutes" so scheduling works out of the box
function defaultDateTimeLocal(plusMinutes){
  const d = new Date(Date.now() + (plusMinutes||0) * 60000);
  const pad = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()) +
    "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}
document.querySelectorAll('input[type="datetime-local"]').forEach(el => {
  el.value = defaultDateTimeLocal(2);
});

// ===================== Section 1: Trigger =====================
function getCheckbox(card, name){
  const el = card.querySelector('[data-param="'+name+'"]');
  return !!(el && el.checked);
}
async function runTriggerManual(btn){
  const card = btn.closest(".endpoint-card");
  const phone = getCardPhone(card); if(!phone) return;
  const override = getCheckbox(card, "override");
  const msg = override
    ? "OVERRIDE=true: this BYPASSES every gatekeeper and uses a stub guest if Quickbase isn't wired. Real SMS to " + phone + ". Continue?"
    : "This goes through the normal gatekeepers (CRM lookup required). Real SMS to " + phone + " if all gates pass. Continue?";
  if(!confirm(msg)) return;
  await runRequest(card, {
    method: "POST", url: "/trigger/manual",
    headers: { "content-type": "application/json" },
    body: {
      phone,
      resID: param(card,"resID"),
      domain: param(card,"domain"),
      attempts: 99,
      override,
    },
  });
}
async function runCustomSms(btn){
  const card = btn.closest(".endpoint-card");
  const phone = getCardPhone(card); if(!phone) return;
  const message = param(card, "message");
  if(!message || !message.trim()){ alert("Type a message body first."); return; }
  if(!confirm("Send this exact text to " + phone + "?\\n\\n" + message)) return;
  await runRequest(card, {
    method: "POST", url: "/trigger/test-sms",
    headers: { "content-type": "application/json" },
    body: { phone, message },
  });
}
async function runTriggerReadymode(btn){
  const card = btn.closest(".endpoint-card");
  const phone = getCardPhone(card); if(!phone) return;
  const override = getCheckbox(card, "override");
  const msg = override
    ? "OVERRIDE=true: bypasses every gatekeeper. Real SMS to " + phone + ". Continue?"
    : "FULL gatekeeper path: needs attempts ≥ 40, DNC clear, CRM lookup. Real SMS to " + phone + " if all gates pass. Continue?";
  if(!confirm(msg)) return;
  await runRequest(card, {
    method: "POST", url: "/trigger/readymode",
    headers: { "content-type": "application/json" },
    body: {
      phone,
      resID: param(card,"resID"),
      domain: param(card,"domain"),
      attempts: Number(param(card,"attempts")),
      override,
    },
  });
}

// ===================== Section 2: Appointment =====================
async function runApptBooked(btn){
  const card = btn.closest(".endpoint-card");
  const phone = getCardPhone(card); if(!phone) return;
  const local = param(card, "event_time");
  const event_time = local ? new Date(local).toISOString() : new Date(Date.now()+120000).toISOString();
  await runRequest(card, {
    method: "POST", url: "/sms-callback/appointment-booked",
    headers: { "content-type": "application/json" },
    body: { phone, event_time },
  });
}
async function runCronTriggerSingle(btn){
  const card = btn.closest(".endpoint-card");
  const phone = getCardPhone(card); if(!phone) return;
  await runRequest(card, { method: "GET", url: "/api/cron/trigger-single?phone=" + encodeURIComponent(phone) });
}
async function runInjectionSchedule(btn){
  const card = btn.closest(".endpoint-card");
  const phone = getCardPhone(card); if(!phone) return;
  const local = param(card, "eventTime");
  const eventTime = local ? new Date(local).toISOString() : new Date(Date.now()+120000).toISOString();
  await runRequest(card, {
    method: "POST", url: "/api/injection/schedule",
    headers: { "content-type": "application/json" },
    body: { phone, eventTime, isTest: param(card,"isTest") === "true" },
  });
}
async function runCalAvailableTimes(btn){
  const card = btn.closest(".endpoint-card");
  await runRequest(card, {
    method: "POST", url: "/cal/available-times",
    headers: { "content-type": "application/json" },
    body: {},
  });
}
async function runCalSchedule(btn){
  const card = btn.closest(".endpoint-card");
  const phone = getCardPhone(card); if(!phone) return;
  const local = param(card, "startTime");
  const startTime = local ? new Date(local).toISOString() : new Date(Date.now()+120000).toISOString();
  const name = param(card, "name") || "Test Guest";
  const email = param(card, "email") || "test@example.com";
  const conversationId = param(card, "conversationId") || undefined;
  if(!confirm("Book a real Cal.com appointment for " + name + " (" + email + ") at " + startTime + "? An SMS injection will also be scheduled.")) return;
  await runRequest(card, {
    method: "POST", url: "/cal/schedule",
    headers: { "content-type": "application/json" },
    body: { phone, name, email, startTime, conversationId },
  });
}
async function runCalCancel(btn){
  const card = btn.closest(".endpoint-card");
  const phone = getCardPhone(card); if(!phone) return;
  const bookingUid = param(card, "bookingUid") || undefined;
  if(!confirm("Cancel the scheduled SMS injection for " + phone + (bookingUid ? " AND Cal.com booking " + bookingUid : "") + "?")) return;
  await runRequest(card, {
    method: "POST", url: "/cal/delete-scheduled-injection",
    headers: { "content-type": "application/json" },
    body: { phone, bookingUid },
  });
}

// ===================== Section 3: Disposition / Hot-path =====================
async function runDispo(btn){
  const card = btn.closest(".endpoint-card");
  const phone = getCardPhone(card); if(!phone) return;
  await runRequest(card, {
    method: "POST", url: "/sms-callback/disposition",
    headers: { "content-type": "application/json" },
    body: { phone, disposition: param(card,"disposition"), campaign_name: param(card,"campaign_name") },
  });
}
async function runTalkNow(btn){
  const card = btn.closest(".endpoint-card");
  const phone = getCardPhone(card); if(!phone) return;
  if(!confirm("This will inject " + phone + " into ODR Appointments NOW. Continue?")) return;
  await runRequest(card, {
    method: "POST", url: "/sms-callback/bland/talk-now",
    headers: { "content-type": "application/json" },
    body: { phone },
  });
}
async function runReturnToSource(btn){
  const card = btn.closest(".endpoint-card");
  const phone = getCardPhone(card); if(!phone) return;
  await runRequest(card, {
    method: "POST", url: "/sms-callback/return-to-source",
    headers: { "content-type": "application/json" },
    body: { phone },
  });
}

// ===================== Section 4: STOP =====================
async function runStop(btn){
  const card = btn.closest(".endpoint-card");
  const phone = getCardPhone(card); if(!phone) return;
  if(!confirm("This will mark " + phone + " as DNC across all 5 ReadyMode domains. Continue?")) return;
  await runRequest(card, {
    method: "POST", url: "/sms-callback/stop",
    headers: { "content-type": "application/json" },
    body: { phone },
  });
}

// ===================== Section 5: Inspect =====================
async function runConvoSearch(btn){
  const card = btn.closest(".endpoint-card");
  const phone = getCardPhone(card); if(!phone) return;
  await runRequest(card, { method: "GET", url: "/api/conversations/search2?phone=" + encodeURIComponent(phone) });
}
async function runPointer(btn){
  const card = btn.closest(".endpoint-card");
  const phone = getCardPhone(card); if(!phone) return;
  await runRequest(card, { method: "GET", url: "/sms-flow/orchestrator/pointer/" + encodeURIComponent(phone) });
}
async function runEvents(btn){
  const card = btn.closest(".endpoint-card");
  const phone = getCardPhone(card); if(!phone) return;
  await runRequest(card, { method: "GET", url: "/sms-flow/orchestrator/events/" + encodeURIComponent(phone) });
}
async function runState(btn){
  const card = btn.closest(".endpoint-card");
  await runRequest(card, { method: "GET", url: "/api/state" });
}

// ===================== Section 6: Misc =====================
async function runAnswered(btn){
  const card = btn.closest(".endpoint-card");
  const phone = getCardPhone(card); if(!phone) return;
  await runRequest(card, {
    method: "POST", url: "/api/guests/answered",
    headers: { "content-type": "application/json" },
    body: { phone },
  });
}
async function runStoreBlandMessage(btn){
  const card = btn.closest(".endpoint-card");
  const phone = getCardPhone(card); if(!phone) return;
  const callId = param(card, "callId");
  if(!callId || !callId.trim()){ alert("Type a callId first."); return; }
  const message = param(card, "message");
  if(!message || !message.trim()){ alert("Type a message first."); return; }
  const sender = param(card, "sender") || "Guest";
  const nodeTag = param(card, "nodeTag") || undefined;
  const doNotText = card.querySelector('[data-param="doNotText"]').checked;
  if(doNotText && !confirm("doNotText will mark the phone as DNC and opt them out of all 5 ReadyMode domains. Continue?")) return;
  const body = { sender, message, nodeTag };
  if(doNotText) body.doNotText = true;
  await runRequest(card, {
    method: "POST",
    url: "/sms-callback/conversation/" + encodeURIComponent(phone) + "/" + encodeURIComponent(callId),
    headers: { "content-type": "application/json" },
    body,
  });
}
async function runSalesRecord(btn){
  const card = btn.closest(".endpoint-card");
  const phone = getCardPhone(card); if(!phone) return;
  await runRequest(card, {
    method: "POST", url: "/api/sales/record",
    headers: { "content-type": "application/json" },
    body: { phone },
  });
}

// ===================== Section 7: Cron / Batch =====================
async function runCronSweep(btn){
  const card = btn.closest(".endpoint-card");
  await runRequest(card, { method: "GET", url: "/api/cron/trigger" });
}
async function runActivateFromReport(btn){
  const card = btn.closest(".endpoint-card");
  // Strip "reportId=" prefix if user copy-pasted it; keep digits only.
  const raw = card.querySelector('[data-input="reportId"]').value.trim();
  const reportId = raw.replace(/^reportId\s*=\s*/i, "").replace(/\D/g, "");
  const verbose = card.querySelector('[data-input="verbose"]').checked;
  if(!confirm("This pulls bookings from Quickbase report " + (reportId || "530 (default)") + " and writes saleswithin7d markers. Continue?")) return;
  const body = {};
  if(reportId) body.reportId = reportId;
  if(verbose) body.verbose = true;
  await runRequest(card, {
    method: "POST", url: "/api/guests/activate-from-report",
    headers: { "content-type": "application/json" },
    body,
  });
}
async function runListToday(btn){
  const card = btn.closest(".endpoint-card");
  await runRequest(card, { method: "GET", url: "/sms-callback/list-today" });
}

// ---- Cron Config ----
async function loadCronConfig(btn){
  const card = btn.closest(".endpoint-card");
  const body = card.querySelector("#cronConfigBody");
  body.innerHTML = '<div class="muted">Loading…</div>';
  try{
    const res = await fetch("/api/config/cron");
    const cfg = await res.json();
    if(!res.ok) throw new Error(cfg.error || "load failed");
    body.innerHTML = renderCronConfigForm(cfg);
  } catch(err){
    body.innerHTML = '<div class="error">Load failed: ' + escapeHtml(String(err.message || err)) + '</div>';
  }
}

function renderCronConfigForm(cfg){
  const r = cfg.report || {};
  const q = cfg.qbSaleMatch || {};
  return ''
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">'
    +   '<div>'
    +     '<h4 style="color:var(--accentHi);margin-bottom:8px">📧 Nightly Report</h4>'
    +     '<label>Recipients (comma-separated)<input type="text" data-cfg="report.recipients" value="' + escapeHtml(r.recipients || "") + '" placeholder="adamp@monsterrg.com, x@y.com"></label>'
    +     '<label>Subject Prefix<input type="text" data-cfg="report.subjectPrefix" value="' + escapeHtml(r.subjectPrefix || "") + '" placeholder="[REPORT]"></label>'
    +     '<label class="checkbox-label"><input type="checkbox" data-cfg="report.enabled"' + (r.enabled ? ' checked' : '') + '> Enabled (cron sends email)</label>'
    +     '<label>Schedule (display only)<input type="text" data-cfg="report.scheduleNote" value="' + escapeHtml(r.scheduleNote || "") + '"></label>'
    +     '<div class="muted small" style="margin-top:6px">⚠ Schedule changes require a code change in main.ts (Deno.cron registers at deploy).</div>'
    +   '</div>'
    +   '<div>'
    +     '<h4 style="color:var(--accentHi);margin-bottom:8px">🔄 QB Sale-Match</h4>'
    +     '<label>Report ID<input type="text" data-cfg="qbSaleMatch.reportId" value="' + escapeHtml(q.reportId || "") + '" placeholder="678"></label>'
    +     '<label>Table ID<input type="text" data-cfg="qbSaleMatch.tableId" value="' + escapeHtml(q.tableId || "") + '" placeholder="bpb28qsnn"></label>'
    +     '<label class="checkbox-label"><input type="checkbox" data-cfg="qbSaleMatch.enabled"' + (q.enabled ? ' checked' : '') + '> Enabled (cron pulls QB)</label>'
    +     '<label>Schedule (display only)<input type="text" data-cfg="qbSaleMatch.scheduleNote" value="' + escapeHtml(q.scheduleNote || "") + '"></label>'
    +   '</div>'
    + '</div>'
    + '<div class="muted small" style="margin-top:10px">Last saved: ' + escapeHtml(cfg.updatedAt || "(never)") + '</div>';
}

function readCronConfigForm(card){
  const out = { report: {}, qbSaleMatch: {} };
  card.querySelectorAll('[data-cfg]').forEach(function(el){
    const path = el.getAttribute("data-cfg").split(".");
    const val = el.type === "checkbox" ? el.checked : el.value;
    out[path[0]][path[1]] = val;
  });
  return out;
}

async function saveCronConfig(btn){
  const card = btn.closest(".endpoint-card");
  const payload = readCronConfigForm(card);
  if(!Object.keys(payload.report).length && !Object.keys(payload.qbSaleMatch).length){
    alert("Click Load first to fetch the current config.");
    return;
  }
  await runRequest(card, {
    method: "POST", url: "/api/config/cron",
    headers: { "content-type": "application/json" },
    body: payload,
  });
  // Re-render with the saved values.
  setTimeout(function(){ loadCronConfig(btn); }, 500);
}

async function sendReportNow(btn){
  if(!confirm("Send the nightly report email now using the saved config?")) return;
  const card = btn.closest(".endpoint-card");
  await runRequest(card, { method: "POST", url: "/api/report/nightly" });
}

async function runQbCronNow(btn){
  if(!confirm("Run the QB sale-match cron now using the saved config?")) return;
  const card = btn.closest(".endpoint-card");
  await runRequest(card, {
    method: "POST", url: "/api/guests/activate-from-report",
    headers: { "content-type": "application/json" },
    body: {},
  });
}
async function runDashboardStats(btn){
  const card = btn.closest(".endpoint-card");
  await runRequest(card, { method: "GET", url: "/api/dashboard/stats" });
}
async function runSmsCount(btn){
  const card = btn.closest(".endpoint-card");
  await runRequest(card, {
    method: "POST", url: "/api/sms/count",
    headers: { "content-type": "application/json" },
    body: {},
  });
}

// ===================== Section 8: Cleanup =====================
async function runCleanup(btn){
  const card = btn.closest(".endpoint-card");
  const phone = getCardPhone(card); if(!phone) return;
  if(!confirm("⚠️ IRREVERSIBLE: this will delete EVERY Firestore record for " + phone + " and scrub ODR. Continue?")) return;
  await runRequest(card, {
    method: "DELETE", url: "/sms-callback/cleanup",
    headers: { "content-type": "application/json" },
    body: { phone },
  });
}
async function runDeleteHistory(btn){
  const card = btn.closest(".endpoint-card");
  const phone = getCardPhone(card); if(!phone) return;
  if(!confirm("Delete ALL conversation history for " + phone + "?")) return;
  await runRequest(card, {
    method: "DELETE", url: "/sms-callback/conversation-history",
    headers: { "content-type": "application/json" },
    body: { phone },
  });
}
async function runCancelInjection(btn){
  const card = btn.closest(".endpoint-card");
  const phone = getCardPhone(card); if(!phone) return;
  await runRequest(card, {
    method: "DELETE", url: "/api/injection/cancel?phone=" + encodeURIComponent(phone),
  });
}
</script>
</body>
</html>`;

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
    <div class="stats-grid">
      <div class="stat-card clickable" id="textsSentCard" title="Click to view sent messages">
        <div style="display:flex;gap:16px">
          <div style="flex:1;border-right:1px solid rgba(42,59,54,.75);padding-right:16px">
            <div class="icon">📤</div>
            <div class="value" id="totalTexts">-</div>
            <div class="label">Total Texts</div>
            <div class="subvalue" id="totalTextsDetail">-</div>
          </div>
          <div style="flex:1">
            <div class="icon">🚀</div>
            <div class="value" id="initialTexts">-</div>
            <div class="label">Initial Texts Sent</div>
            <div class="subvalue" id="initialTextsDetail">First message to guest</div>
          </div>
        </div>
        <div class="hint">Click to drill in</div>
      </div>

      <div class="stat-card clickable" id="peopleRepliedCard" title="Click to view replies">
        <div class="icon">💬</div>
        <div class="value" id="peopleReplied">-</div>
        <div class="label">People Replied</div>
        <div class="subvalue" id="peopleRepliedDetail">-</div>
        <div class="hint">Click to drill in</div>
      </div>

      <div class="stat-card clickable" id="appointmentsCard" title="Click to view appointment entries">
        <div class="icon">📅</div>
        <div class="value" id="appointmentsSet">-</div>
        <div class="label">Appointments Booked</div>
        <div class="subvalue" id="appointmentsSetDetail">-</div>
        <div class="hint">Click to drill in</div>
      </div>

      <div class="stat-card">
        <div class="icon">🗄️</div>
        <div class="value" id="totalKvEntries">-</div>
        <div class="label">Total SMS Records</div>
        <div class="subvalue" id="totalKvDetail">-</div>
      </div>

      <div class="stat-card clickable" id="activatedCard" title="Click to view activated guests">
        <div class="icon">✅</div>
        <div class="value" id="activatedCount">-</div>
        <div class="label">Activated</div>
        <div class="subvalue" id="activatedDetail">Guests marked as sale via SHA match</div>
        <div class="hint">Click to drill in</div>
      </div>

      <div class="stat-card clickable" id="answeredCard" title="Click to view answered guests">
        <div class="icon">📞</div>
        <div class="value" id="answeredCount">-</div>
        <div class="label">Answered</div>
        <div class="subvalue" id="answeredDetail">Guests who answered the call</div>
        <div class="hint">Click to drill in</div>
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

  // Activated + Answered counts
  document.getElementById("activatedCount").textContent = (data.stats.activatedCount || 0).toLocaleString();
  document.getElementById("answeredCount").textContent = (data.stats.answeredCount || 0).toLocaleString();

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
  openOverlay();
  loadAppointments(apptPage);
});

function getCurrentFiltersForAppointments(){
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

function renderDrillTable(items, columns){
  if(!items || items.length === 0){
    drillEmpty.style.display = "block";
    return;
  }
  drillCountChip.textContent = items.length.toLocaleString() + " entries";
  var html = '<table class="table"><thead><tr>';
  columns.forEach(function(col){ html += '<th>' + col.label + '</th>'; });
  html += '</tr></thead><tbody>';
  items.forEach(function(item){
    html += '<tr>';
    columns.forEach(function(col){
      var val = col.render ? col.render(item) : escapeHtml(item[col.key] || "-");
      html += '<td' + (col.cls ? ' class="' + col.cls + '"' : '') + (col.style ? ' style="' + col.style + '"' : '') + '>' + val + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  drillContent.innerHTML = html;
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
    if(res.ok && data.success){
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

let token = localStorage.getItem("token") || "";
let me = JSON.parse(localStorage.getItem("me") || "null");

function $(id){ return document.getElementById(id); }

function setMsg(el, text, ok=true){
  el.className = ok ? "muted ok" : "muted err";
  el.textContent = text;
}

async function api(path, opts={}){
  const headers = opts.headers || {};
  headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Hata");
  return data;
}

function showLoggedIn(){
  $("loginCard").classList.add("hidden");
  $("mainCard").classList.remove("hidden");
  $("reportsCard").classList.remove("hidden");
  $("customersCard").classList.remove("hidden");
  $("opsCard").classList.remove("hidden");

  $("userPill").textContent = `Giriş: ${me?.name || "-"} (${me?.role || "-"})`;

  if (me?.role !== "ADMIN") {
    $("adminCustomerBox").style.display = "none";
  } else {
    $("adminCustomerBox").style.display = "block";
  }
}

function showLoggedOut(){
  $("loginCard").classList.remove("hidden");
  $("mainCard").classList.add("hidden");
  $("reportsCard").classList.add("hidden");
  $("customersCard").classList.add("hidden");
  $("opsCard").classList.add("hidden");
}

function fmt(n){
  const x = Number(n || 0);
  return x.toFixed(2);
}

function initDates(){
  const now = new Date();
  const today = now.toISOString().slice(0,10);
  const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);

  $("fromDate").value = first;
  $("toDate").value = today;
  $("ym").value = today.slice(0,7);

  $("ledgerDate").value = today;
  $("expDate").value = today;
  $("prodDate").value = today;
}

/* ======================================================
   FIRMA + ŞUBE YÜKLEME
====================================================== */
let companies = [];
let branches = [];

async function loadCompanies(){
  companies = await api("/companies");
  const sel = $("companySelect");
  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Firma seç...";
  sel.appendChild(opt0);

  for (const c of companies){
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = c.name;
    sel.appendChild(o);
  }
}

async function loadBranches(companyId){
  if (!companyId){
    branches = [];
    $("branchSelect").innerHTML = `<option value="">Önce firma seç...</option>`;
    renderBranchTable([]);
    return;
  }

  branches = await api(`/branches?companyId=${encodeURIComponent(companyId)}`);
  const sel = $("branchSelect");
  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Şube seç...";
  sel.appendChild(opt0);

  for (const b of branches){
    const o = document.createElement("option");
    o.value = b.id;
    o.textContent = b.full_name || b.name;
    sel.appendChild(o);
  }

  // Şube bakiyelerini de gösterelim
  try{
    const bals = await api(`/balances/branches?companyId=${encodeURIComponent(companyId)}`);
    const map = new Map(bals.map(x => [x.id, x.balance]));
    renderBranchTable(branches.map(b => ({...b, balance: map.get(b.id) ?? 0})));
  }catch{
    renderBranchTable(branches);
  }
}

function renderBranchTable(rows){
  const tb = $("custBody");
  tb.innerHTML = "";
  for (const b of rows){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${b.id}</td>
      <td>${b.full_name || b.name}</td>
      <td>${b.phone || ""}</td>
      <td class="muted">—</td>
      <td>${fmt(b.balance || 0)}</td>
      <td class="muted">Satış için şube seç</td>
    `;
    tr.addEventListener("click", () => {
      // tıklayınca şubeyi seç
      $("branchSelect").value = b.id;
      $("ledgerBranchId").value = b.id;
      setMsg($("custMsg"), `Seçildi: ${b.full_name || b.name} (Şube ID ${b.id})`, true);
    });
    tb.appendChild(tr);
  }
  setMsg($("custMsg"), `Şubeler yüklendi (${rows.length}).`, true);
}

/* ======================================================
   RAPORLAR (bugün / aralık / ay) + breakdown varsa yazdır
====================================================== */
function renderBreakdown(r){
  if (!r?.breakdown) return "";
  const bc = r.breakdown.byCompany || [];
  const bb = r.breakdown.byBranch || [];

  let out = "\n--- FİRMA TOPLAMLARI ---\n";
  for (const x of bc){
    out += `${x.company_name}: Satış ${fmt(x.sales)} | Tahsilat ${fmt(Math.abs(x.payments))} | İade ${fmt(Math.abs(x.returns))} | Net ${fmt(x.net)}\n`;
  }

  out += "\n--- ŞUBE TOPLAMLARI ---\n";
  for (const x of bb){
    out += `${x.full_name}: Satış ${fmt(x.sales)} | Tahsilat ${fmt(Math.abs(x.payments))} | İade ${fmt(Math.abs(x.returns))} | Net ${fmt(x.net)}\n`;
  }
  return out;
}

async function reportToday(){
  const r = await api("/reports/today");
  $("reportOut").textContent =
`BUGÜN RAPORU
SATIŞ: ${fmt(r.sales)}
TAHSİLAT: ${fmt(Math.abs(r.payments))}
İADE: ${fmt(Math.abs(r.returns))}
GİDER: ${fmt(r.expenses)}
ÜRETİM (paket): ${fmt(r.productionPacks)}
${renderBreakdown(r)}
`;
}

async function reportRange(){
  const from = $("fromDate").value;
  const to = $("toDate").value;
  const r = await api(`/reports/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  $("reportOut").textContent =
`RAPOR (${r.from} → ${r.to})
SATIŞ: ${fmt(r.sales)}
TAHSİLAT: ${fmt(Math.abs(r.payments))}
İADE: ${fmt(Math.abs(r.returns))}
GİDER: ${fmt(r.expenses)}
ÜRETİM (paket): ${fmt(r.productionPacks)}
${renderBreakdown(r)}
`;
}

async function reportMonth(){
  const ym = $("ym").value;
  const r = await api(`/reports/month?ym=${encodeURIComponent(ym)}`);
  $("reportOut").textContent =
`AY RAPORU (${r.from} → ${r.to})
SATIŞ: ${fmt(r.sales)}
TAHSİLAT: ${fmt(Math.abs(r.payments))}
İADE: ${fmt(Math.abs(r.returns))}
GİDER: ${fmt(r.expenses)}
ÜRETİM (paket): ${fmt(r.productionPacks)}
${renderBreakdown(r)}
`;
}

/* ======================================================
   İŞLEMLER (SALE / PAYMENT / RETURN / DEBIT / CASH_SALE)
====================================================== */
function ledgerModeUI(){
  const type = $("ledgerType").value;

  // alanlar
  const packsRow = $("ledgerPacksRow");
  const amountRow = $("ledgerAmountRow");

  // varsayılan
  packsRow.style.display = "none";
  amountRow.style.display = "none";

  if (type === "SALE" || type === "RETURN" || type === "CASH_SALE") {
    packsRow.style.display = "block";
  }
  if (type === "PAYMENT" || type === "DEBIT") {
    amountRow.style.display = "block";
  }
}

async function saveLedger(){
  const uiType = $("ledgerType").value; // SALE/PAYMENT/RETURN/DEBIT/CASH_SALE
  const branchId = Number($("ledgerBranchId").value || 0);
  const packs = Number($("ledgerPacks").value || 0);
  const amount = Number($("ledgerAmount").value || 0);
  const note = $("ledgerNote").value || null;
  const entryDate = $("ledgerDate").value || null;

  if (!branchId) return alert("Firma + Şube seç");

  if (uiType === "PAYMENT" && amount <= 0) return alert("Tahsilat tutarı gir");
  if (uiType === "DEBIT" && amount <= 0) return alert("Alacak (veresiye) tutarı gir");
  if ((uiType === "SALE" || uiType === "RETURN" || uiType === "CASH_SALE") && packs <= 0) return alert("Paket gir");

  // 1) normal tipler
  if (uiType === "SALE" || uiType === "RETURN" || uiType === "PAYMENT" || uiType === "DEBIT"){
    await api("/ledger", {
      method:"POST",
      body: JSON.stringify({
        type: uiType,
        branchId,
        packs,
        amount,
        note,
        entryDate
      })
    });
  }

  // 2) peşin satış = SALE + PAYMENT aynı tutar
  if (uiType === "CASH_SALE"){
    // önce satış
    const sale = await api("/ledger", {
      method:"POST",
      body: JSON.stringify({
        type: "SALE",
        branchId,
        packs,
        note: note ? `Peşin Satış: ${note}` : "Peşin Satış",
        entryDate
      })
    });

    // sonra tahsilat (satış tutarı kadar)
    await api("/ledger", {
      method:"POST",
      body: JSON.stringify({
        type: "PAYMENT",
        branchId,
        amount: Math.abs(Number(sale.amount || 0)),
        note: note ? `Peşin Tahsilat: ${note}` : "Peşin Tahsilat",
        entryDate
      })
    });
  }

  setMsg($("opMsg"), "İşlem kaydedildi ✅", true);

  // yenile
  await reportToday();

  // şube listesini yeniden çek (bakiyeler güncellensin)
  const companyId = $("companySelect").value;
  if (companyId) await loadBranches(companyId);
}

/* ======================================================
   GİDER / ÜRETİM
====================================================== */
async function saveExpense(){
  const amount = Number($("expAmount").value || 0);
  const note = $("expNote").value || "";
  const entryDate = $("expDate").value || null;
  if (amount <= 0) return alert("Gider tutarı gir");

  await api("/expenses", {
    method:"POST",
    body: JSON.stringify({ amount, note, entryDate })
  });

  setMsg($("opMsg"), "Gider kaydedildi ✅", true);
  await reportToday();
}

async function saveProd(){
  const packs = Number($("prodPacks").value || 0);
  const note = $("prodNote").value || null;
  const entryDate = $("prodDate").value || null;
  if (packs <= 0) return alert("Üretim paket gir");

  await api("/production", {
    method:"POST",
    body: JSON.stringify({ packs, note, entryDate })
  });

  setMsg($("opMsg"), "Üretim kaydedildi ✅", true);
  await reportToday();
}

/* ======================================================
   LOGIN / LOGOUT
====================================================== */
async function login(){
  try{
    const pin = $("pin").value;
    const r = await api("/auth/login", {
      method:"POST",
      body: JSON.stringify({ pin })
    });
    token = r.token;
    me = r.user;
    localStorage.setItem("token", token);
    localStorage.setItem("me", JSON.stringify(me));

    setMsg($("loginMsg"), "Giriş başarılı ✅", true);
    showLoggedIn();
    initDates();

    // firma/şube load
    await loadCompanies();
    await loadBranches("");

    await reportToday();
  }catch(e){
    setMsg($("loginMsg"), e.message, false);
  }
}

function logout(){
  token = "";
  me = null;
  localStorage.removeItem("token");
  localStorage.removeItem("me");
  showLoggedOut();
}

/* ======================================================
   LOAD
====================================================== */
window.addEventListener("load", async () => {
  $("btnLogin").addEventListener("click", login);
  $("btnLogout").addEventListener("click", logout);

  // Firma seçilince şubeleri yükle
  $("companySelect").addEventListener("change", async () => {
    const companyId = $("companySelect").value;
    $("ledgerBranchId").value = "";
    $("branchSelect").value = "";
    await loadBranches(companyId);
  });

  // Şube seçilince ledgerBranchId doldur
  $("branchSelect").addEventListener("change", () => {
    $("ledgerBranchId").value = $("branchSelect").value || "";
  });

  // işlem tipi UI
  $("ledgerType").addEventListener("change", ledgerModeUI);
  ledgerModeUI();

  // raporlar
  $("btnToday").addEventListener("click", async () => {
    try { await reportToday(); } catch(e){ alert(e.message); }
  });
  $("btnRange").addEventListener("click", async () => {
    try { await reportRange(); } catch(e){ alert(e.message); }
  });
  $("btnMonth").addEventListener("click", async () => {
    try { await reportMonth(); } catch(e){ alert(e.message); }
  });

  // işlemler
  $("btnLedger").addEventListener("click", async () => {
    try { await saveLedger(); } catch(e){ alert(e.message); }
  });
  $("btnExpense").addEventListener("click", async () => {
    try { await saveExpense(); } catch(e){ alert(e.message); }
  });
  $("btnProd").addEventListener("click", async () => {
    try { await saveProd(); } catch(e){ alert(e.message); }
  });

  // token varsa aç
  if (token && me) {
    showLoggedIn();
    initDates();
    try {
      await loadCompanies();
      await loadBranches("");
      await reportToday();
    } catch (e) {
      logout();
    }
  } else {
    showLoggedOut();
  }
});

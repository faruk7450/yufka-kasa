// ===============================
// AUTH STATE
// ===============================
let token = localStorage.getItem("token") || "";
let me = JSON.parse(localStorage.getItem("me") || "null");

// ===============================
// HELPERS
// ===============================
function $(id){ return document.getElementById(id); }

function todayYMD(){
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10); // yyyy-mm-dd
}

function setMsg(el, text, ok=true){
  if (!el) return;
  el.className = ok ? "muted ok" : "muted err";
  el.textContent = text;
}

// UI’de bazen opMsg bazen opsMsg var diye ikisini de destekleyelim
function setAnyMsg(text, ok=true){
  setMsg($("opMsg"), text, ok);
  setMsg($("opsMsg"), text, ok);
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

function fmt(n){
  const x = Number(n || 0);
  return x.toFixed(2);
}

// ===============================
// UI SHOW/HIDE
// ===============================
function showLoggedIn(){
  $("loginCard")?.classList.add("hidden");
  $("mainCard")?.classList.remove("hidden");
  $("reportsCard")?.classList.remove("hidden");
  $("opsCard")?.classList.remove("hidden");

  if ($("userPill")) $("userPill").textContent = `Giriş: ${me?.name || "-"} (${me?.role || "-"})`;

  if (me?.role === "ADMIN") $("adminCard")?.classList.remove("hidden");
  else $("adminCard")?.classList.add("hidden");
}

function showLoggedOut(){
  $("loginCard")?.classList.remove("hidden");
  $("mainCard")?.classList.add("hidden");
  $("reportsCard")?.classList.add("hidden");
  $("opsCard")?.classList.add("hidden");
  $("adminCard")?.classList.add("hidden");
}

function initDates(){
  const ymd = todayYMD();

  // işlem tarihleri
  ["ledgerDate","expDate","prodDate"].forEach(id=>{
    const el = $(id);
    if (el) el.value = ymd;
  });

  // rapor tarihleri
  if ($("fromDate")) $("fromDate").value = ymd;
  if ($("toDate")) $("toDate").value = ymd;

  // aylık yyyy-mm
  if ($("ym")) $("ym").value = ymd.slice(0,7);
}

// ===============================
// DATA LOAD
// ===============================
let companies = [];
let branches = [];

async function loadCompanies(){
  companies = await api("/companies");

  const sel = $("companySelect");
  if (!sel) return;

  sel.innerHTML = "";
  for (const c of companies) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.name} (Bakiye: ${fmt(c.balance)})`;
    sel.appendChild(opt);
  }

  if (companies.length) {
    sel.value = String(companies[0].id);
    await loadBranches();
  } else {
    if ($("branchSelect")) $("branchSelect").innerHTML = "";
  }
}

async function loadBranches(){
  const companyId = Number($("companySelect")?.value || 0);
  if (!companyId) return;

  branches = await api(`/companies/${companyId}/branches`);

  const sel = $("branchSelect");
  if (!sel) return;

  sel.innerHTML = "";
  for (const b of branches) {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = b.name;
    sel.appendChild(opt);
  }
  if (branches.length) sel.value = String(branches[0].id);

  // admin form doldur
  const c = companies.find(x => x.id === companyId);
  if (c) {
    if ($("aCompanyId")) $("aCompanyId").value = c.id;
    if ($("aCompanyName")) $("aCompanyName").value = c.name;
    if ($("aCompanyPhone")) $("aCompanyPhone").value = c.phone || "";
    if ($("aCompanyPrice")) $("aCompanyPrice").value = c.price_per_pack || 0;
  }

  await refreshTotals();
}

async function refreshTotals(){
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
  const to = now.toISOString().slice(0,10);

  const r = await api(`/reports/range?from=${from}&to=${to}`);

  const companyId = Number($("companySelect")?.value || 0);
  const c = companies.find(x => x.id === companyId);

  if ($("companyTotal")) $("companyTotal").textContent = fmt(c?.balance || 0);
  if ($("branchTotal")) $("branchTotal").textContent = fmt(0);

  if ($("reportOut")) {
    $("reportOut").textContent =
`RAPOR (${r.from} → ${r.to})
TOPLAM SATIŞ: ${fmt(r.sales)}
- Veresiye Satış: ${fmt(r.creditSales)}
- Peşin Satış: ${fmt(r.cashSales)}
TAHSİLAT: ${fmt(r.payments)}
İADE: ${fmt(r.returns)}
GİDER: ${fmt(r.expenses)}
ÜRETİM (paket): ${fmt(r.productionPacks)}
`;
  }
}

// ===============================
// REPORTS
// ===============================
async function reportToday(){
  const r = await api("/reports/today");
  if ($("reportOut")) {
    $("reportOut").textContent =
`BUGÜN RAPORU
TOPLAM SATIŞ: ${fmt(r.sales)}
- Veresiye Satış: ${fmt(r.creditSales)}
- Peşin Satış: ${fmt(r.cashSales)}
TAHSİLAT: ${fmt(r.payments)}
İADE: ${fmt(r.returns)}
GİDER: ${fmt(r.expenses)}
ÜRETİM (paket): ${fmt(r.productionPacks)}
`;
  }
}

async function reportRange(){
  const from = $("fromDate")?.value;
  const to = $("toDate")?.value;
  const r = await api(`/reports/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  if ($("reportOut")) {
    $("reportOut").textContent =
`RAPOR (${r.from} → ${r.to})
TOPLAM SATIŞ: ${fmt(r.sales)}
- Veresiye Satış: ${fmt(r.creditSales)}
- Peşin Satış: ${fmt(r.cashSales)}
TAHSİLAT: ${fmt(r.payments)}
İADE: ${fmt(r.returns)}
GİDER: ${fmt(r.expenses)}
ÜRETİM (paket): ${fmt(r.productionPacks)}
`;
  }
}

async function reportMonth(){
  const ym = $("ym")?.value;
  const r = await api(`/reports/month?ym=${encodeURIComponent(ym)}`);
  if ($("reportOut")) {
    $("reportOut").textContent =
`AY RAPORU (${r.from} → ${r.to})
TOPLAM SATIŞ: ${fmt(r.sales)}
- Veresiye Satış: ${fmt(r.creditSales)}
- Peşin Satış: ${fmt(r.cashSales)}
TAHSİLAT: ${fmt(r.payments)}
İADE: ${fmt(r.returns)}
GİDER: ${fmt(r.expenses)}
ÜRETİM (paket): ${fmt(r.productionPacks)}
`;
  }
}

// ===============================
// LEDGER (SATIŞ / TAHSİLAT / ALACAK / İADE)
// ===============================
// UI’de paket fiyatını görmek istersen burada (backend zaten firmadan price_per_pack alıyor)
const PACK_PRICE = 120;

// HTML seçenekleri sende böyle olabilir:
// SALE_CREDIT, CASH_SALE, DEBIT, PAYMENT, RETURN
// Backend ise: SALE, CASH_SALE, DEBT_ADD, PAYMENT, RETURN
function normalizeLedgerType(uiType){
  if (uiType === "SALE_CREDIT") return "SALE";
  if (uiType === "DEBIT") return "DEBT_ADD";
  return uiType;
}

function toggleLedgerFields(){
  const uiType = $("ledgerType")?.value;
  const type = normalizeLedgerType(uiType);

  const needPacks = (type === "SALE" || type === "CASH_SALE" || type === "RETURN");
  const needAmountManual = (type === "DEBT_ADD" || type === "PAYMENT");

  if ($("ledgerPacks")) $("ledgerPacks").style.display = needPacks ? "inline-block" : "none";
  if ($("ledgerAmount")) $("ledgerAmount").style.display = needAmountManual ? "inline-block" : "none";
}

async function saveLedger(){
  const uiType = $("ledgerType")?.value;
  const type = normalizeLedgerType(uiType);

  const companyId = Number($("companySelect")?.value || 0);
  const branchId  = Number($("branchSelect")?.value || 0);

  const packs = Number($("ledgerPacks")?.value || 0);
  let amount  = Number($("ledgerAmount")?.value || 0);

  const note = $("ledgerNote")?.value || null;
  const entryDate = $("ledgerDate")?.value || null;

  if (!companyId) return alert("Firma seç");
  if (!branchId)  return alert("Şube seç");

  // Paket şart olanlar
  if (type === "SALE" || type === "CASH_SALE" || type === "RETURN") {
    if (packs <= 0) return alert("Paket gir");
  }

  // Peşin satış: UI’de göstermek istersen (backend yine kendi hesaplıyor)
  if (type === "CASH_SALE") {
    amount = packs * PACK_PRICE;
  }

  // Tutar şart olanlar
  if (type === "DEBT_ADD" || type === "PAYMENT") {
    if (amount <= 0) return alert("Tutar gir");
  }

  await api("/ledger", {
    method: "POST",
    body: JSON.stringify({ companyId, branchId, type, packs, amount, note, entryDate })
  });

  setAnyMsg("İşlem kaydedildi ✅", true);

  if ($("ledgerPacks")) $("ledgerPacks").value = "";
  if ($("ledgerAmount")) $("ledgerAmount").value = "";
  if ($("ledgerNote")) $("ledgerNote").value = "";

  await loadCompanies();
  await reportToday();
}

// ===============================
// EXPENSE
// ===============================
async function saveExpense(){
  const amount = Number($("expAmount")?.value || 0);
  const note = $("expNote")?.value || "";
  const entryDate = $("expDate")?.value || null;

  if (amount <= 0) return alert("Gider tutarı gir");

  await api("/expenses", {
    method:"POST",
    body: JSON.stringify({ amount, note, entryDate })
  });

  setAnyMsg("Gider kaydedildi ✅", true);
  await reportToday();
}

// ===============================
// PRODUCTION
// ===============================
async function saveProd(){
  const packs = Number($("prodPacks")?.value || 0);
  const note = $("prodNote")?.value || null;
  const entryDate = $("prodDate")?.value || null;

  if (packs <= 0) return alert("Üretim paket gir");

  await api("/production", {
    method:"POST",
    body: JSON.stringify({ packs, note, entryDate })
  });

  setAnyMsg("Üretim kaydedildi ✅", true);
  await reportToday();
}

// ===============================
// ADMIN
// ===============================
async function adminSaveCompany(){
  const id = Number($("aCompanyId")?.value || 0);
  const name = $("aCompanyName")?.value?.trim() || "";
  const phone = $("aCompanyPhone")?.value?.trim() || "";
  const pricePerPack = Number($("aCompanyPrice")?.value || 0);

  if (!name) return alert("Firma adı yaz");

  if (!id) {
    await api("/companies", {
      method:"POST",
      body: JSON.stringify({ name, phone: phone || null, pricePerPack })
    });
  } else {
    await api(`/companies/${id}`, {
      method:"PUT",
      body: JSON.stringify({ name, phone: phone || null, pricePerPack })
    });
  }

  setMsg($("adminMsg"), "Firma kaydedildi ✅", true);
  await loadCompanies();
}

async function adminDeleteCompany(){
  const id = Number($("aCompanyId")?.value || 0);
  if (!id) return alert("Firma ID gerekli");
  if (!confirm("Firma pasife alınacak. Emin misin?")) return;

  await api(`/companies/${id}`, { method:"DELETE" });

  setMsg($("adminMsg"), "Firma kaldırıldı ✅", true);
  if ($("aCompanyId")) $("aCompanyId").value = "";
  if ($("aCompanyName")) $("aCompanyName").value = "";
  if ($("aCompanyPhone")) $("aCompanyPhone").value = "";
  if ($("aCompanyPrice")) $("aCompanyPrice").value = "";

  await loadCompanies();
}

async function adminAddBranch(){
  const companyId = Number($("companySelect")?.value || 0);
  const name = $("aBranchName")?.value?.trim() || "";

  if (!companyId) return alert("Firma seç");
  if (!name) return alert("Şube adı yaz");

  await api(`/companies/${companyId}/branches`, {
    method:"POST",
    body: JSON.stringify({ name })
  });

  if ($("aBranchName")) $("aBranchName").value = "";
  setMsg($("adminMsg"), "Şube eklendi ✅", true);
  await loadBranches();
}

async function adminDeleteBranch(){
  const id = Number($("aBranchId")?.value || 0);
  if (!id) return alert("Şube ID yaz");
  if (!confirm("Şube pasife alınacak. Emin misin?")) return;

  await api(`/branches/${id}`, { method:"DELETE" });

  if ($("aBranchId")) $("aBranchId").value = "";
  setMsg($("adminMsg"), "Şube kaldırıldı ✅", true);
  await loadBranches();
}

// ===============================
// ROLE RESTRICTIONS
// ===============================
function applyRoleRestrictions(){
  const isAdmin = me?.role === "ADMIN";

  const dateIds = ["ledgerDate", "expDate", "prodDate", "fromDate", "toDate", "ym"];
  dateIds.forEach(id => {
    const el = $(id);
    if (!el) return;
    el.disabled = !isAdmin;
    if (!isAdmin) el.style.opacity = "0.7";
  });

  if (!isAdmin) {
    if ($("btnRange")) $("btnRange").style.display = "none";
    if ($("btnMonth")) $("btnMonth").style.display = "none";
    if ($("fromDate")) $("fromDate").style.display = "none";
    if ($("toDate")) $("toDate").style.display = "none";
    if ($("ym")) $("ym").style.display = "none";
  }
}

// ===============================
// AUTH
// ===============================
async function login(){
  try{
    const pin = $("pin")?.value || "";
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
    applyRoleRestrictions();
    initDates();

    await loadCompanies();
    await reportToday();
    toggleLedgerFields();
  } catch(e){
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

// ===============================
// BOOT
// ===============================
window.addEventListener("load", async () => {
  $("btnLogin")?.addEventListener("click", login);
  $("btnLogout")?.addEventListener("click", logout);

  $("btnToday")?.addEventListener("click", async () => { try{ await reportToday(); }catch(e){ alert(e.message); } });
  $("btnRange")?.addEventListener("click", async () => { try{ await reportRange(); }catch(e){ alert(e.message); } });
  $("btnMonth")?.addEventListener("click", async () => { try{ await reportMonth(); }catch(e){ alert(e.message); } });

  $("companySelect")?.addEventListener("change", async () => { try{ await loadBranches(); }catch(e){ alert(e.message); } });
  $("branchSelect")?.addEventListener("change", async () => { try{ await refreshTotals(); }catch(e){ alert(e.message); } });

  $("btnReloadAll")?.addEventListener("click", async () => {
    try {
      await loadCompanies();
      await reportToday();
      setAnyMsg("Yenilendi ✅", true);
    } catch(e){
      alert(e.message);
    }
  });

  $("ledgerType")?.addEventListener("change", toggleLedgerFields);
  $("btnLedger")?.addEventListener("click", async () => { try{ await saveLedger(); }catch(e){ alert(e.message); } });

  $("btnExpense")?.addEventListener("click", async () => { try{ await saveExpense(); }catch(e){ alert(e.message); } });
  $("btnProd")?.addEventListener("click", async () => { try{ await saveProd(); }catch(e){ alert(e.message); } });

  $("btnCompanySave")?.addEventListener("click", async () => { try{ await adminSaveCompany(); }catch(e){ alert(e.message); } });
  $("btnCompanyDelete")?.addEventListener("click", async () => { try{ await adminDeleteCompany(); }catch(e){ alert(e.message); } });

  $("btnBranchAdd")?.addEventListener("click", async () => { try{ await adminAddBranch(); }catch(e){ alert(e.message); } });
  $("btnBranchDelete")?.addEventListener("click", async () => { try{ await adminDeleteBranch(); }catch(e){ alert(e.message); } });

  // Auto login
  if (token && me) {
    showLoggedIn();
    applyRoleRestrictions();
    initDates();
    try {
      await loadCompanies();
      await reportToday();
      toggleLedgerFields();
    } catch {
      logout();
    }
  } else {
    showLoggedOut();
  }
});

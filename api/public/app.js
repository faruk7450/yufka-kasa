let token = localStorage.getItem("token") || "";
let me = JSON.parse(localStorage.getItem("me") || "null");

function $(id){ return document.getElementById(id); }
function todayYMD(){
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,10); // yyyy-mm-dd
}

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

function fmt(n){
  const x = Number(n || 0);
  return x.toFixed(2);
}

function showLoggedIn(){
  $("loginCard").classList.add("hidden");
  $("mainCard").classList.remove("hidden");
  $("reportsCard").classList.remove("hidden");
  $("opsCard").classList.remove("hidden");

  $("userPill").textContent = `Giriş: ${me?.name || "-"} (${me?.role || "-"})`;

  if (me?.role === "ADMIN") $("adminCard").classList.remove("hidden");
  else $("adminCard").classList.add("hidden");
}

function showLoggedOut(){
  $("loginCard").classList.remove("hidden");
  $("mainCard").classList.add("hidden");
  $("reportsCard").classList.add("hidden");
  $("opsCard").classList.add("hidden");
  $("adminCard").classList.add("hidden");
}

function initDates(){
  const ymd = todayYMD();

  // İşlem tarihleri (personelde de bugüne gelsin)
  ["ledgerDate","expDate","prodDate"].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.value = ymd;   // ✅ her seferinde bugünü bas
  });

  // Rapor tarihleri
  const from = document.getElementById("fromDate");
  const to   = document.getElementById("toDate");
  if (from) from.value = ymd;
  if (to)   to.value   = ymd;

  // Aylık: yyyy-mm
  const ym = document.getElementById("ym");
  if (ym) ym.value = ymd.slice(0,7);
}

}

let companies = [];
let branches = [];

async function loadCompanies(){
  companies = await api("/companies");
  const sel = $("companySelect");
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
    $("branchSelect").innerHTML = "";
  }
}

async function loadBranches(){
  const companyId = Number($("companySelect").value || 0);
  if (!companyId) return;

  branches = await api(`/companies/${companyId}/branches`);
  const sel = $("branchSelect");
  sel.innerHTML = "";
  for (const b of branches) {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = b.name;
    sel.appendChild(opt);
  }
  if (branches.length) sel.value = String(branches[0].id);

  // admin formunu doldur
  const c = companies.find(x => x.id === companyId);
  if (c) {
    $("aCompanyId").value = c.id;
    $("aCompanyName").value = c.name;
    $("aCompanyPhone").value = c.phone || "";
    $("aCompanyPrice").value = c.price_per_pack || 0;
  }

  await refreshTotals();
}

async function refreshTotals(){
  // Totaller: rapor range ile (bu ay) gösterelim (hızlı ve pratik)
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
  const to = now.toISOString().slice(0,10);
  const r = await api(`/reports/range?from=${from}&to=${to}`);

  // Company total: seçili firmanın bakiyesi zaten dropdown’da var, ama burada “aylık satış/tahsilat” istiyorsun.
  // Şimdilik UI hızlı: toplam alanına bakiye yazacağız (ana ihtiyaç bu).
  const companyId = Number($("companySelect").value || 0);
  const c = companies.find(x => x.id === companyId);
  $("companyTotal").textContent = fmt(c?.balance || 0);

  // Şube toplamı (bu ay) için basit endpoint yok → şimdilik 0 gösteriyoruz.
  // İstersen sonraki adımda /reports/branch ekleyip bunu gerçek yaparız.
  $("branchTotal").textContent = fmt(0);

  // reportOut'a da en son alınan raporu bas
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

async function reportToday(){
  const r = await api("/reports/today");
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

async function reportRange(){
  const from = $("fromDate").value;
  const to = $("toDate").value;
  const r = await api(`/reports/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
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

async function reportMonth(){
  const ym = $("ym").value;
  const r = await api(`/reports/month?ym=${encodeURIComponent(ym)}`);
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

function toggleLedgerFields(){
  const type = $("ledgerType").value;
  const needPacks = (type === "SALE_CREDIT" || type === "CASH_SALE" || type === "RETURN");
  const needAmount = (type === "PAYMENT" || type === "DEBIT");

  $("ledgerPacks").style.display = needPacks ? "inline-block" : "none";
  $("ledgerAmount").style.display = needAmount ? "inline-block" : "none";
}

async function saveLedger(){
  const type = $("ledgerType").value;
  const companyId = Number($("companySelect").value || 0);
  const branchId = Number($("branchSelect").value || 0);
  const packs = Number($("ledgerPacks").value || 0);
  const amount = Number($("ledgerAmount").value || 0);
  const note = $("ledgerNote").value || null;
  const entryDate = $("ledgerDate").value || null;

  if (!companyId) return alert("Firma seç");
  if (!branchId) return alert("Şube seç");

  if ((type === "PAYMENT" || type === "DEBIT") && !amount) return alert("Tutar gir");
  if ((type === "SALE_CREDIT" || type === "CASH_SALE" || type === "RETURN") && packs <= 0) return alert("Paket gir");

  await api("/ledger", {
    method:"POST",
    body: JSON.stringify({ type, companyId, branchId, packs, amount, note, entryDate })
  });

  setMsg($("opMsg"), "İşlem kaydedildi ✅", true);
  $("ledgerPacks").value = "";
  $("ledgerAmount").value = "";
  $("ledgerNote").value = "";
  await loadCompanies();
  await reportToday();
}

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

// ---- ADMIN ----
async function adminSaveCompany(){
  const id = Number($("aCompanyId").value || 0);
  const name = $("aCompanyName").value.trim();
  const phone = $("aCompanyPhone").value.trim();
  const pricePerPack = Number($("aCompanyPrice").value || 0);

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
  const id = Number($("aCompanyId").value || 0);
  if (!id) return alert("Firma ID gerekli");
  if (!confirm("Firma pasife alınacak. Emin misin?")) return;

  await api(`/companies/${id}`, { method:"DELETE" });
  setMsg($("adminMsg"), "Firma kaldırıldı ✅", true);
  $("aCompanyId").value = "";
  $("aCompanyName").value = "";
  $("aCompanyPhone").value = "";
  $("aCompanyPrice").value = "";
  await loadCompanies();
}

async function adminAddBranch(){
  const companyId = Number($("companySelect").value || 0);
  const name = $("aBranchName").value.trim();
  if (!companyId) return alert("Firma seç");
  if (!name) return alert("Şube adı yaz");

  await api(`/companies/${companyId}/branches`, {
    method:"POST",
    body: JSON.stringify({ name })
  });

  $("aBranchName").value = "";
  setMsg($("adminMsg"), "Şube eklendi ✅", true);
  await loadBranches();
}

async function adminDeleteBranch(){
  const id = Number($("aBranchId").value || 0);
  if (!id) return alert("Şube ID yaz");
  if (!confirm("Şube pasife alınacak. Emin misin?")) return;

  await api(`/branches/${id}`, { method:"DELETE" });
  $("aBranchId").value = "";
  setMsg($("adminMsg"), "Şube kaldırıldı ✅", true);
  await loadBranches();
}

// ---- AUTH ----
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
    await loadCompanies();
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

window.addEventListener("load", async () => {
  $("btnLogin").addEventListener("click", login);
  $("btnLogout").addEventListener("click", logout);

  $("btnToday").addEventListener("click", async () => { try{ await reportToday(); }catch(e){ alert(e.message); } });
  $("btnRange").addEventListener("click", async () => { try{ await reportRange(); }catch(e){ alert(e.message); } });
  $("btnMonth").addEventListener("click", async () => { try{ await reportMonth(); }catch(e){ alert(e.message); } });

  $("companySelect").addEventListener("change", async () => { try{ await loadBranches(); }catch(e){ alert(e.message); } });
  $("branchSelect").addEventListener("change", async () => { try{ await refreshTotals(); }catch(e){ alert(e.message); } });

  $("btnReloadAll").addEventListener("click", async () => {
    try { await loadCompanies(); await reportToday(); setMsg($("opMsg"), "Yenilendi ✅", true); }
    catch(e){ alert(e.message); }
  });

  $("ledgerType").addEventListener("change", toggleLedgerFields);
  $("btnLedger").addEventListener("click", async () => { try{ await saveLedger(); }catch(e){ alert(e.message); } });

  $("btnExpense").addEventListener("click", async () => { try{ await saveExpense(); }catch(e){ alert(e.message); } });
  $("btnProd").addEventListener("click", async () => { try{ await saveProd(); }catch(e){ alert(e.message); } });

  $("btnCompanySave").addEventListener("click", async () => { try{ await adminSaveCompany(); }catch(e){ alert(e.message); } });
  $("btnCompanyDelete").addEventListener("click", async () => { try{ await adminDeleteCompany(); }catch(e){ alert(e.message); } });

  $("btnBranchAdd").addEventListener("click", async () => { try{ await adminAddBranch(); }catch(e){ alert(e.message); } });
  $("btnBranchDelete").addEventListener("click", async () => { try{ await adminDeleteBranch(); }catch(e){ alert(e.message); } });

  toggleLedgerFields();

  if (token && me) {
    showLoggedIn();
    applyRoleRestrictions();
    initDates();
    try {
      await loadCompanies();
      await reportToday();
    } catch {
      logout();
    }
  } else {
    showLoggedOut();
  }
});

function applyRoleRestrictions() {
  const isAdmin = me?.role === "ADMIN";

  // Tarih alanlarını kilitle
  const dateIds = ["ledgerDate", "expDate", "prodDate", "fromDate", "toDate", "ym"];
  dateIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = !isAdmin;
    if (!isAdmin) el.style.opacity = "0.7";
  });

  // Personelde sadece Bugün Raporu kalsın
  if (!isAdmin) {
    const btnRange = document.getElementById("btnRange");
    const btnMonth = document.getElementById("btnMonth");
    const from = document.getElementById("fromDate");
    const to = document.getElementById("toDate");
    const ym = document.getElementById("ym");

    if (btnRange) btnRange.style.display = "none";
    if (btnMonth) btnMonth.style.display = "none";
    if (from) from.style.display = "none";
    if (to) to.style.display = "none";
    if (ym) ym.style.display = "none";
  }
}

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

async function reportToday(){
  const r = await api("/reports/today");
  $("reportOut").textContent =
`BUGÜN RAPORU
SATIŞ: ${fmt(r.sales)}
TAHSİLAT: ${fmt(Math.abs(r.payments))}
ALACAK/VERESİYE: ${fmt(r.debtAdjust)}
İADE: ${fmt(Math.abs(r.returns))}
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
SATIŞ: ${fmt(r.sales)}
TAHSİLAT: ${fmt(Math.abs(r.payments))}
ALACAK/VERESİYE: ${fmt(r.debtAdjust)}
İADE: ${fmt(Math.abs(r.returns))}
GİDER: ${fmt(r.expenses)}
ÜRETİM (paket): ${fmt(r.productionPacks)}
`;
}

async function reportMonth(){
  const ym = $("ym").value;
  const r = await api(`/reports/month?ym=${encodeURIComponent(ym)}`);
  $("reportOut").textContent =
`AY RAPORU (${r.from} → ${r.to})
SATIŞ: ${fmt(r.sales)}
TAHSİLAT: ${fmt(Math.abs(r.payments))}
ALACAK/VERESİYE: ${fmt(r.debtAdjust)}
İADE: ${fmt(Math.abs(r.returns))}
GİDER: ${fmt(r.expenses)}
ÜRETİM (paket): ${fmt(r.productionPacks)}
`;
}

// --- Firma/Şube selectleri ---
async function loadCompanies(){
  const rows = await api("/companies");

  const coSel = $("companySelect");
  const coPick = $("coPickForBranch");

  coSel.innerHTML = "";
  coPick.innerHTML = "";

  for (const c of rows) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.name} (Toplam: ${fmt(c.balance)})`;
    opt.dataset.balance = c.balance;
    coSel.appendChild(opt);

    const opt2 = document.createElement("option");
    opt2.value = c.id;
    opt2.textContent = c.name;
    coPick.appendChild(opt2);
  }

  if (rows.length) {
    $("companyTotal").textContent = `Toplam: ${fmt(rows[0].balance)}`;
    await loadBranches(Number(rows[0].id));
  } else {
    $("companyTotal").textContent = `Toplam: 0.00`;
    $("branchSelect").innerHTML = "";
    $("ledgerBranchId").value = "";
  }
}

async function loadBranches(companyId){
  const rows = await api(`/companies/${companyId}/branches`);
  const brSel = $("branchSelect");
  brSel.innerHTML = "";

  for (const b of rows) {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = `${b.name} (Bakiye: ${fmt(b.balance)})`;
    brSel.appendChild(opt);
  }

  if (rows.length) $("ledgerBranchId").value = rows[0].id;
  else $("ledgerBranchId").value = "";
}

function syncLedgerTypeUI(){
  const type = $("ledgerType").value;
  const packsRow = $("ledgerPacksRow");
  const amountRow = $("ledgerAmountRow");

  if (type === "PAYMENT" || type === "DEBT_ADJ") {
    amountRow.style.display = "";
    packsRow.style.display = "none";
  } else {
    amountRow.style.display = "none";
    packsRow.style.display = "";
  }
}

async function saveLedger(){
  const type = $("ledgerType").value;
  const branchId = Number($("ledgerBranchId").value || 0);
  const packs = Number($("ledgerPacks").value || 0);
  const amount = Number($("ledgerAmount").value || 0);
  const note = $("ledgerNote").value || null;
  const entryDate = $("ledgerDate").value || null;

  if (!branchId) return alert("Şube seç");

  if (type === "PAYMENT" || type === "DEBT_ADJ") {
    if (amount <= 0) return alert("Tutar gir");
  } else {
    if (packs <= 0) return alert("Paket gir");
  }

  await api("/ledger", {
    method:"POST",
    body: JSON.stringify({ type, branchId, packs, amount, note, entryDate })
  });

  setMsg($("opMsg"), "İşlem kaydedildi ✅", true);

  // temizle
  $("ledgerPacks").value = "";
  $("ledgerAmount").value = "";
  $("ledgerNote").value = "";

  await reportToday();
  await loadCompanies(); // toplamlar/bakiyeler güncellensin
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
  $("expAmount").value = "";
  $("expNote").value = "";

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
  $("prodPacks").value = "";
  $("prodNote").value = "";

  await reportToday();
}

async function addCompany(){
  const name = $("coName").value.trim();
  const phone = $("coPhone").value.trim();
  const pricePerPack = Number($("coPrice").value || 0);
  if (!name) return alert("Firma adı yaz");
  await api("/companies", {
    method:"POST",
    body: JSON.stringify({ name, phone: phone || null, pricePerPack })
  });
  $("coName").value = ""; $("coPhone").value = ""; $("coPrice").value = "";
  setMsg($("adminMsg"), "Firma eklendi ✅", true);
  await loadCompanies();
}

async function addBranch(){
  const companyId = Number($("coPickForBranch").value || 0);
  const name = $("brName").value.trim();
  if (!companyId) return alert("Firma seç");
  if (!name) return alert("Şube adı yaz");
  await api("/branches", {
    method:"POST",
    body: JSON.stringify({ companyId, name })
  });
  $("brName").value = "";
  setMsg($("adminMsg"), "Şube eklendi ✅", true);

  // seçili firmaya göre şubeleri güncelle
  await loadBranches(companyId);
  await loadCompanies();
}

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
    syncLedgerTypeUI();
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

  $("ledgerType").addEventListener("change", syncLedgerTypeUI);

  $("companySelect").addEventListener("change", async (e) => {
    const companyId = Number(e.target.value);
    const opt = e.target.selectedOptions[0];
    $("companyTotal").textContent = `Toplam: ${fmt(opt?.dataset?.balance || 0)}`;
    await loadBranches(companyId);
  });

  $("branchSelect").addEventListener("change", async (e) => {
    $("ledgerBranchId").value = e.target.value;
  });

  $("btnToday").addEventListener("click", async () => { try { await reportToday(); } catch(e){ alert(e.message);} });
  $("btnRange").addEventListener("click", async () => { try { await reportRange(); } catch(e){ alert(e.message);} });
  $("btnMonth").addEventListener("click", async () => { try { await reportMonth(); } catch(e){ alert(e.message);} });

  $("btnLedger").addEventListener("click", async () => { try { await saveLedger(); } catch(e){ alert(e.message);} });
  $("btnExpense").addEventListener("click", async () => { try { await saveExpense(); } catch(e){ alert(e.message);} });
  $("btnProd").addEventListener("click", async () => { try { await saveProd(); } catch(e){ alert(e.message);} });

  $("btnAddCompany").addEventListener("click", async () => { try { await addCompany(); } catch(e){ alert(e.message);} });
  $("btnAddBranch").addEventListener("click", async () => { try { await addBranch(); } catch(e){ alert(e.message);} });

  if (token && me) {
    showLoggedIn();
    initDates();
    syncLedgerTypeUI();
    try {
      await loadCompanies();
      await reportToday();
    } catch (e) {
      logout();
    }
  } else {
    showLoggedOut();
  }
});

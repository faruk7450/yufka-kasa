let token = localStorage.getItem("token") || "";
let me = JSON.parse(localStorage.getItem("me") || "null");

function $(id) { return document.getElementById(id); }

function fmt(n){
  const x = Number(n || 0);
  return x.toFixed(2);
}

function setMsg(el, text, ok=true){
  el.className = ok ? "muted ok" : "muted err";
  el.textContent = text;
}

async function api(path, opts={}){
  const headers = opts.headers || {};
  if (!headers["Content-Type"] && !(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";
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
  $("opsCard").classList.remove("hidden");
  $("adminCard").classList.toggle("hidden", me?.role !== "ADMIN");

  $("userPill").textContent = `Giriş: ${me?.name || "-"} (${me?.role || "-"})`;
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

function ledgerTypeUI(){
  const t = $("ledgerType").value;
  const packs = $("ledgerPacks");
  const amount = $("ledgerAmount");

  // varsayılan gizle
  packs.style.display = "none";
  amount.style.display = "none";

  if (t === "SALE" || t === "CASH_SALE" || t === "RETURN") {
    packs.style.display = "";
  }
  if (t === "PAYMENT" || t === "DEBIT") {
    amount.style.display = "";
  }
}

let companiesCache = [];
let branchesCache = [];

async function loadCompanies(){
  const rows = await api("/companies");
  companiesCache = rows;

  const sel = $("companySelect");
  sel.innerHTML = "";
  for (const c of rows) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.name} (Bakiye: ${fmt(c.balance)})`;
    sel.appendChild(opt);
  }

  // admin tablo
  const tb = $("companyBody");
  tb.innerHTML = "";
  for (const c of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.id}</td>
      <td>${c.name}</td>
      <td>${c.phone || ""}</td>
      <td>${fmt(c.price_per_pack)}</td>
      <td>${fmt(c.balance)}</td>
    `;
    tr.addEventListener("click", () => {
      $("cId").value = c.id;
      $("cName").value = c.name;
      $("cPhone").value = c.phone || "";
      $("cPrice").value = c.price_per_pack;
      $("companySelect").value = c.id;
      onCompanyChanged();
      setMsg($("adminMsg"), `Seçildi: ${c.name} (ID ${c.id})`, true);
    });
    tb.appendChild(tr);
  }

  await onCompanyChanged();
}

async function loadBranches(companyId){
  const rows = await api(`/companies/${companyId}/branches`);
  branchesCache = rows;

  const sel = $("branchSelect");
  sel.innerHTML = "";
  for (const b of rows) {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = b.name;
    sel.appendChild(opt);
  }
}

async function refreshBalances(){
  const companyId = Number($("companySelect").value || 0);
  const branchId = Number($("branchSelect").value || 0);
  if (!companyId) return;

  const r = await api(`/balances?companyId=${companyId}&branchId=${branchId}`);
  $("balPill").textContent = `Toplam: ${fmt(r.companyBalance)}`;
  $("branchBalPill").textContent = `Şube: ${fmt(r.branchBalance)}`;
}

async function onCompanyChanged(){
  const companyId = Number($("companySelect").value || 0);
  if (!companyId) return;
  await loadBranches(companyId);
  await refreshBalances();
}

async function onBranchChanged(){
  await refreshBalances();
}

async function reportToday(){
  const r = await api("/reports/today");
  $("reportOut").textContent =
`BUGÜN RAPORU
SATIŞ: ${fmt(r.sales)}
ALACAK (Tutar): ${fmt(r.debit)}
TAHSİLAT: ${fmt(Math.abs(r.payments))}
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
ALACAK (Tutar): ${fmt(r.debit)}
TAHSİLAT: ${fmt(Math.abs(r.payments))}
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
ALACAK (Tutar): ${fmt(r.debit)}
TAHSİLAT: ${fmt(Math.abs(r.payments))}
İADE: ${fmt(Math.abs(r.returns))}
GİDER: ${fmt(r.expenses)}
ÜRETİM (paket): ${fmt(r.productionPacks)}
`;
}

async function saveLedger(){
  const type = $("ledgerType").value;
  const companyId = Number($("companySelect").value || 0);
  const branchId = Number($("branchSelect").value || 0);

  const packs = Number(($("ledgerPacks").value || "").replace(",", ".") || 0);
  const amount = Number(($("ledgerAmount").value || "").replace(",", ".") || 0);

  const note = $("ledgerNote").value || null;
  const entryDate = $("ledgerDate").value || null;

  if (!companyId) return alert("Firma seç");
  if (!branchId) return alert("Şube seç");

  if ((type === "SALE" || type === "CASH_SALE" || type === "RETURN") && packs <= 0) return alert("Paket gir");
  if ((type === "PAYMENT" || type === "DEBIT") && amount <= 0) return alert("Tutar gir");

  await api("/ledger", {
    method:"POST",
    body: JSON.stringify({ type, companyId, branchId, packs, amount, note, entryDate })
  });

  setMsg($("opMsg"), "İşlem kaydedildi ✅", true);

  $("ledgerPacks").value = "";
  $("ledgerAmount").value = "";
  $("ledgerNote").value = "";

  await reportToday();
  await loadCompanies();     // tablo + bakiye güncellensin
  await refreshBalances();
}

async function saveExpense(){
  const amount = Number(($("expAmount").value || "").replace(",", ".") || 0);
  const note = $("expNote").value || "";
  const entryDate = $("expDate").value || null;
  if (amount <= 0) return alert("Gider tutarı gir");

  await api("/expenses", {
    method:"POST",
    body: JSON.stringify({ amount, note, entryDate })
  });

  setMsg($("opMsg"), "Gider kaydedildi ✅", true);
  $("expAmount").value = ""; $("expNote").value = "";
  await reportToday();
}

async function saveProd(){
  const packs = Number(($("prodPacks").value || "").replace(",", ".") || 0);
  const note = $("prodNote").value || null;
  const entryDate = $("prodDate").value || null;
  if (packs <= 0) return alert("Üretim paket gir");

  await api("/production", {
    method:"POST",
    body: JSON.stringify({ packs, note, entryDate })
  });

  setMsg($("opMsg"), "Üretim kaydedildi ✅", true);
  $("prodPacks").value = ""; $("prodNote").value = "";
  await reportToday();
}

/** -------- ADMIN -------- */
async function addCompany(){
  const name = $("cName").value.trim();
  const phone = $("cPhone").value.trim();
  const pricePerPack = Number(($("cPrice").value || "").replace(",", ".") || 0);
  if (!name) return alert("Firma adı yaz");

  await api("/companies", {
    method:"POST",
    body: JSON.stringify({ name, phone: phone || null, pricePerPack })
  });

  $("cId").value=""; $("cName").value=""; $("cPhone").value=""; $("cPrice").value="";
  await loadCompanies();
  setMsg($("adminMsg"), "Firma eklendi ✅", true);
}

async function updateCompany(){
  const id = Number($("cId").value || 0);
  if (!id) return alert("Güncellemek için Firma ID gir");
  const name = $("cName").value.trim();
  const phone = $("cPhone").value.trim();
  const pricePerPack = Number(($("cPrice").value || "").replace(",", ".") || 0);

  await api(`/companies/${id}`, {
    method:"PUT",
    body: JSON.stringify({ name, phone: phone || null, pricePerPack })
  });

  await loadCompanies();
  setMsg($("adminMsg"), "Firma güncellendi ✅", true);
}

async function deleteCompany(){
  const id = Number($("cId").value || 0);
  if (!id) return alert("Kaldırmak için Firma ID gir");
  if (!confirm("Firma pasife alınacak. Emin misin?")) return;

  await api(`/companies/${id}`, { method:"DELETE" });

  $("cId").value=""; $("cName").value=""; $("cPhone").value=""; $("cPrice").value="";
  await loadCompanies();
  setMsg($("adminMsg"), "Firma kaldırıldı ✅", true);
}

async function addBranch(){
  const companyId = Number($("companySelect").value || 0);
  const name = $("branchName").value.trim();
  if (!companyId) return alert("Önce firma seç");
  if (!name) return alert("Şube adı yaz");

  await api(`/companies/${companyId}/branches`, {
    method:"POST",
    body: JSON.stringify({ name })
  });

  $("branchName").value = "";
  await onCompanyChanged();
  setMsg($("adminMsg"), "Şube eklendi ✅", true);
}

async function renameBranch(){
  const id = Number($("branchRenameId").value || 0);
  const name = $("branchRenameName").value.trim();
  if (!id) return alert("Şube ID gir");
  if (!name) return alert("Yeni şube adını yaz");

  await api(`/branches/${id}`, {
    method:"PUT",
    body: JSON.stringify({ name })
  });

  await onCompanyChanged();
  setMsg($("adminMsg"), "Şube güncellendi ✅", true);
}

async function deleteBranch(){
  const id = Number($("branchRenameId").value || 0);
  if (!id) return alert("Şube ID gir");
  if (!confirm("Şube pasife alınacak. Emin misin?")) return;

  await api(`/branches/${id}`, { method:"DELETE" });
  await onCompanyChanged();
  setMsg($("adminMsg"), "Şube kaldırıldı ✅", true);
}

/** -------- LOGIN/LOGOUT -------- */
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
    ledgerTypeUI();
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

/** -------- BOOT -------- */
window.addEventListener("load", async () => {
  $("btnLogin").addEventListener("click", login);
  $("btnLogout").addEventListener("click", logout);

  $("ledgerType").addEventListener("change", ledgerTypeUI);

  $("btnReloadCompanies").addEventListener("click", async () => {
    try { await loadCompanies(); } catch(e){ setMsg($("opMsg"), e.message, false); }
  });

  $("companySelect").addEventListener("change", async () => {
    try { await onCompanyChanged(); } catch(e){ alert(e.message); }
  });
  $("branchSelect").addEventListener("change", async () => {
    try { await onBranchChanged(); } catch(e){ alert(e.message); }
  });

  $("btnToday").addEventListener("click", async () => { try{ await reportToday(); }catch(e){ alert(e.message);} });
  $("btnRange").addEventListener("click", async () => { try{ await reportRange(); }catch(e){ alert(e.message);} });
  $("btnMonth").addEventListener("click", async () => { try{ await reportMonth(); }catch(e){ alert(e.message);} });

  $("btnLedger").addEventListener("click", async () => { try{ await saveLedger(); }catch(e){ alert(e.message);} });
  $("btnExpense").addEventListener("click", async () => { try{ await saveExpense(); }catch(e){ alert(e.message);} });
  $("btnProd").addEventListener("click", async () => { try{ await saveProd(); }catch(e){ alert(e.message);} });

  $("btnAddCompany").addEventListener("click", async () => { try{ await addCompany(); }catch(e){ alert(e.message);} });
  $("btnUpdateCompany").addEventListener("click", async () => { try{ await updateCompany(); }catch(e){ alert(e.message);} });
  $("btnDeleteCompany").addEventListener("click", async () => { try{ await deleteCompany(); }catch(e){ alert(e.message);} });

  $("btnAddBranch").addEventListener("click", async () => { try{ await addBranch(); }catch(e){ alert(e.message);} });
  $("btnRenameBranch").addEventListener("click", async () => { try{ await renameBranch(); }catch(e){ alert(e.message);} });
  $("btnDeleteBranch").addEventListener("click", async () => { try{ await deleteBranch(); }catch(e){ alert(e.message);} });

  ledgerTypeUI();

  if (token && me) {
    showLoggedIn();
    initDates();
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

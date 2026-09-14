(function () {
  "use strict";

  const BTN_ID   = "so-manager-btn";
  const FUNCS_SEL = "#view > div > div.functions";

  // ---- Show only on the customer Special Orders view ----
  function currentCustomerId() {
    const p = new URLSearchParams(location.search);
    if (p.get("name") === "customer.views.customer" &&
        p.get("form_name") === "view" &&
        p.get("tab") === "special_orders") {
      return p.get("id") || "";
    }
    return "";
  }

  // ---- Inject / maintain the button ----
  function ensureButton() {
    const custId = currentCustomerId();
    const funcs = document.querySelector(FUNCS_SEL);
    const existing = document.getElementById(BTN_ID);

    if (!custId || !funcs) { existing?.remove(); return; }
    if (existing) return;

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.textContent = "Manage Special Orders";
    // Try to match the look of sibling buttons; fall back to inline style
    const sibling = funcs.querySelector("button, a.button, .button");
    if (sibling && sibling.className) btn.className = sibling.className;
    else Object.assign(btn.style, {
      padding:"6px 12px", marginLeft:"6px", cursor:"pointer",
      border:"1px solid #2563eb", color:"#fff", borderRadius:"6px"
    });
    // !important must be set via setProperty; a plain style.background assignment ignores it
    btn.style.setProperty("background", "#2563eb", "important");
    btn.addEventListener("click", (e) => { e.preventDefault(); openPicker(currentCustomerId()); });
    funcs.appendChild(btn);
  }

  // Re-check on DOM changes (tab switches / ajax nav) plus an interval fallback
  const mo = new MutationObserver(() => ensureButton());
  mo.observe(document.documentElement, { childList:true, subtree:true });
  setInterval(ensureButton, 1500);
  ensureButton();

  // =========================================================
  //  PICKER
  // =========================================================
  function openPicker(prefillCust) {
    const BASE = "https://us.merchantos.com/ajax_forms.php";
    const bust = () => Date.now();
    const enc = (o) => Object.entries(o)
      .map(([k,v]) => `${k}=${encodeURIComponent(typeof v==="string"?v:JSON.stringify(v))}`).join("&");
    const post = async (formName, body) => {
      const res = await fetch(`${BASE}?ajax=1&no_cache=${bust()}&form_name=${formName}`, {
        method:"POST", credentials:"include",
        headers:{ "content-type":"application/x-www-form-urlencoded; charset=UTF-8",
                  "x-requested-with":"XMLHttpRequest", "accept":"*/*" },
        body: enc(body)
      });
      const t = await res.text(); try { return JSON.parse(t); } catch { return t; }
    };

    function ctx(customerId, page) {
      if (customerId) {
        const saved = { customer_id:String(customerId), item_search:"", shop_id:"-1",
                        vendor_id:"-1", completed:"off", customer_search_intention:"", employee_id:"-1" };
        return {
          pannel: "special_order_listings_special_orders_view",
          saved,
          listing: { draw_all:false, draw_tab_only:false, name:"special_order.listings.special_orders",
            is_child_list:"1", display_search:"1", saved_search:saved, sort:"status", sort_dir:"DESC",
            count:100, page, page_count:1, tab:"single", display_advanced:false, page_size:"100",
            max_size:100, page_controls:true, title:"Special Orders", deleted_rows:null, user_search:true }
        };
      }
      const saved = { customer_search:"", item_search:"", shop_id:"-1", vendor_id:"-1",
                      completed:"off", customer_search_intention:"", employee_id:"-1" };
      return {
        pannel: "listing",
        saved,
        listing: { draw_all:false, draw_tab_only:false, name:"special_order.listings.special_orders",
          request:false, saved_search:saved, sort:"status", sort_dir:"DESC", count:100, page,
          page_count:1, tab:"single", display_search:true, display_advanced:false, page_size:100,
          max_size:100, page_controls:true, is_child_list:false, title:"Special Orders",
          type:"listing", deleted_rows:null, user_search:true, row_num:0, rec_num:1 }
      };
    }

    async function fetchAll(customerId) {
      let all=[], page=1, guard=0;
      while (guard++ < 200) {
        const c = ctx(customerId, page);
        const resp = await post("listing.refresh", {
          method:"POST", form_name:"listing.refresh",
          ajax_listing:c.listing, key_values:c.saved, pannel_id:c.pannel });
        const rows = (resp && resp.row_values) || [];
        all = all.concat(rows);
        if (rows.length < 100) break;
        page++;
      }
      return all;
    }
    async function deleteSO(customerId, row) {
      const c = ctx(customerId, 1);
      return post("listing.dofunction", {
        method:"POST", form_name:"listing.dofunction", ajax_listing:c.listing,
        fnc:"delete", key_values:c.saved, row, selected_records:[], pannel_id:c.pannel });
    }

    // ---------- UI ----------
    document.getElementById("so-picker-overlay")?.remove();
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
    const urlCust = prefillCust || "";

    const overlay = document.createElement("div");
    overlay.id = "so-picker-overlay";
    overlay.innerHTML = `
      <div id="so-picker">
        <div class="sop-head">
          <strong>Special Orders</strong>
          <label style="color:#374151">Customer ID:
            <input id="sop-cust" value="${esc(urlCust)}" placeholder="required" style="width:120px" /></label>
          <button id="sop-load">Load</button>
          <span id="sop-count"></span>
          <input id="sop-search" placeholder="Filter loaded rows…" />
          <button id="sop-close">✕</button>
        </div>
        <div class="sop-body"><table id="sop-table">
          <thead><tr><th>SO ID</th><th>Customer</th><th>Item</th><th>Status</th>
            <th>Price</th><th>Shop</th><th>Created</th><th></th></tr></thead>
          <tbody></tbody></table></div>
      </div>`;
    const css = document.createElement("style");
    css.id = "so-picker-style";
    css.textContent = `
      #so-picker-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2147483647;
        display:flex;align-items:center;justify-content:center;font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif}
      #so-picker{background:#fff;width:min(1000px,94vw);max-height:86vh;border-radius:10px;display:flex;
        flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.4)}
      .sop-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #e5e7eb;
        background:#f9fafb;flex-wrap:wrap}
      .sop-head strong{font-size:15px}
      #sop-count{color:#6b7280}
      #sop-cust,#sop-search{padding:6px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px}
      #sop-search{flex:1;min-width:160px}
      #sop-load{background:#2563eb;color:#fff;border:none;padding:6px 12px;border-radius:6px;cursor:pointer}
      #sop-close{border:none;background:#eee;border-radius:6px;width:30px;height:30px;cursor:pointer}
      .sop-body{overflow:auto}
      #sop-table{width:100%;border-collapse:collapse}
      #sop-table th{position:sticky;top:0;background:#f3f4f6;text-align:left;padding:8px 10px;
        border-bottom:1px solid #e5e7eb;font-size:12px}
      #sop-table td{padding:7px 10px;border-bottom:1px solid #f1f1f1;white-space:nowrap;max-width:280px;
        overflow:hidden;text-overflow:ellipsis}
      #sop-table tr:hover td{background:#f8fafc}
      .sop-id{font-weight:600}
      .sop-del{background:#dc2626;color:#fff;border:none;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:12px}
      .sop-del:hover{background:#b91c1c}.sop-del[disabled]{background:#f3b4b4;cursor:not-allowed}
      .sop-gone td{opacity:.45;text-decoration:line-through}`;
    document.head.appendChild(css);
    document.body.appendChild(overlay);
    const close = () => { overlay.remove(); css.remove(); };
    overlay.querySelector("#sop-close").onclick = close;
    overlay.onclick = (e)=>{ if(e.target===overlay) close(); };
    document.addEventListener("keydown", function onEsc(e){
      if(e.key==="Escape"){ close(); document.removeEventListener("keydown", onEsc); }
    });

    const tbody = overlay.querySelector("#sop-table tbody");
    const countEl = overlay.querySelector("#sop-count");
    const search = overlay.querySelector("#sop-search");
    const custInput = overlay.querySelector("#sop-cust");
    let data = [], curCust = "";

    const render = (filter="") => {
      const f = filter.toLowerCase().trim(); tbody.innerHTML="";
      data.filter(r => !f || [r.special_order_id,r.customer_name,r.description,r.status,r.shop_name]
          .some(v=>String(v??"").toLowerCase().includes(f)))
        .forEach(r => {
          const tr=document.createElement("tr");
          tr.innerHTML=`<td class="sop-id">${esc(r.special_order_id)}</td>
            <td>${esc(r.customer_name)} <span style="color:#9ca3af">#${esc(r.customer_id)}</span></td>
            <td title="${esc(r.description)}">${esc(r.description)}</td>
            <td>${esc(r.status)}</td><td>$${esc(r.retail)}</td><td>${esc(r.shop_name)}</td>
            <td>${esc((r.create_time||"").split(" ")[0])}</td>
            <td><button class="sop-del" ${String(r.can_delete)==="1"?"":"disabled"}>Delete</button></td>`;
          tr.querySelector("button").onclick = async (ev)=>{
            if(!confirm(`Delete Special Order #${r.special_order_id}?\nCustomer: ${r.customer_name}\nItem: ${r.description}\n\nThis cannot be undone.`)) return;
            ev.target.disabled=true; ev.target.textContent="Deleting…";
            const res = await deleteSO(curCust, r);
            const ok = !(res && res.failed_msg);
            ev.target.textContent = ok?"Deleted":"Failed";
            if(ok){ tr.classList.add("sop-gone"); data=data.filter(x=>x!==r); countEl.textContent=`${data.length} orders`; }
            else { ev.target.disabled=false; console.warn("Delete failed:",res); }
          };
          tbody.appendChild(tr);
        });
    };
    search.oninput = ()=>render(search.value);

    async function load() {
      curCust = custInput.value.trim();
      if (!curCust) {                       // require a customer ID before polling
        countEl.textContent = "Enter a customer ID, then click Load.";
        tbody.innerHTML = "";
        custInput.focus();
        return;
      }
      countEl.textContent = "loading…"; tbody.innerHTML = "";
      data = await fetchAll(curCust);
      countEl.textContent = `${data.length} orders`;
      render(search.value);
    }
    overlay.querySelector("#sop-load").onclick = load;
    custInput.onkeydown = (e) => { if (e.key === "Enter") load(); };

    // Auto-load since we launched from a customer page with a known ID
    if (urlCust) { load(); }
    else { countEl.textContent = "Enter a customer ID, then click Load."; custInput.focus(); }
  }
})();

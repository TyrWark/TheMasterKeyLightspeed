(function () {
  "use strict";

  var ALLOWED_ORIGINS = {
    "https://lightspeedanalytics.net": true,
    "https://app.lightspeedanalytics.net": true
  };

  var MSG_TYPES = {
    TOP_PING: "TM_TOP_PING",
    IFRAME_READY: "TM_IFRAME_READY",
    IFRAME_PONG: "TM_IFRAME_PONG",
    IFRAME_HEALTH: "TM_IFRAME_HEALTH",
    QID_READY: "TM_QID_READY",
    QID_ERROR: "TM_QID_ERROR"
  };

  var CONFIG = {
    LOAD_CHECK_SECONDS: 1,
    LOAD_BUTTON_SELECTOR: "#top-bar-buttons-react-root > div > div > div.css-11fsnzt-Box-Flex.e1rqh3k81 > button.css-1ic0uy0-BaseButton-ExtendedBaseButton-ExtendedBaseButton-ExtendedBaseButton-ExtendedBaseButton-ExtendedBaseButton.e1eugw0d1",
    MIN_LEFT_NAV_GUTTER_PX: 64,
    TOP_NAV_FALLBACK_PX: 64,
    MAX_TOP_OFFSET_PX: 180,
    MAX_LEFT_ANCHORED_START_PX: 120,
    REPORTS_POST_URL: "https://lightspeedanalytics.net/reports",
    REPOST_CATEGORY_ID: "1",
    REPOST_REPORT_ID: "99999",
    QID_RESOLVE_TIMEOUT_MS: 18000,
    QID_RESOLVE_ATTEMPT_TIMEOUT_MS: 9000,
    USE_POPUP_RESOLVER_ONLY: true,
    IFRAME_READY_RETRY_MS: 700,
    IFRAME_READY_MAX_ATTEMPTS: 20,
    TOP_IFRAME_PING_MS: 1200,
    TOP_IFRAME_PING_MAX_ATTEMPTS: 12,
    LOAD_GATE_MAX_ATTEMPTS: 10,
    IFRAME_HEALTH_POLL_MS: 3000,
    IFRAME_LOADED_BUTTON_SELECTOR: "#main-content > explore-subrouter > ui-view > lk-explore-dataflux > lk-explore-header > div.title-controls > button.btn.btn-default"
  };

  var state = {
    latestIframeUrl: "",
    latestIframeOrigin: "",
    latestIframeAt: 0,
    lastResolvedQid: "",
    lastResolvedResolverUrl: "",
    recoveryModeActive: false,
    overlayOffsetTimerId: null,
    lastOverlayOffsetsKey: "",
    pendingQidRequests: {},
    topPingTimerId: null,
    topPingAttempts: 0,
    loadGateAttempts: 0,
    latestIframeBroken: null,
    latestIframeLoaded: null,
    latestIframeHealthReason: "",
    latestIframeHealthAt: 0,
    recoveryActivatedOnce: false,
    lastAppliedHealthKey: "",
    lastDynamicAudit: null,
    dynamicTrimModalSourceUrl: "",
    lastDynamicTrimSelection: []
  };

  function clampText(input, maxLen) {
    var text = (input || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    if (text.length <= maxLen) return text;
    return text.slice(0, Math.max(1, maxLen - 1)).trim() + "...";
  }

  function isAllowedOrigin(origin) {
    return !!ALLOWED_ORIGINS[origin];
  }

  function getContextLabel() {
    if (window.top === window.self) {
      return "Top";
    }

    var frameEl = window.frameElement;
    var frameName = "unnamed";

    if (window.name) {
      frameName = window.name;
    } else if (frameEl && frameEl.getAttribute && frameEl.getAttribute("name")) {
      frameName = frameEl.getAttribute("name");
    } else if (frameEl && frameEl.id) {
      frameName = frameEl.id;
    }

    return "Iframe:" + frameName;
  }

  function getMessageSourceLabel(event) {
    if (!event) return "self";

    if (event.origin === "https://app.lightspeedanalytics.net") {
      return "Iframe(app.lightspeedanalytics.net)";
    }

    if (event.origin === "https://lightspeedanalytics.net") {
      return "Top(lightspeedanalytics.net)";
    }

    return "Unknown(" + (event.origin || "no-origin") + ")";
  }

  function safeLog(prefix, payload, event) {
    var runner = getContextLabel();
    var source = getMessageSourceLabel(event);
    var sourceOrigin = event && event.origin ? event.origin : "self";
    var enrichedPayload = Object.assign({}, payload || {}, {
      runner: runner,
      source: source,
      self: window.location.origin,
      messageOrigin: sourceOrigin
    });

    console.log("[TM-SKELETON] " + prefix, enrichedPayload);
  }

  function encodeWireMessage(message) {
    try {
      return JSON.stringify(message || {});
    } catch (e) {
      return "{}";
    }
  }

  function decodeWireMessage(rawData) {
    if (!rawData) return null;

    if (typeof rawData === "string") {
      try {
        return JSON.parse(rawData);
      } catch (e) {
        return null;
      }
    }

    if (typeof rawData === "object") {
      return rawData;
    }

    return null;
  }

  function updateStatus(text) {
    var statusEl = document.getElementById("tm-status");
    if (!statusEl) return;
    statusEl.textContent = text;
  }

  function updateQid(text) {
    var qidEl = document.getElementById("tm-qid");
    if (!qidEl) return;
    qidEl.textContent = text;
  }

  function updateResolvedQidLink() {
    var linkEl = document.getElementById("tm-qid-link");
    if (!linkEl) return;

    var canOpen = !!(state.lastResolvedQid && state.lastResolvedResolverUrl);
    if (!canOpen) {
      linkEl.textContent = "Open resolved QID report: (not available)";
      linkEl.removeAttribute("href");
      linkEl.style.pointerEvents = "none";
      linkEl.style.opacity = "0.65";
      return;
    }

    linkEl.textContent = "Open resolved QID report";
    linkEl.href = state.lastResolvedResolverUrl;
    linkEl.target = "_blank";
    linkEl.rel = "noopener noreferrer";
    linkEl.style.pointerEvents = "auto";
    linkEl.style.opacity = "1";
  }

  function updateRepostButtonState() {
    var repostBtn = document.getElementById("tm-btn-repost");
    if (!repostBtn) return;

    repostBtn.disabled = !(state.lastResolvedQid && state.lastResolvedResolverUrl);
    updateResolvedQidLink();
  }

  function deriveDefaultRepostName() {
    try {
      if (state.latestIframeUrl) {
        var fromLatest = new URL(state.latestIframeUrl).searchParams.get("title") || "";
        if (fromLatest) return fromLatest + " (Repost)";
      }
    } catch (e1) {
      null;
    }

    return "Recovered Report " + new Date().toLocaleString();
  }

  function buildRepostPayload(title, shareEnabled) {
    return {
      title: title,
      description: "",
      url: state.lastResolvedResolverUrl,
      category_id: CONFIG.REPOST_CATEGORY_ID,
      report_id: CONFIG.REPOST_REPORT_ID,
      share: !!shareEnabled
    };
  }

  function postRecoveredReport(payload) {
    return fetch(CONFIG.REPORTS_POST_URL, {
      headers: {
        accept: "*/*",
        "content-type": "application/json"
      },
      referrer: document.URL,
      referrerPolicy: "strict-origin-when-cross-origin",
      body: JSON.stringify(payload),
      method: "POST",
      mode: "cors",
      credentials: "include"
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("Repost failed with status " + response.status);
      }
      return response.json();
    });
  }

  function updateQidLoadingText(text) {
    var textEl = document.getElementById("tm-qid-loading-text");
    if (!textEl) return;
    textEl.textContent = text;
  }

  function showQidLoading(text) {
    var loadingEl = document.getElementById("tm-qid-loading");
    if (!loadingEl) return;
    updateQidLoadingText(text || "Resolving QID...");
    loadingEl.style.display = "block";
  }

  function hideQidLoading() {
    var loadingEl = document.getElementById("tm-qid-loading");
    if (!loadingEl) return;
    loadingEl.style.display = "none";
  }

  function setRecoveryMode(active) {
    var overlay = document.getElementById("tm-overlay");
    if (!overlay) return;

    state.recoveryModeActive = !!active;
    overlay.style.display = active ? "block" : "none";
  }

  function detectBrokenReportSignature() {
    var bodyText = "";
    if (document.body) {
      bodyText = document.body.innerText || document.body.textContent || "";
    }

    if (!bodyText) {
      return {
        broken: false,
        reason: ""
      };
    }

    var hasPumaPrefix = bodyText.indexOf("Puma caught this error:") !== -1;
    var hasHttpParserError = bodyText.indexOf("Puma::HttpParserError") !== -1;
    var hasQueryStringLengthText = bodyText.indexOf("QUERY_STRING is longer than the 10240 allowed length") !== -1;

    if (!(hasPumaPrefix && hasHttpParserError) && !hasQueryStringLengthText) {
      return {
        broken: false,
        reason: ""
      };
    }

    var excerpt = "";
    var pumaPrefix = "Puma caught this error:";
    var pumaIndex = bodyText.indexOf(pumaPrefix);
    if (pumaIndex !== -1) {
      excerpt = clampText(bodyText.slice(pumaIndex, pumaIndex + 240), 220);
    }

    if (!excerpt && hasQueryStringLengthText) {
      excerpt = "Puma caught this error: HTTP element QUERY_STRING is longer than the 10240 allowed length. (Puma::HttpParserError)";
    }

    return {
      broken: true,
      reason: excerpt
    };
  }

  function detectLoadedReportSignature() {
    try {
      return !!document.querySelector(CONFIG.IFRAME_LOADED_BUTTON_SELECTOR);
    } catch (e) {
      return false;
    }
  }

  function getIframeHealthSnapshot() {
    var detection = detectBrokenReportSignature();
    var loaded = detectLoadedReportSignature();
    var status = "loading";

    if (detection.broken) {
      status = "broken";
    } else if (loaded) {
      status = "loaded";
    }

    return {
      broken: !!detection.broken,
      loaded: loaded,
      status: status,
      reason: detection.reason || "",
      href: window.location.href,
      at: Date.now()
    };
  }

  function applyIframeHealthFromMessage(data, event) {
    if (!data || !data.health) return;

    var health = data.health;
    var isBroken = !!health.broken;
    var isLoaded = !!health.loaded;
    var status = health.status || (isBroken ? "broken" : (isLoaded ? "loaded" : "loading"));
    var reason = clampText(health.reason || "", 220);
    var wasBroken = state.latestIframeBroken;
    var wasLoaded = state.latestIframeLoaded;
    var previousKey = state.lastAppliedHealthKey;
    var healthKey = String(isBroken) + ":" + String(isLoaded) + ":" + reason;

    state.latestIframeBroken = isBroken;
    state.latestIframeLoaded = isLoaded;
    state.latestIframeHealthReason = reason;
    state.latestIframeHealthAt = health.at || Date.now();
    state.lastAppliedHealthKey = healthKey;

    if (previousKey !== healthKey) {
      safeLog("Received IFRAME_HEALTH", {
        status: status,
        broken: isBroken,
        loaded: isLoaded,
        reason: reason,
        href: health.href || data.href || "",
        at: state.latestIframeHealthAt
      }, event);
    }

    if (isBroken && wasBroken !== true) {
      activateRecoveryTool("Iframe reported Puma error." + (reason ? " " + reason : ""));
      return;
    }

    if (!isBroken && isLoaded && wasLoaded !== true) {
      updateStatus("Iframe reports loaded fine (header button found).");
      safeLog("Iframe reports loaded fine", {
        status: status,
        selector: CONFIG.IFRAME_LOADED_BUTTON_SELECTOR,
        at: state.latestIframeHealthAt
      }, event);
      return;
    }

    if (state.recoveryModeActive) {
      updateStatus("Iframe health check reports no Puma error.");
    }
  }

  function getVisibleRect(el) {
    if (!el) return null;

    var style = window.getComputedStyle(el);
    if (!style || style.display === "none" || style.visibility === "hidden") {
      return null;
    }

    var rect = el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    return rect;
  }

  function computeOverlayOffsets() {
    var top = CONFIG.TOP_NAV_FALLBACK_PX;
    var left = CONFIG.MIN_LEFT_NAV_GUTTER_PX;

    var topNavSelectors = [
      ".cd-main-header",
      "#top-bar-buttons-react-root",
      ".cd-top-nav"
    ];

    for (var t = 0; t < topNavSelectors.length; t++) {
      var topNodes = document.querySelectorAll(topNavSelectors[t]);
      for (var tn = 0; tn < topNodes.length; tn++) {
        var topRect = getVisibleRect(topNodes[tn]);
        if (!topRect) continue;

        // Only consider nav-like elements that are near top and not gigantic.
        if (topRect.top <= 10 && topRect.height > 0 && topRect.height <= CONFIG.MAX_TOP_OFFSET_PX) {
          top = Math.max(top, Math.ceil(topRect.bottom));
        }
      }
    }

    top = Math.min(top, CONFIG.MAX_TOP_OFFSET_PX);

    var sideSelectors = [
      ".cd-side-nav",
      ".cd-secondary-nav",
      ".c-menu--slide-left",
      "#Admin-Menu",
      "#Super-User-Menu"
    ];

    for (var i = 0; i < sideSelectors.length; i++) {
      var nodes = document.querySelectorAll(sideSelectors[i]);
      for (var n = 0; n < nodes.length; n++) {
        var rect = getVisibleRect(nodes[n]);
        if (rect) {
          // Keep left nav pass-through only for elements anchored near the left edge.
          if (rect.left <= CONFIG.MAX_LEFT_ANCHORED_START_PX && rect.right > 0 && rect.width <= 420) {
            left = Math.max(left, Math.ceil(rect.right));
          }
        }
      }
    }

    return { top: top, left: left };
  }

  function applyOverlayOffsets() {
    var overlay = document.getElementById("tm-overlay");
    var panel = document.getElementById("tm-panel");
    if (!overlay || !panel) return;

    var offsets = computeOverlayOffsets();
    overlay.style.top = offsets.top + "px";
    overlay.style.left = offsets.left + "px";

    var offsetKey = offsets.top + ":" + offsets.left;
    if (state.lastOverlayOffsetsKey !== offsetKey) {
      state.lastOverlayOffsetsKey = offsetKey;
      safeLog("Overlay offsets applied", offsets);
    }
  }

  function startOverlayOffsetWatcher() {
    if (state.overlayOffsetTimerId) return;

    applyOverlayOffsets();
    window.addEventListener("resize", applyOverlayOffsets);
    state.overlayOffsetTimerId = window.setInterval(applyOverlayOffsets, 1200);
  }

  function stopOverlayOffsetWatcher() {
    if (!state.overlayOffsetTimerId) return;

    window.clearInterval(state.overlayOffsetTimerId);
    state.overlayOffsetTimerId = null;
    window.removeEventListener("resize", applyOverlayOffsets);
  }

  function removeExistingDump() {
    var old = document.getElementById("tm-dump-root");
    if (old && old.parentNode) {
      old.parentNode.removeChild(old);
    }
  }

  function getDumpMountNode() {
    var mount = document.getElementById("tm-dump-mount");
    return mount || document.body;
  }

  function createKeyValueTable(rows) {
    var table = document.createElement("table");
    table.className = "tm-table";

    for (var i = 0; i < rows.length; i++) {
      var tr = document.createElement("tr");
      if (i === 0) tr.className = "tm-header-row";

      var td1 = document.createElement("td");
      var td2 = document.createElement("td");
      td1.textContent = rows[i][0];
      td2.textContent = rows[i][1];

      tr.appendChild(td1);
      tr.appendChild(td2);
      table.appendChild(tr);
    }

    return table;
  }

  function createDynamicTable(dynamicFields) {
    var table = document.createElement("table");
    table.className = "tm-table";

    var headers = ["#", "Category", "Label", "Type", "Based On", "Expression"];
    var headerRow = document.createElement("tr");
    headerRow.className = "tm-header-row";
    for (var h = 0; h < headers.length; h++) {
      var th = document.createElement("td");
      th.textContent = headers[h];
      headerRow.appendChild(th);
    }
    table.appendChild(headerRow);

    for (var i = 0; i < dynamicFields.length; i++) {
      var row = dynamicFields[i] || {};
      var tr = document.createElement("tr");

      var values = [
        String(i + 1),
        row.category || "",
        row.label || "",
        row.type || row._type_hint || "",
        row.based_on || row.dimension || row.measure || "",
        row.expression || row.filter_expression || ""
      ];

      for (var c = 0; c < values.length; c++) {
        var td = document.createElement("td");
        td.textContent = values[c];
        tr.appendChild(td);
      }

      table.appendChild(tr);
    }

    return table;
  }

  function createFilterTable(filters) {
    var rows = [["Filter", "Value"]];
    for (var i = 0; i < filters.length; i++) {
      rows.push([filters[i].key, filters[i].value]);
    }
    return createKeyValueTable(rows);
  }

  function escapeRegExp(input) {
    return String(input || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function containsIdentifier(haystack, identifier) {
    var text = String(haystack || "");
    var id = String(identifier || "").trim();
    if (!text || !id) return false;

    var pattern = new RegExp("(^|[^A-Za-z0-9_])" + escapeRegExp(id) + "([^A-Za-z0-9_]|$)", "i");
    return pattern.test(text);
  }

  function buildDynamicFieldLabel(row, index) {
    if (!row) return "dynamic_" + String(index + 1);
    return row.label || row.measure || row.dimension || row.name || ("dynamic_" + String(index + 1));
  }

  function getDynamicFieldType(row) {
    if (!row) return "";
    return String(row.type || row._type_hint || row.category || row.kind || "").toLowerCase();
  }

  function isTableCalculationType(row) {
    var type = getDynamicFieldType(row);
    if (type.indexOf("table") !== -1 && type.indexOf("calc") !== -1) return true;

    if (row && row.category && String(row.category).toLowerCase().indexOf("table") !== -1 && String(row.category).toLowerCase().indexOf("calc") !== -1) {
      return true;
    }

    if (row && row.table_calculation) return true;
    return false;
  }

  function collectDynamicIdentifiers(row) {
    var seen = {};
    var ids = [];

    function pushId(value) {
      var v = String(value || "").trim();
      if (!v) return;
      var key = v.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      ids.push(v);
    }

    pushId(row && row.name);
    pushId(row && row.measure);
    pushId(row && row.dimension);
    pushId(row && row.label_short);
    pushId(row && row.label);

    return ids;
  }

  function buildDynamicExpressionBlob(row) {
    if (!row || typeof row !== "object") return "";

    var parts = [
      row.expression,
      row.filter_expression,
      row.table_calculation,
      row.sql,
      row.sql_where,
      row.formula,
      row.value_format,
      row.html
    ];

    return parts
      .filter(function (part) {
        return typeof part === "string" && part.trim();
      })
      .join("\n");
  }

  function buildDynamicFieldAudit(dynamicFields, contextText) {
    var rows = [];
    var indexByIdentifier = {};
    var requiredMap = {};

    if (!Array.isArray(dynamicFields) || dynamicFields.length === 0) {
      return {
        rows: [],
        removableIndexes: [],
        requiredIndexes: [],
        totalCount: 0,
        removableCount: 0,
        requiredCount: 0
      };
    }

    for (var i = 0; i < dynamicFields.length; i++) {
      var row = dynamicFields[i] || {};
      var ids = collectDynamicIdentifiers(row);
      var entry = {
        index: i,
        label: buildDynamicFieldLabel(row, i),
        type: getDynamicFieldType(row) || "unknown",
        ids: ids,
        blob: buildDynamicExpressionBlob(row),
        dependsOn: {},
        referencedBy: {},
        rootReferenced: false,
        required: false,
        reason: "",
        tableCalculation: isTableCalculationType(row),
        defaultRemove: false,
        statusLabel: "",
        statusClass: ""
      };

      rows.push(entry);

      for (var idIdx = 0; idIdx < ids.length; idIdx++) {
        var key = ids[idIdx].toLowerCase();
        if (!indexByIdentifier[key]) indexByIdentifier[key] = [];
        indexByIdentifier[key].push(i);
      }
    }

    for (var r = 0; r < rows.length; r++) {
      var rowEntry = rows[r];
      for (var rid = 0; rid < rowEntry.ids.length; rid++) {
        if (containsIdentifier(contextText, rowEntry.ids[rid])) {
          rowEntry.rootReferenced = true;
          requiredMap[r] = true;
          break;
        }
      }
    }

    for (var src = 0; src < rows.length; src++) {
      var sourceRow = rows[src];
      if (!sourceRow.blob) continue;

      for (var key in indexByIdentifier) {
        if (!Object.prototype.hasOwnProperty.call(indexByIdentifier, key)) continue;
        var targets = indexByIdentifier[key];
        var sampleId = key;

        if (!containsIdentifier(sourceRow.blob, sampleId)) continue;

        for (var t = 0; t < targets.length; t++) {
          var targetIdx = targets[t];
          if (targetIdx === src) continue;
          sourceRow.dependsOn[targetIdx] = true;
          rows[targetIdx].referencedBy[src] = true;
        }
      }
    }

    var queue = [];
    for (var reqKey in requiredMap) {
      if (Object.prototype.hasOwnProperty.call(requiredMap, reqKey)) {
        queue.push(Number(reqKey));
      }
    }

    while (queue.length) {
      var current = queue.shift();
      if (rows[current].required) continue;
      rows[current].required = true;

      var deps = rows[current].dependsOn;
      for (var depKey in deps) {
        if (!Object.prototype.hasOwnProperty.call(deps, depKey)) continue;
        var depIdx = Number(depKey);
        if (!rows[depIdx].required) queue.push(depIdx);
      }
    }

    var removableIndexes = [];
    var requiredIndexes = [];

    for (var a = 0; a < rows.length; a++) {
      var auditRow = rows[a];
      var refsBy = Object.keys(auditRow.referencedBy).map(function (idx) {
        return rows[Number(idx)].label;
      });

      var depsOn = Object.keys(auditRow.dependsOn).map(function (idx) {
        return rows[Number(idx)].label;
      });

      if (!auditRow.required && auditRow.tableCalculation) {
        requiredIndexes.push(auditRow.index);
        auditRow.reason = "Table calculation";
        auditRow.statusLabel = "Default Keep";
        auditRow.statusClass = "table-calc";
      } else if (auditRow.required) {
        requiredIndexes.push(auditRow.index);
        if (auditRow.rootReferenced) {
          auditRow.reason = "Referenced by selected fields/sorts/filters";
          auditRow.statusLabel = "Active";
          auditRow.statusClass = "active";
        } else {
          auditRow.reason = "Required by other referenced dynamic fields";
          auditRow.statusLabel = "Active Reference";
          auditRow.statusClass = "active-ref";
        }
      } else {
        removableIndexes.push(auditRow.index);
        if (refsBy.length) {
          auditRow.reason = "Only referenced by removable dynamic fields";
        } else {
          auditRow.reason = "Not referenced by query or dynamic dependencies";
        }
        auditRow.statusLabel = "Preflag Remove";
        auditRow.statusClass = "removable";
      }

      auditRow.defaultRemove = auditRow.statusClass === "removable";

      auditRow.refsByLabels = refsBy;
      auditRow.depLabels = depsOn;
    }

    return {
      rows: rows,
      removableIndexes: removableIndexes,
      requiredIndexes: requiredIndexes,
      totalCount: rows.length,
      removableCount: removableIndexes.length,
      requiredCount: requiredIndexes.length
    };
  }

  function createDynamicAuditTable(audit) {
    var table = document.createElement("table");
    table.className = "tm-table";

    var headers = ["#", "Dynamic", "Status", "Reason", "References", "Referenced By"];
    var headerRow = document.createElement("tr");
    headerRow.className = "tm-header-row";
    for (var h = 0; h < headers.length; h++) {
      var head = document.createElement("td");
      head.textContent = headers[h];
      headerRow.appendChild(head);
    }
    table.appendChild(headerRow);

    for (var i = 0; i < audit.rows.length; i++) {
      var row = audit.rows[i];
      var tr = document.createElement("tr");
      var values = [
        String(row.index + 1),
        row.label,
        row.required ? "Keep" : "Preflag Remove",
        row.reason,
        row.depLabels && row.depLabels.length ? row.depLabels.join(", ") : "",
        row.refsByLabels && row.refsByLabels.length ? row.refsByLabels.join(", ") : ""
      ];

      for (var c = 0; c < values.length; c++) {
        var td = document.createElement("td");
        td.textContent = values[c];
        tr.appendChild(td);
      }

      table.appendChild(tr);
    }

    return table;
  }

  function createDynamicTrimSelectionTable(audit, selectedIndexesMap) {
    var table = document.createElement("table");
    table.className = "tm-table";

    var headers = ["Trim", "#", "Dynamic", "Type", "Status", "Reason", "References", "Referenced By"];
    var headerRow = document.createElement("tr");
    headerRow.className = "tm-header-row";
    for (var h = 0; h < headers.length; h++) {
      var head = document.createElement("td");
      head.textContent = headers[h];
      headerRow.appendChild(head);
    }
    table.appendChild(headerRow);

    for (var i = 0; i < audit.rows.length; i++) {
      var row = audit.rows[i];
      var tr = document.createElement("tr");
      tr.className = "tm-audit-" + (row.statusClass || "unknown");

      var trimTd = document.createElement("td");
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.setAttribute("data-dyn-trim-index", String(row.index));
      checkbox.checked = !!(selectedIndexesMap && selectedIndexesMap[row.index]);
      trimTd.appendChild(checkbox);
      tr.appendChild(trimTd);

      var values = [
        String(row.index + 1),
        row.label,
        row.type || "",
        row.statusLabel || "",
        row.reason,
        row.depLabels && row.depLabels.length ? row.depLabels.join(", ") : "",
        row.refsByLabels && row.refsByLabels.length ? row.refsByLabels.join(", ") : ""
      ];

      for (var c = 0; c < values.length; c++) {
        var td = document.createElement("td");
        td.textContent = values[c];
        if (c === 3) {
          td.className = "tm-status-pill tm-status-" + (row.statusClass || "unknown");
        }
        tr.appendChild(td);
      }

      table.appendChild(tr);
    }

    return table;
  }

  function getSelectedDynamicTrimIndexesFromDom() {
    var boxes = document.querySelectorAll("input[data-dyn-trim-index]");
    var selected = [];

    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      if (!box.checked) continue;

      var idx = Number(box.getAttribute("data-dyn-trim-index") || "-1");
      if (!Number.isFinite(idx) || idx < 0) continue;
      selected.push(idx);
    }

    return selected;
  }

  function setDynamicTrimSelectionFromAuditDefault(audit) {
    var boxes = document.querySelectorAll("input[data-dyn-trim-index]");
    var defaultMap = {};
    if (audit && audit.rows) {
      for (var r = 0; r < audit.rows.length; r++) {
        if (audit.rows[r].defaultRemove) {
          defaultMap[audit.rows[r].index] = true;
        }
      }
    }

    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      var idx = Number(box.getAttribute("data-dyn-trim-index") || "-1");
      box.checked = !!defaultMap[idx];
    }
  }

  function setDynamicTrimSelectionAll(value) {
    var boxes = document.querySelectorAll("input[data-dyn-trim-index]");
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].checked = !!value;
    }
  }

  function getDynamicTrimSourceUrl() {
    // Prefer the last modal source so users can re-open and adjust trim choices
    // against the same baseline URL instead of the already-trimmed resolver URL.
    if (state.dynamicTrimModalSourceUrl) return state.dynamicTrimModalSourceUrl;
    if (state.latestIframeUrl) return state.latestIframeUrl;
    if (state.lastResolvedResolverUrl) return state.lastResolvedResolverUrl;
    return "";
  }

  function openDynamicTrimModal() {
    var modal = document.getElementById("tm-dynamic-trim-modal");
    var tableHost = document.getElementById("tm-dynamic-trim-table-wrap");
    var meta = document.getElementById("tm-dynamic-trim-meta");
    var status = document.getElementById("tm-dynamic-trim-status");
    if (!modal || !tableHost || !meta || !status) return;

    var sourceUrl = getDynamicTrimSourceUrl();
    if (!sourceUrl) {
      updateStatus("Dynamic trim unavailable: no source URL yet.");
      return;
    }

    var plan;
    try {
      plan = buildDynamicTrimPlan(sourceUrl, null);
    } catch (e) {
      updateStatus("Dynamic trim failed: " + (e && e.message ? e.message : String(e)));
      return;
    }

    state.dynamicTrimModalSourceUrl = sourceUrl;
    state.lastDynamicAudit = plan.audit || null;

    var selectedMap = {};
    if (state.lastDynamicTrimSelection && state.lastDynamicTrimSelection.length) {
      for (var s = 0; s < state.lastDynamicTrimSelection.length; s++) {
        selectedMap[state.lastDynamicTrimSelection[s]] = true;
      }
    } else if (plan.audit && plan.audit.rows) {
      for (var r = 0; r < plan.audit.rows.length; r++) {
        if (plan.audit.rows[r].defaultRemove) {
          selectedMap[plan.audit.rows[r].index] = true;
        }
      }
    }

    tableHost.textContent = "";
    if (plan.audit && plan.audit.rows && plan.audit.rows.length) {
      tableHost.appendChild(createDynamicTrimSelectionTable(plan.audit, selectedMap));
      meta.textContent = "Keep=" + plan.audit.requiredCount + " | Preflag Remove=" + plan.audit.removableCount + " | Total=" + plan.audit.totalCount;
      status.textContent = "Select dynamic fields to trim, then apply.";
    } else {
      meta.textContent = "No dynamic fields found on source URL.";
      status.textContent = "Nothing to trim.";
    }

    modal.style.display = "block";
  }

  function closeDynamicTrimModal() {
    var modal = document.getElementById("tm-dynamic-trim-modal");
    if (!modal) return;
    modal.style.display = "none";
  }

  function applyDynamicTrimSelectionToResolverUrl() {
    var sourceUrl = state.dynamicTrimModalSourceUrl || state.lastResolvedResolverUrl || state.latestIframeUrl || "";
    if (!sourceUrl) {
      updateStatus("Trim apply skipped: no source URL.");
      return;
    }

    var selectedIndexes = getSelectedDynamicTrimIndexesFromDom();
    state.lastDynamicTrimSelection = selectedIndexes.slice();

    var plan;
    try {
      plan = buildDynamicTrimPlan(sourceUrl, selectedIndexes);
    } catch (e) {
      updateStatus("Trim apply failed: " + (e && e.message ? e.message : String(e)));
      return;
    }

    if (state.lastResolvedResolverUrl) {
      state.lastResolvedResolverUrl = plan.trimmedUrl;
      updateRepostButtonState();
      updateResolvedQidLink();
    }

    state.lastDynamicAudit = plan.audit || state.lastDynamicAudit;
    updateStatus("Trim applied: removed " + plan.removedCount + " of " + plan.totalCount + " dynamic fields.");

    var status = document.getElementById("tm-dynamic-trim-status");
    if (status) {
      status.textContent = "Applied trim: removed " + plan.removedCount + " dynamic fields.";
    }
  }

  function startQidResolveFlow(resolverUrl, uiOptions, labelPrefix) {
    updateStatus(labelPrefix + "...");
    updateQid("QID: resolving...");
    showQidLoading("Preparing resolver candidates...");

    resolveQidWithStrategy(resolverUrl, uiOptions, function (progress) {
      if (!progress || progress.phase !== "trying") return;

      var msg = "Trying " + progress.strategy + " (" + progress.index + "/" + progress.total + ")";
      updateQidLoadingText(msg);
      updateStatus(labelPrefix + "... " + msg);
    })
      .then(function (payload) {
        hideQidLoading();
        var resolvedQid = payload.qid || extractQid(payload.href || "") || "";
        state.lastResolvedQid = resolvedQid;
        state.lastResolvedResolverUrl = payload.href || payload.resolverUrl || "";
        updateQid("QID: " + (resolvedQid || "(empty)"));
        if (resolvedQid) {
          var repostNameEl = document.getElementById("tm-repost-name");
          if (repostNameEl && !repostNameEl.value) {
            repostNameEl.value = deriveDefaultRepostName();
          }
        }
        updateRepostButtonState();
        updateStatus("Resolved QID via " + (payload.mode || "resolver") + " using " + (payload.strategy || "selected-toggles") + ".");
        safeLog("Resolved QID", {
          qid: resolvedQid,
          mode: payload.mode || "resolver",
          strategy: payload.strategy || "selected-toggles",
          href: payload.href || ""
        });
      })
      .catch(function (resolveError) {
        hideQidLoading();
        state.lastResolvedQid = "";
        state.lastResolvedResolverUrl = "";
        updateRepostButtonState();
        updateQid("QID: (failed)");
        updateStatus("Resolve QID failed: " + resolveError.message);
        safeLog("Resolve QID failed", { error: resolveError.message });
      });
  }

  function trimUnusedDynamicFieldsFromUrl(urlString) {
    return buildDynamicTrimPlan(urlString, null);
  }

  function buildDynamicTrimPlan(urlString, explicitRemoveIndexes) {
    var parsed = new URL(urlString);
    var dynamicRaw = parsed.searchParams.get("dynamic_fields") || "";
    var dynamicParsed = safeJsonParse(dynamicRaw);
    var dynamicFields = Array.isArray(dynamicParsed) ? dynamicParsed : [];

    if (!dynamicFields.length) {
      return {
        trimmedUrl: urlString,
        removedCount: 0,
        totalCount: 0,
        audit: null
      };
    }

    var fieldsRaw = parsed.searchParams.get("fields") || "";
    var fields = fieldsRaw ? fieldsRaw.split(",") : [];
    var contextParts = [
      fields.join(","),
      parsed.searchParams.get("sorts") || "",
      parsed.searchParams.get("filter_config") || ""
    ];

    var filters = [];
    parsed.searchParams.forEach(function (value, key) {
      if (key.indexOf("f[") === 0) {
        filters.push(key + "=" + value);
      }
    });
    contextParts.push(filters.join("|"));

    var audit = buildDynamicFieldAudit(dynamicFields, contextParts.join("\n"));

    var removeMap = {};
    if (Array.isArray(explicitRemoveIndexes)) {
      // An explicit (even empty) selection is user intent. Empty means remove none.
      for (var er = 0; er < explicitRemoveIndexes.length; er++) {
        var explicitIdx = Number(explicitRemoveIndexes[er]);
        if (!Number.isFinite(explicitIdx)) continue;
        if (explicitIdx < 0 || explicitIdx >= dynamicFields.length) continue;
        removeMap[explicitIdx] = true;
      }
    } else {
      for (var dr = 0; dr < audit.rows.length; dr++) {
        if (audit.rows[dr].defaultRemove) {
          removeMap[dr] = true;
        }
      }
    }

    var plannedRemoveIndexes = Object.keys(removeMap).map(function (idx) {
      return Number(idx);
    });

    if (!plannedRemoveIndexes.length) {
      return {
        trimmedUrl: urlString,
        removedCount: 0,
        totalCount: audit.totalCount,
        audit: audit,
        selectedRemoveIndexes: []
      };
    }

    var kept = [];
    for (var d = 0; d < dynamicFields.length; d++) {
      if (!removeMap[d]) kept.push(dynamicFields[d]);
    }

    parsed.searchParams.set("dynamic_fields", JSON.stringify(kept));

    return {
      trimmedUrl: parsed.toString(),
      removedCount: plannedRemoveIndexes.length,
      totalCount: audit.totalCount,
      audit: audit,
      selectedRemoveIndexes: plannedRemoveIndexes
    };
  }

  function makeRequestId() {
    return "req_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
  }

  function appendRequestIdHash(urlString, requestId) {
    var u = new URL(urlString);
    u.hash = "tmrid=" + encodeURIComponent(requestId);
    return u.toString();
  }

  function getTargetOriginFromReferrer() {
    if (!document.referrer) return "*";
    try {
      return new URL(document.referrer).origin;
    } catch (e) {
      return "*";
    }
  }

  function extractQid(urlString) {
    try {
      var u = new URL(urlString);
      var qid = u.searchParams.get("qid") || "";
      if (qid) return qid;

      if (u.hash && u.hash.indexOf("qid=") !== -1) {
        var hash = u.hash.charAt(0) === "#" ? u.hash.slice(1) : u.hash;
        var pieces = hash.split("&");
        for (var i = 0; i < pieces.length; i++) {
          if (pieces[i].indexOf("qid=") === 0) {
            return decodeURIComponent(pieces[i].slice(4) || "");
          }
        }
      }

      return "";
    } catch (e) {
      return "";
    }
  }

  function findQidFromCurrentDocument() {
    var candidates = [];

    candidates.push(window.location.href);
    candidates.push(document.URL || "");

    var iframes = document.querySelectorAll("iframe");
    for (var i = 0; i < iframes.length; i++) {
      var frame = iframes[i];
      if (frame && frame.src) {
        candidates.push(frame.src);
      }

      try {
        if (frame && frame.contentWindow && frame.contentWindow.location && frame.contentWindow.location.href) {
          candidates.push(frame.contentWindow.location.href);
        }
      } catch (frameAccessError) {
        null;
      }
    }

    var anchors = document.querySelectorAll("a[href*='qid=']");
    for (var a = 0; a < anchors.length; a++) {
      candidates.push(anchors[a].href || "");
    }

    for (var c = 0; c < candidates.length; c++) {
      var candidateUrl = candidates[c];
      if (!candidateUrl) continue;
      var qid = extractQid(candidateUrl);
      if (qid) {
        return {
          qid: qid,
          sourceUrl: candidateUrl
        };
      }
    }

    return {
      qid: "",
      sourceUrl: ""
    };
  }

  function completePendingQidRequest(requestId, payload) {
    var pending = state.pendingQidRequests[requestId];
    if (!pending) return false;

    if (pending.timeoutId) window.clearTimeout(pending.timeoutId);
    if (pending.cleanup) pending.cleanup();
    delete state.pendingQidRequests[requestId];

    pending.resolve(payload);
    return true;
  }

  function failPendingQidRequest(requestId, reason) {
    var pending = state.pendingQidRequests[requestId];
    if (!pending) return false;

    if (pending.timeoutId) window.clearTimeout(pending.timeoutId);
    if (pending.cleanup) pending.cleanup();
    delete state.pendingQidRequests[requestId];

    pending.reject(new Error(reason));
    return true;
  }

  function requestQidViaHiddenIframe(resolverUrl, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var requestId = makeRequestId();
      var requestUrl = resolverUrl;
      var resolverFrame = document.createElement("iframe");
      var isCleaned = false;

      resolverFrame.id = "tm-qid-resolver-" + requestId;
      resolverFrame.name = requestId;
      resolverFrame.style.position = "fixed";
      resolverFrame.style.width = "1px";
      resolverFrame.style.height = "1px";
      resolverFrame.style.opacity = "0";
      resolverFrame.style.pointerEvents = "none";
      resolverFrame.style.left = "-10000px";
      resolverFrame.style.top = "-10000px";

      function cleanup() {
        if (isCleaned) return;
        isCleaned = true;
        if (resolverFrame.parentNode) {
          resolverFrame.parentNode.removeChild(resolverFrame);
        }
      }

      var timeoutId = window.setTimeout(function () {
        failPendingQidRequest(requestId, "Hidden iframe resolver timed out");
      }, timeoutMs);

      state.pendingQidRequests[requestId] = {
        mode: "hidden-iframe",
        resolve: resolve,
        reject: reject,
        cleanup: cleanup,
        timeoutId: timeoutId
      };

      resolverFrame.src = requestUrl;
      document.body.appendChild(resolverFrame);

      safeLog("Started hidden iframe resolver", {
        requestId: requestId,
        requestUrl: requestUrl
      });
    });
  }

  function requestQidViaPopup(resolverUrl, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var requestId = makeRequestId();
      var requestUrl = appendRequestIdHash(resolverUrl, requestId);
      // Intentionally keep opener to mirror legacy popup->opener postMessage flow.
      var popupRef = window.open(requestUrl, "_blank");
      var closePollId = null;

      if (!popupRef) {
        reject(new Error("Popup blocked"));
        return;
      }

      try {
        popupRef.name = requestId;
      } catch (setNameError) {
        null;
      }

      function cleanup() {
        if (closePollId) {
          window.clearInterval(closePollId);
          closePollId = null;
        }
      }

      closePollId = window.setInterval(function () {
        if (popupRef.closed) {
          failPendingQidRequest(requestId, "Popup closed before QID response");
        }
      }, 300);

      var timeoutId = window.setTimeout(function () {
        failPendingQidRequest(requestId, "Popup resolver timed out");
      }, timeoutMs);

      state.pendingQidRequests[requestId] = {
        mode: "popup",
        resolve: resolve,
        reject: reject,
        cleanup: cleanup,
        timeoutId: timeoutId
      };

      safeLog("Started popup resolver", {
        requestId: requestId,
        requestUrl: requestUrl
      });
    });
  }

  function resolveQidWithFallback(resolverUrl, timeoutMs) {
    var useTimeout = timeoutMs || CONFIG.QID_RESOLVE_TIMEOUT_MS;

    if (CONFIG.USE_POPUP_RESOLVER_ONLY) {
      return requestQidViaPopup(resolverUrl, useTimeout);
    }

    return requestQidViaHiddenIframe(resolverUrl, useTimeout).catch(function (iframeError) {
      safeLog("Hidden iframe resolver failed", {
        error: iframeError && iframeError.message ? iframeError.message : String(iframeError)
      });
      return requestQidViaPopup(resolverUrl, useTimeout);
    });
  }

  function resolveQidWithStrategy(sourceUrl, uiOptions, onProgress) {
    var candidates = buildResolverCandidates(sourceUrl, uiOptions);
    var attemptTimeout = CONFIG.QID_RESOLVE_ATTEMPT_TIMEOUT_MS;

    return new Promise(function (resolve, reject) {
      var idx = 0;
      var lastError = null;

      function tryNext() {
        if (idx >= candidates.length) {
          reject(lastError || new Error("No resolver candidates left"));
          return;
        }

        var candidate = candidates[idx++];
        if (onProgress) {
          onProgress({
            phase: "trying",
            strategy: candidate.label,
            index: idx,
            total: candidates.length,
            url: candidate.url
          });
        }

        safeLog("Trying resolver candidate", {
          strategy: candidate.label,
          urlLength: candidate.url.length,
          index: idx,
          total: candidates.length
        });

        resolveQidWithFallback(candidate.url, attemptTimeout)
          .then(function (payload) {
            var qid = payload && payload.qid ? payload.qid : "";
            if (!qid) {
              lastError = new Error("Resolver returned empty qid");
              tryNext();
              return;
            }

            payload.strategy = candidate.label;
            payload.resolverUrl = candidate.url;
            resolve(payload);
          })
          .catch(function (err) {
            lastError = err;
            if (onProgress) {
              onProgress({
                phase: "failed",
                strategy: candidate.label,
                index: idx,
                total: candidates.length,
                error: err && err.message ? err.message : String(err)
              });
            }
            safeLog("Resolver candidate failed", {
              strategy: candidate.label,
              error: err && err.message ? err.message : String(err)
            });
            tryNext();
          });
      }

      tryNext();
    });
  }

  function getResolverUrlFromCurrentSelection() {
    var removeFilters = !!document.getElementById("tm-toggle-filters").checked;
    var removeVis = !!document.getElementById("tm-toggle-vis").checked;
    var base = new URL(state.latestIframeUrl);
    var effective = stripParams(base, removeFilters, removeVis);
    return effective.toString();
  }

  function trySendResolverResultFromCurrentWindow() {
    var requestId = "";

    if (window.name && /^req_/.test(window.name)) {
      requestId = window.name;
    }

    var currentUrl;
    try {
      currentUrl = new URL(window.location.href);
    } catch (e) {
      return;
    }

    if (!requestId) {
      var requestIdFromUrl = currentUrl.searchParams.get("tm_request_id") || "";
      if (requestIdFromUrl) requestId = requestIdFromUrl;
    }

    if (!requestId && currentUrl.hash && currentUrl.hash.indexOf("tmrid=") !== -1) {
      try {
        requestId = decodeURIComponent(currentUrl.hash.split("tmrid=")[1].split("&")[0] || "");
      } catch (hashDecodeError) {
        requestId = "";
      }
    }

    if (!requestId) return;

    var startedAt = Date.now();
    var maxWaitMs = Math.max(2500, CONFIG.QID_RESOLVE_TIMEOUT_MS - 2000);

    function postResolverPayload(foundQid) {
      var qid = foundQid || "";
      var targetOrigin = getTargetOriginFromReferrer();
      var payload = {
        type: qid ? MSG_TYPES.QID_READY : MSG_TYPES.QID_ERROR,
        requestId: requestId,
        qid: qid,
        href: window.location.href,
        reason: qid ? "" : "No qid present after resolver wait window",
        at: Date.now()
      };

      var sent = false;
      try {
        if (window.opener && window.opener !== window) {
          window.opener.postMessage(encodeWireMessage(payload), targetOrigin);
          sent = true;
        }
      } catch (e1) {
        null;
      }

      try {
        if (window.top && window.top !== window) {
          window.top.postMessage(encodeWireMessage(payload), targetOrigin);
          sent = true;
        }
      } catch (e2) {
        null;
      }

      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(encodeWireMessage(payload), targetOrigin);
          sent = true;
        }
      } catch (e3) {
        null;
      }

      safeLog("Resolver payload posted", {
        requestId: requestId,
        qid: qid,
        targetOrigin: targetOrigin,
        sent: sent
      });

      if (window.opener && window.opener !== window) {
        window.setTimeout(function () {
          window.close();
        }, 80);
      }
    }

    function tick() {
      var qidScan = findQidFromCurrentDocument();
      if (qidScan.qid) {
        safeLog("QID discovered in resolver window", {
          requestId: requestId,
          qid: qidScan.qid,
          sourceUrl: qidScan.sourceUrl
        });
        postResolverPayload(qidScan.qid);
        return;
      }

      if ((Date.now() - startedAt) >= maxWaitMs) {
        postResolverPayload("");
        return;
      }

      window.setTimeout(tick, 200);
    }

    tick();
    return;
  }

  function isResolverOnlyWindow() {
    var isAppOrigin = window.location.origin === "https://app.lightspeedanalytics.net";
    if (!isAppOrigin) return false;

    var isExplorePath = window.location.pathname.indexOf("/embed/explore/") !== -1;
    if (!isExplorePath) return false;

    var hasRequestName = !!(window.name && /^req_/.test(window.name));
    var hasHashMarker = !!(window.location.hash && window.location.hash.indexOf("tmrid=") !== -1);

    var hasSearchMarker = false;
    try {
      hasSearchMarker = !!(new URL(window.location.href).searchParams.get("tm_request_id"));
    } catch (e) {
      hasSearchMarker = false;
    }

    var hasOpener = !!(window.opener && window.opener !== window);
    return hasRequestName || hasHashMarker || hasSearchMarker || hasOpener;
  }

  function safeJsonParse(input) {
    if (!input) return null;

    try {
      return JSON.parse(input);
    } catch (e1) {
      try {
        return JSON.parse(decodeURIComponent(input));
      } catch (e2) {
        return null;
      }
    }
  }

  function stripParams(urlObj, removeFilters, removeVis) {
    var out = new URL(urlObj.toString());
    var keys = [];
    out.searchParams.forEach(function (_value, key) {
      keys.push(key);
    });

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (removeVis && key === "vis") {
        out.searchParams.delete(key);
      }

      if (removeFilters && (key.indexOf("f[") === 0 || key === "filter_config")) {
        out.searchParams.delete(key);
      }
    }

    return out;
  }

  function stripDynamicFields(urlString) {
    var out = new URL(urlString);
    out.searchParams.delete("dynamic_fields");
    return out.toString();
  }

  function buildResolverCandidates(sourceUrl, uiOptions) {
    var candidates = [];
    var seen = {};

    function addCandidate(label, urlString) {
      if (!urlString) return;
      if (seen[urlString]) return;
      seen[urlString] = true;
      candidates.push({ label: label, url: urlString });
    }

    var selected = stripParams(new URL(sourceUrl), !!uiOptions.removeFilters, !!uiOptions.removeVis).toString();
    addCandidate("selected-toggles", selected);

    addCandidate("without-vis", stripParams(new URL(sourceUrl), !!uiOptions.removeFilters, true).toString());
    addCandidate("without-filters", stripParams(new URL(sourceUrl), true, !!uiOptions.removeVis).toString());
    addCandidate("without-both", stripParams(new URL(sourceUrl), true, true).toString());

    return candidates;
  }

  function getParamOrBlank(params, key) {
    var value = params.get(key);
    return value == null ? "" : value;
  }

  function parseDump(urlString, options) {
    var parsed = new URL(urlString);
    var effective = stripParams(parsed, options.removeFilters, options.removeVis);
    var params = effective.searchParams;

    var fieldsRaw = getParamOrBlank(params, "fields");
    var fields = fieldsRaw ? fieldsRaw.split(",") : [];

    var filters = [];
    params.forEach(function (value, key) {
      if (key.indexOf("f[") === 0) {
        filters.push({
          key: key,
          value: value
        });
      }
    });

    var dynamicRaw = getParamOrBlank(params, "dynamic_fields");
    var dynamicParsed = safeJsonParse(dynamicRaw);
    var dynamicFields = Array.isArray(dynamicParsed) ? dynamicParsed : [];
    var visRaw = getParamOrBlank(params, "vis");
    var sortsRaw = getParamOrBlank(params, "sorts");
    var filterConfigRaw = getParamOrBlank(params, "filter_config");
    var filterLength = filterConfigRaw.length;
    var contextParts = [fields.join(","), sortsRaw, filterConfigRaw];

    for (var fi = 0; fi < filters.length; fi++) {
      contextParts.push(filters[fi].key + "=" + filters[fi].value);
      filterLength += (filters[fi].key || "").length + String(filters[fi].value || "").length;
    }

    var dynamicAudit = buildDynamicFieldAudit(dynamicFields, contextParts.join("\n"));

    var summaryRows = [
      ["Metric", "Value"],
      ["Title", getParamOrBlank(params, "title")],
      ["Look ID", getParamOrBlank(params, "look_id")],
      ["Sorts", getParamOrBlank(params, "sorts")],
      ["Limit", getParamOrBlank(params, "limit")],
      ["Column Limit", getParamOrBlank(params, "column_limit")],
      ["Field Count", String(fields.length)],
      ["Filter Count", String(filters.length)],
      ["Has Vis", params.has("vis") ? "yes" : "no"],
      ["Dynamic Field Count", String(dynamicFields.length)],
      ["Visualization Length", String(visRaw.length)],
      ["Dynamic Field Length", String(dynamicRaw.length)],
      ["Filter Length", String(filterLength)],
      ["Effective URL Length", String(effective.toString().length)]
    ];

    return {
      effectiveUrl: effective.toString(),
      fields: fields,
      filters: filters,
      dynamicFields: dynamicFields,
      dynamicAudit: dynamicAudit,
      summaryRows: summaryRows
    };
  }

  function renderDump(dumpData, options) {
    removeExistingDump();

    var root = document.createElement("div");
    root.id = "tm-dump-root";

    var title = document.createElement("h3");
    title.textContent = "Report Dump";
    root.appendChild(title);

    var meta = document.createElement("div");
    meta.className = "tm-meta";
    meta.textContent = "removeFilters=" + options.removeFilters + " | removeVis=" + options.removeVis;
    root.appendChild(meta);

    root.appendChild(createKeyValueTable(dumpData.summaryRows));

    if (dumpData.fields.length > 0) {
      var fieldsTitle = document.createElement("h4");
      fieldsTitle.textContent = "Fields";
      root.appendChild(fieldsTitle);

      var fieldsText = document.createElement("pre");
      fieldsText.className = "tm-pre";
      fieldsText.textContent = dumpData.fields.join("\n");
      root.appendChild(fieldsText);
    }

    if (dumpData.filters.length > 0) {
      var filtersTitle = document.createElement("h4");
      filtersTitle.textContent = "Filters";
      root.appendChild(filtersTitle);
      root.appendChild(createFilterTable(dumpData.filters));
    }

    var dynTitle = document.createElement("h4");
    dynTitle.textContent = "Dynamic Fields";
    root.appendChild(dynTitle);
    root.appendChild(createDynamicTable(dumpData.dynamicFields));

    var urlTitle = document.createElement("h4");
    urlTitle.textContent = "Effective URL";
    root.appendChild(urlTitle);

    var urlText = document.createElement("pre");
    urlText.className = "tm-pre";
    urlText.textContent = dumpData.effectiveUrl;
    root.appendChild(urlText);

    getDumpMountNode().appendChild(root);
  }

  function isLoadButtonClickable() {
    var btn = document.querySelector(CONFIG.LOAD_BUTTON_SELECTOR);
    if (!btn) return false;

    var isDisabled = !!(
      btn.disabled ||
      btn.getAttribute("disabled") !== null ||
      btn.getAttribute("aria-disabled") === "true"
    );

    return !isDisabled;
  }

  function activateRecoveryTool(reason) {
    if (state.recoveryActivatedOnce && state.recoveryModeActive) {
      return;
    }

    var safeReason = clampText(reason || "", 220);
    ensureTopPanel();
    setRecoveryMode(true);
    startOverlayOffsetWatcher();
    state.recoveryActivatedOnce = true;
    updateStatus("Recovery mode active. " + safeReason);
    safeLog("Recovery mode activated", {
      reason: safeReason,
      loadCheckSeconds: CONFIG.LOAD_CHECK_SECONDS,
      selector: CONFIG.LOAD_BUTTON_SELECTOR
    });
  }

  function registerManualRecoveryCommand() {
    if (typeof GM_registerMenuCommand !== "function") return;

    GM_registerMenuCommand("Activate recovery tool", function () {
      activateRecoveryTool("Manually activated from the Tampermonkey menu.");
    });
  }

  function runLoadGateCheck() {
    state.loadGateAttempts += 1;

    if (state.latestIframeBroken === true) {
      activateRecoveryTool("Iframe reported Puma error.");
      return;
    }

    if (state.latestIframeLoaded === true) {
      safeLog("Iframe loaded signal detected; recovery mode not needed", {
        selector: CONFIG.IFRAME_LOADED_BUTTON_SELECTOR,
        attempts: state.loadGateAttempts,
        healthAt: state.latestIframeHealthAt
      });
      updateStatus("Iframe reports loaded fine (header button found).");
      return;
    }

    if (state.loadGateAttempts <= CONFIG.LOAD_GATE_MAX_ATTEMPTS) {
      updateStatus("Waiting for iframe health check before enabling recovery mode...");
      window.setTimeout(runLoadGateCheck, CONFIG.LOAD_CHECK_SECONDS * 1000);
      return;
    }

    // Keep waiting for iframe signals instead of force-triggering recovery off the top-page button state.
    updateStatus("Still waiting on iframe signals (no Puma error and no loaded button yet).");
    window.setTimeout(runLoadGateCheck, CONFIG.LOAD_CHECK_SECONDS * 1000);
  }

  function pingEmbedsForHandshake() {
    var iframes = document.querySelectorAll("iframe");
    for (var i = 0; i < iframes.length; i++) {
      var frame = iframes[i];
      if (!frame || !frame.contentWindow) continue;

      try {
        frame.contentWindow.postMessage(encodeWireMessage({
          type: MSG_TYPES.TOP_PING,
          at: Date.now(),
          reason: "top-probe"
        }), "*");
      } catch (e) {
        null;
      }
    }
  }

  function startTopIframePingProbe() {
    if (state.topPingTimerId) return;

    state.topPingAttempts = 0;

    function tick() {
      if (state.latestIframeUrl) {
        stopTopIframePingProbe();
        return;
      }

      if (state.topPingAttempts >= CONFIG.TOP_IFRAME_PING_MAX_ATTEMPTS) {
        stopTopIframePingProbe();
        safeLog("Top iframe ping probe finished without capture", {
          attempts: state.topPingAttempts
        });
        return;
      }

      state.topPingAttempts += 1;
      pingEmbedsForHandshake();
    }

    tick();
    state.topPingTimerId = window.setInterval(tick, CONFIG.TOP_IFRAME_PING_MS);
  }

  function stopTopIframePingProbe() {
    if (!state.topPingTimerId) return;
    window.clearInterval(state.topPingTimerId);
    state.topPingTimerId = null;
  }

  function ensureStyles() {
    if (document.getElementById("tm-skeleton-style")) return;

    var style = document.createElement("style");
    style.id = "tm-skeleton-style";
    style.textContent = ""
      + "#tm-panel{position:relative;z-index:2147483647;background:#0f172a;color:#e2e8f0;padding:12px;border-radius:8px;font:12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35);max-width:960px;margin:0 auto 12px auto;}"
      + "#tm-panel h3{margin:0 0 8px 0;font-size:13px;color:#93c5fd;}"
      + "#tm-panel label{display:block;margin:4px 0;}"
      + "#tm-panel input[type='text']{width:100%;box-sizing:border-box;margin-top:4px;padding:6px;border:1px solid #334155;border-radius:6px;background:#0b1220;color:#e2e8f0;}"
      + "#tm-panel button{margin-right:6px;margin-top:8px;padding:5px 8px;border:1px solid #334155;border-radius:6px;background:#1e293b;color:#e2e8f0;cursor:pointer;}"
      + "#tm-panel .tm-btn-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}"
      + "#tm-panel .tm-btn-row button{margin-right:0;margin-top:0;}"
      + "#tm-panel button:disabled{opacity:.5;cursor:not-allowed;}"
      + "#tm-panel a{display:block;margin-top:6px;color:#93c5fd;text-decoration:underline;word-break:break-word;}"
      + "#tm-status{margin-top:8px;color:#cbd5e1;word-break:break-word;}"
      + "#tm-overlay{position:fixed;inset:0;z-index:2147483646;background:rgba(2,6,23,.96);display:none;overflow:auto;}"
      + "#tm-overlay-content{padding:16px;}"
      + "#tm-dynamic-trim-modal{position:fixed;inset:0;z-index:2147483648;background:rgba(2,6,23,.72);display:none;}"
      + "#tm-dynamic-trim-card{position:relative;max-width:1200px;max-height:86vh;overflow:auto;margin:4vh auto 0 auto;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:10px;padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.45);font:13px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;}"
      + "#tm-dynamic-trim-card h4{margin:0 0 8px 0;color:#93c5fd;}"
      + "#tm-dynamic-trim-controls button{margin-right:6px;margin-top:6px;}"
      + "#tm-dynamic-trim-meta{color:#cbd5e1;margin:6px 0;}"
      + "#tm-dynamic-trim-status{color:#cbd5e1;margin:8px 0 4px 0;}"
      + "#tm-dynamic-trim-legend{margin:8px 0 10px 0;color:#cbd5e1;}"
      + "#tm-dynamic-trim-legend span{display:inline-block;margin:4px 8px 0 0;padding:2px 8px;border-radius:999px;border:1px solid transparent;font-size:12px;font-weight:600;}"
      + "#tm-dynamic-trim-legend .lg-active{background:#dcfce7;color:#14532d;border-color:#86efac;}"
      + "#tm-dynamic-trim-legend .lg-active-ref{background:#dbeafe;color:#1e3a8a;border-color:#93c5fd;}"
      + "#tm-dynamic-trim-legend .lg-default{background:#fef3c7;color:#78350f;border-color:#fcd34d;}"
      + "#tm-dynamic-trim-legend .lg-remove{background:#fee2e2;color:#7f1d1d;border-color:#fca5a5;}"
      + "#tm-dynamic-trim-table-wrap{overflow:auto;max-height:58vh;background:#ffffff;border:1px solid #334155;border-radius:8px;}"
      + "#tm-dynamic-trim-table-wrap .tm-table{width:100%;table-layout:auto;border-collapse:separate;border-spacing:0;margin-top:0;}"
      + "#tm-dynamic-trim-table-wrap .tm-table td{font-size:12px;line-height:1.35;padding:8px 10px;color:#0f172a;background:#ffffff;border:1px solid #cbd5e1;vertical-align:top;}"
      + "#tm-dynamic-trim-table-wrap .tm-header-row td{position:sticky;top:0;z-index:2;background:#0f172a;color:#f8fafc;font-weight:700;border-color:#1e293b;}"
      + ".tm-audit-active td{background:#dcfce7 !important;color:#14532d !important;}"
      + ".tm-audit-active-ref td{background:#dbeafe !important;color:#1e3a8a !important;}"
      + ".tm-audit-table-calc td{background:#fef3c7 !important;color:#78350f !important;}"
      + ".tm-audit-removable td{background:#fee2e2 !important;color:#7f1d1d !important;}"
      + ".tm-status-pill{font-weight:700;}"
      + ".tm-status-active{color:#14532d !important;}"
      + ".tm-status-active-ref{color:#1e3a8a !important;}"
      + ".tm-status-table-calc{color:#78350f !important;}"
      + ".tm-status-removable{color:#7f1d1d !important;}"
      + "#tm-qid-loading{position:fixed;left:50%;transform:translateX(-50%);top:18px;z-index:2147483647;display:none;background:#0b1220;color:#dbeafe;border:1px solid #1d4ed8;border-radius:10px;padding:10px 12px;min-width:320px;max-width:80vw;pointer-events:none;box-shadow:0 8px 22px rgba(2,6,23,.45);font:12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;}"
      + "#tm-qid-loading-title{font-weight:700;color:#93c5fd;margin-bottom:4px;}"
      + "#tm-qid-loading-text{color:#dbeafe;word-break:break-word;}"
      + "#tm-dump-mount{max-width:960px;margin:0 auto;}"
      + "#tm-dump-root{position:relative;z-index:2147483646;background:#f8fafc;color:#0f172a;margin:0 0 16px 0;padding:14px;border:1px solid #cbd5e1;border-radius:8px;font:12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;}"
      + "#tm-dump-root h3,#tm-dump-root h4{margin:10px 0 8px 0;}"
      + ".tm-table{border-collapse:collapse;width:100%;table-layout:fixed;margin-top:8px;}"
      + ".tm-table td{border:1px solid #cbd5e1;padding:6px;vertical-align:top;word-break:break-word;}"
      + ".tm-header-row td{background:#e2e8f0;font-weight:700;}"
      + ".tm-pre{white-space:pre-wrap;background:#e2e8f0;padding:8px;border-radius:6px;border:1px solid #cbd5e1;word-break:break-word;}"
      + ".tm-meta{color:#334155;margin-bottom:8px;}";
    document.head.appendChild(style);
  }

  function ensureTopPanel() {
    if (document.getElementById("tm-panel") && document.getElementById("tm-overlay")) return;

    ensureStyles();

    var overlay = document.createElement("div");
    overlay.id = "tm-overlay";

    var overlayContent = document.createElement("div");
    overlayContent.id = "tm-overlay-content";
    overlay.appendChild(overlayContent);

    document.body.appendChild(overlay);

    var panel = document.createElement("div");
    panel.id = "tm-panel";

    var title = document.createElement("h3");
    title.textContent = "TM Report Dump";
    panel.appendChild(title);

    var toggleFilters = document.createElement("label");
    toggleFilters.innerHTML = '<input id="tm-toggle-filters" type="checkbox"> Remove filters';
    panel.appendChild(toggleFilters);

    var toggleVis = document.createElement("label");
    toggleVis.innerHTML = '<input id="tm-toggle-vis" type="checkbox"> Remove vis';
    panel.appendChild(toggleVis);

    var primaryBtnRow = document.createElement("div");
    primaryBtnRow.className = "tm-btn-row";

    var dumpBtn = document.createElement("button");
    dumpBtn.id = "tm-btn-dump";
    dumpBtn.textContent = "Dump Table";
    primaryBtnRow.appendChild(dumpBtn);

    var clearBtn = document.createElement("button");
    clearBtn.id = "tm-btn-clear";
    clearBtn.textContent = "Clear Dump";
    primaryBtnRow.appendChild(clearBtn);

    var trimDynamicBtn = document.createElement("button");
    trimDynamicBtn.id = "tm-btn-trim-dynamic";
    trimDynamicBtn.textContent = "Trim Dynamic Fields";
    primaryBtnRow.appendChild(trimDynamicBtn);

    panel.appendChild(primaryBtnRow);

    var qidTrimRow = document.createElement("div");
    qidTrimRow.className = "tm-btn-row";

    var qidTrimBtn = document.createElement("button");
    qidTrimBtn.id = "tm-btn-qid-trim";
    qidTrimBtn.textContent = "Resolve QID with Dynamic Trim";
    qidTrimRow.appendChild(qidTrimBtn);

    panel.appendChild(qidTrimRow);

    var qidText = document.createElement("div");
    qidText.id = "tm-qid";
    qidText.textContent = "QID: (none)";
    panel.appendChild(qidText);

    var qidLink = document.createElement("a");
    qidLink.id = "tm-qid-link";
    qidLink.textContent = "Open resolved QID report: (not available)";
    qidLink.href = "#";
    qidLink.addEventListener("click", function (event) {
      if (!(state.lastResolvedQid && state.lastResolvedResolverUrl)) {
        event.preventDefault();
      }
    });
    panel.appendChild(qidLink);

    var repostNameWrap = document.createElement("label");
    repostNameWrap.textContent = "Repost Name";
    var repostNameInput = document.createElement("input");
    repostNameInput.id = "tm-repost-name";
    repostNameInput.type = "text";
    repostNameInput.placeholder = "Enter report name";
    repostNameWrap.appendChild(repostNameInput);
    panel.appendChild(repostNameWrap);

    var repostShare = document.createElement("label");
    repostShare.innerHTML = '<input id="tm-repost-share" type="checkbox" checked> Share report';
    panel.appendChild(repostShare);

    var repostBtn = document.createElement("button");
    repostBtn.id = "tm-btn-repost";
    repostBtn.textContent = "Repost Report";
    repostBtn.disabled = true;
    panel.appendChild(repostBtn);

    var status = document.createElement("div");
    status.id = "tm-status";
    status.textContent = "Waiting for iframe URL...";
    panel.appendChild(status);

    var qidLoading = document.createElement("div");
    qidLoading.id = "tm-qid-loading";
    qidLoading.innerHTML = '<div id="tm-qid-loading-title">Resolving QID</div><div id="tm-qid-loading-text">Preparing resolver...</div>';
    overlay.appendChild(qidLoading);

    var trimModal = document.createElement("div");
    trimModal.id = "tm-dynamic-trim-modal";
    trimModal.innerHTML = ''
      + '<div id="tm-dynamic-trim-card">'
      + '  <h4>Dynamic Field Trim Selector</h4>'
      + '  <div id="tm-dynamic-trim-meta">Loading...</div>'
      + '  <div id="tm-dynamic-trim-controls">'
      + '    <button id="tm-trim-default">Default Selection</button>'
      + '    <button id="tm-trim-clear">Clear Selection</button>'
      + '    <button id="tm-trim-select-all">Select All</button>'
      + '    <button id="tm-trim-apply">Apply Trim</button>'
      + '    <button id="tm-trim-close">Close</button>'
      + '  </div>'
      + '  <div id="tm-dynamic-trim-legend">'
      + '    <span class="lg-active">Active</span>'
      + '    <span class="lg-active-ref">Active Reference</span>'
      + '    <span class="lg-default">Default Keep</span>'
      + '    <span class="lg-remove">Preflag Remove</span>'
      + '  </div>'
      + '  <div id="tm-dynamic-trim-status">Select dynamic fields to trim.</div>'
      + '  <div id="tm-dynamic-trim-table-wrap"></div>'
      + '</div>';
    overlay.appendChild(trimModal);

    overlayContent.appendChild(panel);

    var dumpMount = document.createElement("div");
    dumpMount.id = "tm-dump-mount";
    overlayContent.appendChild(dumpMount);

    applyOverlayOffsets();

    dumpBtn.addEventListener("click", function () {
      if (!state.latestIframeUrl) {
        updateStatus("No iframe URL captured yet.");
        safeLog("Dump skipped", { reason: "No iframe URL captured yet" });
        return;
      }

      try {
        var options = {
          removeFilters: !!document.getElementById("tm-toggle-filters").checked,
          removeVis: !!document.getElementById("tm-toggle-vis").checked
        };

        var dumpData = parseDump(state.latestIframeUrl, options);
        state.lastDynamicAudit = dumpData.dynamicAudit || null;
        renderDump(dumpData, options);
        updateStatus("Dump rendered from latest iframe URL.");

        safeLog("Dump rendered", {
          options: options,
          capturedAt: state.latestIframeAt,
          sourceOrigin: state.latestIframeOrigin,
          effectiveUrlLength: dumpData.effectiveUrl.length,
          dynamicCount: dumpData.dynamicFields.length
        });
      } catch (e) {
        updateStatus("Dump failed: " + e.message);
        safeLog("Dump failed", { error: e.message });
      }
    });

    clearBtn.addEventListener("click", function () {
      removeExistingDump();
      updateStatus("Dump cleared.");
      safeLog("Dump cleared", {});
    });

    trimDynamicBtn.addEventListener("click", function () {
      openDynamicTrimModal();
    });

    var trimCloseBtn = document.getElementById("tm-trim-close");
    if (trimCloseBtn) {
      trimCloseBtn.addEventListener("click", function () {
        closeDynamicTrimModal();
      });
    }

    var trimApplyBtn = document.getElementById("tm-trim-apply");
    if (trimApplyBtn) {
      trimApplyBtn.addEventListener("click", function () {
        applyDynamicTrimSelectionToResolverUrl();
      });
    }

    var trimDefaultBtn = document.getElementById("tm-trim-default");
    if (trimDefaultBtn) {
      trimDefaultBtn.addEventListener("click", function () {
        setDynamicTrimSelectionFromAuditDefault(state.lastDynamicAudit);
      });
    }

    var trimClearBtn = document.getElementById("tm-trim-clear");
    if (trimClearBtn) {
      trimClearBtn.addEventListener("click", function () {
        setDynamicTrimSelectionAll(false);
      });
    }

    var trimAllBtn = document.getElementById("tm-trim-select-all");
    if (trimAllBtn) {
      trimAllBtn.addEventListener("click", function () {
        setDynamicTrimSelectionAll(true);
      });
    }

    trimModal.addEventListener("click", function (event) {
      if (event.target === trimModal) {
        closeDynamicTrimModal();
      }
    });

    qidTrimBtn.addEventListener("click", function () {
      if (!state.latestIframeUrl) {
        updateStatus("Resolve QID with trim skipped: no iframe URL captured yet.");
        safeLog("Resolve QID with trim skipped", { reason: "No iframe URL captured yet" });
        return;
      }

      var resolverUrl = "";
      try {
        resolverUrl = getResolverUrlFromCurrentSelection();
      } catch (urlError) {
        updateStatus("Resolve QID with trim failed: invalid resolver URL");
        safeLog("Resolve QID with trim failed", { error: urlError.message });
        return;
      }

      try {
        var trimPlan = buildDynamicTrimPlan(resolverUrl, state.lastDynamicTrimSelection || []);
        resolverUrl = trimPlan.trimmedUrl;
        state.lastDynamicAudit = trimPlan.audit || state.lastDynamicAudit;
        updateStatus("Resolving QID with dynamic trim (removed " + trimPlan.removedCount + ").");
      } catch (trimError) {
        updateStatus("Resolve QID with trim failed: " + (trimError.message || String(trimError)));
        return;
      }

      var uiOptions = {
        removeFilters: !!document.getElementById("tm-toggle-filters").checked,
        removeVis: !!document.getElementById("tm-toggle-vis").checked
      };

      startQidResolveFlow(resolverUrl, uiOptions, "Resolving QID with dynamic trim");
    });

    repostBtn.addEventListener("click", function () {
      if (!(state.lastResolvedQid && state.lastResolvedResolverUrl)) {
        updateStatus("Repost locked: resolve QID first.");
        return;
      }

      var nameEl = document.getElementById("tm-repost-name");
      var shareEl = document.getElementById("tm-repost-share");
      var reportName = (nameEl && nameEl.value ? nameEl.value.trim() : "") || deriveDefaultRepostName();
      var shareEnabled = !!(shareEl && shareEl.checked);
      var targetReportUrl = state.lastResolvedResolverUrl;

      var payload = buildRepostPayload(reportName, shareEnabled);
      payload.url = targetReportUrl;

      repostBtn.disabled = true;
      updateStatus("Reposting report...");

      postRecoveredReport(payload)
        .then(function (data) {
          var reportUrl = data && data.report_url ? String(data.report_url) : "";
          if (reportUrl) {
            var absoluteReportUrl = "https://lightspeedanalytics.net/" + reportUrl.replace(/^\/+/, "");
            window.open(absoluteReportUrl, "_blank");
          }

          updateStatus("Repost successful." + (reportUrl ? " Opening report..." : ""));
          safeLog("Repost successful", {
            qid: state.lastResolvedQid,
            share: shareEnabled,
            title: reportName,
            reportUrl: reportUrl
          });
        })
        .catch(function (repostError) {
          updateStatus("Repost failed: " + repostError.message);
          safeLog("Repost failed", {
            error: repostError.message,
            qid: state.lastResolvedQid
          });
        })
        .finally(function () {
          updateRepostButtonState();
        });
    });

    updateRepostButtonState();
    updateResolvedQidLink();
  }

  // Resolver popup/tab should run only the tiny handoff logic, then stop.
  if (isResolverOnlyWindow()) {
    safeLog("Resolver-only mode engaged", {
      href: window.location.href,
      name: window.name || "",
      hasOpener: !!(window.opener && window.opener !== window)
    });
    trySendResolverResultFromCurrentWindow();
    return;
  }

  // Handle resolver-return payloads in any non-resolver window context.
  window.addEventListener("message", function (event) {
    if (!isAllowedOrigin(event.origin)) return;

    var data = decodeWireMessage(event.data) || {};
    if (!data.type) return;

    if (data.type === MSG_TYPES.QID_READY) {
      var readyRequestId = data.requestId || "";
      if (!readyRequestId) return;

      var pendingReady = state.pendingQidRequests[readyRequestId];
      if (!pendingReady) return;

      completePendingQidRequest(readyRequestId, {
        mode: pendingReady.mode,
        requestId: readyRequestId,
        qid: data.qid || "",
        href: data.href || "",
        at: data.at || Date.now()
      });

      safeLog("Received QID_READY", {
        requestId: readyRequestId,
        qid: data.qid || ""
      }, event);
      return;
    }

    if (data.type === MSG_TYPES.QID_ERROR) {
      var errorRequestId = data.requestId || "";
      if (!errorRequestId) return;

      failPendingQidRequest(errorRequestId, data.reason || "Resolver returned QID error");

      safeLog("Received QID_ERROR", {
        requestId: errorRequestId,
        reason: data.reason || ""
      }, event);
    }
  });

  if (window.top === window.self) {
    setTimeout(runLoadGateCheck, CONFIG.LOAD_CHECK_SECONDS * 1000);

    // TOP WINDOW MODE: listen for iframe messages and optionally ping child iframes.
    window.addEventListener("message", function (event) {
      if (!isAllowedOrigin(event.origin)) return;

      var data = decodeWireMessage(event.data) || {};
      if (!data.type) return;

      if (data.type === MSG_TYPES.IFRAME_READY) {
        var previousIframeUrl = state.latestIframeUrl || "";
        state.latestIframeUrl = data.href || "";
        state.latestIframeOrigin = event.origin || "";
        state.latestIframeAt = data.at || Date.now();

        if (state.latestIframeUrl && state.latestIframeUrl !== previousIframeUrl) {
          state.dynamicTrimModalSourceUrl = "";
          state.lastDynamicTrimSelection = [];
          state.lastDynamicAudit = null;
        }

        applyIframeHealthFromMessage(data, event);

        stopTopIframePingProbe();

        if (state.recoveryModeActive) {
          updateStatus("Captured iframe URL from " + state.latestIframeOrigin);
        }

        safeLog("Received IFRAME_READY", {
          origin: event.origin,
          href: data.href,
          at: data.at
        }, event);

        // Send a simple ping back to the iframe to prove two-way communication.
        if (event.source && event.source.postMessage) {
          event.source.postMessage(encodeWireMessage({
            type: MSG_TYPES.TOP_PING,
            at: Date.now()
          }), event.origin);
        }
      }

      if (data.type === MSG_TYPES.IFRAME_PONG) {
        var previousIframeUrlPong = state.latestIframeUrl || "";
        state.latestIframeUrl = data.href || state.latestIframeUrl;
        state.latestIframeOrigin = event.origin || state.latestIframeOrigin;
        state.latestIframeAt = data.at || Date.now();

        if (state.latestIframeUrl && state.latestIframeUrl !== previousIframeUrlPong) {
          state.dynamicTrimModalSourceUrl = "";
          state.lastDynamicTrimSelection = [];
          state.lastDynamicAudit = null;
        }

        applyIframeHealthFromMessage(data, event);

        stopTopIframePingProbe();

        if (state.recoveryModeActive) {
          updateStatus("Received iframe pong from " + state.latestIframeOrigin);
        }

        safeLog("Received IFRAME_PONG", {
          origin: event.origin,
          iframeHref: data.href,
          at: data.at
        }, event);
      }

      if (data.type === MSG_TYPES.IFRAME_HEALTH) {
        applyIframeHealthFromMessage(data, event);
      }
    });

    safeLog("Top window listener attached", {
      href: window.location.href,
      iframeCount: document.querySelectorAll("iframe").length
    });

    registerManualRecoveryCommand();
    startTopIframePingProbe();

    window.addEventListener("beforeunload", stopOverlayOffsetWatcher);

    return;
  }

  // IFRAME MODE: send ready event to top, then respond to top pings.
  var parentOrigin = "*";
  if (document.referrer) {
    try {
      parentOrigin = new URL(document.referrer).origin;
    } catch (e) {
      parentOrigin = "*";
    }
  }

  function postToTop(message) {
    window.top.postMessage(encodeWireMessage(message), parentOrigin);
  }

  var iframeHealthTimerId = null;
  var lastIframeHealthKey = "";

  function postIframeHealth(tag) {
    var health = getIframeHealthSnapshot();
    var healthKey = String(health.broken) + ":" + String(health.loaded) + ":" + health.reason;

    if (tag === "poll" && healthKey === lastIframeHealthKey) {
      return;
    }

    lastIframeHealthKey = healthKey;

    postToTop({
      type: MSG_TYPES.IFRAME_HEALTH,
      href: window.location.href,
      at: Date.now(),
      tag: tag || "health",
      health: health
    });

    safeLog("Posted IFRAME_HEALTH to top", {
      targetOrigin: parentOrigin,
      status: health.status,
      broken: health.broken,
      loaded: health.loaded,
      reason: health.reason,
      tag: tag || "health"
    });
  }

  function startIframeHealthLoop() {
    if (iframeHealthTimerId) return;

    postIframeHealth("initial");
    iframeHealthTimerId = window.setInterval(function () {
      postIframeHealth("poll");
    }, CONFIG.IFRAME_HEALTH_POLL_MS);
  }

  function stopIframeHealthLoop() {
    if (!iframeHealthTimerId) return;
    window.clearInterval(iframeHealthTimerId);
    iframeHealthTimerId = null;
  }

  var iframeReadyAttempts = 0;
  var iframeReadyAcked = false;
  var iframeReadyTimerId = null;

  function stopIframeReadyLoop() {
    if (!iframeReadyTimerId) return;
    window.clearInterval(iframeReadyTimerId);
    iframeReadyTimerId = null;
  }

  function postIframeReady(tag) {
    postToTop({
      type: MSG_TYPES.IFRAME_READY,
      href: window.location.href,
      at: Date.now(),
      tag: tag || "ready",
      health: getIframeHealthSnapshot()
    });

    safeLog("Posted IFRAME_READY to top", {
      targetOrigin: parentOrigin,
      href: window.location.href,
      attempt: iframeReadyAttempts,
      tag: tag || "ready"
    });
  }

  function startIframeReadyLoop() {
    if (iframeReadyTimerId) return;

    iframeReadyAttempts = 0;

    function tick() {
      if (iframeReadyAcked) {
        stopIframeReadyLoop();
        return;
      }

      if (iframeReadyAttempts >= CONFIG.IFRAME_READY_MAX_ATTEMPTS) {
        stopIframeReadyLoop();
        safeLog("Stopped IFRAME_READY retries", {
          attempts: iframeReadyAttempts,
          reason: "max-attempts"
        });
        return;
      }

      iframeReadyAttempts += 1;
      postIframeReady("retry");
    }

    tick();
    iframeReadyTimerId = window.setInterval(tick, CONFIG.IFRAME_READY_RETRY_MS);
  }

  startIframeReadyLoop();
  startIframeHealthLoop();

  window.addEventListener("message", function (event) {
    if (!isAllowedOrigin(event.origin)) return;

    var data = decodeWireMessage(event.data) || {};
    if (data.type !== MSG_TYPES.TOP_PING) return;

    iframeReadyAcked = true;
    stopIframeReadyLoop();

    safeLog("Received TOP_PING", {
      at: data.at
    }, event);

    postToTop({
      type: MSG_TYPES.IFRAME_PONG,
      href: window.location.href,
      at: Date.now(),
      health: getIframeHealthSnapshot()
    });

    postIframeHealth("pong");

    safeLog("Posted IFRAME_PONG to top", {
      targetOrigin: parentOrigin,
      href: window.location.href
    });
  });

  window.addEventListener("beforeunload", stopIframeHealthLoop);
})();

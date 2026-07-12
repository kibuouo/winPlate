(function exposeNotificationDigest(global) {
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeDigest(digest = {}) {
    const severity = ["danger", "warning", "info"].includes(digest.severity) ? digest.severity : "info";
    const title = String(digest.title || digest.headline || "暂无新通知");
    return {
      title,
      headline: title,
      summary: String(digest.summary || "当前没有需要关注的新通知。"),
      priority: String(digest.priority || "none"),
      severity,
      category: String(digest.category || "system"),
      iconKey: String(digest.iconKey || "bell"),
      source: String(digest.primarySource || digest.source || "system"),
      unreadCount: Math.max(0, Number(digest.unreadCount) || 0),
      generatedAt: Number.isFinite(Number(digest.generatedAt)) ? Number(digest.generatedAt) : null,
      groups: Array.isArray(digest.groups) ? digest.groups : [],
      sourceIds: Array.isArray(digest.sourceIds) ? digest.sourceIds : []
    };
  }

  const LEVEL_RANK = { critical: 4, danger: 4, warning: 3, success: 2, info: 1 };

  function selectDigestItems(digest = {}, items = []) {
    const value = normalizeDigest(digest);
    const ids = new Set(value.sourceIds.map(String));
    const represented = ids.size
      ? items.filter((item) => ids.has(String(item.sourceId || item.id)))
      : items.filter((item) => item.unread);
    return represented.slice().sort((left, right) =>
      (LEVEL_RANK[right.level] || 0) - (LEVEL_RANK[left.level] || 0)
        || Number(right.createdAt || 0) - Number(left.createdAt || 0)
    );
  }

  function renderDigestDrawerList(digest, items, { sourceLabel, relativeTime } = {}) {
    const list = selectDigestItems(digest, items);
    if (!list.length) return '<div class="notification-drawer-empty"><strong>暂无需要处理的通知</strong></div>';
    return `<div class="notification-drawer-list">${list.map((item) => `
      <button class="notification-drawer-item level-${escapeHtml(item.level || "info")}" type="button" data-notification-drawer-item="${escapeHtml(item.id)}">
        <span><i class="notification-status-dot" aria-hidden="true"></i>${escapeHtml(sourceLabel?.(item.source) || item.source || "WinPlate")}</span>
        <strong>${escapeHtml(item.title || "通知")}</strong>
        <p>${escapeHtml(item.body || item.message || "暂无详细内容。")}</p>
        <small>${escapeHtml(relativeTime?.(item.createdAt) || "")}${item.unread ? " · 未读" : " · 已读"}</small>
      </button>`).join("")}</div>`;
  }

  function renderGroups(digest) {
    const groups = normalizeDigest(digest).groups;
    if (!groups.length) return '<p class="notification-digest-groups-empty">没有待归类的通知</p>';
    return `<div class="notification-digest-groups">${groups.map((group) => `
      <article class="notification-digest-group severity-${escapeHtml(group.severity || "info")}">
        <header><strong>${escapeHtml(group.label)}</strong><span>${Math.max(0, Number(group.count) || 0)}</span></header>
        <p>${escapeHtml(group.summary)}</p>
      </article>`).join("")}</div>`;
  }

  function renderDigestCard(digest, { compact = false } = {}) {
    const value = normalizeDigest(digest);
    const iconKey = "sparkles";
    return `
      <section class="notification-digest-card severity-${escapeHtml(value.severity)} ${compact ? "compact" : ""}" aria-label="智能通知摘要" ${compact ? "" : 'role="button" tabindex="0" aria-expanded="false" aria-controls="notification-digest-drawer" data-notification-digest-open="true"'}>
        <div class="notification-digest-heading">
          <span class="notification-digest-kicker">${global.WinPlateSmartNotificationIcons.renderSmartNotificationIcon(iconKey)}智能摘要</span>
          <span class="notification-digest-count">${value.unreadCount} 未读</span>
        </div>
        <h2>${escapeHtml(value.headline)}</h2>
        <p>${escapeHtml(value.summary)}</p>
        ${compact ? "" : renderGroups(value)}
      </section>`;
  }

  function renderRawNotifications(items, { expanded = false, sourceLabel, levelLabel, relativeTime } = {}) {
    const list = Array.isArray(items) ? items : [];
    // Baseline markup remains <details class="notification-raw-section"> when collapsed.
    const rows = list.length ? `<div class="notification-page-list">${list.map((item) => `
      <article class="notification-page-item source-${escapeHtml(item.source)} level-${escapeHtml(item.level)} ${item.unread ? "unread" : ""}" data-notification-open="${escapeHtml(item.id)}">
        <div class="notification-page-main">
          <span class="notification-source">${escapeHtml(sourceLabel?.(item.source) || item.source || "WinPlate")}</span>
          <h2>${escapeHtml(item.title)}</h2>
          ${item.body || item.message ? `<p>${escapeHtml(item.body || item.message)}</p>` : ""}
          <footer>
            <span>${escapeHtml(levelLabel?.(item.level) || item.level || "信息")}</span>
            <time>${escapeHtml(relativeTime?.(item.createdAt) || "")}</time>
          </footer>
        </div>
        <button class="notification-read-button" type="button" data-notification-read="${escapeHtml(item.id)}" ${item.unread ? "" : "disabled"}>
          ${item.unread ? "标记已读" : "已读"}
        </button>
      </article>`).join("")}</div>` : `
        <div class="notification-empty-state"><strong>暂无原始通知</strong><span>新的来源事件会在这里保留。</span></div>`;
    return `
      <details class="notification-raw-section"${expanded ? " open" : ""}>
        <summary><span>原始通知</span><small>${list.length} 条</small></summary>
        ${rows}
      </details>`;
  }

  function filterNotificationItems(items = [], filters = {}) {
    const source = String(filters.source || "all");
    const state = String(filters.state || "all");
    return (Array.isArray(items) ? items : []).filter((item) => (
      (source === "all" || String(item.source) === source)
      && (state === "all" || (state === "unread" ? Boolean(item.unread) : !item.unread))
    ));
  }

  function isAcknowledgementRequired(item = {}) {
    const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
    return item.source === "qweather"
      && item.unread === true
      && metadata.severity === "red"
      && !["resolved", "cancelled", "ended"].includes(metadata.lifecycle);
  }

  function renderNotificationList(items, { selectedId = null, sourceLabel, levelLabel, relativeTime } = {}) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      return '<div class="notification-master-empty"><strong>没有匹配的通知</strong><span>尝试调整筛选条件。</span></div>';
    }
    return `<div class="notification-master-list">${list.map((item) => {
      const selected = String(item.id) === String(selectedId);
      return `
        <button class="notification-master-row source-${escapeHtml(item.source)} level-${escapeHtml(item.level)} ${item.unread ? "unread" : ""} ${selected ? "selected" : ""}"
          type="button" aria-pressed="${selected}" data-notification-select="${escapeHtml(item.id)}">
          <span class="notification-source">${escapeHtml(sourceLabel?.(item.source) || item.source || "WinPlate")}</span>
          <strong>${escapeHtml(item.title || "通知")}</strong>
          <p>${escapeHtml(item.body || item.message || "暂无详细内容。")}</p>
          <small>${escapeHtml(levelLabel?.(item.level) || item.level || "信息")} · ${escapeHtml(relativeTime?.(item.createdAt) || "")}${item.unread ? " · 未读" : ""}</small>
        </button>`;
    }).join("")}</div>`;
  }

  global.WinPlateNotificationDigest = {
    normalizeDigest,
    selectDigestItems,
    renderDigestDrawerList,
    renderDigestCard,
    renderGroups,
    renderRawNotifications,
    filterNotificationItems,
    renderNotificationList,
    isAcknowledgementRequired
  };
})(window);

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
      groups: Array.isArray(digest.groups) ? digest.groups : [],
      sourceIds: Array.isArray(digest.sourceIds) ? digest.sourceIds : []
    };
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
    const iconKey = global.WinPlateSmartNotificationIcons.resolveSmartNotificationIcon(value);
    return `
      <section class="notification-digest-card severity-${escapeHtml(value.severity)} ${compact ? "compact" : ""}" aria-label="智能通知摘要" ${compact ? "" : 'data-notification-digest-toggle="true"'}>
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

  global.WinPlateNotificationDigest = {
    normalizeDigest,
    renderDigestCard,
    renderGroups,
    renderRawNotifications
  };
})(window);

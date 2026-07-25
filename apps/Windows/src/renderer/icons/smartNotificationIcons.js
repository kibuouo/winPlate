(function exposeSmartNotificationIcons(root, factory) {
  const api = typeof module !== "undefined" && module.exports
    ? require("@winplate/icons/electron/smartNotificationIcons")
    : factory(root.WinPlateSmartNotificationIconKeys);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.WinPlateSmartNotificationIcons = api;
})(typeof window !== "undefined" ? window : null, function createBrowserSmartNotificationIcons(keysApi) {
  const { ICON_KEYS, isSmartNotificationIconKey, normalizeSmartNotificationIconKey } = keysApi;
  const ICON_BODIES = Object.freeze({
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 5-2 6-2 6h16s-2-1-2-6"></path><path d="M10 18h4"></path>',
    "cloud-rain-alert": '<path d="M16 13a4 4 0 0 0-1-7.9A6 6 0 0 0 3.5 8 4 4 0 0 0 4 16h10"></path><path d="m8 18-1 2"></path><path d="m12 18-1 2"></path><path d="M18 16v2"></path><path d="M18 21h.01"></path>',
    "cloud-lightning": '<path d="M17 17a5 5 0 0 0-1-9.9A7 7 0 0 0 2.7 10 4.5 4.5 0 0 0 7 17h2"></path><path d="m13 12-2 5h4l-2 5"></path>',
    wind: '<path d="M3 8h10a2 2 0 1 0-2-2"></path><path d="M3 12h15a2 2 0 1 1-2 2"></path><path d="M3 16h8"></path>',
    "thermometer-sun": '<path d="M10 4a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0Z"></path><path d="M8 9v7"></path><circle cx="17" cy="7" r="3"></circle><path d="M17 1v1M17 12v1M11 7h1M22 7h1M13 3l1 1M20 10l1 1M13 11l1-1M20 4l1-1"></path>',
    "thermometer-snowflake": '<path d="M10 4a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0Z"></path><path d="M8 9v7"></path><path d="M17 3v8M13.5 5l7 4M13.5 9l7-4M15 3.5l2 1 2-1M15 10.5l2-1 2 1"></path>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m4 7 8 6 8-6"></path>',
    "mail-unread": '<rect x="3" y="6" width="15" height="13" rx="2"></rect><path d="m4 8 7 5 6-4"></path><circle cx="19" cy="5" r="2"></circle>',
    "mail-warning": '<rect x="3" y="5" width="15" height="14" rx="2"></rect><path d="m4 7 7 5 6-4"></path><path d="M21 13v4"></path><path d="M21 21h.01"></path>',
    paperclip: '<path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 0 1-2.8-2.8l8.9-8.9"></path>',
    "check-circle": '<circle cx="12" cy="12" r="9"></circle><path d="m8 12 2.5 2.5L16 9"></path>',
    "x-circle": '<circle cx="12" cy="12" r="9"></circle><path d="m9 9 6 6M15 9l-6 6"></path>',
    loader: '<path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"></path>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="m7 9 3 3-3 3M13 15h4"></path>',
    codex: '<defs><linearGradient id="codex-icon-gradient" x1="5" y1="4" x2="19" y2="20" gradientUnits="userSpaceOnUse"><stop stop-color="#5b5ce2"></stop><stop offset=".55" stop-color="#4f8ff7"></stop><stop offset="1" stop-color="#8b5cf6"></stop></linearGradient></defs><path d="M7.5 18.5h9.25a4.25 4.25 0 0 0 .64-8.45A5.75 5.75 0 0 0 6.5 8.1a3.75 3.75 0 0 0 1 7.4Z" fill="url(#codex-icon-gradient)" stroke="none"></path><path d="m8.9 10.6 2.2 1.9-2.2 1.9M13.2 14.4h2.8" fill="none" stroke="#fff" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"></path>',
    chatgpt: '<path transform="scale(.075)" fill="currentColor" stroke="none" d="m297.06 130.97c7.26-21.79 4.76-45.66-6.85-65.48-17.46-30.4-52.56-46.04-86.84-38.68-15.25-17.18-37.16-26.95-60.13-26.81-35.04-.08-66.13 22.48-76.91 55.82-22.51 4.61-41.94 18.7-53.31 38.67-17.59 30.32-13.58 68.54 9.92 94.54-7.26 21.79-4.76 45.66 6.85 65.48 17.46 30.4 52.56 46.04 86.84 38.68 15.24 17.18 37.16 26.95 60.13 26.8 35.06.09 66.16-22.49 76.94-55.86 22.51-4.61 41.94-18.7 53.31-38.67 17.57-30.32 13.55-68.51-9.94-94.51zm-120.28 168.11c-14.03.02-27.62-4.89-38.39-13.88.49-.26 1.34-.73 1.89-1.07l63.72-36.8c3.26-1.85 5.26-5.32 5.24-9.07v-89.83l26.93 15.55c.29.14.48.42.52.74v74.39c-.04 33.08-26.83 59.9-59.91 59.97zm-128.84-55.03c-7.03-12.14-9.56-26.37-7.15-40.18.47.28 1.3.79 1.89 1.13l63.72 36.8c3.23 1.89 7.23 1.89 10.47 0l77.79-44.92v31.1c.02.32-.13.63-.38.83l-64.41 37.19c-28.69 16.52-65.33 6.7-81.92-21.95zm-16.77-139.09c7-12.16 18.05-21.46 31.21-26.29 0 .55-.03 1.52-.03 2.2v73.61c-.02 3.74 1.98 7.21 5.23 9.06l77.79 44.91-26.93 15.55c-.27.18-.61.21-.91.08l-64.42-37.22c-28.63-16.58-38.45-53.21-21.95-81.89zm221.26 51.49-77.79-44.92 26.93-15.54c.27-.18.61-.21.91-.08l64.42 37.19c28.68 16.57 38.51 53.26 21.94 81.94-7.01 12.14-18.05 21.44-31.2 26.28v-75.81c.03-3.74-1.96-7.2-5.2-9.06zm26.8-40.34c-.47-.29-1.3-.79-1.89-1.13l-63.72-36.8c-3.23-1.89-7.23-1.89-10.47 0l-77.79 44.92v-31.1c-.02-.32.13-.63.38-.83l64.41-37.16c28.69-16.55 65.37-6.7 81.91 22 6.99 12.12 9.52 26.31 7.15 40.1zm-168.51 55.43-26.94-15.55c-.29-.14-.48-.42-.52-.74v-74.39c.02-33.12 26.89-59.96 60.01-59.94 14.01 0 27.57 4.92 38.34 13.88-.49.26-1.33.73-1.89 1.07l-63.72 36.8c-3.26 1.85-5.26 5.31-5.24 9.06l-.04 89.79zm14.63-31.54 34.65-20.01 34.65 20v40.01l-34.65 20-34.65-20z"></path>',
    "message-bot": '<path d="M21 12a8 8 0 0 1-8 8H6l-4 2 1.5-4A9 9 0 1 1 21 12Z"></path><path d="M9 9h6v6H9zM12 6v3M10.5 12h.01M13.5 12h.01"></path>',
    code: '<path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"></path>',
    bug: '<path d="M8 9h8v7a4 4 0 0 1-8 0Z"></path><path d="M9 5l1 2M15 5l-1 2M4 13h4M16 13h4M5 8l3 2M19 8l-3 2M5 18l3-2M19 18l-3-2"></path>',
    monitor: '<rect x="3" y="4" width="18" height="14" rx="2"></rect><path d="M8 22h8M12 18v4"></path>',
    cpu: '<rect x="7" y="7" width="10" height="10" rx="1"></rect><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3M10 10h4v4h-4z"></path>',
    "memory-stick": '<rect x="3" y="6" width="18" height="12" rx="2"></rect><path d="M7 10h2v4H7zM12 10h2v4h-2zM17 10h1M7 18v3M12 18v3M17 18v3"></path>',
    wifi: '<path d="M5 12.5a11 11 0 0 1 14 0M8.5 16a6 6 0 0 1 7 0M12 20h.01M2 9a16 16 0 0 1 20 0"></path>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"></path>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"></path>',
    wallet: '<path d="M3 6a2 2 0 0 1 2-2h14v16H5a2 2 0 0 1-2-2Z"></path><path d="M3 8h16M15 12h6v4h-6a2 2 0 0 1 0-4Z"></path>',
    plug: '<path d="M8 3v5M16 3v5M6 8h12v3a6 6 0 0 1-6 6v4M8 21h8"></path>',
    github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7A5.5 5.5 0 0 0 19.3 4 5.1 5.1 0 0 0 19.1.5S17.9.1 15 2a13.4 13.4 0 0 0-6 0C6.1.1 4.9.5 4.9.5A5.1 5.1 0 0 0 4.7 4a5.5 5.5 0 0 0-1.5 3.8c0 5.4 3.5 6.6 6.8 7A4.8 4.8 0 0 0 9 18v4"></path><path d="M9 19c-3 .9-3-1.5-4-2"></path>',
    "git-pull-request": '<circle cx="6" cy="5" r="2"></circle><circle cx="18" cy="19" r="2"></circle><path d="M6 7v12M18 17V9a4 4 0 0 0-4-4h-2M12 3l-2 2 2 2"></path>',
    "git-commit": '<circle cx="12" cy="12" r="3"></circle><path d="M3 12h6M15 12h6"></path>',
    star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2l-5-4.9 6.9-1Z"></path>',
    tag: '<path d="M20 13 13 20l-10-10V3h7Z"></path><circle cx="7" cy="7" r="1"></circle>',
    sparkles: '<path d="M12 3.5 13.9 8.1 18.5 10 13.9 11.9 12 16.5 10.1 11.9 5.5 10 10.1 8.1 12 3.5Z"></path><path d="M19 3v4"></path><path d="M21 5h-4"></path><path d="M5 16v2"></path><path d="M6 17H4"></path>'
  });
  function renderSmartNotificationIcon(iconKey) {
    const key = normalizeSmartNotificationIconKey(iconKey);
    return `<svg class="notification-icon smart-notification-icon" data-icon-key="${key}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_BODIES[key]}</svg>`;
  }
  const RULES = [
    [/暴雨|强降雨|大雨/i, "cloud-rain-alert"],
    [/雷电|雷暴|闪电/i, "cloud-lightning"],
    [/大风|台风|阵风/i, "wind"],
    [/高温|炎热|酷暑/i, "thermometer-sun"],
    [/寒潮|低温|冰冻|霜冻/i, "thermometer-snowflake"],
    [/重要邮件|紧急邮件/i, "mail-warning"],
    [/附件|attachment/i, "paperclip"],
    [/新邮件|未读邮件|收件箱|inbox/i, "mail-unread"],
    [/失败|错误|异常|报错|failed|failure|error/i, "x-circle"],
    [/任务完成|已完成|生成完成|修复完成/i, "check-circle"],
    [/\bIssue\b|议题/i, "github"],
    [/GitHub|Pull Request|\bPR\b/i, "git-pull-request"],
    [/\bAPI\b|接口/i, "plug"],
    [/余额|balance/i, "wallet"],
    [/网络|Wi-?Fi|network/i, "wifi"],
    [/\bCPU\b|处理器/i, "cpu"],
    [/内存|memory/i, "memory-stick"],
    [/下载|download/i, "download"],
    [/上传|upload/i, "upload"],
    [/ChatGPT/i, "chatgpt"],
    [/Codex/i, "codex"]
  ];
  const SOURCE_DEFAULTS = Object.freeze({
    qweather: "bell", weather: "bell", mail: "mail", codex: "codex", chatgpt: "chatgpt",
    github: "github", system: "monitor", local: "monitor", external: "monitor"
  });
  const CATEGORY_DEFAULTS = Object.freeze({
    weather: "bell", mail: "mail", development: "code", github: "github", system: "monitor",
    network: "wifi", finance: "wallet"
  });
  function resolveSmartNotificationIcon(notification = {}) {
    const content = [notification.title, notification.headline, notification.summary, notification.body, notification.category, notification.source]
      .filter(Boolean).join(" ");
    const rule = RULES.find(([pattern]) => pattern.test(content));
    if (rule) return rule[1];
    if (notification.severity === "danger") return "x-circle";
    if (notification.severity === "warning") return "bell";
    if (isSmartNotificationIconKey(notification.iconKey)) return notification.iconKey;
    const sourceDefault = SOURCE_DEFAULTS[String(notification.source || "").toLowerCase()];
    if (sourceDefault) return sourceDefault;
    const categoryDefault = CATEGORY_DEFAULTS[String(notification.category || "").toLowerCase()];
    return sourceDefault || categoryDefault || "bell";
  }
  return {
    ICON_KEYS,
    SMART_NOTIFICATION_ICON_REGISTRY: ICON_BODIES,
    isSmartNotificationIconKey,
    renderSmartNotificationIcon,
    resolveSmartNotificationIcon
  };
});

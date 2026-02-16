window.Launcher = window.Launcher || {};

window.Launcher.i18n = (function () {
  let messages = {};

  function init(msgs) {
    messages = msgs || {};
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
  }

  function t(key, params) {
    const parts = key.split(".");
    let val = messages;
    for (let i = 0; i < parts.length; i++) {
      if (val == null || typeof val !== "object") return key;
      val = val[parts[i]];
    }
    if (typeof val !== "string") return key;
    if (params) {
      return val.replace(/\{(\w+)\}/g, function (_, k) {
        return params[k] !== undefined ? params[k] : "{" + k + "}";
      });
    }
    return val;
  }

  return { init: init, t: t };
})();

window.t = window.Launcher.i18n.t;

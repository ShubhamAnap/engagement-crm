/**
 * EnerTech Engage — embeddable website chat loader
 *
 * Usage on any website:
 *
 * <script
 *   src="https://YOUR_APP_URL/widget.js"
 *   data-app-url="https://YOUR_APP_URL"
 *   data-key="YOUR_WIDGET_PUBLIC_KEY"
 *   async>
 * </script>
 */
(function () {
  if (window.__enertechWidgetLoaded) return;
  window.__enertechWidgetLoaded = true;

  var script = document.currentScript;
  if (!script) return;

  var appUrl = (script.getAttribute("data-app-url") || "").replace(/\/$/, "");
  var key = script.getAttribute("data-key") || "";
  if (!appUrl || !key) {
    console.error("[EnerTech Widget] data-app-url and data-key are required");
    return;
  }

  var BRAND = "#0B2388";
  var INK = "#FFFFFF";

  var open = false;
  var btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("aria-label", "ASK EnerTech");
  btn.style.cssText = [
    "position:fixed",
    "right:16px",
    "bottom:16px",
    "z-index:2147483000",
    "width:72px",
    "height:72px",
    "padding:8px",
    "border:2px solid " + INK,
    "border-radius:50%",
    "background:" + BRAND,
    "color:" + INK,
    "font:700 11px/1.15 system-ui,sans-serif",
    "letter-spacing:0.02em",
    "text-align:center",
    "box-shadow:0 12px 28px rgba(11,35,136,.45)",
    "cursor:pointer",
    "display:flex",
    "align-items:center",
    "justify-content:center",
  ].join(";");

  function renderLabel(isOpen) {
    btn.innerHTML = "";
    if (isOpen) {
      btn.setAttribute("aria-label", "Close chat");
      var close = document.createElement("span");
      close.textContent = "Close";
      close.style.cssText = "font:700 12px/1 system-ui,sans-serif";
      btn.appendChild(close);
      return;
    }
    btn.setAttribute("aria-label", "ASK EnerTech");
    var stack = document.createElement("span");
    stack.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:2px";
    var ask = document.createElement("span");
    ask.textContent = "ASK";
    ask.style.cssText = "font-size:13px;font-weight:800;letter-spacing:0.06em";
    var brand = document.createElement("span");
    brand.textContent = "EnerTech";
    brand.style.cssText = "font-size:9px;font-weight:600;opacity:.95";
    stack.appendChild(ask);
    stack.appendChild(brand);
    btn.appendChild(stack);
  }

  renderLabel(false);

  var frameWrap = document.createElement("div");
  frameWrap.style.cssText = [
    "position:fixed",
    "right:16px",
    "bottom:100px",
    "z-index:2147483000",
    "width:min(384px,calc(100vw - 24px))",
    "height:min(560px,calc(100vh - 120px))",
    "display:none",
    "border-radius:12px",
    "overflow:hidden",
    "box-shadow:0 20px 50px rgba(11,35,136,.35)",
    "background:transparent",
  ].join(";");

  var iframe = document.createElement("iframe");
  iframe.title = "EnerTech chat";
  iframe.allow = "clipboard-write; microphone";
  iframe.style.cssText = "width:100%;height:100%;border:0;background:transparent;";
  iframe.src = appUrl + "/embed?key=" + encodeURIComponent(key);
  frameWrap.appendChild(iframe);

  btn.addEventListener("click", function () {
    open = !open;
    frameWrap.style.display = open ? "block" : "none";
    renderLabel(open);
  });

  document.body.appendChild(frameWrap);
  document.body.appendChild(btn);
})();

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

  var open = false;
  var btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("aria-label", "Open EnerTech chat");
  btn.textContent = "Chat with EnerTech";
  btn.style.cssText = [
    "position:fixed",
    "right:16px",
    "bottom:16px",
    "z-index:2147483000",
    "height:48px",
    "padding:0 20px 0 16px",
    "border:none",
    "border-radius:999px",
    "background:#0f766e",
    "color:#fff",
    "font:600 14px/1 system-ui,sans-serif",
    "box-shadow:0 10px 30px rgba(0,0,0,.25)",
    "cursor:pointer",
  ].join(";");

  var frameWrap = document.createElement("div");
  frameWrap.style.cssText = [
    "position:fixed",
    "right:16px",
    "bottom:76px",
    "z-index:2147483000",
    "width:min(384px,calc(100vw - 24px))",
    "height:min(560px,calc(100vh - 100px))",
    "display:none",
    "border-radius:12px",
    "overflow:hidden",
    "box-shadow:0 20px 50px rgba(0,0,0,.3)",
    "background:transparent",
  ].join(";");

  var iframe = document.createElement("iframe");
  iframe.title = "EnerTech chat";
  iframe.allow = "clipboard-write";
  iframe.style.cssText = "width:100%;height:100%;border:0;background:transparent;";
  iframe.src = appUrl + "/embed?key=" + encodeURIComponent(key);
  frameWrap.appendChild(iframe);

  btn.addEventListener("click", function () {
    open = !open;
    frameWrap.style.display = open ? "block" : "none";
    btn.textContent = open ? "Close chat" : "Chat with EnerTech";
  });

  document.body.appendChild(frameWrap);
  document.body.appendChild(btn);
})();

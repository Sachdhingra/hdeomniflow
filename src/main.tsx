import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Clickjacking protection: meta-tag CSP cannot express frame-ancestors,
// so break out if the app is loaded inside a hostile iframe.
if (window.self !== window.top) {
  try {
    window.top!.location.href = window.self.location.href;
  } catch {
    document.body.innerHTML = "";
  }
}

// Register service worker so showNotification() works when the app is
// backgrounded on Android Chrome (new Notification() is dropped on mobile).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

createRoot(document.getElementById("root")!).render(<App />);

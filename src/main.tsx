import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Register service worker so showNotification() works when the app is
// backgrounded on Android Chrome (new Notification() is dropped on mobile).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

createRoot(document.getElementById("root")!).render(<App />);

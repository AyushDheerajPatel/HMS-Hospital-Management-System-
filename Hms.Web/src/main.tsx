
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./index.css";
import App from "./App.tsx";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/service-worker.js").catch(() => {
    window.dispatchEvent(new Event("hms:service-worker-error"));
  });
}

if (import.meta.env.DEV && "serviceWorker" in navigator) {
  void (async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const applicationRegistrations = registrations.filter(
      (registration) =>
        new URL(registration.scope).origin === window.location.origin &&
        (registration.active?.scriptURL.endsWith("/service-worker.js") ??
          false),
    );
    const removed = await Promise.all(
      applicationRegistrations.map((registration) =>
        registration.unregister(),
      ),
    );
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith("hms-shell-"))
        .map((name) => caches.delete(name)),
    );

    if (
      removed.some(Boolean) &&
      navigator.serviceWorker.controller?.scriptURL.endsWith(
        "/service-worker.js",
      )
    ) {
      window.location.reload();
    }
  })().catch((error: unknown) => {
    console.error("Unable to clear the HMS development service worker.", error);
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
);

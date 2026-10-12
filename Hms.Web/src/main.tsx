
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./index.css";
import App from "./App.tsx";

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/service-worker.js").catch(() => {
    window.dispatchEvent(new Event("hms:service-worker-error"));
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
);

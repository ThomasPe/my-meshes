import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { syncThemeWithLocal, getCurrentTheme } from "./helpers/theme_helpers";
import { useTranslation } from "react-i18next";
import "./localization/i18n";
import { updateAppLanguage } from "./helpers/language_helpers";
import { router } from "./routes/router";
import { RouterProvider } from "@tanstack/react-router";
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import { ThemeMode } from "@/types/theme-mode";

export default function App() {
  const { i18n } = useTranslation();
  const [appearance, setAppearance] = useState<"light" | "dark">("light");

  useEffect(() => {
    syncThemeWithLocal();
    updateAppLanguage(i18n);
    
    // Initialize theme appearance
    const initTheme = async () => {
      const theme = await getCurrentTheme();
      const isDarkMode = document.documentElement.classList.contains("dark");
      setAppearance(isDarkMode ? "dark" : "light");
    };
    
    initTheme();
    
    // Listen for theme changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "class") {
          const isDarkMode = document.documentElement.classList.contains("dark");
          setAppearance(isDarkMode ? "dark" : "light");
        }
      });
    });
    
    observer.observe(document.documentElement, { attributes: true });
    
    return () => observer.disconnect();
  }, [i18n]);

  return (
    <Theme appearance={appearance} accentColor="blue">
      <RouterProvider router={router} />
    </Theme>
  );
}

const root = createRoot(document.getElementById("app")!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

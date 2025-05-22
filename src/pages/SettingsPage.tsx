import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Moon, Sun, Computer } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getCurrentTheme, setTheme } from "@/helpers/theme_helpers";
import { ThemeMode } from "@/types/theme-mode";

export default function SettingsPage() {
  const { t } = useTranslation();
  const [currentTheme, setCurrentTheme] = useState<ThemeMode>("system");
  
  useEffect(() => {
    const fetchTheme = async () => {
      const theme = await getCurrentTheme();
      setCurrentTheme(theme.local || theme.system);
    };
    
    fetchTheme();
  }, []);
  
  const handleThemeChange = (value: string) => {
    if (value && (value === "dark" || value === "light" || value === "system")) {
      const newTheme = value as ThemeMode;
      setTheme(newTheme);
      setCurrentTheme(newTheme);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col gap-4">
        <h1 className="text-2xl font-bold">{t("titleSettingsPage")}</h1>
        <div className="rounded border border-border p-4">
          <h2 className="mb-2 text-lg font-semibold">{t("settings.appearance")}</h2>
          <p className="text-muted-foreground mb-4">{t("settings.appearanceDescription")}</p>
          
          <div className="space-y-2">
            <div className="font-medium">{t("settings.themeMode")}</div>
            <ToggleGroup 
              type="single" 
              value={currentTheme} 
              onValueChange={handleThemeChange}
              className="justify-start"
            >
              <ToggleGroupItem value="light" aria-label={t("settings.lightMode")}>
                <Sun className="h-4 w-4 mr-2" />
                {t("settings.lightMode")}
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" aria-label={t("settings.darkMode")}>
                <Moon className="h-4 w-4 mr-2" />
                {t("settings.darkMode")}
              </ToggleGroupItem>
              <ToggleGroupItem value="system" aria-label={t("settings.systemMode")}>
                <Computer className="h-4 w-4 mr-2" />
                {t("settings.systemMode")}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        <div className="rounded border border-border p-4">
          <h2 className="mb-2 text-lg font-semibold">{t("settings.fileSystem")}</h2>
          <p className="text-muted-foreground">{t("settings.fileSystemDescription")}</p>
        </div>
      </div>
    </div>
  );
}
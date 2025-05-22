import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Moon, Sun, Computer } from "lucide-react";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { Heading, Text, Box, Flex } from "@radix-ui/themes";
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
    <Box className="flex h-full flex-col">
      <Box className="flex flex-1 flex-col gap-4">
        <Heading size="5">{t("titleSettingsPage")}</Heading>
        <Box className="rounded border border-border p-4">
          <Heading size="4" mb="2">{t("settings.appearance")}</Heading>
          <Text color="gray" as="p" mb="4">{t("settings.appearanceDescription")}</Text>
          
          <Flex direction="column" gap="2">
            <Text weight="medium">{t("settings.themeMode")}</Text>
            <ToggleGroup.Root 
              type="single" 
              value={currentTheme} 
              onValueChange={handleThemeChange}
            >
              <ToggleGroup.Item value="light" aria-label={t("settings.lightMode")}>
                <Flex gap="2" align="center">
                  <Sun className="h-4 w-4" />
                  <Text>{t("settings.lightMode")}</Text>
                </Flex>
              </ToggleGroup.Item>
              <ToggleGroup.Item value="dark" aria-label={t("settings.darkMode")}>
                <Flex gap="2" align="center">
                  <Moon className="h-4 w-4" />
                  <Text>{t("settings.darkMode")}</Text>
                </Flex>
              </ToggleGroup.Item>
              <ToggleGroup.Item value="system" aria-label={t("settings.systemMode")}>
                <Flex gap="2" align="center">
                  <Computer className="h-4 w-4" />
                  <Text>{t("settings.systemMode")}</Text>
                </Flex>
              </ToggleGroup.Item>
            </ToggleGroup.Root>
          </Flex>
        </Box>
        <Box className="rounded border border-border p-4">
          <Heading size="4" mb="2">{t("settings.fileSystem")}</Heading>
          <Text color="gray" as="p">{t("settings.fileSystemDescription")}</Text>
        </Box>
      </Box>
    </Box>
  );
}
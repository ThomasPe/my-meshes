import React from "react";
import { useTranslation } from "react-i18next";

export default function SettingsPage() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col gap-4">
        <h1 className="text-2xl font-bold">{t("titleSettingsPage")}</h1>
        <div className="rounded border border-border p-4">
          <h2 className="mb-2 text-lg font-semibold">{t("settings.appearance")}</h2>
          <p className="text-muted-foreground">{t("settings.appearanceDescription")}</p>
        </div>
        <div className="rounded border border-border p-4">
          <h2 className="mb-2 text-lg font-semibold">{t("settings.fileSystem")}</h2>
          <p className="text-muted-foreground">{t("settings.fileSystemDescription")}</p>
        </div>
      </div>
    </div>
  );
}
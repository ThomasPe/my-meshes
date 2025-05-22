import { Moon } from "lucide-react";
import React from "react";
import { Button } from "@radix-ui/themes";
import { toggleTheme } from "@/helpers/theme_helpers";

export default function ToggleTheme() {
  return (
    <Button variant="ghost" size="1" onClick={toggleTheme}>
      <Moon size={16} />
    </Button>
  );
}

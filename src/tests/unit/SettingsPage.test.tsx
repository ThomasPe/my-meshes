import { render, screen, fireEvent } from "@testing-library/react";
import { vi, test, expect, beforeEach } from "vitest";
import SettingsPage from "@/pages/SettingsPage";
import React from "react";
import * as themeHelpers from "@/helpers/theme_helpers";

// Mock the theme helpers
vi.mock("@/helpers/theme_helpers", () => ({
  getCurrentTheme: vi.fn().mockResolvedValue({
    system: "light",
    local: "dark"
  }),
  setTheme: vi.fn()
}));

// Set up before each test
beforeEach(() => {
  vi.clearAllMocks();
});

test("renders SettingsPage with theme mode selection", async () => {
  render(<SettingsPage />);
  
  // Check that the theme selection toggle group is rendered
  expect(await screen.findByText("settings.themeMode")).toBeInTheDocument();
  expect(await screen.findByText("settings.lightMode")).toBeInTheDocument();
  expect(await screen.findByText("settings.darkMode")).toBeInTheDocument();
  expect(await screen.findByText("settings.systemMode")).toBeInTheDocument();
  
  // Verify that getCurrentTheme was called
  expect(themeHelpers.getCurrentTheme).toHaveBeenCalledTimes(1);
});

test("changes theme when toggle buttons are clicked", async () => {
  render(<SettingsPage />);
  
  // Wait for elements to be in the document
  const lightButton = await screen.findByText("settings.lightMode");
  const darkButton = await screen.findByText("settings.darkMode");
  const systemButton = await screen.findByText("settings.systemMode");
  
  // Click the light mode button
  fireEvent.click(lightButton);
  expect(themeHelpers.setTheme).toHaveBeenCalledWith("light");
  
  // Click the dark mode button
  fireEvent.click(darkButton);
  expect(themeHelpers.setTheme).toHaveBeenCalledWith("dark");
  
  // Click the system mode button
  fireEvent.click(systemButton);
  expect(themeHelpers.setTheme).toHaveBeenCalledWith("system");
});
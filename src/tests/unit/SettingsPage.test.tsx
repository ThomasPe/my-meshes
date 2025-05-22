import { render, screen, fireEvent } from "@testing-library/react";
import { vi, test, expect, beforeEach } from "vitest";
import SettingsPage from "@/pages/SettingsPage";
import React from "react";
import * as themeHelpers from "@/helpers/theme_helpers";

// Mock Radix Themes components
vi.mock("@radix-ui/themes", () => ({
  Box: ({ children, className }: any) => <div className={className}>{children}</div>,
  Flex: ({ children, className, gap, direction, align }: any) => (
    <div className={`flex ${className || ''}`} data-gap={gap} data-direction={direction} data-align={align}>{children}</div>
  ),
  Text: ({ children, color, as: Component = "span", mb, weight }: any) => (
    <Component data-color={color} data-mb={mb} data-weight={weight}>{children}</Component>
  ),
  Heading: ({ children, mb, size }: any) => <h2 data-mb={mb} data-size={size}>{children}</h2>,
  ToggleGroup: {
    Root: ({ children, type, value, onValueChange }: any) => (
      <div data-testid="toggle-group" data-type={type} data-value={value}>
        {React.Children.map(children, child => 
          React.cloneElement(child, {
            onClick: () => onValueChange && onValueChange(child.props.value)
          })
        )}
      </div>
    ),
    Item: ({ children, value, "aria-label": ariaLabel, onClick }: any) => (
      <button data-value={value} aria-label={ariaLabel} onClick={onClick}>
        {children}
      </button>
    )
  }
}));

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
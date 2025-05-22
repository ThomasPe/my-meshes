import { exposeThemeContext } from "./theme/theme-context";
import { exposeWindowContext } from "./window/window-context";
import { exposeFilesystemContext } from "./filesystem/filesystem-context";

export default function exposeContexts() {
  exposeWindowContext();
  exposeThemeContext();
  exposeFilesystemContext();
}

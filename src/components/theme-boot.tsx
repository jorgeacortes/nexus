import { THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * Applies the saved theme before paint so the first frame matches. Dark is the
 * default; "system" follows the OS preference.
 */
export function ThemeBootScript() {
  const script = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||"dark";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){document.documentElement.classList.add("dark");}})();`;
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: required for the pre-hydration theme boot script
    <script dangerouslySetInnerHTML={{ __html: script }} />
  );
}

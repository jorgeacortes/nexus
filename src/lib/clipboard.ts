/**
 * Copy text to the clipboard.
 *
 * `navigator.clipboard` only exists in a secure context. The deployed board is
 * reachable as plain `http://<host>:3210` (localhost counts as secure, a
 * Tailscale host does not), so fall back to a hidden textarea plus the legacy
 * `execCommand("copy")` when the async API is missing or refuses.
 *
 * Returns whether the text made it to the clipboard, so callers can tell the
 * operator instead of silently doing nothing.
 */
export async function copyText(text: string): Promise<boolean> {
  const clipboard = globalThis.navigator?.clipboard;
  if (typeof clipboard?.writeText === "function") {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Insecure context or denied permission: try the legacy path.
    }
  }
  return copyWithExecCommand(text);
}

function copyWithExecCommand(text: string): boolean {
  const doc = globalThis.document;
  if (!doc?.body) return false;
  const area = doc.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.opacity = "0";
  // Park the textarea inside the open dialog when there is one: Radix (the task
  // sheet, the create-task dialog) keeps focus inside the modal and re-focuses
  // it, which drops the selection of a textarea sitting on <body> before the
  // command reads it. Returns true without writing in that case, so the host
  // matters for honesty, not just looks.
  const active = doc.activeElement;
  const dialog = typeof active?.closest === "function" ? active.closest("[role='dialog'],[role='alertdialog']") : null;
  (dialog ?? doc.body).appendChild(area);
  try {
    area.focus();
    area.select();
    return doc.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

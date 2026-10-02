import { ROUTES } from "./routes";
import { type Page, expect, test } from "@playwright/test";

/**
 * Smoke test: every route in routes.ts answers 200, shows its main heading and
 * logs no errors to the browser console. Page behaviour is tested elsewhere.
 */

// Console errors that are not ours to fix, matched against "<message> <url>".
// Add a pattern only with a comment saying why it is safe to ignore.
const IGNORED_CONSOLE_ERRORS: RegExp[] = [];

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", message => {
    if (message.type() !== "error") return;
    const text = `${message.text()} ${message.location().url}`;
    if (!IGNORED_CONSOLE_ERRORS.some(pattern => pattern.test(text))) errors.push(`console: ${text}`);
  });
  page.on("pageerror", error => errors.push(`uncaught: ${error.message}`));
  return errors;
}

for (const route of ROUTES) {
  test(`${route.path} loads with its heading and no console errors`, async ({ page }) => {
    const errors = collectErrors(page);

    const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
    expect(response?.status(), `HTTP status of ${route.path}`).toBe(200);

    if (route.text) {
      await expect(page.getByText(route.text).first()).toBeVisible();
    } else {
      await expect(page.getByRole("heading", { level: 1, name: route.heading }).first()).toBeVisible();
    }

    // Let client effects (contract reads, polling) run before judging the console.
    await page.waitForLoadState("networkidle").catch(() => undefined);
    expect(errors, `errors on ${route.path}`).toEqual([]);
  });
}

/** Exercise the compact Home through its public controls, never by unhiding content. */
import assert from "node:assert/strict";

async function activate(control, keyboard) {
  if (keyboard) { await control.focus(); await control.press("Enter"); }
  else await control.click();
}
async function weatherExpanded(page, expanded, keyboard) {
  const summary = page.locator('summary[aria-label="Time and weather"]');
  await summary.waitFor();
  const details = summary.locator("..");
  assert.equal(await details.evaluate(element => element.tagName), "DETAILS");
  if (await details.evaluate(element => element.open) !== expanded) await activate(summary, keyboard);
  await page.waitForFunction(expanded => document.querySelector('summary[aria-label="Time and weather"]')?.parentElement.open === expanded, expanded);
  if (expanded) await page.getByRole("combobox", { name: "Temperature", exact: true }).waitFor();
  else assert.equal(await page.getByRole("combobox", { name: "Temperature", exact: true }).isVisible(), false);
}
async function styleExpanded(page, expanded, keyboard) {
  const panel = page.getByRole("region", { name: "Saved style direction", exact: true });
  const toggle = panel.getByRole("button", { name: /^(Change|Close) direction$/ });
  await toggle.waitFor();
  const state = await toggle.getAttribute("aria-expanded");
  assert.ok(state === "true" || state === "false", "the visible direction control exposes its disclosure state");
  if ((state === "true") !== expanded) await activate(toggle, keyboard);
  const settled = panel.getByRole("button", { name: expanded ? "Close direction" : "Change direction", exact: true });
  await settled.waitFor(); assert.equal(await settled.getAttribute("aria-expanded"), String(expanded));
  if (expanded) await panel.getByRole("button", { name: "New direction", exact: true }).waitFor();
  else assert.equal(await panel.getByRole("button", { name: "New direction", exact: true }).isVisible(), false);
  return panel;
}
export const openTimeAndWeather = (page, { keyboard = false } = {}) => weatherExpanded(page, true, keyboard);
export const closeTimeAndWeather = (page, { keyboard = false } = {}) => weatherExpanded(page, false, keyboard);
export const openStyleDirection = (page, { keyboard = false } = {}) => styleExpanded(page, true, keyboard);
export const closeStyleDirection = (page, { keyboard = false } = {}) => styleExpanded(page, false, keyboard);

/** Literal acceptance: closed options, no horizontal overflow, and the mobile ask in view. */
export function assertHomeLayout(metrics) {
  assert.ok(metrics && Number.isFinite(metrics.pageWidth) && metrics.pageWidth > 0);
  assert.ok(metrics.pageWidth <= metrics.viewport.width, "Home must not overflow horizontally");
  assert.equal(metrics.weatherOpen, false, "Home layout is measured with time/weather closed");
  assert.equal(metrics.directionOpen, false, "Home layout is measured with direction editing closed");
  for (const key of ["event", "submit"]) {
    const rect = metrics[key];
    assert.ok(rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0, `Home ${key} must be measurable`);
    if (metrics.viewport.width === 390) {
      assert.equal(metrics.viewport.height, 844, "mobile acceptance uses the reviewed 390 by 844 viewport");
      assert.ok(rect.x >= 0 && rect.x + rect.width <= 390 && rect.y >= 0 && rect.y + rect.height <= 844, `Home ${key} must fit entirely in the initial mobile viewport`);
    }
  }
}

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { openStyleDirection, closeStyleDirection, openTimeAndWeather, closeTimeAndWeather } from "./home-browser-controls.mjs";

export async function captureHomeEdge(page, name, outputDirectory) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const metrics = await page.evaluate(() => {
    const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden";
    const controls = [...document.querySelectorAll("main input, main select, main textarea, main button, main summary")].filter(visible).map(element => {
      const rect = element.getBoundingClientRect();
      return { label: element.getAttribute("aria-label") || element.textContent.trim().slice(0, 80), left: rect.left, right: rect.right, width: rect.width };
    });
    return { viewportWidth: innerWidth, pageWidth: document.documentElement.scrollWidth, controls };
  });
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(path.join(outputDirectory, `edge-${name}.json`), JSON.stringify(metrics, null, 2) + "\n");
    await page.screenshot({ path: path.join(outputDirectory, `edge-${name}.png`), fullPage: true });
  }
  assert.equal(metrics.viewportWidth, 390);
  assert.ok(metrics.pageWidth <= 390, `${name}: horizontal page overflow`);
  assert.ok(metrics.controls.length > 0);
  for (const control of metrics.controls) assert.ok(control.left >= -1 && control.right <= 391 && control.width > 0, `${name}: clipped ${control.label}`);
  return metrics;
}

export async function checkHomeEdges({ page, origin, ids, outputDirectory }) {
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = page.getByRole("region", { name: "Saved style direction", exact: true });
  const submit = page.getByRole("button", { name: "Get Recommendations", exact: true });
  const links = () => page.getByRole("link", { name: "Open proposal / plan an outfit", exact: true });
  const bindings = () => links().evaluateAll(elements => elements.map(element => element.getAttribute("href")));
  try {
    await page.goto(`${origin}/dashboard`);
    await links().first().waitFor();
    const originalBindings = await bindings(); assert.ok(originalBindings.length);
    await page.reload(); await links().first().waitFor();
    assert.deepEqual(await bindings(), originalBindings, "reload retains exact admitted proposal identities");
    await captureHomeEdge(page, "restored-results", outputDirectory);
    const eventInput = page.getByRole("textbox", { name: "Event description", exact: true });
    const originalOccasion = await eventInput.inputValue();
    const draftOccasion = "An unfinished different occasion";
    await eventInput.fill(draftOccasion);
    const jump = page.getByRole("link", { name: `View ${originalBindings.length} shown outfit${originalBindings.length === 1 ? "" : "s"}`, exact: true });
    // Natural Tab traversal from the edited event field: closed settings must not
    // strand focus in invisible controls, and opening each disclosure must expose it.
    const focused = locator => locator.evaluate(element => element === document.activeElement);
    await page.keyboard.press("Tab");
    assert.ok(await focused(panel.getByRole("button", { name: "Change direction", exact: true })));
    await page.keyboard.press("Enter"); await page.keyboard.press("Tab");
    assert.ok(await focused(panel.getByRole("combobox", { name: "Style direction", exact: true })));
    await page.keyboard.press("Shift+Tab");
    assert.ok(await focused(panel.getByRole("button", { name: "Close direction", exact: true })));
    await page.keyboard.press("Enter"); await page.keyboard.press("Tab");
    assert.ok(await focused(panel.locator("summary").filter({ hasText: "Leave pieces or an exact outfit out" })));
    await page.keyboard.press("Tab");
    const weatherToggle = page.locator('summary[aria-label="Time and weather"]');
    assert.ok(await focused(weatherToggle));
    await page.keyboard.press("Enter"); await page.keyboard.press("Tab");
    assert.ok(await focused(page.getByRole("button", { name: "Now", exact: true })));
    await page.keyboard.press("Shift+Tab");
    assert.ok(await focused(weatherToggle));
    await page.keyboard.press("Enter"); await page.keyboard.press("Tab");
    assert.ok(await focused(submit));
    await page.keyboard.press("Tab"); assert.ok(await focused(jump));
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.id === "home-outfits");
    const heading = await page.locator("#home-outfits").boundingBox();
    assert.ok(heading && heading.y >= 0 && heading.y + heading.height <= 844, "explicit navigation brings the result heading into view");
    if (outputDirectory) await page.screenshot({ path: path.join(outputDirectory, "edge-outfit-navigation.png") });
    const resultRegion = page.getByRole("region", { name: "Shown outfits", exact: true });
    assert.equal(await resultRegion.getByText(`Requested for: ${originalOccasion}`, { exact: true }).count(), 1);
    assert.equal((await resultRegion.innerText()).includes(draftOccasion), false);
    await page.keyboard.press("Tab");
    assert.ok(await focused(page.getByRole("link", { name: "Back to request", exact: true })));
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.id === "home-request");
    assert.equal(await eventInput.inputValue(), draftOccasion, "round-trip navigation retains the unfinished request");
    assert.deepEqual(await bindings(), originalBindings, "navigation never changes admitted outfit identities");
    await eventInput.fill(originalOccasion);

    await openTimeAndWeather(page, { keyboard: true });
    await page.getByRole("combobox", { name: "Temperature", exact: true }).selectOption("cold");
    await page.getByRole("combobox", { name: "Rain", exact: true }).selectOption("rain");
    await page.getByRole("combobox", { name: "Wind", exact: true }).selectOption("windy");
    await captureHomeEdge(page, "manual-weather-open", outputDirectory);
    await closeTimeAndWeather(page, { keyboard: true });
    assert.match(await page.locator("#home-weather-summary").innerText(), /cold, rain expected, windy/);
    await captureHomeEdge(page, "manual-weather-closed", outputDirectory);
    assert.deepEqual(await bindings(), originalBindings, "draft weather does not replace old proposals");

    await openStyleDirection(page);
    const select = panel.getByRole("combobox", { name: "Style direction", exact: true });
    const boardId = await select.inputValue(); assert.ok(boardId);
    const originalLabel = await select.locator("option:checked").innerText();
    const longLabel = "LongDirectionWithoutSpaces".repeat(2); // 52 chars, within the real 60-char limit.
    async function beginRename(label, next) {
      const manage = panel.getByRole("button", { name: "Manage saved choices", exact: true });
      if (await manage.count()) await manage.click();
      await panel.getByRole("button", { name: `Rename: ${label}`, exact: true }).click();
      await panel.getByLabel("Saved choice name", { exact: true }).fill(next);
    }
    await beginRename(originalLabel, longLabel);
    let release, intercepted;
    const gate = new Promise(resolve => { release = resolve; });
    const arrived = new Promise(resolve => { intercepted = resolve; });
    const commands = []; let arrivalTimer;
    const handler = async route => {
      if (route.request().method() !== "POST") return route.continue();
      const command = route.request().postDataJSON();
      if (command.kind !== "rename_board") return route.continue();
      commands.push(command);
      const response = await route.fetch();
      intercepted();
      await gate;
      await route.fulfill({ response });
    };
    await page.route("**/api/style-memory", handler);
    try {
      await panel.getByRole("button", { name: "Save changes", exact: true }).click();
      await Promise.race([arrived, new Promise((_, reject) => { arrivalTimer = setTimeout(() => reject(new Error("Rename acknowledgement was not intercepted")), 15_000); })]);
      clearTimeout(arrivalTimer);
      await closeStyleDirection(page);
      assert.equal(await submit.isDisabled(), true);
      assert.ok((await panel.getByLabel("Acknowledged saved settings").innerText()).includes(originalLabel));
      await panel.getByText("Saving saved directions… Outfit requests wait for confirmation.", { exact: true }).waitFor();
      await captureHomeEdge(page, "pending-save-closed", outputDirectory);
      release();
      await panel.getByLabel("Acknowledged saved settings").getByText(new RegExp(longLabel)).waitFor();
      await page.waitForFunction(element => !element.disabled, await submit.elementHandle());
      assert.equal(commands.length, 1); assert.equal(commands[0].label, longLabel); assert.equal(commands[0].boardId, boardId);
      await captureHomeEdge(page, "long-direction", outputDirectory);
      assert.deepEqual(await bindings(), originalBindings, "renaming current settings preserves historical proposal bindings");
    } finally { release(); clearTimeout(arrivalTimer); await page.unroute("**/api/style-memory", handler); }
    await openStyleDirection(page); await beginRename(longLabel, originalLabel);
    await panel.getByRole("button", { name: "Save changes", exact: true }).click();
    await panel.getByRole("button", { name: `Rename: ${originalLabel}`, exact: true }).waitFor();
    await closeStyleDirection(page);
    await page.goto(`${origin}/dashboard?rescue=${ids[0]}&name=${encodeURIComponent("A long synthetic rescue garment name for the phone walkthrough")}`);
    await page.getByText("Building an outfit around", { exact: false }).waitFor();
    await captureHomeEdge(page, "rescue", outputDirectory);
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await page.getByRole("link", { name: "Pick it from your wardrobe", exact: true }).waitFor();
    await page.goto(`${origin}/dashboard`);
  } finally { await page.setViewportSize(viewport); }
}

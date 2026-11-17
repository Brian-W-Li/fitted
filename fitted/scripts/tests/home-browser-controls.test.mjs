import test from "node:test";
import assert from "node:assert/strict";
import { assertHomeLayout } from "../home-browser-controls.mjs";

const mobile = () => ({ viewport: { width: 390, height: 844 }, pageWidth: 390, weatherOpen: false, directionOpen: false,
  event: { x: 24, y: 300, width: 342, height: 100 }, submit: { x: 24, y: 430, width: 342, height: 48 }, direction: { x: 24, y: 180, width: 342, height: 80 } });
test("the mobile ask and button must fit whole, with both optional controls closed", () => {
  assertHomeLayout(mobile());
  for (const change of [m => { m.submit.y = 820; }, m => { m.event.x = -1; }, m => { m.event.width = 390; },
    m => { m.pageWidth = 391; }, m => { m.weatherOpen = true; }, m => { m.directionOpen = true; },
    m => { m.submit = null; }, m => { m.event.height = 0; }]) {
    const bad = mobile(); change(bad); assert.throws(() => assertHomeLayout(bad));
  }
});
test("desktop retains overflow and closed-state checks without a mobile vertical limit", () => {
  const desktop = { ...mobile(), viewport: { width: 1280, height: 900 }, pageWidth: 1280, submit: { x: 24, y: 1100, width: 500, height: 48 } };
  assertHomeLayout(desktop);
  assert.throws(() => assertHomeLayout({ ...desktop, pageWidth: 1281 }));
});

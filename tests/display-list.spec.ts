import { expect, test } from "playwright/test";

interface DisplayListResult {
  pass: boolean;
  error?: string;
  gpuErrors: string[];
  pendingGpuWork?: boolean;
  checks: { name: string; pass: boolean; expected?: unknown; got?: unknown }[];
}

test("a display list draws, animates and outlives its resources", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/tests/display-list.html");
  const handle = await page.waitForFunction(
    () => (window as unknown as { displayList?: DisplayListResult }).displayList
  );
  const result = (await handle.jsonValue()) as DisplayListResult;

  // Reported first: they explain a failure better than the pixel checks do.
  expect(result.error).toBeUndefined();
  expect(result.gpuErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(result.checks.filter((check) => !check.pass)).toEqual([]);
  // Every frame ran: a missing step would leave fewer checks.
  expect(result.checks).toHaveLength(55);
  expect(result.pendingGpuWork).toBe(false);
  expect(result.pass).toBe(true);
});

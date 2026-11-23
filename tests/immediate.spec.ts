import { expect, test } from "playwright/test";

interface ImmediateResult {
  pass: boolean;
  error?: string;
  gpuErrors: string[];
  pendingGpuWork?: boolean;
  checks: { name: string; pass: boolean; expected?: unknown; got?: unknown }[];
}

test("the immediate API draws every feature", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/tests/immediate.html");
  const handle = await page.waitForFunction(
    () => (window as unknown as { immediate?: ImmediateResult }).immediate
  );
  const result = (await handle.jsonValue()) as ImmediateResult;

  // Reported first: they explain a failure better than the pixel checks do.
  expect(result.error).toBeUndefined();
  expect(result.gpuErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(result.checks.filter((check) => !check.pass)).toEqual([]);
  // Every step ran: a missing one would leave fewer checks.
  expect(result.checks).toHaveLength(180);
  expect(result.pendingGpuWork).toBe(false);
  expect(result.pass).toBe(true);
});

import { test, expect } from "e2e/test";

test("adds new plant with custom title", async ({ page, now }) => {
  const plantName = `Plant ${now}`;

  await page.goto("/");

  await page.getByRole("link", { name: "Add plant" }).click();
  await page.getByRole("textbox", { name: "Plant name" }).fill(plantName);
  await page.getByRole("button", { name: "Save plant" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("listitem").getByRole("link", { name: plantName })).toBeVisible();
});

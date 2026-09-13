import { expect, test as setup } from "@playwright/test";

const authFile = "e2e/.auth/user.json";

setup("sign in as the seeded user", async ({ page }) => {
  await page.goto("/auth/signin");
  await page.getByRole("textbox", { name: "Email" }).fill("test@yapca.local");
  await page.getByRole("textbox", { name: "Password" }).fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");

  await expect(page.getByRole("button", { name: "Sign in" })).toBeHidden();

  await page.context().storageState({ path: authFile });
});

// Risk #2 (context/foundation/test-plan.md §2): a due task is omitted from the daily list — the
// plant needs water and the list stays silent. §8 names this flow as the browser-level response:
// sign in → plant due on the list → mark watered → disappears. Modeled on e2e/specs/seed.spec.ts.
//
// Real boundaries: auth (storageState), SSR loader, React island hydration, Astro Action, RPC, DB.
// Nothing is mocked.
import { test, expect } from "e2e/test";

test.describe("Risk #2: due plants are never silently dropped from Today", () => {
  test("a plant due today stays on the list until it is watered, and stays off after a reload", async ({
    page,
    now,
    plantCleanup,
  }) => {
    const plantName = `Due fern ${now}`;
    const wateredButton = page.getByRole("button", { name: `Watered ${plantName}` });
    // Present in every rendered list state (empty, due, nothing due), absent while the island is
    // still resolving the local date — so waiting on it rules out a vacuous "not on the list".
    const renderedList = page.getByRole("link", { name: "Add plant" }).first();

    plantCleanup.track(plantName);

    // Add a plant that needs water today.
    await page.goto("/plants/new");
    await page.getByRole("textbox", { name: "Plant name" }).fill(plantName);
    await expect(page.getByRole("radio", { name: /^Today/ })).toBeChecked();
    await page.getByRole("button", { name: "Save plant" }).click();

    // The freshly loaded Today list shows it as due.
    await expect(page).toHaveURL("/");
    await expect(wateredButton).toBeVisible();

    // Mark it watered: the mutation is confirmed and the row leaves the list.
    await wateredButton.click();
    await expect(page.getByText(`${plantName} marked watered`)).toBeVisible();
    await expect(wateredButton).toBeHidden();

    // After a reload, the server-loaded list agrees: it is no longer due.
    await page.reload();
    await expect(renderedList).toBeVisible();
    await expect(wateredButton).toBeHidden();
  });
});

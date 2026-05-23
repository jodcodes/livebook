import { expect, test, type APIRequestContext } from "@playwright/test";

type PlaybookSummary = {
  id: string;
};

type ClausePayload = {
  clause_id?: string;
  playbook_id?: string;
};

type PlaybookVersion = {
  version_id: string;
  playbook_id: string;
  changed_clause_ids?: string[];
};

const E2E_PLAYBOOK_ID = "e2e-review-undo-playbook";
const E2E_CLAUSE_ID = "e2e-review-undo-playbook:liability";

test.beforeEach(async ({ request }) => {
  await ensureE2ePlaybook(request);
});

test("legal user can move through review, proofread, ask, draft, projects, and settings", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Legal Counsel/i }).click();

  await page.locator("button").filter({ hasText: /^Review$/ }).first().click();
  await page.locator("button").filter({ hasText: /Custom Review/ }).first().click();
  await expect(page.getByText("Custom review instructions")).toBeVisible();
  await page.locator("button").filter({ hasText: /Review document/ }).first().click();
  await expect(page.getByText("Confirm action")).toBeVisible();
  await page.locator("button").filter({ hasText: /^Confirm$/ }).first().click();
  await expect(page.getByText("Redline summary")).toBeVisible();
  await page.locator("button").filter({ hasText: /Edit before apply/ }).first().click();
  await expect(page.getByText("Edit redline before applying")).toBeVisible();
  await page.locator("button").filter({ hasText: /Apply edited redline/ }).first().click();
  await expect(page.getByText("Confirm action")).toBeVisible();
  await page.locator("button").filter({ hasText: /^Confirm$/ }).first().click();
  await expect(page.locator("button").filter({ hasText: /^Undo$/ }).first()).toBeVisible();

  await page.locator("button").filter({ hasText: /Final cleanup checks/ }).first().click();
  await page.locator("button").filter({ hasText: /^Proofread$/ }).first().click();
  await expect(page.getByText("Confirm action")).toBeVisible();
  await page.locator("button").filter({ hasText: /^Confirm$/ }).first().click();
  await expect(page.locator("button").filter({ hasText: /Apply fix/ }).first()).toBeVisible();

  await page.locator("button").filter({ hasText: /^Ask$/ }).first().click();
  await page.locator("button").filter({ hasText: /Document Context/ }).first().click();
  await expect(page.getByText("Selected text", { exact: true })).toBeVisible();

  await page.locator("button").filter({ hasText: /^Draft$/ }).first().click();
  await expect(page.getByText("Precedent import")).toBeVisible();

  await page.locator("button").filter({ hasText: /^Projects$/ }).first().click();
  await expect(page.getByText("Project goal")).toBeVisible();

  await page.locator("button").filter({ hasText: /^Settings$/ }).first().click();
  await expect(page.getByText("Role permissions")).toBeVisible();

  await expect(page.locator("body")).not.toContainText("Market");
  expect(consoleErrors).toEqual([]);
});

test("business user sees role-limited settings without legal queue", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Business User/i }).click();

  await expect(page.locator("body")).not.toContainText("Legal Queue");

  await page.locator("button").filter({ hasText: /^Settings$/ }).first().click();
  await expect(page.getByText("Business users can inspect defaults")).toBeVisible();
  await expect(page.getByRole("button", { name: /Save settings/i })).toBeDisabled();
});

test("legal user can restore an older playbook version with confirm and undo", async ({
  page,
  request,
}) => {
  const playbooksResponse = await request.get("/api/backend/playbooks");
  expect(playbooksResponse.ok()).toBeTruthy();
  const playbooks = (await playbooksResponse.json()) as PlaybookSummary[];
  expect(playbooks.length).toBeGreaterThan(0);

  const targetPlaybook =
    playbooks.find((playbook) => playbook.id === E2E_PLAYBOOK_ID) ?? playbooks[0];
  if (!targetPlaybook) {
    throw new Error("expected at least one seeded playbook");
  }
  const clausesResponse = await request.get("/api/backend/playbook");
  expect(clausesResponse.ok()).toBeTruthy();
  const clauses = (await clausesResponse.json()) as ClausePayload[];
  const targetClause = clauses.find(
    (clause) => clause.playbook_id === targetPlaybook.id && clause.clause_id
  );
  const targetClauseId = targetClause?.clause_id;
  expect(targetClauseId).toBeTruthy();
  if (!targetClauseId) {
    throw new Error("expected a seeded playbook clause");
  }

  const originalVersionsResponse = await request.get(
    `/api/backend/playbooks/${encodeURIComponent(targetPlaybook.id)}/versions`
  );
  expect(originalVersionsResponse.ok()).toBeTruthy();
  const originalVersions = (await originalVersionsResponse.json()) as PlaybookVersion[];
  const originalCurrentVersion = originalVersions[0];

  const stamp = Date.now();
  try {
    for (const redLine of [`E2E restore baseline ${stamp}`, `E2E restore changed ${stamp}`]) {
      const patchResponse = await request.patch(
        `/api/backend/playbook/${encodeURIComponent(targetClauseId)}`,
        { data: { red_line: redLine } }
      );
      expect(patchResponse.ok()).toBeTruthy();
    }

    const versionsResponse = await request.get(
      `/api/backend/playbooks/${encodeURIComponent(targetPlaybook.id)}/versions`
    );
    expect(versionsResponse.ok()).toBeTruthy();
    const versions = (await versionsResponse.json()) as PlaybookVersion[];
    const olderVersion =
      versions.find(
        (version, index) =>
          index > 0 && version.changed_clause_ids?.includes(targetClauseId)
      ) ?? versions[1];
    expect(olderVersion).toBeTruthy();
    if (!olderVersion) {
      throw new Error("expected at least two playbook versions to restore");
    }

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /Legal Counsel/i }).click();
    await page.locator("button").filter({ hasText: /^Version History$/ }).click();
    await expect(page.getByRole("heading", { name: "Version History" })).toBeVisible();

    await page.locator("button").filter({ hasText: olderVersion.version_id }).click();
    const restoreButton = page.locator("button").filter({ hasText: /Restore this version/ });
    await expect(restoreButton).toBeEnabled();
    await restoreButton.click();
    await expect(page.getByText("as a new current playbook version")).toBeVisible();
    await page.locator("button").filter({ hasText: /^Confirm$/ }).click();

    await expect(page.getByText("Undo restore")).toBeVisible();
    await page.locator("button").filter({ hasText: /^Undo$/ }).click();
    await expect(page.getByText("Undo applied.")).toBeVisible();
  } finally {
    if (originalCurrentVersion) {
      const restoreOriginalResponse = await request.post(
        `/api/backend/playbooks/${encodeURIComponent(
          originalCurrentVersion.playbook_id
        )}/versions/${encodeURIComponent(originalCurrentVersion.version_id)}/restore`
      );
      expect(restoreOriginalResponse.ok()).toBeTruthy();
    }
  }
});

async function ensureE2ePlaybook(request: APIRequestContext) {
  const clausesResponse = await request.get("/api/backend/playbook");
  expect(clausesResponse.ok()).toBeTruthy();
  const clauses = (await clausesResponse.json()) as ClausePayload[];
  if (clauses.some((clause) => clause.clause_id === E2E_CLAUSE_ID)) {
    return;
  }
  if (clauses.length > 0) {
    return;
  }

  const seedResponse = await request.patch("/api/backend/playbook", {
    data: [
      {
        clause_id: E2E_CLAUSE_ID,
        original_clause_id: "Liability",
        playbook_id: E2E_PLAYBOOK_ID,
        playbook_name: "E2E Review Undo Playbook",
        playbook_type: "opposite_party",
        party_name: "E2E Counterparty",
        law_type: "General Commercial",
        name: "Liability cap",
        clause_type: "Liability",
        positions: {
          preferred: "Liability is capped at fees paid in the prior 12 months.",
          fallback_1: "Liability is capped at 150% of fees paid in the prior 12 months.",
          fallback_2: "Liability is capped at 200% of fees paid in the prior 12 months.",
        },
        red_line: "Reject unlimited liability and uncapped indirect damages.",
        escalation_trigger: "Counterparty requests unlimited liability.",
        always_escalate: true,
        keywords: ["liability", "cap", "damages"],
        negotiation_history: [],
        history: [],
        source_files: ["e2e-fixture.json"],
        low_confidence: false,
        meta: {
          version: 1,
          version_id: "VER-e2e-review-undo-liability",
          review_status: "pending",
          pending_evolve: false,
          created_at: "2026-01-01T00:00:00.000Z",
          created_by: "E2E",
          created_by_role: "lawyer",
          created_from: "e2e_fixture",
        },
      },
    ],
  });
  expect(seedResponse.ok()).toBeTruthy();
}

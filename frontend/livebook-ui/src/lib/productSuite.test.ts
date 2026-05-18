import { describe, expect, it } from "vitest";

import { createProductWorkflows } from "./productSuite";

describe("createProductWorkflows", () => {
  it("covers all product-gap workflows", () => {
    const workflows = createProductWorkflows({
      documentText: "Agreement text",
      draftInstructions: "Draft indemnity language",
      goal: "Review document consistency",
      question: "What are the risks?",
      selectedText: "Selected clause",
      standardsAvailable: true,
      benchmarkContractType: "commercial lease",
    });

    expect(workflows.map((workflow) => workflow.id)).toEqual([
      "word-review",
      "draft-clause",
      "document-chat",
      "benchmark-review",
      "associate-project",
      "proofread",
    ]);
  });

  it("builds payloads from the current shared context", () => {
    const workflows = createProductWorkflows({
      documentText: "Current document",
      draftInstructions: "Draft indemnity language",
      goal: "Review consistency",
      question: "Explain this clause",
      selectedText: "Selected text",
      standardsAvailable: false,
      benchmarkContractType: "master services agreement",
    });

    expect(workflows.find((workflow) => workflow.id === "word-review")?.payload()).toMatchObject({
      document_text: "Current document",
      word_context_available: true,
    });
    expect(workflows.find((workflow) => workflow.id === "document-chat")?.payload()).toMatchObject({
      question: "Explain this clause",
      document_text: "Current document",
      selected_text: "Selected text",
    });
    expect(workflows.find((workflow) => workflow.id === "associate-project")?.payload()).toMatchObject({
      goal: "Review consistency",
    });
    expect(workflows.find((workflow) => workflow.id === "benchmark-review")?.payload()).toMatchObject({
      standards_available: false,
      contract_type: "master services agreement",
    });
  });
});

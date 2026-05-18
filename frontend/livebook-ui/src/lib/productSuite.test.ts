import { describe, expect, it } from "vitest";

import { createProductWorkflows } from "./productSuite";

describe("createProductWorkflows", () => {
  it("covers all product-gap workflows", () => {
    const workflows = createProductWorkflows({
      documentText: "Agreement text",
      draftInstructions: "Draft indemnity language",
      goal: "Review document consistency",
      question: "What are the risks?",
      reviewMode: "general",
      customReviewInstructions: "",
      selectedText: "Selected clause",
    });

    expect(workflows.map((workflow) => workflow.id)).toEqual([
      "word-review",
      "draft-clause",
      "document-chat",
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
      reviewMode: "custom",
      customReviewInstructions: "Flag missing assignment consent.",
      selectedText: "Selected text",
    });

    expect(workflows.find((workflow) => workflow.id === "word-review")?.payload()).toMatchObject({
      document_text: "Current document",
      word_context_available: true,
      review_mode: "custom",
      custom_instructions: "Flag missing assignment consent.",
    });
    expect(workflows.find((workflow) => workflow.id === "draft-clause")?.payload()).toMatchObject({
      document_context: "Current document",
      selected_text: "Selected text",
    });
    expect(workflows.find((workflow) => workflow.id === "document-chat")?.payload()).toMatchObject({
      question: "Explain this clause",
      document_text: "Current document",
      selected_text: "Selected text",
    });
    expect(workflows.find((workflow) => workflow.id === "associate-project")?.payload()).toMatchObject({
      goal: "Review consistency",
    });
  });
});

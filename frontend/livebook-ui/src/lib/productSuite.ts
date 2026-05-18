export type WorkflowId =
  | "word-review"
  | "draft-clause"
  | "document-chat"
  | "associate-project"
  | "proofread";

export type ProductSuiteContext = {
  documentText: string;
  draftInstructions: string;
  goal: string;
  question: string;
  reviewMode: string;
  customReviewInstructions: string;
  selectedText: string;
};

export type ProductWorkflow = {
  id: WorkflowId;
  title: string;
  description: string;
  iconClass: string;
  actionLabel: string;
  payload: () => Record<string, unknown>;
};

export function createProductWorkflows({
  documentText,
  draftInstructions,
  goal,
  question,
  reviewMode,
  customReviewInstructions,
  selectedText,
}: ProductSuiteContext): ProductWorkflow[] {
  return [
    {
      id: "word-review",
      title: "Word Review",
      description: "Review the current matter text for contract risks and staged redlines.",
      iconClass: "ri-file-search-line",
      actionLabel: "Review document",
      payload: () => ({
        document_text: documentText,
        actor: "Legal Reviewer",
        word_context_available: true,
        review_mode: reviewMode,
        custom_instructions: customReviewInstructions,
        selected_text: selectedText,
      }),
    },
    {
      id: "draft-clause",
      title: "Drafting",
      description: "Draft clause language from the current matter context and preferred style.",
      iconClass: "ri-quill-pen-line",
      actionLabel: "Draft clause",
      payload: () => ({
        instructions: draftInstructions,
        document_context: documentText,
        selected_text: selectedText,
        party_position: "customer",
        jurisdiction: null,
        writing_style: "plain English",
      }),
    },
    {
      id: "document-chat",
      title: "Document Chat",
      description: "Ask a grounded legal question using document and playbook context.",
      iconClass: "ri-chat-3-line",
      actionLabel: "Ask Livebook",
      payload: () => ({
        question,
        selected_text: selectedText,
        document_text: documentText,
        playbook_guidance: "Prefer mutual termination rights.",
        history: ["We discussed the termination clause."],
        language: "English",
      }),
    },
    {
      id: "associate-project",
      title: "Projects",
      description: "Plan supervised multi-document legal work with approval gates.",
      iconClass: "ri-node-tree",
      actionLabel: "Plan project",
      payload: () => ({
        goal,
        workflow: "financing documents",
        documents: [
          { name: "Credit Agreement", text: "Party: Acme Inc. Closing Date: May 1." },
          { name: "Security Agreement", text: "Party: ACME Incorporated. Closing Date: May 2." },
        ],
      }),
    },
    {
      id: "proofread",
      title: "Proofread",
      description: "Run final drafting cleanup separately from legal-risk review.",
      iconClass: "ri-check-double-line",
      actionLabel: "Proofread",
      payload: () => ({
        document_text: documentText,
      }),
    },
  ];
}

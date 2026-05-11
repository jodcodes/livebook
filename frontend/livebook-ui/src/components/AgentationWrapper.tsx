"use client";

import { Agentation } from "agentation";

export default function AgentationWrapper() {
  if (process.env.NODE_ENV !== "development") return null;

  const endpoint = process.env.NEXT_PUBLIC_AGENTATION_ENDPOINT;
  if (!endpoint) return null;

  return <Agentation endpoint={endpoint} />;
}

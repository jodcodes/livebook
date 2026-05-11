"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Notice, StatusBadge } from "@/components/premium";
import { cn } from "@/lib/utils";
import { localActor } from "@/lib/actorDefaults";

type UploadState = "idle" | "uploading" | "success" | "error";
type UploadMode = "create" | "update";

const OPPOSITE_PARTY_NAMES = ["Globex GmbH", "Acme Corp", "Initech Ltd"];
const SIEMENS_LAW_TYPES = [
  "Smart Infrastructure / Energy",
  "Digital Industries / Automation",
  "Data Privacy & Cybersecurity",
  "Procurement & Supply Chain",
  "Software, IP & Licensing",
  "Export Control & Sanctions",
  "Competition & Antitrust",
  "Mobility & Rail",
  "Healthcare & MedTech",
  "Employment & Works Council",
  "Corporate Governance & M&A",
  "ESG & Sustainability",
  "Real Estate & Facilities",
  "General Commercial",
];

interface PlaybookSummary {
  id: string;
  name: string;
  law_type?: string;
  party_name?: string;
  clause_count: number;
}

interface DiffField {
  field: string;
  from: string;
  to: string;
}

interface DiffItem {
  clause_id: string;
  name: string;
  changed_fields?: DiffField[];
}

interface DraftDiff {
  added?: DiffItem[];
  updated?: DiffItem[];
  removed?: DiffItem[];
  unchanged?: DiffItem[];
}

interface UploadResponse {
  kind: "created" | "draft";
  draft_id?: string;
  target_playbook_id?: string;
  diff?: DraftDiff;
}

interface PlaybookUploadModalProps {
  uploaderRole?: "business" | "lawyer";
  onUploadComplete: () => void;
  onClose?: () => void;
}

const ACCEPTED_TYPES =
  "application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx";

function isSupportedFile(file: File) {
  const lowerName = file.name.toLowerCase();
  return (
    file.type === "application/pdf" ||
    lowerName.endsWith(".pdf") ||
    lowerName.endsWith(".docx") ||
    lowerName.endsWith(".xlsx")
  );
}

function defaultNameFromFile(file?: File) {
  if (!file) return "";
  return file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
}

function diffCount(diff?: DraftDiff) {
  if (!diff) return 0;
  return (
    (diff.added?.length ?? 0) +
    (diff.updated?.length ?? 0) +
    (diff.removed?.length ?? 0)
  );
}

function DiffBucket({
  title,
  icon,
  tone,
  items = [],
}: {
  title: string;
  icon: string;
  tone: string;
  items?: DiffItem[];
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <i className={`${icon} ${tone}`} />
          {title}
        </h4>
        <span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">None</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.clause_id} className="rounded-lg bg-muted/40 p-3">
              <p className="font-mono text-xs text-muted-foreground">{item.clause_id}</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{item.name}</p>
              {item.changed_fields && item.changed_fields.length > 0 && (
                <div className="mt-2 space-y-1">
                  {item.changed_fields.slice(0, 4).map((field) => (
                    <p key={field.field} className="text-xs text-muted-foreground">
                      <span className="font-semibold">{field.field}:</span>{" "}
                      {field.from} {"->"} {field.to}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function PlaybookUploadModal({
  uploaderRole = "lawyer",
  onUploadComplete,
  onClose,
}: PlaybookUploadModalProps) {
  const uploaderActor = localActor(uploaderRole === "lawyer" ? "lawyer" : "business");
  const [uploadMode, setUploadMode] = useState<UploadMode>("create");
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [dragActive, setDragActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [playbookName, setPlaybookName] = useState("");
  const [oppositePartyName, setOppositePartyName] = useState(OPPOSITE_PARTY_NAMES[0]);
  const [lawType, setLawType] = useState(SIEMENS_LAW_TYPES[0]);
  const [playbooks, setPlaybooks] = useState<PlaybookSummary[]>([]);
  const [targetPlaybookId, setTargetPlaybookId] = useState("");
  const [draft, setDraft] = useState<UploadResponse | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedPlaybook = useMemo(
    () => playbooks.find((playbook) => playbook.id === targetPlaybookId),
    [playbooks, targetPlaybookId]
  );

  useEffect(() => {
    let cancelled = false;
    async function loadPlaybooks() {
      try {
        const response = await fetch("/api/backend/playbooks");
        if (!response.ok) throw new Error(await response.text());
        const list = (await response.json()) as PlaybookSummary[];
        if (cancelled) return;
        setPlaybooks(list);
        setTargetPlaybookId((current) => current || list[0]?.id || "");
      } catch {
        if (cancelled) setPlaybooks([]);
      }
    }
    void loadPlaybooks();
    return () => {
      cancelled = true;
    };
  }, []);

  const setFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      const unsupported = files.find((file) => !isSupportedFile(file));
      if (unsupported) {
        setErrorMessage(`${unsupported.name} is not supported. Use PDF, DOCX, or XLSX.`);
        setUploadState("error");
        return;
      }
      setSelectedFiles(files);
      setDraft(null);
      setUploadState("idle");
      setErrorMessage("");
      if (!playbookName.trim() && files.length > 0) {
        setPlaybookName(defaultNameFromFile(files[0]));
      }
    },
    [playbookName]
  );

  const uploadFiles = async () => {
    if (selectedFiles.length === 0) {
      setErrorMessage("Choose at least one playbook source file.");
      setUploadState("error");
      return;
    }
    if (uploadMode === "update" && !targetPlaybookId) {
      setErrorMessage("Choose an existing playbook to update.");
      setUploadState("error");
      return;
    }

    setUploadState("uploading");
    setErrorMessage("");
    setDraft(null);

    const formData = new FormData();
    selectedFiles.forEach((file) => formData.append("file", file));
    formData.append("upload_mode", uploadMode);
    if (uploadMode === "update") {
      formData.append("target_playbook_id", targetPlaybookId);
    }
    formData.append("playbook_name", playbookName.trim() || defaultNameFromFile(selectedFiles[0]));
    formData.append("playbook_type", "opposite_party");
    formData.append("party_name", oppositePartyName);
    formData.append("law_type", lawType);
    formData.append("uploaded_by_role", uploaderRole);
    formData.append("uploaded_by_name", uploaderActor.display_name);
    formData.append("uploaded_by_email", uploaderActor.email);

    try {
      const response = await fetch("/api/playbook", {
        method: "POST",
        body: formData,
      });
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(responseText || `Upload failed (${response.status})`);
      }
      const payload = JSON.parse(responseText) as UploadResponse;
      if (payload.kind === "draft") {
        setDraft(payload);
        setUploadState("idle");
        return;
      }
      setUploadState("success");
      window.setTimeout(() => {
        onUploadComplete();
      }, 900);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Network error. Is the backend running?"
      );
      setUploadState("error");
    }
  };

  const confirmDraft = async () => {
    if (!draft?.draft_id) return;
    setIsConfirming(true);
    setErrorMessage("");
    try {
      const response = await fetch(
        `/api/backend/playbook/uploads/${encodeURIComponent(draft.draft_id)}/confirm`,
        { method: "POST" }
      );
      if (!response.ok) throw new Error(await response.text());
      setUploadState("success");
      window.setTimeout(() => {
        onUploadComplete();
      }, 900);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setUploadState("error");
    } finally {
      setIsConfirming(false);
    }
  };

  const handleDrag = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "dragenter" || event.type === "dragover") {
      setDragActive(true);
    } else if (event.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    if (event.dataTransfer.files.length > 0) {
      setFiles(event.dataTransfer.files);
    }
  };

  const handleRetry = () => {
    setUploadState("idle");
    setErrorMessage("");
  };

  const title = draft
    ? "Review Playbook Update"
    : uploadMode === "create"
      ? "Create a Playbook"
      : "Update a Playbook";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose?.()}>
      <DialogContent
        className="max-h-[92vh] w-[min(920px,calc(100vw-3rem))] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
        showCloseButton={false}
      >
        {uploadState === "success" ? (
          <div className="flex flex-col items-center px-8 py-12 text-center">
            <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <i className="ri-checkbox-circle-line text-xl" />
            </div>
            <DialogTitle className="text-xl">
              {uploadMode === "update" ? "Playbook Updated" : "Playbook Created"}
            </DialogTitle>
            <DialogDescription className="mt-2">Getting rules ready...</DialogDescription>
          </div>
        ) : (
          <>
            <DialogHeader className="border-b px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <DialogTitle className="text-xl font-semibold tracking-tight">
                    {title}
                  </DialogTitle>
                  <DialogDescription className="mt-2">
                    Upload source files as{" "}
                    {uploaderRole === "lawyer" ? "Legal Counsel" : "Business User"}.
                  </DialogDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-lg"
                  onClick={onClose}
                  aria-label="Close"
                >
                  <i className="ri-close-line text-base" />
                </Button>
              </div>
            </DialogHeader>

            <div className="min-h-0 overflow-y-auto px-6 py-4">
              {!draft && (
                <div className="flex flex-col gap-5">
                  <ToggleGroup
                    type="single"
                    value={uploadMode}
                    onValueChange={(value) => {
                      const mode = value as UploadMode;
                      if (mode) {
                        setUploadMode(mode);
                        setDraft(null);
                        setErrorMessage("");
                        setUploadState("idle");
                      }
                    }}
                    variant="outline"
                    className="grid w-full grid-cols-2 rounded-lg bg-muted p-1"
                  >
                    <ToggleGroupItem
                      value="create"
                      className="h-10 rounded-md data-[state=on]:bg-card data-[state=on]:text-livebook-dark data-[state=on]:shadow-sm"
                    >
                      New playbook
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="update"
                      className="h-10 rounded-md data-[state=on]:bg-card data-[state=on]:text-livebook-dark data-[state=on]:shadow-sm"
                    >
                      Update existing
                    </ToggleGroupItem>
                  </ToggleGroup>

                  {uploadMode === "update" ? (
                    <Field>
                      <FieldLabel>Existing playbook</FieldLabel>
                      <Select value={targetPlaybookId} onValueChange={setTargetPlaybookId}>
                        <SelectTrigger className="h-11 w-full">
                          <SelectValue placeholder="Select playbook" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {playbooks.map((playbook) => (
                              <SelectItem key={playbook.id} value={playbook.id}>
                                {playbook.name} ({playbook.clause_count} clauses)
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  ) : (
                    <FieldGroup className="grid min-w-0 gap-4 md:grid-cols-[minmax(240px,1fr)_minmax(180px,220px)_minmax(220px,260px)]">
                      <Field>
                        <FieldLabel>Playbook name</FieldLabel>
                        <Input
                          value={playbookName}
                          onChange={(event) => setPlaybookName(event.target.value)}
                          placeholder="Livebook NDA Playbook"
                        />
                      </Field>
                      <Field>
                        <FieldLabel>Opposite party</FieldLabel>
                        <Select value={oppositePartyName} onValueChange={setOppositePartyName}>
                          <SelectTrigger className="h-11 w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {OPPOSITE_PARTY_NAMES.map((name) => (
                                <SelectItem key={name} value={name}>
                                  {name}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field>
                        <FieldLabel>Domain</FieldLabel>
                        <Select value={lawType} onValueChange={setLawType}>
                          <SelectTrigger className="h-11 w-full min-w-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {SIEMENS_LAW_TYPES.map((type) => (
                                <SelectItem key={type} value={type}>
                                  {type}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                    </FieldGroup>
                  )}

                  <div
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => inputRef.current?.click()}
                    className={cn(
                      "relative cursor-pointer rounded-lg border border-dashed p-5 text-center transition-colors",
                      dragActive
                        ? "border-livebook bg-livebook-pale/60"
                        : "border-border bg-muted/35 hover:border-livebook hover:bg-livebook-pale/30",
                      uploadState === "uploading" && "pointer-events-none opacity-60"
                    )}
                  >
                    <input
                      ref={inputRef}
                      type="file"
                      accept={ACCEPTED_TYPES}
                      multiple
                      onChange={(event) => {
                        if (event.target.files && event.target.files.length > 0) {
                          setFiles(event.target.files);
                        }
                      }}
                      className="hidden"
                    />

                    {uploadState === "uploading" ? (
                      <div className="flex flex-col items-center">
                        <i className="ri-loader-4-line mb-3 text-2xl animate-spin text-livebook" />
                        <p className="text-sm font-medium text-foreground/80">
                          Uploading and processing...
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground/70">
                          This may take a few moments
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="mb-3 inline-flex size-11 items-center justify-center rounded-lg bg-livebook-pale text-livebook">
                          <i className="ri-upload-cloud-2-line text-lg" />
                        </div>
                        <p className="text-sm font-semibold text-foreground">
                          Drop source files here
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Click to browse.{" "}
                          PDF, DOCX, and XLSX files are supported
                        </p>
                      </>
                    )}
                  </div>

                  {selectedFiles.length > 0 && (
                    <div className="rounded-lg border bg-muted/35 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Selected files
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedFiles.map((file) => (
                          <StatusBadge
                            key={`${file.name}-${file.size}`}
                            tone="neutral"
                          >
                            <i className="ri-file-text-line text-base" data-icon="inline-start" />
                            {file.name}
                          </StatusBadge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {draft && (
                <div className="space-y-4">
                  <Notice tone="warning">
                    Review update for{" "}
                    <span className="font-semibold">
                      {selectedPlaybook?.name ?? draft.target_playbook_id}
                    </span>
                    . Confirm applies {diffCount(draft.diff)} changes and creates next major
                    version.
                  </Notice>
                  <div className="grid gap-3 md:grid-cols-2">
                    <DiffBucket
                      title="Added"
                      icon="ri-add-circle-line"
                      tone="text-emerald-600"
                      items={draft.diff?.added}
                    />
                    <DiffBucket
                      title="Updated"
                      icon="ri-edit-2-line"
                      tone="text-livebook"
                      items={draft.diff?.updated}
                    />
                    <DiffBucket
                      title="Removed"
                      icon="ri-delete-bin-line"
                      tone="text-red-600"
                      items={draft.diff?.removed}
                    />
                    <DiffBucket
                      title="Unchanged"
                      icon="ri-checkbox-circle-line"
                      tone="text-muted-foreground"
                      items={draft.diff?.unchanged}
                    />
                  </div>
                </div>
              )}

              {uploadState === "error" && (
                <Notice tone="danger" title="Upload failed" className="mt-4">
                  <p>{errorMessage}</p>
                  <Button
                    type="button"
                    variant="link"
                    onClick={handleRetry}
                    className="mt-1 h-auto p-0 text-destructive"
                  >
                    Try again
                  </Button>
                </Notice>
              )}
            </div>

            <DialogFooter className="mx-0 mb-0 mt-0 flex-row justify-end rounded-none border-t bg-card px-6 py-3">
              {draft && (
                <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                  Back
                </Button>
              )}
              <Button
                type="button"
                onClick={draft ? () => void confirmDraft() : () => void uploadFiles()}
                disabled={uploadState === "uploading" || isConfirming}
              >
                {(uploadState === "uploading" || isConfirming) && (
                  <i className="ri-loader-4-line text-base animate-spin" data-icon="inline-start" />
                )}
                {draft
                  ? isConfirming
                    ? "Applying..."
                    : "Confirm update"
                  : uploadMode === "update"
                    ? "Review update"
                    : "Create playbook"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

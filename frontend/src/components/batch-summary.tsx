"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  FolderOpen,
  Loader2,
  Play,
  Plus,
  RotateCcw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ReferenceList } from "./reference-list";
import { WorkspaceDock } from "./workspace-dock";
import {
  BatchFileResult,
  BatchSummary as BatchSummaryType,
  DiscoveryResult,
  Reference,
  WorkspaceAddResult,
  WorkspaceStats,
} from "@/lib/types";

interface BatchSummaryProps {
  summary: BatchSummaryType;
  fileResults: BatchFileResult[];
  cancelled: boolean;
  onUploadMore: () => void;
  onResume: () => void;
  onRetryFile: (paperId: string) => void;
  workspaceStats: WorkspaceStats;
  onAddToWorkspaceForFile: (
    paperId: string,
    paperLabel: string,
    references: Reference[]
  ) => WorkspaceAddResult;
  onBatchAddAllMatched: () => void;
  getCachedDiscovery: (reference: Reference) => DiscoveryResult | null;
  onCheckAvailability: (reference: Reference) => Promise<DiscoveryResult>;
  onAppendFiles: (files: File[]) => void;
}

export function BatchSummary({
  summary,
  fileResults,
  cancelled,
  onUploadMore,
  onResume,
  onRetryFile,
  workspaceStats,
  onAddToWorkspaceForFile,
  onBatchAddAllMatched,
  getCachedDiscovery,
  onCheckAvailability,
  onAppendFiles,
}: BatchSummaryProps) {
  const router = useRouter();
  const appendInputRef = useRef<HTMLInputElement>(null);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  // Auto-expand when there's exactly 1 file and it's done
  useEffect(() => {
    const doneFiles = fileResults.filter((fr) => fr.status === "done");
    if (doneFiles.length === 1 && fileResults.length === 1) {
      setExpandedFile(doneFiles[0].paperId);
    }
  }, [fileResults]);

  // Derive "added" state from actual workspace results (single source of truth)
  const addedFileIds = useMemo(
    () => new Set(fileResults.filter((fr) => fr.workspaceResult !== null).map((fr) => fr.paperId)),
    [fileResults]
  );
  const allDoneAdded = useMemo(() => {
    const doneFiles = fileResults.filter((fr) => fr.status === "done" && fr.data);
    return doneFiles.length > 0 && doneFiles.every((fr) => fr.workspaceResult !== null);
  }, [fileResults]);

  const isRetrying = useMemo(
    () => fileResults.some((fr) => fr.status === "processing"),
    [fileResults]
  );
  const pendingOrErrorCount = useMemo(
    () => fileResults.filter((fr) => fr.status === "pending" || fr.status === "error").length,
    [fileResults]
  );

  const hasAnyAdded = addedFileIds.size > 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">
          {cancelled
            ? "Batch cancelled"
            : fileResults.length === 1
            ? "Extraction complete"
            : "Batch complete"}
        </h2>
        {fileResults.length > 1 && (
          <p className="text-sm text-muted-foreground mt-0.5">
            {summary.processedPapers} of {summary.totalPapers} papers processed
            {summary.failedPapers > 0 && `, ${summary.failedPapers} failed`}
          </p>
        )}
      </div>

      {/* Stats grid — only show for multi-file batches */}
      {fileResults.length > 1 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Papers" value={summary.processedPapers} />
          <StatCard label="Total refs" value={summary.totalRefs} />
          <StatCard label="Matched" value={summary.matchedRefs} />
          <StatCard
            label="Added to workspace"
            value={summary.addedToWorkspace}
          />
        </div>
      )}
      {fileResults.length > 1 &&
        (summary.mergedInWorkspace > 0 ||
          summary.conflictsInWorkspace > 0) && (
          <p className="text-xs text-muted-foreground">
            {summary.mergedInWorkspace > 0 &&
              `${summary.mergedInWorkspace} merged (duplicates)`}
            {summary.mergedInWorkspace > 0 &&
              summary.conflictsInWorkspace > 0 &&
              " · "}
            {summary.conflictsInWorkspace > 0 &&
              `${summary.conflictsInWorkspace} conflicts to review`}
          </p>
        )}

      {/* Batch-level actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {pendingOrErrorCount > 0 && (
          <Button
            size="sm"
            onClick={onResume}
            disabled={isRetrying}
            className="gap-1.5 min-h-11"
          >
            {isRetrying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Resume Remaining ({pendingOrErrorCount} {pendingOrErrorCount === 1 ? "file" : "files"})
          </Button>
        )}
        <Button
          size="sm"
          onClick={onBatchAddAllMatched}
          disabled={allDoneAdded || isRetrying}
          className="gap-1.5 min-h-11"
        >
          <Plus className="h-4 w-4" />
          Add All Matched + Fuzzy to Workspace
        </Button>
        {hasAnyAdded && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/workspace")}
            className="gap-1.5 min-h-11"
          >
            <FolderOpen className="h-4 w-4" />
            Go to Workspace
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => appendInputRef.current?.click()}
          disabled={isRetrying}
          className="gap-1.5 min-h-11"
        >
          <Plus className="h-4 w-4" />
          Add more PDFs
        </Button>
        <input
          ref={appendInputRef}
          type="file"
          accept=".pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []).filter(
              (f) => f.name.toLowerCase().endsWith(".pdf")
            );
            if (files.length > 0) onAppendFiles(files);
            e.target.value = "";
          }}
        />
        <Button variant="outline" size="sm" onClick={onUploadMore} className="min-h-11">
          Start Over
        </Button>
      </div>

      {fileResults.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Click a file below to review its references, select entries, and add
          them to workspace individually.
        </p>
      )}

      {/* Per-file expandable rows */}
      <div className="space-y-2">
        {fileResults.map((result) => {
          const canExpand = result.status === "done" || result.status === "error";
          const isExpanded = expandedFile === result.paperId && canExpand;

          return (
            <Collapsible
              key={result.paperId}
              open={isExpanded}
              onOpenChange={(open) =>
                canExpand && setExpandedFile(open ? result.paperId : null)
              }
            >
              <div className="rounded-lg border">
                {/* File row header */}
                <CollapsibleTrigger asChild disabled={!canExpand}>
                  <button
                    type="button"
                    className={`flex items-center gap-3 w-full px-3 py-2.5 text-sm text-left transition-colors ${
                      canExpand
                        ? "hover:bg-muted/50 cursor-pointer"
                        : "cursor-default opacity-70"
                    }`}
                  >
                    <StatusIcon status={result.status} />
                    <span className="truncate flex-1 font-medium">
                      {result.file.name}
                    </span>
                    {result.status === "done" && result.data && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {result.data.total_count} refs (
                        {result.data.matched_count + result.data.fuzzy_count}{" "}
                        matched)
                      </span>
                    )}
                    {result.status === "error" && !isExpanded && (
                      <span className="text-xs text-destructive shrink-0 max-w-[200px] truncate">
                        {result.error}
                      </span>
                    )}
                    {addedFileIds.has(result.paperId) && (
                      <Badge
                        variant="outline"
                        className="text-[10px] h-4 border-green-400 text-green-600 dark:text-green-400 shrink-0"
                      >
                        added
                      </Badge>
                    )}
                    {canExpand &&
                      (isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      ))}
                  </button>
                </CollapsibleTrigger>

                <CollapsibleContent className="overflow-hidden">
                  {/* Full reference list */}
                  {result.status === "done" &&
                    result.data &&
                    result.data.total_count > 0 && (
                      <div className="border-t px-3 py-3">
                        <ReferenceList
                          data={result.data}
                          compact
                          workspaceStats={workspaceStats}
                          onAddToWorkspace={(selectedRefs) =>
                            onAddToWorkspaceForFile(
                              result.paperId,
                              result.file.name,
                              selectedRefs
                            )
                          }
                          getCachedDiscovery={getCachedDiscovery}
                          onCheckAvailability={onCheckAvailability}
                        />
                      </div>
                    )}

                  {/* 0 references */}
                  {result.status === "done" &&
                    result.data &&
                    result.data.total_count === 0 && (
                      <div className="border-t px-3 py-3">
                        <p className="text-sm text-muted-foreground text-center py-4">
                          No references found in this PDF.
                        </p>
                      </div>
                    )}

                  {/* Error + retry */}
                  {result.status === "error" && (
                    <div className="border-t px-3 py-3 space-y-2">
                      <p className="text-sm text-destructive">{result.error}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onRetryFile(result.paperId)}
                        disabled={isRetrying}
                        className="gap-1.5"
                      >
                        {isRetrying ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                        Retry
                      </Button>
                    </div>
                  )}
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}
      </div>

      {workspaceStats.refs > 0 && <WorkspaceDock stats={workspaceStats} />}
    </div>
  );
}

function StatusIcon({ status }: { status: BatchFileResult["status"] }) {
  switch (status) {
    case "pending":
      return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
    case "processing":
      return <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />;
    case "done":
      return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />;
    case "error":
      return <AlertCircle className="h-4 w-4 text-destructive shrink-0" />;
    default:
      return <FileText className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

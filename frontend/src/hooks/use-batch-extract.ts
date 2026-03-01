"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { extractReferences } from "@/lib/api-client";
import { buildPaperId } from "@/lib/text-utils";
import {
  BatchFileResult,
  BatchStage,
  BatchSummary,
  ExtractResponse,
  WorkspaceAddResult,
} from "@/lib/types";

export function useBatchExtract() {
  const [batchStage, setBatchStage] = useState<BatchStage>("idle");
  const [fileResults, setFileResults] = useState<BatchFileResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  // Ref to avoid stale closures in resumeBatch/retryFile
  const fileResultsRef = useRef<BatchFileResult[]>([]);
  fileResultsRef.current = fileResults;

  // startBatch iterates over the closed-over `files` param, so files appended
  // mid-processing are not picked up here. They remain "pending" and are
  // processed by a subsequent resumeBatch call (via "Resume Remaining").
  const startBatch = useCallback(
    async (
      files: File[],
      grobidInstanceId: string | undefined,
    ) => {
      cancelledRef.current = false;
      const controller = new AbortController();
      abortRef.current = controller;

      const results: BatchFileResult[] = files.map((file) => ({
        file,
        paperId: buildPaperId(file),
        status: "pending" as const,
        data: null,
        error: null,
        workspaceResult: null,
      }));
      setFileResults([...results]);
      setBatchStage("processing");
      setCurrentIndex(0);

      for (let i = 0; i < files.length; i++) {
        if (cancelledRef.current || controller.signal.aborted) {
          setBatchStage("cancelled");
          return;
        }

        setCurrentIndex(i);
        results[i] = { ...results[i], status: "processing" };
        setFileResults([...results]);

        try {
          const data: ExtractResponse = await extractReferences(files[i], {
            signal: controller.signal,
            grobidInstanceId,
          });

          results[i] = {
            ...results[i],
            status: "done",
            data,
          };
        } catch (err) {
          if (controller.signal.aborted) {
            results[i] = { ...results[i], status: "pending", error: null };
            setFileResults([...results]);
            return;
          }
          results[i] = {
            ...results[i],
            status: "error",
            error:
              err instanceof Error ? err.message : "Extraction failed",
          };
        }

        setFileResults([...results]);
      }

      setBatchStage("done");
    },
    []
  );

  const cancelBatch = useCallback(() => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    setBatchStage("cancelled");
  }, []);

  const resetBatch = useCallback(() => {
    cancelledRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    setFileResults([]);
    setBatchStage("idle");
    setCurrentIndex(0);
  }, []);

  const resumeBatch = useCallback(
    async (grobidInstanceId: string | undefined) => {
      cancelledRef.current = false;
      const controller = new AbortController();
      abortRef.current = controller;
      setBatchStage("processing");

      const results = [...fileResultsRef.current];

      for (let i = 0; i < results.length; i++) {
        if (cancelledRef.current || controller.signal.aborted) {
          setBatchStage("cancelled");
          return;
        }

        // Skip already-done files
        if (results[i].status === "done") continue;

        setCurrentIndex(i);
        results[i] = { ...results[i], status: "processing", error: null };
        setFileResults([...results]);

        try {
          const data: ExtractResponse = await extractReferences(
            results[i].file,
            { signal: controller.signal, grobidInstanceId }
          );
          results[i] = { ...results[i], status: "done", data };
        } catch (err) {
          if (controller.signal.aborted) {
            results[i] = { ...results[i], status: "pending", error: null };
            setFileResults([...results]);
            return;
          }
          results[i] = {
            ...results[i],
            status: "error",
            error: err instanceof Error ? err.message : "Extraction failed",
          };
        }

        setFileResults([...results]);
      }

      setBatchStage("done");
    },
    []
  );

  const retryFile = useCallback(
    async (paperId: string, grobidInstanceId: string | undefined) => {
      const results = [...fileResultsRef.current];
      const idx = results.findIndex((fr) => fr.paperId === paperId);
      if (idx === -1) return;

      const controller = new AbortController();
      abortRef.current = controller;

      results[idx] = { ...results[idx], status: "processing", error: null };
      setFileResults([...results]);

      try {
        const data: ExtractResponse = await extractReferences(
          results[idx].file,
          { signal: controller.signal, grobidInstanceId }
        );
        results[idx] = { ...results[idx], status: "done", data };
      } catch (err) {
        if (controller.signal.aborted) {
          results[idx] = { ...results[idx], status: "error", error: "Cancelled" };
          setFileResults([...results]);
          return;
        }
        results[idx] = {
          ...results[idx],
          status: "error",
          error: err instanceof Error ? err.message : "Extraction failed",
        };
      }

      setFileResults([...results]);
    },
    []
  );

  const appendFiles = useCallback((files: File[]) => {
    const newEntries: BatchFileResult[] = files.map((file) => ({
      file,
      paperId: buildPaperId(file),
      status: "pending" as const,
      data: null,
      error: null,
      workspaceResult: null,
    }));
    setFileResults((prev) => {
      const next = [...prev, ...newEntries];
      fileResultsRef.current = next; // Eagerly sync so resumeBatch sees appended files
      return next;
    });
  }, []);

  const updateFileWorkspaceResult = useCallback(
    (paperId: string, result: WorkspaceAddResult) => {
      setFileResults((prev) =>
        prev.map((fr) =>
          fr.paperId === paperId ? { ...fr, workspaceResult: result } : fr
        )
      );
    },
    []
  );

  const summary: BatchSummary = useMemo(() => {
    let totalRefs = 0;
    let matchedRefs = 0;
    let addedToWorkspace = 0;
    let mergedInWorkspace = 0;
    let conflictsInWorkspace = 0;
    let processedPapers = 0;
    let failedPapers = 0;

    for (const result of fileResults) {
      if (result.status === "done" && result.data) {
        processedPapers += 1;
        totalRefs += result.data.total_count;
        matchedRefs += result.data.matched_count + result.data.fuzzy_count;
      } else if (result.status === "error") {
        failedPapers += 1;
      }
      if (result.workspaceResult) {
        addedToWorkspace += result.workspaceResult.added;
        mergedInWorkspace += result.workspaceResult.merged;
        conflictsInWorkspace += result.workspaceResult.conflicts;
      }
    }

    return {
      totalPapers: fileResults.length,
      processedPapers,
      failedPapers,
      totalRefs,
      matchedRefs,
      addedToWorkspace,
      mergedInWorkspace,
      conflictsInWorkspace,
    };
  }, [fileResults]);

  return {
    batchStage,
    fileResults,
    currentIndex,
    summary,
    startBatch,
    cancelBatch,
    resetBatch,
    resumeBatch,
    retryFile,
    appendFiles,
    updateFileWorkspaceResult,
  };
}

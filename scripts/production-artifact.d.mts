export type ProductionReceipt = {
  version: 1;
  commit: string;
  fileHashes: Record<string, string>;
};

export function createProductionReceipt(directory: string, commit: string, metadata?: Record<string, unknown>): Promise<ProductionReceipt>;
export function verifyProductionArtifact(directory: string, receipt: unknown, expectedCommit: string): Promise<{ fileCount: number; commit: string }>;

/**
 * CS-08 — Catalog sync shared contracts (Studio ↔ website).
 * Studio side: D:\Hyper_Catalog_Studio\scripts\cs08-manifest-gen.mts emits
 * frozen manifests; website side: /sync page + /api/catalog-sync/*.
 */

export type SyncTargetEnvironment = "DISPOSABLE" | "PRIMARY";

export interface SyncManifestOperation {
  type:
    | "SET_PRODUCT_FIELD"
    | "SET_VARIANT_FIELD"
    | "CREATE_PRODUCT"
    | "CREATE_CATEGORY"
    | "CREATE_BRAND";
  entityType: "product" | "product_variant" | "category" | "brand";
  entityId: string;
  field?: string;
  base: unknown;
  proposed: unknown;
  productId?: string;
  payload?: Record<string, unknown>;
  variantId?: string | null;
  price?: string | null;
  source?: { v0?: boolean; origin?: string; explicitClear?: boolean; provenance?: string; approvalEligible?: boolean; journalSession?: string | null } | null;
}

export interface SyncManifest {
  manifestId: string;
  digest: string;
  studio: { source: string; sourceId: string; revision: number; generatedAt: string };
  sourceBaseline: { id: string; type: string };
  operations: SyncManifestOperation[];
  counts: { products: number; variants: number; categories: number; brands: number };
  validation: Record<string, unknown>;
  mode: string;
}

export type RowStatus =
  | "UNCHANGED"
  | "SAFE_TO_APPLY"
  | "ALREADY_APPLIED"
  | "CONFLICTED"
  | "SOURCE_NOT_FOUND"
  | "TARGET_REFERENCE_MISSING"
  | "INVALID_OPERATION"
  | "UNSUPPORTED_MAPPING"
  | "DEPENDENCY_BLOCKED";

export interface PreviewRow {
  op: SyncManifestOperation;
  status: RowStatus;
  current: unknown;
  proposed: unknown;
  base: unknown;
  productId?: string;
  message: string | null;
  dependencyOrder?: number;
}

export interface PreviewCounts {
  unchanged: number;
  safeToApply: number;
  alreadyApplied: number;
  conflicted: number;
  sourceNotFound: number;
  targetReferenceMissing: number;
  invalid: number;
  dependencyBlocked: number;
}

export interface SyncPreview {
  previewId: string;
  manifestId: string;
  digest: string;
  studioSourceId: string;
  target: { database: string; systemIdentifier: string; environment: SyncTargetEnvironment; host: string; port: number };
  generatedAt: string;
  rows: PreviewRow[];
  counts: PreviewCounts;
  affectedProducts: number;
  affectedVariants: number;
  affectedCategories: number;
  affectedBrands: number;
  priceChanges: number;
  lifecycleChanges: number;
}

export type ApplyStatus =
  | "APPLYING"
  | "APPLIED_VERIFIED"
  | "ALREADY_APPLIED"
  | "BLOCKED"
  | "FAILED_ROLLED_BACK"
  | "RECONCILIATION_REQUIRED";

export interface SyncApplyReceipt {
  syncJobId: string;
  manifestId: string;
  digest: string;
  target: { database: string; systemIdentifier: string; environment: SyncTargetEnvironment };
  actor: { id: string; userId: string; permission: string };
  approval: { manifestDigest: string; approvedBy: string; approvedAt: string; tool: string } | null;
  startAt: string;
  completedAt: string;
  operationCount: number;
  appliedCount: number;
  alreadyAppliedCount: number;
  conflictedCount: number;
  failedCount: number;
  auditEventCount: number;
  resultDigest: string;
  status: ApplyStatus;
  note?: string | null;
}

export interface SyncResult {
  ok: boolean;
  status?: ApplyStatus;
  receipt?: SyncApplyReceipt;
  preview?: SyncPreview;
  manifest?: SyncManifest;
  error?: string;
  errorCode?: string;
  errorHttp?: number;
}

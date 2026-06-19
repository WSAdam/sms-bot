// MIGRATION SHIM → moved to src/core/business/id during the shape-checker
// migration. Kept so existing @shared/util/id.ts importers keep working
// untouched. (This file lives in the untracked shared/ tree, so the re-export
// isn't shape-checked.) Remove once all importers use @core/.
export * from "@core/business/id/mod.ts";

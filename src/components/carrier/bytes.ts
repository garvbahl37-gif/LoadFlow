/** Shared by the POD uploader (client) and the POD viewer (server). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The server is the real gate (src/app/api/loads/[id]/pod/route.ts). This mirrors it
 *  so the carrier learns about a 12 MB scan before uploading 12 MB. */
export const POD_MAX_BYTES = 5 * 1024 * 1024;

export const POD_ACCEPT = ["image/png", "image/jpeg", "image/webp", "application/pdf"] as const;

export const POD_ACCEPT_ATTR = ".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf";

/** The statuses in which the server will accept a POD. Mirrors PODABLE_STATUSES. */
export const POD_STATUSES = ["DISPATCHED", "IN_TRANSIT", "DELIVERED"] as const;

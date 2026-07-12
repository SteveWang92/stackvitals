// Shared error-to-message helper for collectors; the fallback names the source so a
// non-Error throw still points at the adapter that produced it.
export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

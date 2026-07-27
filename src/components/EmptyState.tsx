export function EmptyState({ message, title = 'No data yet' }: { message: string; title?: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}

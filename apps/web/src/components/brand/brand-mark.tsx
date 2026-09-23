/** A folded page forms a P; no external assets, scripts or icon-font dependency. */
export function BrandMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 32 32" className={className} fill="none">
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <path d="M10 25V7h8a7 7 0 0 1 0 14h-4v4h-4Zm4-8h4a3 3 0 0 0 0-6h-4v6Z" fill="#f7f6f2" />
      <path d="m14 11 7-4h-7v4Z" fill="#b9ceb1" />
    </svg>
  );
}

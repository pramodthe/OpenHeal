/**
 * The mark is the run tape in miniature: a recorder spine with phase blocks
 * of differing length hanging off it, the active phase marked in the signal
 * colour. Same idea as the console's left rail, at 20px.
 */
export function HealMark({
  className = 'h-5 w-5',
  accent = 'rgb(var(--signal))',
}: {
  className?: string;
  accent?: string;
}) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="2.5" height="20" rx="1.25" fill="currentColor" />
      <rect x="8" y="3" width="9" height="3" rx="1.5" fill="currentColor" opacity="0.45" />
      <rect x="8" y="8.5" width="14" height="3" rx="1.5" fill="currentColor" opacity="0.45" />
      <rect x="8" y="14" width="11" height="3" rx="1.5" fill={accent} />
      <rect x="8" y="19.5" width="6" height="2.5" rx="1.25" fill="currentColor" opacity="0.2" />
    </svg>
  );
}

export default HealMark;

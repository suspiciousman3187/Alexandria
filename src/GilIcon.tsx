export function GilIcon({ size = 18, className = '' }: { size?: number; className?: string }) {
  return <img src="/gil.png" width={size} height={size} alt="" draggable={false} className={`shrink-0 select-none ${className}`} />;
}

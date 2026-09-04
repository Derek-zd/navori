export default function Status({ value }: { value: string }) {
  const color =
    value === 'success' || value === 'done'
      ? 'text-green-600'
      : value === 'failed' || value === 'error' || value === 'rejected'
        ? 'text-red-600'
        : value === 'running' || value === 'scanning' || value === 'awaiting_approval'
          ? 'text-blue-600'
          : 'text-slate-500'
  return <span className={color}>{value}</span>
}

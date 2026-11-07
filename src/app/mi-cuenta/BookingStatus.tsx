const BOOKING_STATUS: Record<string, { label: string; className: string }> = {
  confirmed: { label: 'Confirmada', className: 'bg-brand-blue-light text-brand-blue-dark' },
  pending: { label: 'Pendiente', className: 'bg-amber-50 text-amber-700' },
  completed: { label: 'Realizada', className: 'bg-slate-100 text-slate-600' },
  cancelled: { label: 'Cancelada', className: 'bg-slate-100 text-slate-500' },
  no_show: { label: 'No realizada', className: 'bg-slate-100 text-slate-500' },
}

export default function BookingStatus({ status }: { status: string | null }) {
  const s = BOOKING_STATUS[String(status)] || {
    label: String(status || 'Sin estado'),
    className: 'bg-slate-100 text-slate-500',
  }
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${s.className}`}>{s.label}</span>
}

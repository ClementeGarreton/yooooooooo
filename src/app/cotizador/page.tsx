import CotizadorClient from './CotizadorClient'

export default function CotizadorPage({ searchParams }: { searchParams: { start?: string; codigo?: string } }) {
  return <CotizadorClient startOnline={searchParams.start === 'online'} codigo={String(searchParams.codigo || '')} />
}

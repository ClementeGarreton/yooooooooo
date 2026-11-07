import { notFound } from 'next/navigation'
import {
  getCompanyBookingDetail,
  getCustomerCompany,
  getOwnedBookingDetail,
  getOwnedBookingForReschedule,
} from '@/lib/customerAccount'
import { rescheduleBlock } from '@/lib/customerReschedule'
import { getDocumentScope, listCustomerDocuments } from '@/lib/customerDocuments'
import { getBookingHistory } from '@/lib/customerBookingHistory'
import { getCustomerAssignment } from '@/lib/customerAssignment'
import { requireCustomerId } from '../../../session'
import BookingDetailView from './BookingDetailView'
import { serviceWords } from '../../../serviceWords'

export const dynamic = 'force-dynamic'

/**
 * Detalle de una reserva. Una reserva ajena responde 404, igual que una inexistente.
 * Las reservas de la empresa: el encargado las abre con sus acciones (pagar, cambiar la
 * fecha), igual que las propias; un miembro las abre en solo lectura.
 */
export default async function ReservaPage({ params }: { params: { id: string } }) {
  const customerId = await requireCustomerId()

  const [booking, forReschedule, scope, company] = await Promise.all([
    getOwnedBookingDetail(customerId, params.id),
    getOwnedBookingForReschedule(customerId, params.id),
    getDocumentScope(customerId),
    getCustomerCompany(customerId),
  ])
  const noun = serviceWords(Boolean(company)).one

  if (booking && forReschedule) {
    const [documents, history, assignment] = await Promise.all([
      listCustomerDocuments(scope, { bookingId: booking.id }),
      getBookingHistory(booking.id),
      getCustomerAssignment(booking.id, booking.vehicleId),
    ])
    return (
      <BookingDetailView
        booking={booking}
        rescheduleReason={rescheduleBlock(forReschedule)}
        documents={documents}
        history={history}
        assignment={assignment}
        companyView={booking.own ? undefined : { clientName: booking.ownerName, canEdit: true }}
        noun={noun}
      />
    )
  }

  const companyBooking = await getCompanyBookingDetail(customerId, params.id)
  if (!companyBooking) notFound()
  const [documents, history, assignment] = await Promise.all([
    listCustomerDocuments(scope, { bookingId: companyBooking.id }),
    getBookingHistory(companyBooking.id),
    getCustomerAssignment(companyBooking.id, companyBooking.vehicleId),
  ])
  return (
    <BookingDetailView
      booking={companyBooking}
      rescheduleReason={null}
      documents={documents}
      assignment={assignment}
      companyView={{ clientName: companyBooking.clientName, canEdit: false }}
      noun={noun}
      history={history}
    />
  )
}

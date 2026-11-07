// jsPDF pesa cientos de kB parseado: si se importa arriba, viaja en el First Load de
// cualquier página que importe este módulo (p. ej. /pago/exito lo carga sola al abrir).
// Se carga bajo demanda con `await import('jspdf')` en las funciones que arman el PDF.
import type jsPDF from 'jspdf'
import { useQuoteStore } from '@/store/quoteStore'
import { formatDate, formatTime, formatCurrency, formatDistanceKm, formatParkingDistance } from './utils'
import { applyPdfTextSanitizer } from './pdfText'
import { depositAmount } from './revenueBreakdown'
import { packagingLabel } from './packagingCatalog'
import { getPricingConfig } from './pricingService'
import { formatStopAddress, normalizeStops } from './stops'

/**
 * Paradas intermedias, entre origen y destino (el orden del recorrido). Los tres PDF del
 * cliente las omitían: quien cotizaba con una parada no la veía en su cotización ni en su
 * comprobante. Devuelve la nueva posición vertical.
 */
function drawStops(pdf: jsPDF, rawStops: unknown, y: number, lineHeight: number): number {
  const width = pdf.internal.pageSize.getWidth() - 40
  normalizeStops(rawStops).forEach((parada, i) => {
    pdf.splitTextToSize(`Parada ${i + 1}: ${formatStopAddress(parada)}`, width).forEach((linea: string) => {
      pdf.text(linea, 20, y)
      y += lineHeight
    })
    if (parada.note) {
      pdf.splitTextToSize(`  ${parada.note}`, width).forEach((linea: string) => {
        pdf.text(linea, 20, y)
        y += lineHeight
      })
    }
  })
  return y
}

type QuotePdfOptions = {
  /** Si es false, solo se genera el blob (p. ej. subida silenciosa al llegar al resumen). Por defecto true. */
  download?: boolean
  /**
   * Precio a imprimir en lugar del calculado. Lo usa el cotizador interno del panel
   * cuando la secretaria acordó otro valor con el cliente: el PDF que recibe tiene que
   * decir ESE precio, no el del cálculo. El resto del documento es el mismo.
   */
  priceOverride?: number
}

export const generateQuotePDF = async (options?: QuotePdfOptions) => {
  const shouldDownload = options?.download !== false

  // Verificar que estamos en el cliente
  if (typeof window === 'undefined') {
    console.error('generateQuotePDF debe ejecutarse solo en el cliente')
    return
  }

  const {
    personalInfo,
    dateTime,
    isFlexible,
    origin,
    destination,
    stops,
    items,
    additionalServices,
    totalVolume,
    totalWeight,
    totalDistance,
    estimatedPrice,
    recommendedVehicle,
    requiredCrew,
    totalCrew,
  } = useQuoteStore.getState()

  // Los precios de desarme y armado salen de la configuración vigente. Antes estaban
  // escritos a mano ($15.000) y el PDF mostraba otro valor que el que se cobra: medido el
  // 16-sep-2026, en producción esos servicios valían $20.000. `getPricingConfig` cachea
  // cinco minutos, así que no suma una consulta por PDF.
  const precioServicios = (await getPricingConfig()).additionalServices
  const precioDocumento =
    typeof options?.priceOverride === 'number' && options.priceOverride > 0
      ? Math.round(options.priceOverride)
      : estimatedPrice

  // Crear nuevo documento PDF. La librería entra bajo demanda (ver import del encabezado).
  const { default: JsPDF } = await import('jspdf')
  const pdf = new JsPDF('p', 'mm', 'a4')
  // Deja el documento a salvo de emojis y guiones largos: la fuente del PDF no los
  // dibuja y saldrían como basura. Se aplica una sola vez, sobre todo lo que se escriba.
  applyPdfTextSanitizer(pdf as any)
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  
  // Colores corporativos
  const primaryColor: [number, number, number] = [111, 168, 220] // #6FA8DC - Azul Cielo
  const secondaryColor: [number, number, number] = [140, 198, 63] // #8CC63F - Verde Lima
  const textColor: [number, number, number] = [0, 0, 0] // #000000 - Negro (Texto principal)
  const lightGray: [number, number, number] = [225, 240, 250] // #E1F0FA - Azul Muy Claro

  let yPosition = 20

  // Header
  pdf.setFillColor(...primaryColor)
  pdf.rect(0, 0, pageWidth, 40, 'F')
  
  pdf.setTextColor(255, 255, 255)
  pdf.setFontSize(24)
  pdf.setFont('helvetica', 'bold')
  pdf.text('COTIZACIÓN DE MUDANZA', pageWidth / 2, 15, { align: 'center' })
  
  pdf.setFontSize(12)
  pdf.setFont('helvetica', 'normal')
  pdf.text('Yo Me Encargo - Servicios de Mudanza', pageWidth / 2, 25, { align: 'center' })
  
  pdf.text(`Fecha: ${new Date().toLocaleDateString('es-CL')}`, pageWidth / 2, 32, { align: 'center' })

  yPosition = 50

  // Informacion del Cliente
  pdf.setTextColor(...textColor)
  pdf.setFontSize(16)
  pdf.setFont('helvetica', 'bold')
  pdf.text('INFORMACIÓN DEL CLIENTE', 20, yPosition)
  
  yPosition += 10
  pdf.setFontSize(12)
  pdf.setFont('helvetica', 'normal')
  
  if (personalInfo) {
    pdf.text(`Nombre: ${personalInfo.name}`, 20, yPosition)
    yPosition += 7
    pdf.text(`Email: ${personalInfo.email}`, 20, yPosition)
    yPosition += 7
    pdf.text(`Teléfono: ${personalInfo.phone}`, 20, yPosition)
    yPosition += 7
    
    if (personalInfo.isCompany && personalInfo.companyName) {
      yPosition += 5
      // Cuadro de facturación con advertencia
      pdf.setFillColor(219, 234, 254) // bg-blue-100
      pdf.setDrawColor(220, 38, 38) // border-red-600
      pdf.setLineWidth(1.5)
      pdf.rect(20, yPosition - 3, pageWidth - 40, 35, 'FD')
      
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(...primaryColor)
      pdf.setFontSize(12)
      pdf.text('CON FACTURA', 25, yPosition + 3)
      
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(...textColor)
      yPosition += 8
      pdf.text(`Razón Social: ${personalInfo.companyName}`, 25, yPosition)
      yPosition += 6
      pdf.text(`RUT: ${personalInfo.companyRut || 'No especificado'}`, 25, yPosition)
      yPosition += 8
      
      // Advertencia dentro del mismo cuadro
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(220, 38, 38) // red-600
      pdf.setFontSize(10)
      pdf.text('ESTE DOCUMENTO NO ES VÁLIDO COMO FACTURA', pageWidth / 2, yPosition, { align: 'center' })
      
      pdf.setTextColor(...textColor)
      pdf.setFontSize(12)
      yPosition += 10
    }
  }

  yPosition += 5

  // Detalles de la Mudanza
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  pdf.text('DETALLES DE LA MUDANZA', 20, yPosition)
  
  yPosition += 10
  pdf.setFontSize(12)
  pdf.setFont('helvetica', 'normal')
  
  if (dateTime) {
    pdf.text(`Fecha: ${formatDate(new Date(dateTime))}`, 20, yPosition)
    yPosition += 7
    pdf.text(`Hora: ${formatTime(new Date(dateTime))}`, 20, yPosition)
    yPosition += 7
    
    if (isFlexible) {
      pdf.setTextColor(...secondaryColor)
      pdf.text('[OK] Con descuento por flexibilidad (10%)', 20, yPosition)
      pdf.setTextColor(...textColor)
      yPosition += 7
    }
  }

  yPosition += 10

  // Direcciones
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.text('DIRECCIONES', 20, yPosition)
  
  yPosition += 8
  pdf.setFontSize(12)
  pdf.setFont('helvetica', 'normal')
  
  if (origin.address) {
    pdf.text(`Origen: ${origin.address.street} ${origin.address.number}, ${origin.address.commune}`, 20, yPosition)
    yPosition += 7
    if (origin.details) {
      pdf.text(`${origin.details.propertyType ? `Tipo: ${origin.details.propertyType} - ` : ''}Piso ${origin.details.floor}${origin.details.hasElevator ? ' (con ascensor)' : ' (sin ascensor)'}`, 20, yPosition)
      yPosition += 7
      const originParking = formatParkingDistance(origin.details.parkingDistance)
      if (originParking) {
        pdf.text(`Acarreo estacionamiento a puerta: ${originParking}`, 20, yPosition)
        yPosition += 7
      }
    }
  }

  yPosition = drawStops(pdf, stops, yPosition, 7)

  if (destination.address) {
    pdf.text(`Destino: ${destination.address.street} ${destination.address.number}, ${destination.address.commune}`, 20, yPosition)
    yPosition += 7
    if (destination.details) {
      pdf.text(`${destination.details.propertyType ? `Tipo: ${destination.details.propertyType} - ` : ''}Piso ${destination.details.floor}${destination.details.hasElevator ? ' (con ascensor)' : ' (sin ascensor)'}`, 20, yPosition)
      yPosition += 7
      const destinationParking = formatParkingDistance(destination.details.parkingDistance)
      if (destinationParking) {
        pdf.text(`Acarreo estacionamiento a puerta: ${destinationParking}`, 20, yPosition)
        yPosition += 7
      }
    }
  }

  // Distancia puerta a puerta (misma etiqueta que en los demás PDF)
  if (totalDistance > 0) {
    pdf.text(`Distancia puerta a puerta: ${formatDistanceKm(totalDistance)}`, 20, yPosition)
    yPosition += 7
  }

  yPosition += 10

  // Verificar si necesitamos una nueva página
  if (yPosition > 150) {
    pdf.addPage()
    yPosition = 20
  }

  // Items a Transportar
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  pdf.text('ITEMS A TRANSPORTAR', 20, yPosition)
  
  yPosition += 10
  pdf.setFontSize(12)
  pdf.setFont('helvetica', 'normal')
  
  // Tabla de items
  const tableTop = yPosition
  const itemHeight = 6
  const col1 = 20
  const col2 = 120
  const col3 = 160
  
  // Headers de la tabla
  pdf.setFont('helvetica', 'bold')
  pdf.text('Item', col1, yPosition)
  pdf.text('Cantidad', col2, yPosition)
  pdf.text('Volumen', col3, yPosition)
  yPosition += itemHeight
  
  // Línea separadora
  pdf.setDrawColor(200, 200, 200)
  pdf.line(col1, yPosition - 2, pageWidth - 20, yPosition - 2)
  
  // Items
  pdf.setFont('helvetica', 'normal')
  items.forEach((item) => {
    if (yPosition > pageHeight - 30) {
      pdf.addPage()
      yPosition = 20
    }
    
    pdf.text(item.name, col1, yPosition)
    pdf.text(`x${item.quantity}`, col2, yPosition)
    pdf.text(`${(item.volume * item.quantity).toFixed(2)} m³`, col3, yPosition)
    yPosition += itemHeight

    // Packaging info
    if (item.packaging && item.packaging.type !== 'none') {
      pdf.setFontSize(9)
      pdf.setTextColor(...primaryColor)
      pdf.text(`  Embalaje: ${packagingLabel(item.packaging.type)}`, col1, yPosition)
      pdf.setTextColor(...textColor)
      pdf.setFontSize(11)
      yPosition += 5
    }
  })

  yPosition += 10

  // Resumen de volumen
  pdf.setFont('helvetica', 'bold')
  pdf.text(`Volumen Total: ${totalVolume.toFixed(2)} m³`, 20, yPosition)
  yPosition += 6
  pdf.text(`Peso Total: ${totalWeight} kg`, 20, yPosition)
  yPosition += 6
  pdf.text(`Vehículo Recomendado: ${recommendedVehicle}`, 20, yPosition)

  yPosition += 15

  // Servicios Adicionales
  const hasAdditionalServices = additionalServices.disassembly || 
    additionalServices.assembly || 
    additionalServices.packing || 
    additionalServices.unpacking ||
    totalCrew > 1

  if (hasAdditionalServices) {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(14)
    pdf.text('SERVICIOS ADICIONALES', 20, yPosition)
    yPosition += 8
    
    pdf.setFontSize(12)
    pdf.setFont('helvetica', 'normal')
    
    if (additionalServices.disassembly) {
      pdf.text(`[OK] Desarme de muebles - ${formatCurrency(precioServicios.disassembly)}`, 20, yPosition)
      yPosition += 6
    }
    if (additionalServices.assembly) {
      pdf.text(`[OK] Armado de muebles - ${formatCurrency(precioServicios.assembly)}`, 20, yPosition)
      yPosition += 6
    }
    if (additionalServices.packing) {
      pdf.text('[OK] Armado de Cajas - Contactar ejecutivo', 20, yPosition)
      yPosition += 6
    }
    if (additionalServices.unpacking) {
      pdf.text('[OK] Desembalaje - Contactar ejecutivo', 20, yPosition)
      yPosition += 6
    }
    if (totalCrew > 1) {
      pdf.text(`[OK] Cuadrilla total: ${totalCrew} personas`, 20, yPosition)
      yPosition += 6
      if (additionalServices.extraHelpers > 0) {
        pdf.text(
          `    Ayudantes adicionales seleccionados: ${additionalServices.extraHelpers} (mínimo por peso: ${requiredCrew})`,
          20,
          yPosition
        )
        yPosition += 6
      }
    }
    
    yPosition += 10
  }

  // Observaciones
  if (additionalServices.observations) {
    pdf.setFont('helvetica', 'bold')
    pdf.text('OBSERVACIONES:', 20, yPosition)
    yPosition += 8
    pdf.setFont('helvetica', 'normal')
    
    // Dividir texto largo en líneas
    const observations = pdf.splitTextToSize(additionalServices.observations, pageWidth - 40)
    observations.forEach((line: string) => {
      pdf.text(line, 20, yPosition)
      yPosition += 6
    })
    
    yPosition += 10
  }

  // Precio Final
  pdf.setFillColor(...lightGray)
  pdf.rect(20, yPosition, pageWidth - 40, 25, 'F')
  
  pdf.setTextColor(...primaryColor)
  pdf.setFontSize(20)
  pdf.setFont('helvetica', 'bold')
  pdf.text('PRECIO ESTIMADO', pageWidth / 2, yPosition + 10, { align: 'center' })
  
  pdf.setFontSize(28)
  pdf.text(formatCurrency(precioDocumento), pageWidth / 2, yPosition + 20, { align: 'center' })
  
  pdf.setTextColor(...textColor)
  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'normal')
  pdf.text('IVA incluido', pageWidth / 2, yPosition + 25, { align: 'center' })

  // Footer
  const footerY = pageHeight - 20
  pdf.setFontSize(8)
  pdf.setTextColor(128, 128, 128)
  
  if (personalInfo?.isCompany) {
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(220, 38, 38) // red-600
    pdf.setFontSize(9)
    pdf.text('NOTA: Este documento NO es válido como factura. La factura se emitirá al momento del pago.', pageWidth / 2, footerY - 15, { align: 'center' })
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(128, 128, 128)
    pdf.setFontSize(8)
  }
  
  pdf.text('Esta cotización es válida por 7 días desde la fecha de emisión.', pageWidth / 2, footerY - 10, { align: 'center' })
  pdf.text('Para confirmar tu reserva, contáctanos al +56 9 5233 4799', pageWidth / 2, footerY - 5, { align: 'center' })
  pdf.text('www.yomeencargo.cl | contacto@yomeencargo.cl', pageWidth / 2, footerY, { align: 'center' })

  const fileName = `Cotizacion_Mudanza_${personalInfo?.name?.replace(/\s/g, '_') || 'Cliente'}_${new Date().toISOString().split('T')[0]}.pdf`
  if (shouldDownload) {
    pdf.save(fileName)
  }

  return {
    blob: pdf.output('blob'),
    fileName
  }
}

export const generateQuotePDFFromData = (quoteData: any) => {
  // Función alternativa que recibe los datos como parámetro
  // Útil para generar PDFs desde el backend
  return generateQuotePDF()
}

export const generateBookingPDF = async (
  paymentInfo?: {
    order: string
    amount: string
    token: string
  },
  shouldDownload: boolean = true // Por defecto descarga el PDF
) => {
  // Verificar que estamos en el cliente
  if (typeof window === 'undefined') {
    console.error('generateBookingPDF debe ejecutarse solo en el cliente')
    return
  }

  const {
    personalInfo,
    dateTime,
    isFlexible,
    origin,
    destination,
    stops,
    items,
    additionalServices,
    totalVolume,
    totalWeight,
    totalDistance,
    estimatedPrice,
    recommendedVehicle,
    requiredCrew,
    totalCrew,
  } = useQuoteStore.getState()

  // Los precios de desarme y armado salen de la configuración vigente. Antes estaban
  // escritos a mano ($15.000) y el PDF mostraba otro valor que el que se cobra: medido el
  // 16-sep-2026, en producción esos servicios valían $20.000. `getPricingConfig` cachea
  // cinco minutos, así que no suma una consulta por PDF.
  const precioServicios = (await getPricingConfig()).additionalServices

  // Crear nuevo documento PDF. La librería entra bajo demanda (ver import del encabezado).
  const { default: JsPDF } = await import('jspdf')
  const pdf = new JsPDF('p', 'mm', 'a4')
  // Sin esto, los ✓ y los emojis de las notas se dibujan como basura (ver pdfText.ts).
  applyPdfTextSanitizer(pdf as any)
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  
  // Colores corporativos
  const primaryColor: [number, number, number] = [111, 168, 220] // #6FA8DC - Azul Cielo
  const secondaryColor: [number, number, number] = [140, 198, 63] // #8CC63F - Verde Lima
  const textColor: [number, number, number] = [0, 0, 0] // #000000 - Negro (Texto principal)
  const lightGray: [number, number, number] = [225, 240, 250] // #E1F0FA - Azul Muy Claro
  const greenColor: [number, number, number] = [22, 163, 74] // #16A34A - Verde éxito

  let yPosition = 20

  // Header
  pdf.setFillColor(...primaryColor)
  pdf.rect(0, 0, pageWidth, 45, 'F')
  
  // Cargar y agregar logo
  try {
    const logoUrl = '/logo.png'
    const logoImg = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = logoUrl
    })
    
    // Agregar logo a la izquierda (tamaño 30mm de alto, manteniendo proporción)
    const logoHeight = 30
    const logoWidth = (logoImg.width / logoImg.height) * logoHeight
    pdf.addImage(logoImg, 'PNG', 15, 7.5, logoWidth, logoHeight)
  } catch (error) {
    console.warn('No se pudo cargar el logo:', error)
  }
  
  pdf.setTextColor(255, 255, 255)
  pdf.setFontSize(26)
  pdf.setFont('helvetica', 'bold')
  pdf.text('RESERVA CONFIRMADA', pageWidth / 2, 15, { align: 'center' })
  
  pdf.setFontSize(14)
  pdf.setFont('helvetica', 'normal')
  pdf.text('Yo Me Encargo - Servicios de Mudanza', pageWidth / 2, 25, { align: 'center' })
  
  pdf.setFontSize(11)
  pdf.text(`Fecha de emisión: ${new Date().toLocaleDateString('es-CL')} ${new Date().toLocaleTimeString('es-CL')}`, pageWidth / 2, 33, { align: 'center' })

  // Estado de Pago
  pdf.setFillColor(...greenColor)
  pdf.rect(0, 45, pageWidth, 12, 'F')
  pdf.setTextColor(255, 255, 255)
  pdf.setFontSize(14)
  pdf.setFont('helvetica', 'bold')
  pdf.text('✓ PAGO APROBADO', pageWidth / 2, 53, { align: 'center' })

  yPosition = 65

  // Información de Pago
  if (paymentInfo) {
    pdf.setTextColor(...textColor)
    pdf.setFontSize(16)
    pdf.setFont('helvetica', 'bold')
    pdf.text('INFORMACIÓN DEL PAGO', 20, yPosition)
    
    yPosition += 10
    
    // Cuadro de información de pago
    pdf.setFillColor(...lightGray)
    pdf.rect(20, yPosition - 5, pageWidth - 40, 28, 'F')
    
    pdf.setFontSize(12)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(...textColor)
    
    pdf.text(`Número de Orden: #${paymentInfo.order}`, 25, yPosition + 2)
    yPosition += 8
    pdf.text(`Token de Transacción: ${paymentInfo.token}`, 25, yPosition)
    yPosition += 8
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(...greenColor)
    pdf.setFontSize(14)
    pdf.text(`Monto Pagado: ${formatCurrency(parseInt(paymentInfo.amount))}`, 25, yPosition)
    pdf.setTextColor(...textColor)
    pdf.setFontSize(12)
    pdf.setFont('helvetica', 'normal')
    
    yPosition += 12
  }

  yPosition += 5

  // Informacion del Cliente
  pdf.setTextColor(...textColor)
  pdf.setFontSize(16)
  pdf.setFont('helvetica', 'bold')
  pdf.text('INFORMACIÓN DEL CLIENTE', 20, yPosition)
  
  yPosition += 10
  pdf.setFontSize(12)
  pdf.setFont('helvetica', 'normal')
  
  if (personalInfo) {
    pdf.text(`Nombre: ${personalInfo.name}`, 20, yPosition)
    yPosition += 7
    pdf.text(`Email: ${personalInfo.email}`, 20, yPosition)
    yPosition += 7
    pdf.text(`Teléfono: ${personalInfo.phone}`, 20, yPosition)
    yPosition += 7
    
    if (personalInfo.isCompany && personalInfo.companyName) {
      yPosition += 5
      // Cuadro de facturación
      pdf.setFillColor(219, 234, 254) // bg-blue-100
      pdf.setDrawColor(...primaryColor)
      pdf.setLineWidth(1.5)
      pdf.rect(20, yPosition - 3, pageWidth - 40, 24, 'FD')
      
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(...primaryColor)
      pdf.setFontSize(12)
      pdf.text('CON FACTURA', 25, yPosition + 3)
      
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(...textColor)
      yPosition += 8
      pdf.text(`Razón Social: ${personalInfo.companyName}`, 25, yPosition)
      yPosition += 6
      pdf.text(`RUT: ${personalInfo.companyRut || 'No especificado'}`, 25, yPosition)
      yPosition += 10
    }
  }

  yPosition += 5

  // Detalles de la Mudanza
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  pdf.text('DETALLES DE LA MUDANZA', 20, yPosition)
  
  yPosition += 10
  pdf.setFontSize(12)
  pdf.setFont('helvetica', 'normal')
  
  if (dateTime) {
    pdf.text(`Fecha programada: ${formatDate(new Date(dateTime))}`, 20, yPosition)
    yPosition += 7
    pdf.text(`Hora programada: ${formatTime(new Date(dateTime))}`, 20, yPosition)
    yPosition += 7
    
    if (isFlexible) {
      pdf.setTextColor(...secondaryColor)
      pdf.text('✓ Con descuento por flexibilidad (10%)', 20, yPosition)
      pdf.setTextColor(...textColor)
      yPosition += 7
    }
  }

  yPosition += 5

  // Distancia
  if (totalDistance > 0) {
    pdf.setFont('helvetica', 'bold')
    pdf.text(`Distancia puerta a puerta: ${formatDistanceKm(totalDistance)}`, 20, yPosition)
    pdf.setFont('helvetica', 'normal')
    yPosition += 7
  }

  yPosition += 5

  // Direcciones
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.text('DIRECCIONES', 20, yPosition)
  
  yPosition += 8
  pdf.setFontSize(12)
  pdf.setFont('helvetica', 'normal')
  
  if (origin.address) {
    pdf.setFont('helvetica', 'bold')
    pdf.text('Origen:', 20, yPosition)
    pdf.setFont('helvetica', 'normal')
    yPosition += 6
    pdf.text(`${origin.address.street} ${origin.address.number}, ${origin.address.commune}`, 20, yPosition)
    yPosition += 6
    if (origin.address.region) {
      pdf.text(`Región: ${origin.address.region}`, 20, yPosition)
      yPosition += 6
    }
    if (origin.address.additionalInfo) {
      pdf.text(`Info adicional: ${origin.address.additionalInfo}`, 20, yPosition)
      yPosition += 6
    }
    if (origin.details) {
      pdf.text(`${origin.details.propertyType ? `Tipo: ${origin.details.propertyType} | ` : ''}Piso: ${origin.details.floor} | Ascensor: ${origin.details.hasElevator ? 'Sí' : 'No'}`, 20, yPosition)
      yPosition += 6
      const originParking = formatParkingDistance(origin.details.parkingDistance)
      if (originParking) {
        pdf.text(`Acarreo estacionamiento a puerta: ${originParking}`, 20, yPosition)
        yPosition += 6
      }
    }
    yPosition += 3
  }

  const yAntesDeParadas = yPosition
  yPosition = drawStops(pdf, stops, yPosition, 6)
  if (yPosition > yAntesDeParadas) yPosition += 3

  if (destination.address) {
    pdf.setFont('helvetica', 'bold')
    pdf.text('Destino:', 20, yPosition)
    pdf.setFont('helvetica', 'normal')
    yPosition += 6
    pdf.text(`${destination.address.street} ${destination.address.number}, ${destination.address.commune}`, 20, yPosition)
    yPosition += 6
    if (destination.address.region) {
      pdf.text(`Región: ${destination.address.region}`, 20, yPosition)
      yPosition += 6
    }
    if (destination.address.additionalInfo) {
      pdf.text(`Info adicional: ${destination.address.additionalInfo}`, 20, yPosition)
      yPosition += 6
    }
    if (destination.details) {
      pdf.text(`${destination.details.propertyType ? `Tipo: ${destination.details.propertyType} | ` : ''}Piso: ${destination.details.floor} | Ascensor: ${destination.details.hasElevator ? 'Sí' : 'No'}`, 20, yPosition)
      yPosition += 6
      const destinationParking = formatParkingDistance(destination.details.parkingDistance)
      if (destinationParking) {
        pdf.text(`Acarreo estacionamiento a puerta: ${destinationParking}`, 20, yPosition)
        yPosition += 6
      }
    }
  }

  yPosition += 10

  // Verificar si necesitamos una nueva página
  if (yPosition > 200) {
    pdf.addPage()
    yPosition = 20
  }

  // Items a Transportar
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  pdf.text('ITEMS A TRANSPORTAR', 20, yPosition)
  
  yPosition += 10
  pdf.setFontSize(11)
  
  // Tabla de items
  const itemHeight = 7
  const col1 = 20
  const col2 = 105
  const col3 = 135
  const col4 = 165
  
  // Headers de la tabla
  pdf.setFont('helvetica', 'bold')
  pdf.text('Item', col1, yPosition)
  pdf.text('Cantidad', col2, yPosition)
  pdf.text('Peso', col3, yPosition)
  pdf.text('Volumen', col4, yPosition)
  yPosition += itemHeight
  
  // Línea separadora
  pdf.setDrawColor(200, 200, 200)
  pdf.line(col1, yPosition - 3, pageWidth - 20, yPosition - 3)
  
  // Items
  pdf.setFont('helvetica', 'normal')
  items.forEach((item) => {
    if (yPosition > pageHeight - 30) {
      pdf.addPage()
      yPosition = 20
      // Re-dibujar headers
      pdf.setFont('helvetica', 'bold')
      pdf.text('Item', col1, yPosition)
      pdf.text('Cantidad', col2, yPosition)
      pdf.text('Peso', col3, yPosition)
      pdf.text('Volumen', col4, yPosition)
      yPosition += itemHeight
      pdf.setFont('helvetica', 'normal')
    }
    
    // Truncar nombre del item si es muy largo
    const itemName = item.name.length > 40 ? item.name.substring(0, 37) + '...' : item.name
    pdf.text(itemName, col1, yPosition)
    pdf.text(`x${item.quantity}`, col2, yPosition)
    pdf.text(`${(item.weight * item.quantity)} kg`, col3, yPosition)
    pdf.text(`${(item.volume * item.quantity).toFixed(2)} m³`, col4, yPosition)
    
    // Indicadores especiales
    if (item.isFragile || item.isGlass || item.isHeavy) {
      yPosition += 5
      pdf.setFontSize(9)
      pdf.setTextColor(220, 38, 38) // red-600
      let indicators = []
      if (item.isFragile) indicators.push('Fragil')
      if (item.isGlass) indicators.push('Vidrio')
      if (item.isHeavy) indicators.push('Pesado')
      pdf.text(`  [${indicators.join(', ')}]`, col1, yPosition)
      pdf.setTextColor(...textColor)
      pdf.setFontSize(11)
    }
    
    // Packaging info
    if (item.packaging && item.packaging.type !== 'none') {
      yPosition += 5
      pdf.setFontSize(9)
      pdf.setTextColor(...primaryColor)
      pdf.text(`  Embalaje: ${packagingLabel(item.packaging.type)}`, col1, yPosition)
      pdf.setTextColor(...textColor)
      pdf.setFontSize(11)
    }
    
    yPosition += itemHeight
  })

  yPosition += 5

  // Resumen de volumen y peso
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.text(`Volumen Total: ${totalVolume.toFixed(2)} m³`, 20, yPosition)
  yPosition += 7
  pdf.text(`Peso Total: ${totalWeight} kg`, 20, yPosition)
  yPosition += 7
  pdf.text(`Vehículo Recomendado: ${recommendedVehicle}`, 20, yPosition)

  yPosition += 15

  // Verificar espacio para servicios adicionales
  if (yPosition > pageHeight - 60) {
    pdf.addPage()
    yPosition = 20
  }

  // Servicios Adicionales
  const hasAdditionalServices = additionalServices.disassembly || 
    additionalServices.assembly || 
    additionalServices.packing || 
    additionalServices.unpacking ||
    totalCrew > 1

  if (hasAdditionalServices) {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(14)
    pdf.text('SERVICIOS ADICIONALES', 20, yPosition)
    yPosition += 8
    
    pdf.setFontSize(12)
    pdf.setFont('helvetica', 'normal')
    
    if (additionalServices.disassembly) {
      pdf.text(`✓ Desarme de muebles - ${formatCurrency(precioServicios.disassembly)}`, 20, yPosition)
      yPosition += 6
    }
    if (additionalServices.assembly) {
      pdf.text(`✓ Armado de muebles - ${formatCurrency(precioServicios.assembly)}`, 20, yPosition)
      yPosition += 6
    }
    if (additionalServices.packing) {
      pdf.text('✓ Armado de Cajas - Contactar ejecutivo', 20, yPosition)
      yPosition += 6
    }
    if (additionalServices.unpacking) {
      pdf.text('✓ Desembalaje - Contactar ejecutivo', 20, yPosition)
      yPosition += 6
    }
    if (totalCrew > 1) {
      pdf.text(`✓ Cuadrilla total: ${totalCrew} personas`, 20, yPosition)
      yPosition += 6
      if (additionalServices.extraHelpers > 0) {
        pdf.text(
          `  Ayudantes adicionales seleccionados: ${additionalServices.extraHelpers} (mínimo por peso: ${requiredCrew})`,
          20,
          yPosition
        )
        yPosition += 6
      }
    }
    
    yPosition += 10
  }

  // Observaciones
  if (additionalServices.observations && additionalServices.observations.trim() !== '') {
    if (yPosition > pageHeight - 40) {
      pdf.addPage()
      yPosition = 20
    }
    
    pdf.setFont('helvetica', 'bold')
    pdf.text('OBSERVACIONES:', 20, yPosition)
    yPosition += 8
    pdf.setFont('helvetica', 'normal')
    
    // Dividir texto largo en líneas
    const observations = pdf.splitTextToSize(additionalServices.observations, pageWidth - 40)
    observations.forEach((line: string) => {
      if (yPosition > pageHeight - 20) {
        pdf.addPage()
        yPosition = 20
      }
      pdf.text(line, 20, yPosition)
      yPosition += 6
    })
    
    yPosition += 10
  }

  // Verificar si hay espacio para el precio final
  if (yPosition > pageHeight - 50) {
    pdf.addPage()
    yPosition = 20
  }

  // Precio Final
  pdf.setFillColor(...lightGray)
  pdf.rect(20, yPosition, pageWidth - 40, 30, 'F')
  
  pdf.setTextColor(...primaryColor)
  pdf.setFontSize(18)
  pdf.setFont('helvetica', 'bold')
  pdf.text('MONTO TOTAL PAGADO', pageWidth / 2, yPosition + 10, { align: 'center' })
  
  pdf.setFontSize(32)
  pdf.setTextColor(...greenColor)
  pdf.text(formatCurrency(estimatedPrice), pageWidth / 2, yPosition + 22, { align: 'center' })
  
  pdf.setTextColor(...textColor)
  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'normal')
  pdf.text('IVA incluido', pageWidth / 2, yPosition + 28, { align: 'center' })

  yPosition += 40

  // Información importante
  pdf.setFillColor(254, 252, 232) // yellow-50
  pdf.setDrawColor(251, 191, 36) // yellow-400
  pdf.setLineWidth(0.5)
  pdf.rect(20, yPosition, pageWidth - 40, 30, 'FD')
  
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(146, 64, 14) // yellow-900
  pdf.setFontSize(12)
  pdf.text('IMPORTANTE', 25, yPosition + 7)
  
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.text('• Conserva este documento como comprobante de tu reserva', 25, yPosition + 14)
  pdf.text('• Te contactaremos vía WhatsApp para confirmar detalles', 25, yPosition + 20)
  pdf.text('• Un ejecutivo te llamará en las próximas 24 horas', 25, yPosition + 26)

  // Footer
  const footerY = pageHeight - 20
  pdf.setFontSize(8)
  pdf.setTextColor(128, 128, 128)
  
  if (personalInfo?.isCompany) {
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(220, 38, 38) // red-600
    pdf.setFontSize(9)
    pdf.text('NOTA: La factura se enviará por correo electrónico en las próximas 48 horas hábiles.', pageWidth / 2, footerY - 15, { align: 'center' })
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(128, 128, 128)
    pdf.setFontSize(8)
  }
  
  pdf.text('Para consultas o cambios, contáctanos:', pageWidth / 2, footerY - 10, { align: 'center' })
  pdf.text('+56 9 5233 4799 | contacto@yomeencargo.cl', pageWidth / 2, footerY - 5, { align: 'center' })
  pdf.text('www.yomeencargo.cl - Yo Me Encargo Spa', pageWidth / 2, footerY, { align: 'center' })

  // Generar el nombre del archivo
  const fileName = `Reserva_Confirmada_${paymentInfo?.order || 'YME'}_${personalInfo?.name?.replace(/\s/g, '_') || 'Cliente'}_${new Date().toISOString().split('T')[0]}.pdf`
  
  // Solo descargar si se solicita explícitamente
  if (shouldDownload) {
    pdf.save(fileName)
  }
  
  // Siempre retornar el blob del PDF para que pueda ser usado
  return {
    blob: pdf.output('blob'),
    fileName
  }
}

/**
 * Genera un PDF de cotización confirmada para el checkout (antes del pago)
 * Similar al PDF de reserva pero sin información de pago
 * Este PDF solo se descarga localmente, NO se sube a la base de datos
 */
type CheckoutPdfOptions = {
  download?: boolean
}

export const generateCheckoutPDF = async (options?: CheckoutPdfOptions) => {
  const shouldDownload = options?.download !== false

  // Verificar que estamos en el cliente
  if (typeof window === 'undefined') {
    console.error('generateCheckoutPDF debe ejecutarse solo en el cliente')
    return
  }

  const {
    personalInfo,
    dateTime,
    isFlexible,
    origin,
    destination,
    stops,
    items,
    additionalServices,
    totalVolume,
    totalWeight,
    totalDistance,
    estimatedPrice,
    recommendedVehicle,
    requiredCrew,
    totalCrew,
  } = useQuoteStore.getState()

  // Crear nuevo documento PDF. La librería entra bajo demanda (ver import del encabezado).
  const { default: JsPDF } = await import('jspdf')
  const pdf = new JsPDF('p', 'mm', 'a4')
  // Sin esto, los ✓ y los emojis de las notas se dibujan como basura (ver pdfText.ts).
  applyPdfTextSanitizer(pdf as any)
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  
  // Colores corporativos
  const primaryColor: [number, number, number] = [111, 168, 220] // #6FA8DC - Azul Cielo
  const secondaryColor: [number, number, number] = [140, 198, 63] // #8CC63F - Verde Lima
  const textColor: [number, number, number] = [0, 0, 0] // #000000 - Negro (Texto principal)
  const lightGray: [number, number, number] = [225, 240, 250] // #E1F0FA - Azul Muy Claro
  const blueColor: [number, number, number] = [37, 99, 235] // #2563EB - Azul

  let yPosition = 20

  // Header
  pdf.setFillColor(...primaryColor)
  pdf.rect(0, 0, pageWidth, 45, 'F')
  
  pdf.setTextColor(255, 255, 255)
  pdf.setFontSize(26)
  pdf.setFont('helvetica', 'bold')
  pdf.text('COTIZACIÓN CONFIRMADA', pageWidth / 2, 15, { align: 'center' })
  
  pdf.setFontSize(14)
  pdf.setFont('helvetica', 'normal')
  pdf.text('Yo Me Encargo - Servicios de Mudanza', pageWidth / 2, 25, { align: 'center' })
  
  pdf.setFontSize(11)
  pdf.text(`Fecha de emisión: ${new Date().toLocaleDateString('es-CL')} ${new Date().toLocaleTimeString('es-CL')}`, pageWidth / 2, 33, { align: 'center' })

  // Banner de cotización
  pdf.setFillColor(...blueColor)
  pdf.rect(0, 45, pageWidth, 12, 'F')
  pdf.setTextColor(255, 255, 255)
  pdf.setFontSize(14)
  pdf.setFont('helvetica', 'bold')
  pdf.text('LISTA PARA CONFIRMAR', pageWidth / 2, 53, { align: 'center' })

  yPosition = 65

  // Información del Cliente
  pdf.setTextColor(...textColor)
  pdf.setFontSize(16)
  pdf.setFont('helvetica', 'bold')
  pdf.text('INFORMACIÓN DEL CLIENTE', 20, yPosition)
  
  yPosition += 10
  pdf.setFontSize(12)
  pdf.setFont('helvetica', 'normal')
  
  if (personalInfo) {
    pdf.text(`Nombre: ${personalInfo.name}`, 20, yPosition)
    yPosition += 7
    pdf.text(`Email: ${personalInfo.email}`, 20, yPosition)
    yPosition += 7
    pdf.text(`Teléfono: ${personalInfo.phone}`, 20, yPosition)
    yPosition += 7
    
    if (personalInfo.isCompany && personalInfo.companyName) {
      yPosition += 5
      // Cuadro de facturación
      pdf.setFillColor(219, 234, 254) // bg-blue-100
      pdf.setDrawColor(...primaryColor)
      pdf.setLineWidth(1.5)
      pdf.rect(20, yPosition - 3, pageWidth - 40, 24, 'FD')
      
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(...primaryColor)
      pdf.setFontSize(12)
      pdf.text('CON FACTURA', 25, yPosition + 3)
      
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(...textColor)
      yPosition += 8
      pdf.text(`Razón Social: ${personalInfo.companyName}`, 25, yPosition)
      yPosition += 6
      pdf.text(`RUT: ${personalInfo.companyRut || 'No especificado'}`, 25, yPosition)
      yPosition += 10
    }
  }

  yPosition += 5

  // Detalles de la Mudanza
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  pdf.text('DETALLES DE LA MUDANZA', 20, yPosition)
  
  yPosition += 10
  pdf.setFontSize(12)
  pdf.setFont('helvetica', 'normal')
  
  if (dateTime) {
    pdf.text(`Fecha programada: ${formatDate(new Date(dateTime))}`, 20, yPosition)
    yPosition += 7
    pdf.text(`Hora programada: ${formatTime(new Date(dateTime))}`, 20, yPosition)
    yPosition += 7
    
    if (isFlexible) {
      pdf.setTextColor(...secondaryColor)
      pdf.text('✓ Con descuento por flexibilidad (10%)', 20, yPosition)
      pdf.setTextColor(...textColor)
      yPosition += 7
    }
  }

  yPosition += 5

  // Distancia
  if (totalDistance > 0) {
    pdf.setFont('helvetica', 'bold')
    pdf.text(`Distancia puerta a puerta: ${formatDistanceKm(totalDistance)}`, 20, yPosition)
    pdf.setFont('helvetica', 'normal')
    yPosition += 7
  }

  yPosition += 5

  // Direcciones
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.text('DIRECCIONES', 20, yPosition)
  
  yPosition += 8
  pdf.setFontSize(12)
  pdf.setFont('helvetica', 'normal')
  
  if (origin.address) {
    pdf.setFont('helvetica', 'bold')
    pdf.text('Origen:', 20, yPosition)
    pdf.setFont('helvetica', 'normal')
    yPosition += 6
    pdf.text(`${origin.address.street} ${origin.address.number}, ${origin.address.commune}`, 20, yPosition)
    yPosition += 6
    if (origin.address.region) {
      pdf.text(`Región: ${origin.address.region}`, 20, yPosition)
      yPosition += 6
    }
    if (origin.address.additionalInfo) {
      pdf.text(`Detalles: ${origin.address.additionalInfo}`, 20, yPosition)
      yPosition += 6
    }
    if (origin.details) {
      pdf.text(`${origin.details.propertyType ? `Tipo: ${origin.details.propertyType} | ` : ''}Piso: ${origin.details.floor}${origin.details.hasElevator ? ' (con ascensor)' : ' (sin ascensor)'}`, 20, yPosition)
      yPosition += 6
      const originParking = formatParkingDistance(origin.details.parkingDistance)
      if (originParking) {
        pdf.text(`Acarreo estacionamiento a puerta: ${originParking}`, 20, yPosition)
        yPosition += 6
      }
    }
  }

  yPosition += 3

  const yAntesDeParadas = yPosition
  yPosition = drawStops(pdf, stops, yPosition, 6)
  if (yPosition > yAntesDeParadas) yPosition += 3

  if (destination.address) {
    pdf.setFont('helvetica', 'bold')
    pdf.text('Destino:', 20, yPosition)
    pdf.setFont('helvetica', 'normal')
    yPosition += 6
    pdf.text(`${destination.address.street} ${destination.address.number}, ${destination.address.commune}`, 20, yPosition)
    yPosition += 6
    if (destination.address.region) {
      pdf.text(`Región: ${destination.address.region}`, 20, yPosition)
      yPosition += 6
    }
    if (destination.address.additionalInfo) {
      pdf.text(`Detalles: ${destination.address.additionalInfo}`, 20, yPosition)
      yPosition += 6
    }
    if (destination.details) {
      pdf.text(`${destination.details.propertyType ? `Tipo: ${destination.details.propertyType} | ` : ''}Piso: ${destination.details.floor}${destination.details.hasElevator ? ' (con ascensor)' : ' (sin ascensor)'}`, 20, yPosition)
      yPosition += 6
      const destinationParking = formatParkingDistance(destination.details.parkingDistance)
      if (destinationParking) {
        pdf.text(`Acarreo estacionamiento a puerta: ${destinationParking}`, 20, yPosition)
        yPosition += 6
      }
    }
  }

  yPosition += 8

  // Items a Transportar
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.text('ITEMS A TRANSPORTAR', 20, yPosition)
  
  yPosition += 8
  pdf.setFontSize(11)
  pdf.setFont('helvetica', 'normal')

  // Agrupar items por categoría
  const itemsByCategory: { [key: string]: typeof items } = {}
  items.forEach(item => {
    if (!itemsByCategory[item.category]) {
      itemsByCategory[item.category] = []
    }
    itemsByCategory[item.category].push(item)
  })

  // Renderizar items por categoría
  Object.entries(itemsByCategory).forEach(([category, categoryItems]) => {
    if (yPosition > pageHeight - 40) {
      pdf.addPage()
      yPosition = 20
    }

    // Header de categoría
    pdf.setFillColor(...lightGray)
    pdf.rect(20, yPosition - 4, pageWidth - 40, 8, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(11)
    pdf.text(category.toUpperCase(), 25, yPosition + 2)
    yPosition += 10

    // Items de la categoría
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(10)
    
    categoryItems.forEach(item => {
      if (yPosition > pageHeight - 30) {
        pdf.addPage()
        yPosition = 20
      }

      const itemText = `• ${item.name} x${item.quantity}`
      const volumeText = `${parseFloat((item.volume * item.quantity).toFixed(2))} m³`
      
      pdf.text(itemText, 25, yPosition)
      pdf.text(volumeText, pageWidth - 45, yPosition, { align: 'right' })
      
      yPosition += 5

      // Indicadores especiales
      const indicators = []
      if (item.isFragile) indicators.push('Frágil')
      if (item.isHeavy) indicators.push('Pesado')
      if (item.isGlass) indicators.push('Con vidrio')
      if (item.packaging && item.packaging.type !== 'none') {
        indicators.push(`Embalaje: ${packagingLabel(item.packaging.type)}`)
      }

      if (indicators.length > 0) {
        pdf.setTextColor(111, 168, 220)
        pdf.setFontSize(8)
        pdf.text(`  ${indicators.join(' • ')}`, 25, yPosition)
        pdf.setTextColor(...textColor)
        pdf.setFontSize(10)
        yPosition += 5
      }
    })

    yPosition += 3
  })

  // Totales
  yPosition += 5
  if (yPosition > pageHeight - 40) {
    pdf.addPage()
    yPosition = 20
  }

  pdf.setFillColor(...lightGray)
  pdf.rect(20, yPosition - 3, pageWidth - 40, 25, 'F')
  
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.text('RESUMEN', 25, yPosition + 3)
  
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  yPosition += 9
  pdf.text(`Volumen total: ${parseFloat(totalVolume.toFixed(2))} m³`, 25, yPosition)
  pdf.text(`Peso total: ${totalWeight} kg`, pageWidth / 2, yPosition)
  yPosition += 6
  pdf.text(`Vehículo recomendado: ${recommendedVehicle}`, 25, yPosition)

  yPosition += 12

  // Servicios Adicionales
  const hasAdditionalServices = additionalServices.disassembly || 
                                 additionalServices.assembly || 
                                 additionalServices.packing || 
                                 additionalServices.unpacking ||
                                 totalCrew > 1

  if (hasAdditionalServices) {
    if (yPosition > pageHeight - 50) {
      pdf.addPage()
      yPosition = 20
    }

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(14)
    pdf.text('SERVICIOS ADICIONALES', 20, yPosition)
    
    yPosition += 8
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(10)

    if (additionalServices.disassembly) {
      pdf.text('✓ Desarme de muebles', 25, yPosition)
      yPosition += 6
    }
    if (additionalServices.assembly) {
      pdf.text('✓ Armado de muebles', 25, yPosition)
      yPosition += 6
    }
    if (additionalServices.packing) {
      pdf.text('✓ Armado de Cajas (Contactar ejecutivo)', 25, yPosition)
      yPosition += 6
    }
    if (additionalServices.unpacking) {
      pdf.text('✓ Desembalaje (Contactar ejecutivo)', 25, yPosition)
      yPosition += 6
    }
    if (totalCrew > 1) {
      pdf.text(`✓ Cuadrilla total: ${totalCrew} personas`, 25, yPosition)
      yPosition += 6
      if (additionalServices.extraHelpers > 0) {
        pdf.text(
          `  Ayudantes adicionales seleccionados: ${additionalServices.extraHelpers} (mínimo por peso: ${requiredCrew})`,
          25,
          yPosition
        )
        yPosition += 6
      }
    }

    yPosition += 5
  }

  // Observaciones
  if (additionalServices.observations) {
    if (yPosition > pageHeight - 40) {
      pdf.addPage()
      yPosition = 20
    }

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(14)
    pdf.text('OBSERVACIONES', 20, yPosition)
    
    yPosition += 8
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(10)
    
    const lines = pdf.splitTextToSize(additionalServices.observations, pageWidth - 50)
    lines.forEach((line: string) => {
      if (yPosition > pageHeight - 30) {
        pdf.addPage()
        yPosition = 20
      }
      pdf.text(line, 25, yPosition)
      yPosition += 5
    })

    yPosition += 5
  }

  // Precio Total
  if (yPosition > pageHeight - 60) {
    pdf.addPage()
    yPosition = 20
  }

  yPosition += 10

  // Cuadro del precio
  pdf.setFillColor(219, 234, 254) // bg-blue-100
  pdf.setDrawColor(...primaryColor)
  pdf.setLineWidth(2)
  pdf.rect(20, yPosition - 5, pageWidth - 40, 30, 'FD')

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.setTextColor(...primaryColor)
  pdf.text('PRECIO ESTIMADO', pageWidth / 2, yPosition + 5, { align: 'center' })

  pdf.setFontSize(24)
  pdf.setTextColor(...blueColor)
  pdf.text(formatCurrency(estimatedPrice), pageWidth / 2, yPosition + 17, { align: 'center' })

  if (isFlexible) {
    pdf.setFontSize(10)
    pdf.setTextColor(...secondaryColor)
    pdf.text('(Incluye 10% de descuento por flexibilidad)', pageWidth / 2, yPosition + 24, { align: 'center' })
  }

  pdf.setTextColor(...textColor)

  yPosition += 35

  // Información sobre opciones de pago
  pdf.setFillColor(254, 252, 232) // yellow-50
  pdf.setDrawColor(251, 191, 36) // yellow-400
  pdf.setLineWidth(0.5)
  pdf.rect(20, yPosition, pageWidth - 40, 35, 'FD')
  
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(146, 64, 14) // yellow-900
  pdf.setFontSize(12)
  pdf.text('OPCIONES DE PAGO', 25, yPosition + 7)
  
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.setTextColor(...textColor)
  pdf.text(`• Paga el 100% y ahorra 5%: ${formatCurrency(Math.round(estimatedPrice * 0.95))}`, 25, yPosition + 15)
  const deposit = depositAmount(estimatedPrice)
  pdf.text(`• ${deposit > Math.round(estimatedPrice * 0.5) ? 'Abona ahora' : 'Abona el 50% ahora'}: ${formatCurrency(deposit)}`, 25, yPosition + 21)
  pdf.text('  (El resto se paga al finalizar el servicio)', 28, yPosition + 27)

  yPosition += 40

  // Información importante
  if (yPosition > pageHeight - 50) {
    pdf.addPage()
    yPosition = 20
  }

  pdf.setFillColor(220, 252, 231) // green-50
  pdf.setDrawColor(34, 197, 94) // green-500
  pdf.setLineWidth(0.5)
  pdf.rect(20, yPosition, pageWidth - 40, 30, 'FD')
  
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(21, 128, 61) // green-700
  pdf.setFontSize(12)
  pdf.text('PRÓXIMO PASO', 25, yPosition + 7)
  
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.setTextColor(...textColor)
  pdf.text('• Confirma tu reserva seleccionando una opción de pago', 25, yPosition + 14)
  pdf.text('• Serás redirigido a Flow para completar el pago de forma segura', 25, yPosition + 20)
  pdf.text('• Recibirás la confirmación por correo electrónico', 25, yPosition + 26)

  // Footer
  const footerY = pageHeight - 20
  pdf.setFontSize(8)
  pdf.setTextColor(128, 128, 128)
  
  if (personalInfo?.isCompany) {
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(220, 38, 38) // red-600
    pdf.setFontSize(9)
    pdf.text('NOTA: La factura se enviará por correo electrónico en las próximas 48 horas hábiles.', pageWidth / 2, footerY - 15, { align: 'center' })
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(128, 128, 128)
    pdf.setFontSize(8)
  }
  
  pdf.text('Para consultas o cambios, contáctanos:', pageWidth / 2, footerY - 10, { align: 'center' })
  pdf.text('+56 9 5233 4799 | contacto@yomeencargo.cl', pageWidth / 2, footerY - 5, { align: 'center' })
  pdf.text('www.yomeencargo.cl - Yo Me Encargo Spa', pageWidth / 2, footerY, { align: 'center' })

  const fileName = `Cotizacion_Confirmada_${personalInfo?.name?.replace(/\s/g, '_') || 'Cliente'}_${new Date().toISOString().split('T')[0]}.pdf`
  if (shouldDownload) {
    pdf.save(fileName)
  }

  return {
    blob: pdf.output('blob'),
    fileName
  }
}

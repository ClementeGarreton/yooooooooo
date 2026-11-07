// Mismo criterio que pdfGenerator.ts: jsPDF se carga bajo demanda para que no sume
// kB al First Load de /domicilio/exito (esta función recién se usa al generar/bajar el PDF).
import type jsPDF from 'jspdf'
import { formatCurrency } from './utils'
import { applyPdfTextSanitizer } from './pdfText'

interface HomePaymentInfo {
    token: string
    order: string
    amount: string
    bookingId: string
    clientName: string
    clientEmail: string
    visitAddress: string
}

export const generateHomePDF = async (
    paymentInfo: HomePaymentInfo,
    download: boolean = true
): Promise<{ blob: Blob; fileName: string } | null> => {
    try {
        // Crear nuevo documento PDF. La librería entra bajo demanda (ver import del encabezado).
        const { default: JsPDF } = await import('jspdf')
        const pdf = new JsPDF('p', 'mm', 'a4')
        // Deja el documento a salvo de emojis y guiones largos: la fuente del PDF no los
        // dibuja y saldrían como basura. Se aplica una sola vez, sobre todo lo que se escriba.
        applyPdfTextSanitizer(pdf as any)
        const pageWidth = pdf.internal.pageSize.getWidth()

        // Colores corporativos
        const primaryColor: [number, number, number] = [147, 51, 234] // Purple
        const textColor: [number, number, number] = [0, 0, 0]

        let yPosition = 20

        // Header
        pdf.setFillColor(...primaryColor)
        pdf.rect(0, 0, pageWidth, 40, 'F')

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
            pdf.addImage(logoImg, 'PNG', 15, 5, logoWidth, logoHeight)
        } catch (error) {
            console.warn('No se pudo cargar el logo:', error)
        }

        pdf.setTextColor(255, 255, 255)
        pdf.setFontSize(24)
        pdf.setFont('helvetica', 'bold')
        pdf.text('COMPROBANTE DE PAGO', pageWidth / 2, 15, { align: 'center' })

        pdf.setFontSize(12)
        pdf.setFont('helvetica', 'normal')
        pdf.text('Cotización a Domicilio - Yo Me Encargo', pageWidth / 2, 25, { align: 'center' })

        pdf.text(`Fecha: ${new Date().toLocaleDateString('es-CL')}`, pageWidth / 2, 32, { align: 'center' })

        yPosition = 55

        // Información del Cliente
        pdf.setTextColor(...textColor)
        pdf.setFontSize(16)
        pdf.setFont('helvetica', 'bold')
        pdf.text('INFORMACIÓN DEL CLIENTE', 20, yPosition)

        yPosition += 10
        pdf.setFontSize(12)
        pdf.setFont('helvetica', 'normal')

        pdf.text(`Nombre: ${paymentInfo.clientName || 'No especificado'}`, 20, yPosition)
        yPosition += 7
        pdf.text(`Email: ${paymentInfo.clientEmail || 'No especificado'}`, 20, yPosition)
        yPosition += 10

        // Dirección de visita
        pdf.setFont('helvetica', 'bold')
        pdf.text('DIRECCIÓN DE VISITA', 20, yPosition)
        yPosition += 7

        pdf.setFont('helvetica', 'normal')
        const addressLines = pdf.splitTextToSize(paymentInfo.visitAddress || 'No especificada', pageWidth - 40)
        addressLines.forEach((line: string) => {
            pdf.text(line, 20, yPosition)
            yPosition += 5
        })

        yPosition += 10

        // Detalles del Pago
        pdf.setFillColor(243, 232, 255) // Purple light
        pdf.rect(20, yPosition - 5, pageWidth - 40, 45, 'F')

        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(14)
        pdf.text('DETALLES DEL PAGO', 25, yPosition)

        yPosition += 10
        pdf.setFontSize(12)
        pdf.setFont('helvetica', 'normal')

        pdf.text(`Servicio: Cotización a Domicilio`, 25, yPosition)
        yPosition += 7
        pdf.text(`Número de Orden: #${paymentInfo.order || 'N/A'}`, 25, yPosition)
        yPosition += 7
        pdf.text(`Monto Pagado: ${formatCurrency(parseInt(paymentInfo.amount))}`, 25, yPosition)
        yPosition += 7
        pdf.text(`Estado: PAGADO`, 25, yPosition)
        yPosition += 7
        pdf.text(`Fecha de Pago: ${new Date().toLocaleDateString('es-CL')}`, 25, yPosition)

        yPosition += 15

        // Qué incluye el servicio
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(14)
        pdf.text('¿QUÉ INCLUYE ESTE SERVICIO?', 20, yPosition)

        yPosition += 10
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(11)

        // El monto sale del pago, no de la configuración: quien pagó $23.000 tiene que
        // seguir leyendo $23.000 en su comprobante aunque después cambie el precio.
        const montoPagado = formatCurrency(parseInt(paymentInfo.amount))
        const services = [
            `✓ Si contratas el servicio después, los ${montoPagado} se descuentan`,
            '   del valor total del flete',
            '✓ Visita profesional a tu domicilio',
            '✓ Evaluación completa de tus muebles y objetos',
            '✓ Cotización detallada y personalizada',
            '✓ Recomendaciones de empaque y protección',
            '✓ Sin compromiso de contratación'
        ]

        services.forEach(service => {
            pdf.text(service, 25, yPosition)
            yPosition += 7
        })

        yPosition += 10

        // Próximos pasos
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(14)
        pdf.text('PRÓXIMOS PASOS', 20, yPosition)

        yPosition += 10
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(11)

        const steps = [
            '1. Recibirás un correo de confirmación',
            '2. Te contactaremos para coordinar fecha y hora',
            '3. Un profesional visitará tu hogar',
            '4. Recibirás cotización detallada'
        ]

        steps.forEach(step => {
            pdf.text(step, 25, yPosition)
            yPosition += 7
        })

        // Footer
        const footerY = pdf.internal.pageSize.getHeight() - 20
        pdf.setFontSize(8)
        pdf.setTextColor(128, 128, 128)
        pdf.setFont('helvetica', 'normal')
        
        pdf.text('Para consultas o cambios, contáctanos:', pageWidth / 2, footerY - 10, { align: 'center' })
        pdf.text('+56 9 5233 4799 | contacto@yomeencargo.cl', pageWidth / 2, footerY - 5, { align: 'center' })
        pdf.text('www.yomeencargo.cl - Yo Me Encargo Spa', pageWidth / 2, footerY, { align: 'center' })

        // Generar el PDF
        const pdfBlob = pdf.output('blob')
        const fileName = `Comprobante_Domicilio_${paymentInfo.order || Date.now()}_${paymentInfo.clientName.replace(/\s/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`

        if (download) {
            // Descargar al dispositivo
            pdf.save(fileName)
        }

        return {
            blob: pdfBlob,
            fileName
        }
    } catch (error) {
        console.error('Error generando PDF de domicilio:', error)
        return null
    }
}

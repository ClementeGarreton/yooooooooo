// Validación de los PDF que suben las páginas públicas. Sin dependencias de servidor.

/** Las funciones de Vercel aceptan hasta 4,5 MB por petición. */
export const MAX_PDF_BYTES = 4 * 1024 * 1024

/** El tipo que declara quien sube no prueba nada: se miran los primeros bytes. */
export function isPdfBuffer(buffer: Uint8Array): boolean {
  return buffer.length > 4 && String.fromCharCode(...Array.from(buffer.subarray(0, 5))) === '%PDF-'
}

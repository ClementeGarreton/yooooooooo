# Cotización WhatsApp — variables y precio explicados

Cambios limitados a `src/lib/quotePricing.ts` y `src/lib/serverQuoteEngine.ts`.

- El PDF preliminar muestra los pisos, ascensores y metros de acarreo de origen y destino, la respuesta sobre escaleras y el detalle de embalaje (p. ej. «dos escritorios»).
- Los cargos de tarifa base, volumen, ruta, escaleras por extremo, cuadrilla, servicios, embalaje, recargos y descuentos se obtienen **durante el cálculo real** de `calculateQuote`, no con una segunda fórmula.
- El desglose está expresado en pesos enteros, con suma idéntica al total estimado incluso cuando hay descuentos o recargos porcentuales.
- El PDF muestra «Sin confirmar» cuando se desconoce un ascensor y aclara la hipótesis aplicada por la fórmula. **Un piso declarado no demuestra que se usen escaleras**.
- Los metros de acarreo se registran, pero **la fórmula actual no calcula un recargo independiente por acarreo**. Requiere acordar una regla comercial antes de incorporarlo al total.
- El documento sigue siendo estimativo y sujeto a revisión humana. No se crearon tablas ni migraciones nuevas.

## Comprobación disponible

- 36 escenarios de cálculo: el importe total coincide con la versión previa; suma exacta de partidas.
- Prueba instrumental del generador: incluye pisos, embalaje, partidas y total; se ejecuta con una simulación de la biblioteca PDF.
- Transpilación de los tres archivos TypeScript tocados (incluida prueba de regresión): sin errores de sintaxis.

## Pendiente antes de producción

Se requiere `npm run build` en un entorno con dependencias instaladas y generar un PDF real desde una sesión de prueba en Vercel/WhatsApp para revisar el diseño. Las verificaciones anteriores **no sustituyen** esas dos pruebas.

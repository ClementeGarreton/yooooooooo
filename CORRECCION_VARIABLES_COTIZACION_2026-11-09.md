# Corrección focalizada: cotizaciones con accesos y variables sin definir

## Fallo reproducido
Un cliente declara «5 pisos por escalera en origen» pero no informa ascensor, si habrá escaleras en destino ni qué artículos se trasladarán por escalera. La versión anterior consideraba «escaleras» respondido, suponía ascensor=no y calculaba viajes usando TODOS los muebles. El PDF mostraba «Sin confirmar» y «Sin informar».

## Cambio
- El parser OpenAI mantiene el texto original y distingue uso de escaleras en cada extremo, pisos, ascensor, muebles efectivamente subidos y ubicación de acarreo.
- Se guardan esos datos en `state.intake.tommyAccess` y en la ficha existente; no requiere migración SQL.
- Un precio/PDF preliminar **no se genera** hasta contar con datos necesarios para calcular sin inventar. La aclaración se formula en un solo mensaje corto y admite respuestas por número o en lenguaje natural.
- Si el cliente indicó qué muebles pasan por escalera, el recargo usa solo esos artículos, no el inventario completo. Si indicó TODOS, utiliza todos.
- En el PDF WhatsApp tampoco se imprimen los campos opcionales no solicitados «Nombre: No informado», «Correo: No informado», «Documento: Por definir» o «Hora: Por confirmar». No se imprime «Ascensor: Sin confirmar», «Piso: Sin informar» ni se transforma un metro no declarado en 0. Un «No hay acarreo» sí registra 0 en ambos extremos.
- El algoritmo web conserva su comportamiento: el nuevo subconjunto de escaleras es opcional y solo lo usa el cotizador de WhatsApp.
- Las verificaciones de campos incompletos se aplican también al reintentar el PDF con «CONFIRMAR», no solo al texto normal.

## Comprobación local de lógica sin OpenAI ni Vercel
Con dependencias del proyecto instaladas:

```
node scripts/verificar_variables_cotizacion.cjs
node scripts/verificar_escaleras_precio.cjs
npm run build
```

Las dos primeras comprueban semántica en estados *simulados*, no precisión real del modelo. **El build de Next.js y el webhook en producción no se han ejecutado en el entorno de elaboración.** No considerar validado el despliegue sin un build exitoso en Vercel.

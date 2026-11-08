# Corrección de Vercel Hobby — 7 de noviembre de 2026

Se restaura el acuerdo previo para `vercel.json`:

- `/api/admin/cleanup-bookings`: `0 7 * * *` (diario a las 07:00 UTC).
- `/api/cron/emails`: `0 9 * * *` (diario a las 09:00 UTC; antes `0 * * * *`, horario, no compatible con Hobby).

**Importante:** pasar el proceso de correos a una ejecución diaria altera su frecuencia. Los recordatorios programados a +2h/+24h/+72h se revisarán solamente cuando corra el trabajo diario; podrían enviarse tarde o sustituirse por la etapa más reciente exigible. Si se requieren envíos realmente horarios, hay que usar un programador externo o un plan que permita mayor frecuencia. Esto no modifica la API `/api/cron/emails`, solo su frecuencia de invocación por Vercel.

Para desplegar: copiar el contenido del proyecto a Git, confirmar que `vercel.json` en la raíz del repositorio contiene estas expresiones, hacer commit y push a `main`, y redeploy. No basta subir un ZIP a Vercel si éste sigue vinculado al repositorio antiguo.

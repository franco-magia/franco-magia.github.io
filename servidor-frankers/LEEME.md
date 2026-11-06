# Servidor de Frankers

Sirve para que **cualquier persona** le enseñe cosas a Frankers y le lleguen a todos, desde cualquier celu o compu.
Es gratis y corre en tu cuenta de Cloudflare.

Mientras no esté prendido, lo que enseña cada persona queda guardado solo en su dispositivo.

## Cómo prenderlo (unos 5 minutos)

1. Entrá a **dash.cloudflare.com** con tu cuenta.
2. En el menú de la izquierda andá a **Storage & Databases → KV** y tocá **Create**.
   Ponele de nombre `FRANKERS`.
3. Andá a **Compute (Workers) → Workers & Pages → Create → Create Worker**.
   Ponele de nombre `frankers` y tocá **Deploy**.
4. Tocá **Edit code**, borrá todo lo que hay, pegá el contenido de `worker.js` y tocá **Deploy**.
5. En el worker, andá a **Settings → Bindings → Add → KV namespace**:
   - Variable name: `FRANKERS`
   - KV namespace: el `FRANKERS` que creaste.
6. En **Settings → Variables and Secrets → Add**, elegí tipo **Secret**:
   - Nombre: `CLAVE`
   - Valor: una clave que solo sepas vos (sirve para borrar cosas que enseñe la gente).
7. Copiá la dirección del worker (algo como `https://frankers.TU-USUARIO.workers.dev`).
8. Pasásela a Claude, o pegala vos en `frankers/index.html`, en la línea:
   `const SERVIDOR = "";` → `const SERVIDOR = "https://frankers.TU-USUARIO.workers.dev";`

Listo. Desde ahí, lo que enseñe cualquiera (si pasa las reglas) lo sabe todo el mundo en menos de un minuto.

## Cómo se cuida

- Usa **las mismas reglas** que la página: nada de insultos, daño, datos personales ni trucos para cambiar las reglas.
- Si alguien quiere cambiar una respuesta que ya existe, tiene que decir **por qué** o **de dónde lo sacó**.
- Cada conexión puede enseñar hasta **30 cosas por hora**.
- Vos podés borrar cualquier cosa desde **📚 Lo que sé** (modo creador + la clave del servidor).

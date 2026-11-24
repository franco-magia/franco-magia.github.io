/* =========================================================
   CEREBRO DE FRANKERS · red neuronal hecha desde cero (sin librerías)
   ---------------------------------------------------------
   Cómo piensa: lee las últimas palabras de la charla y predice
   cuál es la palabra que sigue. Después agrega esa palabra y vuelve
   a predecir, y así arma frases propias, palabra por palabra.

   Partes:
   1. Palabras  → cada palabra tiene un "vector" (una lista de números) que la red aprende.
   2. Capas escondidas → neuronas que mezclan esos números (tanh). Puede tener varias capas.
   3. Salida   → una neurona por palabra: dice qué tan probable es cada una.
   Aprender = ver un texto, ver cuánto se equivocó al adivinar cada palabra (el error)
   y corregir un poquito cada conexión (descenso por gradiente).
   ========================================================= */
(function fabricaCerebro(global) {
  "use strict";

  const FIN = "<fin>", YO = "<yo>", FRANKERS = "<frankers>", RARA = "<?>";
  const ESPECIALES = [FIN, YO, FRANKERS, RARA];

  // Parte un texto en palabras y signos: "¡Hola, Franco!" → ["¡", "hola", ",", "franco", "!"]
  function tokenizar(texto) {
    return String(texto).toLowerCase().replace(/\{[a-z]+\}/g, " ")
      .match(/<yo>|<frankers>|<fin>|[a-záéíóúüñ0-9]+|[.,!?¡¿:;()"]/g) || [];
  }
  // Vuelve a armar el texto: ["¡", "hola", ",", "franco", "!"] → "¡Hola, franco!"
  function unir(tokens) {
    let s = "";
    for (const t of tokens) {
      if (ESPECIALES.includes(t)) continue;
      if (/^[.,!?:;)]$/.test(t)) s += t;
      else if (!s || /[¡¿("]$/.test(s)) s += t;
      else s += " " + t;
    }
    s = s.replace(/"\s+/g, '"').trim();
    return s.replace(/(^|[.!?]\s+|[¡¿])([a-záéíóúñ])/g, (m, a, b) => a + b.toUpperCase());
  }

  // Números al azar que siempre salen iguales con la misma semilla (así se puede repetir una prueba)
  function azarCon(semilla) {
    let x = semilla >>> 0 || 1;
    return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  }

  // Guardar números en poco espacio (16 bits en vez de 32)
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  function a16(v) {
    f32[0] = v; const x = u32[0], signo = (x >>> 16) & 0x8000;
    let exp = ((x >>> 23) & 0xff) - 127 + 15, man = x & 0x7fffff;
    if (exp <= 0) return signo;
    if (exp >= 31) return signo | 0x7c00;
    return signo | (exp << 10) | (man >>> 13);
  }
  function de16(h) {
    const signo = (h & 0x8000) << 16, exp = (h >>> 10) & 0x1f, man = h & 0x3ff;
    if (exp === 0) return 0;
    u32[0] = signo | ((exp - 15 + 127) << 23) | (man << 13); return f32[0];
  }
  function empacar(arr) {
    const u = new Uint16Array(arr.length); for (let i = 0; i < arr.length; i++) u[i] = a16(arr[i]);
    const bytes = new Uint8Array(u.buffer); let s = "";
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return (typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64"));
  }
  function desempacar(b64) {
    const s = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    const bytes = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    const u = new Uint16Array(bytes.buffer), out = new Float32Array(u.length);
    for (let i = 0; i < u.length; i++) out[i] = de16(u[i]); return out;
  }

  /* Variantes automáticas de lo que escribe la persona (truco 19): así aprende más con pocos ejemplos.
     Sin tildes, con "che", con un error chiquito de tipeo o con una palabra parecida. */
  const SIN_TILDE = { "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u" };
  const PARECIDAS = { hola: "buenas", contame: "decime", decime: "contame", chiste: "broma", gusta: "encanta", estas: "andas", "estás": "andás",
    perro: "perrito", gato: "gatito", "sabés": "conocés", "querés": "quisieras", lindo: "bonito", grande: "enorme", "qué": "que" };
  function variantesDe(palabras, azar = Math.random) {
    const out = [];
    const sinTilde = palabras.map(w => w.replace(/[áéíóú]/g, c => SIN_TILDE[c]));
    if (sinTilde.join(" ") !== palabras.join(" ")) out.push(sinTilde);
    if (palabras[0] !== "che") out.push(["che", ",", ...palabras]);
    const largas = palabras.map((w, i) => [w, i]).filter(([w]) => /^[a-záéíóúñ]{5,}$/.test(w));
    if (largas.length) { // un error chiquito de tipeo: se come una letra
      const [w, i] = largas[Math.floor(azar() * largas.length)], k = 1 + Math.floor(azar() * (w.length - 2));
      const v = palabras.slice(); v[i] = w.slice(0, k) + w.slice(k + 1); out.push(v);
    }
    const cambiable = palabras.findIndex(w => PARECIDAS[w]);
    if (cambiable >= 0) { const v = palabras.slice(); v[cambiable] = PARECIDAS[v[cambiable]]; out.push(v); }
    // dos al azar (para no hacer todo muy lento)
    for (let k = out.length - 1; k > 0; k--) { const j = Math.floor(azar() * (k + 1)); [out[k], out[j]] = [out[j], out[k]]; }
    return out.slice(0, 2);
  }

  class Cerebro {
    /* contexto: cuántas palabras de atrás mira · dimension: números por palabra · capas: neuronas de cada capa escondida */
    constructor({ palabras = [], contexto = 8, dimension = 24, capas = [128], semilla = 7 } = {}) {
      this.azar = azarCon(semilla);
      this.contexto = contexto; this.dimension = dimension;
      this.palabras = [...ESPECIALES, ...palabras.filter(p => !ESPECIALES.includes(p))];
      this.indice = new Map(this.palabras.map((p, i) => [p, i]));
      const V = this.palabras.length, D = dimension;
      this.E = this.llenar(new Float32Array(V * D), 0.1);           // vector de cada palabra
      this.capas = [];                                              // capas escondidas + la de salida
      let entra = contexto * D;
      for (const n of capas) { this.capas.push(this.capaNueva(entra, n)); entra = n; }
      this.capas.push(this.capaNueva(entra, V, true));               // salida: una neurona por palabra
      this.historialError = []; this.vistas = 0;
    }
    llenar(arr, escala) { for (let i = 0; i < arr.length; i++) arr[i] = (this.azar() * 2 - 1) * escala; return arr; }
    capaNueva(entra, sale, salida = false) {
      // Pesos iniciales "Xavier" (truco 10): ni muy grandes ni muy chicos, según cuántas neuronas entran y salen
      return { entra, sale, W: this.llenar(new Float32Array(entra * sale), Math.sqrt(6 / (entra + sale))), b: new Float32Array(sale) };
    }
    get neuronas() { return this.capas.slice(0, -1).map(c => c.sale); }
    get tamano() { let n = this.E.length; for (const c of this.capas) n += c.W.length + c.b.length; return n; }
    id(p) { return this.indice.has(p) ? this.indice.get(p) : this.indice.get(RARA); }

    /* ---------- PENSAR: de las últimas palabras a la probabilidad de cada palabra que sigue ---------- */
    adelante(ids) {
      const D = this.dimension, N = this.contexto, x = new Float32Array(N * D);
      for (let k = 0; k < N; k++) { const off = ids[k] * D; for (let d = 0; d < D; d++) x[k * D + d] = this.E[off + d]; }
      const act = [x];
      for (let l = 0; l < this.capas.length; l++) {
        const { entra, sale, W, b } = this.capas[l], a = act[l], z = new Float32Array(sale);
        z.set(b);
        for (let i = 0; i < entra; i++) { const ai = a[i]; if (ai === 0) continue; const off = i * sale; for (let j = 0; j < sale; j++) z[j] += ai * W[off + j]; }
        if (l < this.capas.length - 1) for (let j = 0; j < sale; j++) z[j] = Math.tanh(z[j]);
        act.push(z);
      }
      // softmax: convierte los puntajes de salida en probabilidades
      const z = act[act.length - 1]; let max = -Infinity; for (let j = 0; j < z.length; j++) if (z[j] > max) max = z[j];
      let suma = 0; for (let j = 0; j < z.length; j++) { z[j] = Math.exp(z[j] - max); suma += z[j]; }
      for (let j = 0; j < z.length; j++) z[j] /= suma;
      return act;
    }

    /* ---------- APRENDER de una palabra: corrige cada conexión un poquito según cuánto se equivocó ---------- */
    paso(ids, objetivo, tasa) {
      const act = this.adelante(ids), p = act[act.length - 1];
      const error = -Math.log(Math.max(p[objetivo], 1e-9));
      let delta = new Float32Array(p); delta[objetivo] -= 1;          // cuánto se equivocó cada neurona de salida
      for (let l = this.capas.length - 1; l >= 0; l--) {
        const { entra, sale, W, b } = this.capas[l], a = act[l];
        const atras = new Float32Array(entra);
        for (let i = 0; i < entra; i++) {
          const ai = a[i], off = i * sale; let s = 0;
          for (let j = 0; j < sale; j++) { s += W[off + j] * delta[j]; if (ai !== 0) W[off + j] -= tasa * ai * delta[j]; }
          atras[i] = s;
        }
        for (let j = 0; j < sale; j++) b[j] -= tasa * delta[j];
        if (l > 0) for (let i = 0; i < entra; i++) atras[i] *= 1 - a[i] * a[i]; // la "curva" de tanh
        delta = atras;
      }
      const D = this.dimension;
      for (let k = 0; k < this.contexto; k++) { const off = ids[k] * D; for (let d = 0; d < D; d++) this.E[off + d] -= tasa * delta[k * D + d]; }
      this.vistas++;
      return error;
    }

    // Convierte un texto en ejemplos: (palabras de antes → palabra que sigue)
    ejemplos(texto) {
      const ids = tokenizar(texto).map(t => this.id(t)), N = this.contexto, fin = this.id(FIN), lista = [];
      const conRelleno = [...Array(N).fill(fin), ...ids];
      for (let k = 0; k < ids.length; k++) lista.push([conRelleno.slice(k, k + N), ids[k]]);
      return lista;
    }
    // Entrena con una lista de textos. Devuelve el error promedio (más chico = mejor).
    entrenar(textos, { vueltas = 1, tasa = 0.05, hasta = Infinity } = {}) {
      let suma = 0, n = 0;
      const todos = []; for (const t of textos) for (const e of this.ejemplos(t)) todos.push(e);
      for (let v = 0; v < vueltas; v++) {
        for (let k = todos.length - 1; k > 0; k--) { const j = Math.floor(this.azar() * (k + 1)); [todos[k], todos[j]] = [todos[j], todos[k]]; }
        for (const [ids, obj] of todos) { suma += this.paso(ids, obj, tasa); n++; if (Date.now() > hasta) break; }
        if (Date.now() > hasta) break;
      }
      const error = n ? suma / n : 0;
      if (n) this.historialError.push(+error.toFixed(3));
      if (this.historialError.length > 200) this.historialError.shift();
      return error;
    }
    // Mide el error sin aprender (para ver si mejora de verdad)
    medirError(textos) {
      let suma = 0, n = 0;
      for (const t of textos) for (const [ids, obj] of this.ejemplos(t)) { const p = this.adelante(ids).pop(); suma += -Math.log(Math.max(p[obj], 1e-9)); n++; }
      return n ? suma / n : 0;
    }

    /* =========================================================
       ENTRENADOR RÁPIDO (los trucos de Franco)
       - Ejemplos convertidos a números una sola vez y guardados (truco 11), sin repetidos (truco 8)
       - Variantes automáticas de lo que escribe la persona: sin tildes, con "che", con errores chicos (truco 19)
       - Grupitos de ejemplos (truco 5) con el optimizador Adam (truco 3)
       - Velocidad de aprendizaje alta al principio y que baja de a poco (truco 9)
       - Apaga neuronas al azar mientras entrena (dropout, truco 16) y limita los cambios muy grandes (truco 17)
       - Practica más seguido lo que más le cuesta (truco 13) y mezcla todo al azar en cada vuelta (truco 14)
       - Se prueba con frases que NO usa para entrenar (truco 15), para cuando ya no mejora (truco 4)
         y se queda con su MEJOR versión, no con la última (truco 18)
       ========================================================= */
    // Convierte textos en ejemplos (con memoria: si ya convirtió ese texto, no lo hace de nuevo)
    idsDe(texto) {
      if (!this._cacheIds || this._cacheV !== this.palabras.length) { this._cacheIds = new Map(); this._cacheV = this.palabras.length; }
      let ids = this._cacheIds.get(texto);
      if (!ids) { ids = Int32Array.from(tokenizar(texto).map(t => this.id(t))); if (this._cacheIds.size < 60000) this._cacheIds.set(texto, ids); }
      return ids;
    }
    armarEjemplos(textos, { variantes = true } = {}) {
      const N = this.contexto, fin = this.id(FIN), yo = this.id(YO), fr = this.id(FRANKERS);
      const vistos = new Set(), ctx = [], obj = [];
      const sumar = (ids, desde = 0) => {
        const rel = new Int32Array(N + ids.length); rel.fill(fin, 0, N); rel.set(ids, N);
        for (let k = desde; k < ids.length; k++) {
          const c = rel.subarray(k, k + N), clave = c.join(",") + ">" + ids[k];
          if (vistos.has(clave)) continue;   // sin ejemplos repetidos
          vistos.add(clave); for (let q = 0; q < N; q++) ctx.push(c[q]); obj.push(ids[k]);
        }
      };
      for (const t of new Set(textos)) {
        const ids = this.idsDe(t); sumar(ids);
        // Variantes: cambian solo lo que escribe la persona; aprende a contestar igual aunque escribas distinto
        if (variantes && ids[0] === yo) {
          const pos = ids.indexOf(fr); if (pos < 2) continue;
          const pregunta = tokenizar(t.slice(t.indexOf(YO) + YO.length, t.indexOf(FRANKERS))), resto = ids.subarray(pos);
          for (const v of variantesDe(pregunta, this.azar)) {
            const nuevos = Int32Array.from([yo, ...v.map(w => this.id(w)), ...resto]);
            sumar(nuevos, v.length + 1); // solo aprende la respuesta (no a escribir con errores)
          }
        }
      }
      return { ctx: Int32Array.from(ctx), obj: Int32Array.from(obj), n: obj.length };
    }
    // Copia de todos los pesos (para guardar la mejor versión)
    foto() { return { E: this.E.slice(), capas: this.capas.map(c => ({ W: c.W.slice(), b: c.b.slice() })) }; }
    volverA(f) { if (!f || f.capas.length !== this.capas.length || f.E.length !== this.E.length) return false; this.E.set(f.E); f.capas.forEach((x, l) => { this.capas[l].W.set(x.W); this.capas[l].b.set(x.b); }); return true; }
    // Error con ejemplos ya armados (más rápido que medirError)
    errorDe(ej, max = Infinity) {
      const N = this.contexto, n = Math.min(ej.n, max); let s = 0;
      for (let e = 0; e < n; e++) { const p = this.adelante(ej.ctx.subarray(e * N, e * N + N)).pop(); s += -Math.log(Math.max(p[ej.obj[e]], 1e-9)); }
      return n ? s / n : 0;
    }
    /* Prepara un entrenamiento. Devuelve { paso(ms), terminar() }: así se puede entrenar de a pedacitos
       (en un Web Worker o en la página, sin trabarla). */
    crearEntrenador(textos, { segundos = 30, prueba = [], tasaMax = 0.0015, tasaMin = 0.0002, grupo = 16, dropout = 0.1,
      recorte = 2, variantes = true, paciencia = 4, errorMeta = 0.02, cadaPrueba = null } = {}) {
      const N = this.contexto, D = this.dimension, L = this.capas.length;
      const ej = this.armarEjemplos(textos, { variantes });
      const ejPrueba = this.armarEjemplos(prueba, { variantes: false });
      const maxPrueba = Math.min(ejPrueba.n, 500);
      if (!ej.n) throw new Error("No hay ejemplos para entrenar");
      // Adam: guarda "m" (para dónde venía yendo) y "v" (qué tan grande es el cambio) de cada peso
      const forma = this.capas.map(c => c.W.length).join(",") + "|" + this.E.length;
      if (!this._adam || this._adam.forma !== forma) this._adam = { forma, t: 0, E: [new Float32Array(this.E.length), new Float32Array(this.E.length)], capas: this.capas.map(c => ({ mW: new Float32Array(c.W.length), vW: new Float32Array(c.W.length), mb: new Float32Array(c.b.length), vb: new Float32Array(c.b.length) })) };
      const A = this._adam, B1 = 0.9, B2 = 0.999, EPS = 1e-8;
      const g = { E: new Float32Array(this.E.length), filas: new Set(), capas: this.capas.map(c => ({ W: new Float32Array(c.W.length), b: new Float32Array(c.b.length) })) };
      const salida = this.capas[L - 1], activas = new Int32Array(salida.sale), usadas = new Uint8Array(salida.sale), umbral = 2e-4;
      const perdida = new Float32Array(ej.n).fill(3); // cuánto le cuesta cada ejemplo (arranca alto: todavía no lo probó)
      let orden = Uint32Array.from({ length: ej.n }, (_, i) => i), pos = ej.n;
      const mezclar = () => { for (let k = orden.length - 1; k > 0; k--) { const j = Math.floor(this.azar() * (k + 1)); const x = orden[k]; orden[k] = orden[j]; orden[j] = x; } pos = 0; };
      const elegir = () => {
        if (this.azar() < 0.25) { // practica más lo que más le cuesta: de 6 al azar, el más difícil
          let mejor = Math.floor(this.azar() * ej.n); for (let k = 0; k < 5; k++) { const c = Math.floor(this.azar() * ej.n); if (perdida[c] > perdida[mejor]) mejor = c; } return mejor;
        }
        if (pos >= ej.n) mezclar(); return orden[pos++];
      };
      const inicio = Date.now(), duracion = segundos * 1000;
      const errorAntes = this.errorDe(ejPrueba, maxPrueba);
      let mejorError = errorAntes, mejorFoto = this.foto(), sinMejorar = 0, ejemplos = 0, sumaPerdida = 0, cuentaPerdida = 0;
      let ultimaPrueba = Date.now(), paro = null, errorPrueba = errorAntes;
      const cada = cadaPrueba || Math.max(4000, duracion / 8);
      const tasaAhora = () => { const f = Math.min(1, (Date.now() - inicio) / duracion), calentar = Math.min(1, f / 0.05); return calentar * (tasaMin + (tasaMax - tasaMin) * 0.5 * (1 + Math.cos(Math.PI * f))); };
      // Un grupito: suma cuánto hay que corregir cada peso (gradiente) y después corrige todo junto con Adam
      const grupito = () => {
        for (let b = 0; b < grupo; b++) {
          const e = elegir(), ids = ej.ctx.subarray(e * N, e * N + N), objetivo = ej.obj[e];
          // adelante, apagando neuronas al azar (dropout)
          const x = new Float32Array(N * D); for (let k = 0; k < N; k++) x.set(this.E.subarray(ids[k] * D, ids[k] * D + D), k * D);
          const act = [x], tanhs = [null], mascaras = [null];
          for (let l = 0; l < L; l++) {
            const { entra, sale, W, b: bias } = this.capas[l], a = act[l], z = new Float32Array(sale); z.set(bias);
            for (let i = 0; i < entra; i++) { const ai = a[i]; if (ai === 0) continue; const off = i * sale; for (let j = 0; j < sale; j++) z[j] += ai * W[off + j]; }
            if (l < L - 1) {
              const h = new Float32Array(sale), m = new Uint8Array(sale), esc = 1 / (1 - dropout);
              for (let j = 0; j < sale; j++) { h[j] = Math.tanh(z[j]); m[j] = this.azar() >= dropout ? 1 : 0; z[j] = m[j] ? h[j] * esc : 0; }
              tanhs.push(h); mascaras.push(m);
            }
            act.push(z);
          }
          const p = act[L]; let max = -Infinity; for (let j = 0; j < p.length; j++) if (p[j] > max) max = p[j];
          let suma = 0; for (let j = 0; j < p.length; j++) { p[j] = Math.exp(p[j] - max); suma += p[j]; } for (let j = 0; j < p.length; j++) p[j] /= suma;
          const err = -Math.log(Math.max(p[objetivo], 1e-9)); perdida[e] = err; sumaPerdida += err; cuentaPerdida++;
          // atrás: cuánto se equivocó cada neurona, de la salida hacia la entrada
          let delta = p; delta[objetivo] -= 1;
          // Última capa: solo corrige las palabras que importan (las que pensó con algo de probabilidad, y la correcta).
          // Las otras casi no cambiarían nada, y saltearlas hace todo mucho más rápido.
          { const { entra, sale, W } = this.capas[L - 1], a = act[L - 1], gW = g.capas[L - 1].W, gb = g.capas[L - 1].b, atras = new Float32Array(entra);
            let n = 0; for (let j = 0; j < sale; j++) if (delta[j] > umbral || j === objetivo) { activas[n++] = j; usadas[j] = 1; }
            for (let i = 0; i < entra; i++) {
              const ai = a[i], off = i * sale; let s = 0;
              for (let q = 0; q < n; q++) { const j = activas[q], dj = delta[j]; s += W[off + j] * dj; gW[off + j] += ai * dj; }
              atras[i] = s;
            }
            for (let q = 0; q < n; q++) gb[activas[q]] += delta[activas[q]];
            if (L > 1) { const h = tanhs[L - 1], m = mascaras[L - 1], esc = 1 / (1 - dropout); for (let i = 0; i < entra; i++) atras[i] = m[i] ? atras[i] * (1 - h[i] * h[i]) * esc : 0; }
            delta = atras; }
          for (let l = L - 2; l >= 0; l--) {
            const { entra, sale, W } = this.capas[l], a = act[l], gW = g.capas[l].W, gb = g.capas[l].b, atras = new Float32Array(entra);
            for (let i = 0; i < entra; i++) {
              const ai = a[i], off = i * sale; let s = 0;
              if (ai !== 0) for (let j = 0; j < sale; j++) { const dj = delta[j]; s += W[off + j] * dj; gW[off + j] += ai * dj; }
              else for (let j = 0; j < sale; j++) s += W[off + j] * delta[j];
              atras[i] = s;
            }
            for (let j = 0; j < sale; j++) gb[j] += delta[j];
            if (l > 0) { const h = tanhs[l], m = mascaras[l], esc = 1 / (1 - dropout); for (let i = 0; i < entra; i++) atras[i] = m[i] ? atras[i] * (1 - h[i] * h[i]) * esc : 0; }
            delta = atras;
          }
          for (let k = 0; k < N; k++) { const fila = ids[k]; g.filas.add(fila); const off = fila * D; for (let d = 0; d < D; d++) g.E[off + d] += delta[k * D + d]; }
          ejemplos++;
        }
        // Limitar los cambios muy grandes (gradient clipping): si el gradiente es enorme, se achica
        const cols = []; for (let j = 0; j < usadas.length; j++) if (usadas[j]) { cols.push(j); usadas[j] = 0; }
        const So = salida.sale, Go = g.capas[L - 1];
        let norma = 0;
        for (let l = 0; l < L - 1; l++) { const c = g.capas[l]; for (let k = 0; k < c.W.length; k++) norma += c.W[k] * c.W[k]; for (let k = 0; k < c.b.length; k++) norma += c.b[k] * c.b[k]; }
        for (let i = 0; i < salida.entra; i++) for (const j of cols) norma += Go.W[i * So + j] ** 2;
        for (const j of cols) norma += Go.b[j] ** 2;
        for (const f of g.filas) for (let d = 0; d < D; d++) norma += g.E[f * D + d] ** 2;
        norma = Math.sqrt(norma) / grupo;
        const escala = (norma > recorte ? recorte / norma : 1) / grupo;
        // Adam: corrige cada peso según su historia
        A.t++; const lr = tasaAhora() * Math.sqrt(1 - B2 ** A.t) / (1 - B1 ** A.t);
        const adam = (P, G, M, V, k) => { const gk = G[k] * escala; M[k] = B1 * M[k] + (1 - B1) * gk; V[k] = B2 * V[k] + (1 - B2) * gk * gk; P[k] -= lr * M[k] / (Math.sqrt(V[k]) + EPS); G[k] = 0; };
        for (let l = 0; l < L - 1; l++) { const c = this.capas[l], G = g.capas[l], S = A.capas[l]; for (let k = 0; k < c.W.length; k++) adam(c.W, G.W, S.mW, S.vW, k); for (let k = 0; k < c.b.length; k++) adam(c.b, G.b, S.mb, S.vb, k); }
        { const S = A.capas[L - 1]; for (let i = 0; i < salida.entra; i++) { const off = i * So; for (const j of cols) adam(salida.W, Go.W, S.mW, S.vW, off + j); } for (const j of cols) adam(salida.b, Go.b, S.mb, S.vb, j); } // Adam "perezoso": solo las palabras que usó
        for (const f of g.filas) for (let d = 0; d < D; d++) adam(this.E, g.E, A.E[0], A.E[1], f * D + d); // solo las palabras que usó
        g.filas.clear();
      };
      const probar = () => {
        errorPrueba = this.errorDe(ejPrueba, maxPrueba); ultimaPrueba = Date.now();
        if (errorPrueba < mejorError - 0.001) { mejorError = errorPrueba; mejorFoto = this.foto(); sinMejorar = 0; } else sinMejorar++;
        if (errorPrueba <= errorMeta) paro = "el error ya es muy bajo";
        else if (sinMejorar >= paciencia && Date.now() - inicio > duracion * 0.3) paro = "ya no mejoraba más";
      };
      const estado = (final = false) => ({ progreso: Math.min(1, (Date.now() - inicio) / duracion), ejemplos, totalEjemplos: ej.n,
        errorEntreno: cuentaPerdida ? +(sumaPerdida / cuentaPerdida).toFixed(3) : null, errorPrueba: +errorPrueba.toFixed(3), errorAntes: +errorAntes.toFixed(3),
        mejorError: +mejorError.toFixed(3), tasa: +tasaAhora().toFixed(5), paro, final });
      const yo = this;
      return {
        paso(ms = 200) { // entrena un ratito y devuelve cómo va
          const hasta = Date.now() + ms;
          sumaPerdida = 0; cuentaPerdida = 0;
          while (Date.now() < hasta && !paro && Date.now() - inicio < duracion) {
            grupito();
            if (Date.now() - ultimaPrueba > cada) probar();
          }
          if (Date.now() - inicio >= duracion && !paro) paro = "se terminó el tiempo";
          return estado();
        },
        get terminado() { return !!paro; },
        terminar() { // se queda con la mejor versión
          if (!paro) paro = "lo paraste vos";
          probar();
          if (errorPrueba > mejorError) yo.volverA(mejorFoto);
          const final = Math.min(errorPrueba, mejorError);
          yo.vistas += ejemplos; yo.historialError.push(+final.toFixed(3)); if (yo.historialError.length > 200) yo.historialError.shift();
          return { ...estado(true), errorPrueba: +final.toFixed(3) };
        },
      };
    }
    // Entrena todo de una (en un Web Worker o en node)
    entrenarRapido(textos, opciones = {}) {
      const ent = this.crearEntrenador(textos, opciones);
      while (!ent.terminado) { const e = ent.paso(500); if (opciones.alAvanzar) opciones.alAvanzar(e); }
      const r = ent.terminar(); if (opciones.alAvanzar) opciones.alAvanzar(r); return r;
    }

    /* ---------- HABLAR: arma una frase palabra por palabra ---------- */
    generar(inicio, { maxPalabras = 30, temperatura = 0.8, opciones = 12, azar = Math.random } = {}) {
      const tokens = tokenizar(inicio), N = this.contexto, fin = this.id(FIN);
      let ids = [...Array(N).fill(fin), ...tokens.map(t => this.id(t))].slice(-N);
      const salida = [], seguridad = [], prohibidas = new Set([this.id(YO), this.id(FRANKERS), this.id(RARA)]);
      for (let k = 0; k < maxPalabras; k++) {
        const p = this.adelante(ids).pop();
        // elige entre las palabras más probables (con un poco de azar, para no repetir siempre lo mismo)
        const mejores = [];
        for (let j = 0; j < p.length; j++) {
          if (prohibidas.has(j) || (k === 0 && j === fin)) continue;
          if (mejores.length < opciones) { mejores.push(j); mejores.sort((a, b) => p[b] - p[a]); }
          else if (p[j] > p[mejores[opciones - 1]]) { mejores[opciones - 1] = j; mejores.sort((a, b) => p[b] - p[a]); }
        }
        const pesos = mejores.map(j => Math.pow(p[j], 1 / temperatura)), total = pesos.reduce((a, b) => a + b, 0);
        let r = azar() * total, elegida = mejores[0];
        for (let i = 0; i < mejores.length; i++) { r -= pesos[i]; if (r <= 0) { elegida = mejores[i]; break; } }
        seguridad.push(p[elegida]);
        if (elegida === fin) break;
        salida.push(this.palabras[elegida]);
        ids = [...ids.slice(1), elegida];
      }
      this.ultimaSeguridad = seguridad.length ? seguridad.reduce((a, b) => a + b, 0) / seguridad.length : 0; // qué tan segura estaba de cada palabra
      return unir(salida);
    }
    // Qué tan segura está de una respuesta entera (promedio de la probabilidad de cada palabra, incluido el final)
    puntuar(inicio, respuesta) {
      const N = this.contexto, fin = this.id(FIN);
      let ids = [...Array(N).fill(fin), ...tokenizar(inicio).map(t => this.id(t))].slice(-N);
      const objetivos = [...tokenizar(respuesta).map(t => this.id(t)), fin];
      let suma = 0;
      for (const o of objetivos) { const p = this.adelante(ids).pop(); suma += Math.log(Math.max(p[o], 1e-9)); ids = [...ids.slice(1), o]; }
      return Math.exp(suma / objetivos.length);
    }
    // Lo que contesta en una charla
    contestar(mensaje, opciones = {}) { return this.generar(`${YO} ${mensaje} ${FRANKERS}`, opciones); }

    /* ---------- CRECER ---------- */
    // Suma neuronas a una capa escondida SIN perder lo que sabe:
    // las conexiones viejas quedan igual y las nuevas arrancan con valores chiquitos.
    agregarNeurona(capa = this.capas.length - 2, cuantas = 1) {
      if (capa < 0 || capa >= this.capas.length - 1) throw new Error("Esa capa no existe");
      const c = this.capas[capa], sig = this.capas[capa + 1], nuevo = c.sale + cuantas;
      const W = new Float32Array(c.entra * nuevo);
      for (let i = 0; i < c.entra; i++) {
        for (let j = 0; j < c.sale; j++) W[i * nuevo + j] = c.W[i * c.sale + j];               // lo viejo, igual
        for (let j = c.sale; j < nuevo; j++) W[i * nuevo + j] = (this.azar() * 2 - 1) * 0.01;  // lo nuevo, chiquito
      }
      const b = new Float32Array(nuevo); b.set(c.b);
      const W2 = new Float32Array(nuevo * sig.sale); W2.set(sig.W);                            // filas viejas iguales
      for (let k = c.sale * sig.sale; k < W2.length; k++) W2[k] = (this.azar() * 2 - 1) * 0.001; // filas nuevas, casi cero
      Object.assign(c, { W, b, sale: nuevo }); Object.assign(sig, { W: W2, entra: nuevo });
      return nuevo;
    }
    // Suma una capa escondida nueva justo antes de la salida.
    // Arranca copiando lo que le llega (casi como si no estuviera), así se olvida muy poco.
    agregarCapa(neuronas) {
      const salida = this.capas[this.capas.length - 1], entra = salida.entra, n = neuronas || entra;
      const capa = { entra, sale: n, W: new Float32Array(entra * n), b: new Float32Array(n) };
      for (let i = 0; i < entra; i++) for (let j = 0; j < n; j++) capa.W[i * n + j] = (i === j ? 1 : 0) + (this.azar() * 2 - 1) * 0.001;
      if (n !== entra) {
        const W = new Float32Array(n * salida.sale);
        for (let i = 0; i < Math.min(n, entra); i++) for (let j = 0; j < salida.sale; j++) W[i * salida.sale + j] = salida.W[i * salida.sale + j];
        Object.assign(salida, { W, entra: n });
      }
      this.capas.splice(this.capas.length - 1, 0, capa);
      return this.neuronas;
    }
    // Aprende palabras nuevas (sin olvidar las que ya sabe)
    agregarPalabras(lista) {
      const nuevas = [...new Set(lista)].filter(p => p && !this.indice.has(p) && p.length < 30);
      if (!nuevas.length) return 0;
      const D = this.dimension, V = this.palabras.length, V2 = V + nuevas.length;
      const E = new Float32Array(V2 * D); E.set(this.E); this.llenar(E.subarray(V * D), 0.1);
      const s = this.capas[this.capas.length - 1], W = new Float32Array(s.entra * V2), b = new Float32Array(V2);
      for (let i = 0; i < s.entra; i++) { W.set(s.W.subarray(i * V, i * V + V), i * V2); for (let j = V; j < V2; j++) W[i * V2 + j] = (this.azar() * 2 - 1) * 0.01; }
      b.set(s.b); b.fill(-4, V); // las palabras nuevas arrancan poco probables
      Object.assign(s, { W, b, sale: V2 }); this.E = E;
      for (const p of nuevas) { this.indice.set(p, this.palabras.length); this.palabras.push(p); }
      return nuevas.length;
    }

    /* ---------- GUARDAR Y CARGAR ---------- */
    aJSON() {
      return { version: 1, contexto: this.contexto, dimension: this.dimension, palabras: this.palabras.slice(ESPECIALES.length),
        E: empacar(this.E), capas: this.capas.map(c => ({ entra: c.entra, sale: c.sale, W: empacar(c.W), b: empacar(c.b) })),
        historialError: this.historialError, vistas: this.vistas };
    }
    // Copia exacta (sin achicar los números), para pasarla a un Web Worker o guardarla en IndexedDB
    aCrudo() { return { version: 2, contexto: this.contexto, dimension: this.dimension, palabras: this.palabras.slice(ESPECIALES.length), E: this.E.slice(), capas: this.capas.map(c => ({ entra: c.entra, sale: c.sale, W: c.W.slice(), b: c.b.slice() })), historialError: this.historialError.slice(), vistas: this.vistas }; }
    static desdeCrudo(j) {
      const c = new Cerebro({ palabras: j.palabras, contexto: j.contexto, dimension: j.dimension, capas: [] });
      c.E = new Float32Array(j.E); c.capas = j.capas.map(x => ({ entra: x.entra, sale: x.sale, W: new Float32Array(x.W), b: new Float32Array(x.b) }));
      c.historialError = j.historialError || []; c.vistas = j.vistas || 0; return c;
    }
    static desdeJSON(j) {
      const c = new Cerebro({ palabras: j.palabras, contexto: j.contexto, dimension: j.dimension, capas: [] });
      c.E = desempacar(j.E); c.capas = j.capas.map(x => ({ entra: x.entra, sale: x.sale, W: desempacar(x.W), b: desempacar(x.b) }));
      c.historialError = j.historialError || []; c.vistas = j.vistas || 0;
      return c;
    }
  }

  // Arma la lista de palabras que conoce, a partir de los textos (las que aparecen al menos "minimo" veces)
  function vocabulario(textos, { maximo = 6000, minimo = 2 } = {}) {
    const cuenta = new Map();
    for (const t of textos) for (const p of tokenizar(t)) if (!ESPECIALES.includes(p)) cuenta.set(p, (cuenta.get(p) || 0) + 1);
    return [...cuenta].filter(([, n]) => n >= minimo).sort((a, b) => b[1] - a[1]).slice(0, maximo).map(([p]) => p);
  }
  // Un texto de charla: "<yo> hola <frankers> ¡hola! <fin>"
  const charla = (pregunta, respuesta) => `${YO} ${pregunta} ${FRANKERS} ${respuesta} ${FIN}`;

  global.FrankersCerebro = { Cerebro, tokenizar, unir, vocabulario, charla, variantesDe, fabrica: fabricaCerebro, FIN, YO, FRANKERS };
  if (typeof module !== "undefined" && module.exports) module.exports = global.FrankersCerebro;
})(typeof globalThis !== "undefined" ? globalThis : this);

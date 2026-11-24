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
(function (global) {
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
      return { entra, sale, W: this.llenar(new Float32Array(entra * sale), salida ? 0.05 : Math.sqrt(1 / entra)), b: new Float32Array(sale) };
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

  global.FrankersCerebro = { Cerebro, tokenizar, unir, vocabulario, charla, FIN, YO, FRANKERS };
  if (typeof module !== "undefined" && module.exports) module.exports = global.FrankersCerebro;
})(typeof globalThis !== "undefined" ? globalThis : this);

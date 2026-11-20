/* =========================================================
   GRAMÁTICA DE FRANKERS · el diccionario y las reglas del español
   ---------------------------------------------------------
   - Sabe de qué tipo es cada palabra (sustantivo, verbo, adjetivo…), su género y su número.
   - Arregla la concordancia: "la primo" → "el primo", "los perro" → "los perros", "el perro ladran" → "el perro ladra".
   - Revisa que una frase esté bien escrita y que no tenga palabras raras.
   - Arma frases propias: artículo + sustantivo + verbo + complemento, con palabras que suelen ir juntas.
   - Aprende qué palabras van juntas leyendo y charlando.
   ========================================================= */
(function (global) {
  "use strict";
  const ARTICULOS = { el: ["m", "s", "def"], la: ["f", "s", "def"], los: ["m", "p", "def"], las: ["f", "p", "def"], un: ["m", "s", "ind"], una: ["f", "s", "ind"], unos: ["m", "p", "ind"], unas: ["f", "p", "ind"] };
  const ARTICULO = { def: { m: { s: "el", p: "los" }, f: { s: "la", p: "las" } }, ind: { m: { s: "un", p: "unos" }, f: { s: "una", p: "unas" } } };
  const NO_TERMINA = new Set(["el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al", "a", "en", "con", "por", "para", "y", "o", "que", "mi", "tu", "su", "sus", "mis", "tus", "es", "son", "muy", "pero", "como", "sin", "sobre", "entre", "hasta", "desde", "se", "me", "te", "lo", "le", "les", "nos", "este", "esta", "ese", "esa"]);
  const PALABRAS_CHICAS = new Set("y o a e u de del al en con por para sin sobre entre hasta desde que qué quien quién como cómo cuando cuándo donde dónde cual cuál no sí si se me te lo le les nos mi tu su mis tus sus yo vos tú él ella ellos ellas nosotros usted ustedes muy más menos ya también pero porque pues este esta estos estas ese esa esos esas eso esto aquí acá ahí allá hoy mañana ayer bien mal todo todos toda todas otro otra otros otras mucho mucha muchos muchas poco poca hay es son era fue soy estoy está están".split(" "));

  class Gramatica {
    constructor(datos, juntas = {}) {
      this.tipos = datos.tipos || {};
      this.base = new Map(); this.forma = new Map(); this.significados = { ...(datos.significados || {}) };
      for (const [w, e] of Object.entries(datos.palabras || {})) this.sumar(w, e);
      this.juntas = { sv: {}, vo: {}, sa: {}, ...juntas }; // sujeto→verbo, verbo→objeto, sustantivo→adjetivo
    }
    // Suma una palabra al diccionario (con sus formas: plural, femenino, conjugaciones)
    sumar(w, e) {
      const tipo = e[0] || "s";
      this.base.set(w, e);
      const poner = (f, info) => { if (!this.forma.has(f)) this.forma.set(f, info); };
      poner(w, { lema: w, tipo, gen: tipo[0] === "s" ? (e[1] || "m") : null, num: "s" });
      if (tipo[0] === "s") { const g = e[1] || "m"; const pl = e[2] || this.plural(w); poner(pl, { lema: w, tipo, gen: g, num: "p" }); }
      if (tipo.includes("a")) { const fem = (tipo[0] === "a" ? e[1] : null) || (/o$/.test(w) ? w.slice(0, -1) + "a" : w); poner(fem, { lema: w, tipo: "a", gen: "f", num: "s" }); poner(this.plural(w), { lema: w, tipo: "a", gen: "m", num: "p" }); poner(this.plural(fem), { lema: w, tipo: "a", gen: "f", num: "p" }); }
      if (tipo[0] === "v" && e[1]) e[1].split(" ").forEach((f, k) => poner(f, { lema: w, tipo: "v", persona: k }));
    }
    plural(s) {
      if (/[aeiouáéó]$/.test(s)) return s + "s";
      if (/z$/.test(s)) return s.slice(0, -1) + "ces";
      if (/[sx]$/.test(s)) return s;
      return s.replace(/[áéíóú](?=[^aeiouáéíóú]*$)/, c => ({ á: "a", é: "e", í: "i", ó: "o", ú: "u" }[c])) + "es";
    }
    info(w) { return this.forma.get(w) || null; }
    conoce(w) { return this.forma.has(w) || /^\d+$/.test(w); }
    significado(w) { const i = this.info(w); return this.significados[w] || (i && this.significados[i.lema]) || null; }
    // Presente de un verbo: persona 0=yo 1=vos 2=él/ella 3=nosotros 4=ellos
    conjugar(lema, persona) { const e = this.base.get(lema); if (!e || e[0][0] !== "v" || !e[1]) return null; return e[1].split(" ")[persona] || null; }
    formaSustantivo(lema, num) { const e = this.base.get(lema); if (!e) return lema; return num === "p" ? (e[2] || this.plural(lema)) : lema; }
    formaAdjetivo(lema, gen, num) { const e = this.base.get(lema) || ["a"]; let f = gen === "f" ? ((e[0][0] === "a" && e[1]) || (/o$/.test(lema) ? lema.slice(0, -1) + "a" : lema)) : lema; return num === "p" ? this.plural(f) : f; }

    /* ---------- CONCORDANCIA: arregla género, número y persona ---------- */
    concordar(tokens) {
      const t = [...tokens];
      for (let i = 0; i < t.length; i++) {
        const art = ARTICULOS[t[i]];
        if (!art) continue;
        // busca el sustantivo que sigue (puede haber un adjetivo en el medio)
        let j = i + 1; if (t[j] && this.info(t[j])?.tipo === "a" && t[j + 1] && this.info(t[j + 1])?.tipo?.[0] === "s") j++;
        const n = this.info(t[j]);
        if (!n || !n.tipo || n.tipo[0] !== "s" || !n.gen) continue;
        const gen = n.gen === "mf" ? art[0] : n.gen;
        t[i] = ARTICULO[art[2]][gen][n.num];
        // adjetivo después del sustantivo: "el perro grandes" → "el perro grande"
        const a = this.info(t[j + 1]);
        if (a && a.tipo === "a" && t[j + 1] !== this.formaAdjetivo(a.lema, gen, n.num) && !this.info(t[j + 1]).tipo.includes("s")) t[j + 1] = this.formaAdjetivo(a.lema, gen, n.num);
        // verbo después: "el perro ladran" → "el perro ladra"
        const v = this.info(t[j + 1]);
        if (v && v.tipo === "v" && (v.persona === 2 || v.persona === 4)) { const bien = this.conjugar(v.lema, n.num === "p" ? 4 : 2); if (bien) t[j + 1] = bien; }
      }
      return t;
    }

    /* ---------- REVISAR: ¿está bien escrita? ¿tiene palabras raras? ---------- */
    revisar(tokens, conocidas) {
      const palabras = tokens.filter(x => /^[a-záéíóúüñ0-9]+$/.test(x));
      if (palabras.length < 2) return { ok: false, motivo: "muy corta" };
      for (const w of palabras) if (!this.conoce(w) && !(conocidas && conocidas.has(w)) && !PALABRAS_CHICAS.has(w)) return { ok: false, motivo: `palabra rara: «${w}»` };
      for (let k = 1; k < tokens.length; k++) if (tokens[k] === tokens[k - 1] && /\w/.test(tokens[k])) return { ok: false, motivo: "palabra repetida" };
      const ultima = palabras[palabras.length - 1];
      if (NO_TERMINA.has(ultima) && !/[?!]/.test(tokens[tokens.length - 1] || "")) return { ok: false, motivo: "termina cortada" };
      const abre = tokens.filter(x => x === "¿").length, cierra = tokens.filter(x => x === "?").length;
      if (abre > cierra || cierra > abre + 1) return { ok: false, motivo: "signos sin cerrar" };
      if (tokens.filter(x => x === '"').length % 2) return { ok: false, motivo: "comillas sin cerrar" };
      if (/^[.,!?:;]/.test(tokens[0])) return { ok: false, motivo: "empieza con un signo" };
      for (let k = 0; k + 1 < tokens.length; k++) if (/^[.,:;]$/.test(tokens[k]) && /^[.,:;!?]$/.test(tokens[k + 1])) return { ok: false, motivo: "signos pegados" };
      return { ok: true };
    }
    // ¿Qué tan relacionada está una frase con el mensaje? (comparte sustantivos y verbos)
    relacion(tokensFrase, tokensMensaje) {
      const clave = (ts) => new Set(ts.map(w => this.info(w)).filter(i => i && /^[sv]/.test(i.tipo) && !PALABRAS_CHICAS.has(i.lema)).map(i => i.lema));
      const a = clave(tokensFrase), b = clave(tokensMensaje); let n = 0; for (const x of a) if (b.has(x)) n++;
      return n;
    }

    /* ---------- APRENDER QUÉ PALABRAS VAN JUNTAS ---------- */
    aprenderJuntas(tokens) {
      const sumar = (tabla, a, b) => { const x = (tabla[a] = tabla[a] || {}); x[b] = (x[b] || 0) + 1; };
      for (let i = 0; i + 1 < tokens.length; i++) {
        const n = this.info(tokens[i]); if (!n || !n.tipo || n.tipo[0] !== "s" || PALABRAS_CHICAS.has(tokens[i])) continue;
        const sig = this.info(tokens[i + 1]);
        if (sig && sig.tipo === "v" && (sig.persona === 2 || sig.persona === 4)) {
          sumar(this.juntas.sv, n.lema, sig.lema);
          // objeto: "el perro come carne", "la vaca da leche"
          let k = i + 2; if (ARTICULOS[tokens[k]]) k++;
          const o = this.info(tokens[k]); if (o && o.tipo && o.tipo[0] === "s" && !PALABRAS_CHICAS.has(tokens[k])) sumar(this.juntas.vo, sig.lema, o.lema);
        }
        const esAdj = (x) => { const i = this.info(x), t = i && (this.base.get(i.lema) || [""])[0]; return i && i.tipo === "a" && /^a/.test(t) && !t.includes("s"); };
        if (esAdj(tokens[i + 1])) sumar(this.juntas.sa, n.lema, this.info(tokens[i + 1]).lema);
        if ((tokens[i + 1] === "es" || tokens[i + 1] === "son") && esAdj(tokens[i + 2])) sumar(this.juntas.sa, n.lema, this.info(tokens[i + 2]).lema);
      }
    }
    // Elige al azar, pero las que van más juntas tienen más chances
    elegir(tabla, azar, minimo = 2) { const ops = Object.entries(tabla || {}).filter(([, n]) => n >= minimo); if (!ops.length) return null; const total = ops.reduce((s, [, n]) => s + n, 0); let r = azar() * total; for (const [w, n] of ops) { r -= n; if (r <= 0) return w; } return ops[0][0]; }

    /* ---------- HABLAR SOLA: arma una oración con reglas de gramática ---------- */
    // artículo + sustantivo + verbo + complemento ("El perro come carne.") o sustantivo + es + adjetivo ("El sol es grande.")
    frasePropia(tema, azar = Math.random) {
      const n = this.info(tema); if (!n || !n.tipo || n.tipo[0] !== "s") return null;
      const lema = n.lema, gen = n.gen === "mf" ? "m" : (n.gen || "m"), num = "s";
      const sujeto = `${ARTICULO.def[gen][num]} ${this.formaSustantivo(lema, num)}`;
      const puro = (w) => { const t = (this.base.get(w) || [""])[0]; return /^a/.test(t) && !t.includes("s"); };
      const verbo = this.elegir(Object.fromEntries(Object.entries(this.juntas.sv[lema] || {}).filter(([w]) => !/^(ser|estar|haber|tener|hacer)$/.test(w))), azar), adjs = Object.fromEntries(Object.entries(this.juntas.sa[lema] || {}).filter(([w]) => puro(w))), adj = this.elegir(adjs, azar, 3);
      let frase = null;
      if (verbo && (azar() < 0.7 || !adj)) {
        const v = this.conjugar(verbo, num === "p" ? 4 : 2); if (!v) return null;
        const obj = this.elegir(this.juntas.vo[verbo], azar, /^(tener|hacer|dar|ser)$/.test(verbo) ? 6 : 3), o = obj && this.info(obj);
        frase = `${sujeto} ${v}` + (o && o.gen ? ` ${obj}` : "");
        if (!o && (this.base.get(verbo) || [])[0] && !this.juntas.vo[verbo] && /^(tener|hacer|dar|ver|tomar|usar|sigue|seguir|dejar|poner)$/.test(verbo)) return null; // verbos que necesitan algo después
      } else if (adj) {
        frase = `${sujeto} ${num === "p" ? "son" : "es"} ${this.formaAdjetivo(adj, gen, num)}`;
      }
      if (!frase) return null;
      return frase.charAt(0).toUpperCase() + frase.slice(1) + ".";
    }
    // Los sustantivos de un mensaje (para saber de qué se habla)
    sustantivos(tokens) { return tokens.filter(w => { const i = this.info(w); return i && i.tipo && i.tipo[0] === "s" && !PALABRAS_CHICAS.has(w) && w.length > 2; }).map(w => this.info(w).lema); }
  }
  global.FrankersGramatica = { Gramatica, PALABRAS_CHICAS };
  if (typeof module !== "undefined" && module.exports) module.exports = global.FrankersGramatica;
})(typeof globalThis !== "undefined" ? globalThis : this);

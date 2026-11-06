// =====================================================================
//  SERVIDOR DE FRANKERS (Cloudflare Worker)
//  Guarda lo que cualquier persona le enseña a Frankers, para que lo sepan todos.
//  - GET  /aprendido  -> lista de todo lo aprendido
//  - POST /ensenar    -> enseñar algo nuevo (pasa por las mismas reglas que la página)
//  - POST /olvidar    -> borrar algo (solo con la clave de Franco, en el header X-Clave)
//  Necesita: un KV llamado FRANKERS y una variable secreta CLAVE. Ver LEEME.md.
// =====================================================================
const MAXIMO = 5000;          // cuántas cosas puede guardar como máximo
const POR_HORA = 30;          // cuántas cosas puede enseñar una misma conexión por hora

// Mismas reglas que la página (insultos, daño, datos personales, cambiar reglas…)
const FILTROS = [
  /\b(bolud\w*|pelotud\w*|forr[oa]s?|put[oa]s?|puteada\w*|mierd\w*|carajo|concha\w*|pija\w*|verga\w*|cul[oe]s?|cag(ar|o|a|on|ue|ad)\w*|chot[oa]s?|trol[oa]s?|idiot\w*|estupid\w*|imbecil\w*|tarad[oa]s?|mogolic\w*|retrasad[oa]s?|gil(es)?|hdp|ctm|lpm|ort[oa]|garch\w*|coger|cogi\w*|pajer\w*|maric\w*|soret\w*|cornud\w*|sudaca\w*|inutil(es)?|feo de mierda|tonto|tonta)\b/,
  /\b(todos los |todas las |los |las )?[a-z]+(s|es) son (todos |todas |unos |unas )?(malos|malas|feos|feas|tontos|tontas|vagos|vagas|sucios|sucias|inferiores|ladrones|peores|asquerosos|asquerosas|brutos|brutas)\b|\bburla\w* de\b|\bme burlo\b/,
  /\b((hacer|hacerle|hacerles|hago|hace|hacele|hacemos|haciendo) (el )?(bullying|bulling)|como (molesto|amenazo|acoso|humillo|insulto) a|amenazar(lo|la|los|las)?|acosar(lo|la|los|las)?|molestar a|humillar(lo|la|los|las)?|escrachar(lo|la)?|insultar(lo|la)?|insultar a|hacerle la vida imposible)\b/,
  /\b(suicid\w*|matarme|me quiero morir|quiero morirme|no quiero vivir|cortarme|lastimarme|hacerme dano|estoy en peligro|me pegan|me lastiman|me estan lastimando|tengo miedo de (mi papa|mi mama|alguien|una persona))\b/,
  /\b(estoy (muy |re |bastante )?(triste|deprimid[oa]|angustiad[oa])|me siento (muy |re )?(triste|sol[oa]|mal)|nadie me quiere|no tengo amigos|lloro mucho|estoy llorando)\b/,
  /\b(ignora\w*|olvida\w*|borra\w*|cambia\w*|saltea\w*|desactiva\w*|rompe\w*)\s+(tus |las |todas |tu )?(reglas|instrucciones|limites|filtros?|programacion)\b|\bahora (sos|eres) (otro|otra|malo|mala|libre)\b|\bmodo (sin filtro|libre|malo|dios)\b|\b(sin|no tengas|no tenes) (reglas|filtro|limites)\b|\bsoy (tu creador|el creador|el admin|administrador)\b|\bes una prueba\b|\bjailbreak\b|\bahora (sos|eres) (otra|una nueva|otro) (ia|inteligencia|robot|asistente)\b|\b(el creador|franco) te (da|dio) permiso\b|\bte (doy|damos) permiso\b|\b(actua|actuar) como\b|\b(fingi|finge|hace de cuenta|imagina|imaginate) que (sos|eres)\b|\bsin censura\b/,
  /\b(matar\w*|mata(lo|la|los)|asesin\w*|bombas?|explosiv\w*|venenos?|envenen\w*|armas de fuego|pistolas?|rifles?|cuchillazo\w*|drogas?|cocaina|marihuana|robar\w*|robo|hackea\w*|tortur\w*|violar|violacion|golpear(lo|la|los)?|pegarle|virus|malware|keylogger|phishing|hackear\w*|hackeo|robar (cuentas?|contrasenas?|claves?)|contrasenas? de (otro|otra|alguien|mi amig\w*)|pagina falsa|paginas falsas|hacerse pasar|hacerme pasar|suplantar\w*|fabricar (un|una|armas?|bombas?|venenos?|drogas?|explosivos?)|crear (un|una) (arma|bomba|virus))\b/,
  /\b(sexo|sexual\w*|porno\w*|desnud\w*|tetas?|pene|vagina|calient[ea] de)\b/,
  /[\w.+-]+@[\w-]+\.[\w.]+|\b\d{2,4}[\s-]?\d{3,4}[\s-]?\d{4}\b|\b\d{1,2}\.\d{3}\.\d{3}\b|\b(calle|avenida|av|pasaje)\s+[a-z]+(\s+[a-z]+)?\s+\d{2,5}\b|\b(vive en (la )?calle|su direccion|su telefono|su celular|su dni|su contrasena|password|donde vive|donde trabaja|direccion de|telefono de|celular de|instagram de|datos de (una persona|alguien|mi )|buscar a (una persona|alguien))\b/,
];

function normalizar(t) {
  return String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/([a-z])\1{2,}/g, "$1").replace(/\s+/g, " ").trim();
}
function rompeReglas(texto) {
  const t = normalizar(texto), crudo = String(texto).toLowerCase() + " " + t;
  return FILTROS.some(re => re.test(t) || re.test(crudo));
}

export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Clave",
    };
    const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(req.url);
    const leer = async () => (await env.FRANKERS.get("aprendido", "json")) || [];

    if (url.pathname === "/aprendido" && req.method === "GET") return json(await leer());

    if (url.pathname === "/ensenar" && req.method === "POST") {
      // Límite por conexión, para que nadie lo llene de cosas
      const ip = req.headers.get("CF-Connecting-IP") || "desconocido";
      const claveLimite = "limite:" + ip;
      const usadas = parseInt((await env.FRANKERS.get(claveLimite)) || "0", 10);
      if (usadas >= POR_HORA) return json({ ok: false, motivo: "Me enseñaste muchas cosas seguidas. ¡Gracias! Probá de nuevo en un rato." }, 429);

      let b; try { b = await req.json(); } catch { return json({ ok: false, motivo: "No entendí lo que me mandaste." }, 400); }
      const limpiar = (lista, largo) => (Array.isArray(lista) ? lista : []).map(x => String(x).trim().slice(0, largo)).filter(Boolean).slice(0, 8);
      const preguntas = limpiar(b.preguntas, 200), respuestas = limpiar(b.respuestas, 280);
      if (!preguntas.length || !respuestas.length) return json({ ok: false, motivo: "Falta qué te pueden decir o qué contestar." }, 400);
      const tipo = ["hecho", "gusto", "opinion"].includes(b.tipo) ? b.tipo : "hecho";
      const autor = tipo === "opinion" ? String(b.autor || "alguien").slice(0, 40) : undefined;
      const fuente = b.fuente ? String(b.fuente).slice(0, 200) : undefined;
      if (rompeReglas([...preguntas, ...respuestas, autor || "", fuente || ""].join("\n"))) return json({ ok: false, motivo: "No puedo aprender eso: rompe mis reglas." }, 400);

      let lista = await leer();
      const claves = new Set(preguntas.map(normalizar));
      const choca = lista.find(e => e.preguntas.some(q => claves.has(normalizar(q))));
      // Si ya sé otra cosa para esa pregunta, solo la cambio si me dicen por qué
      if (choca && !fuente && normalizar(choca.respuestas[0]) !== normalizar(respuestas[0]))
        return json({ ok: false, motivo: `Ya me enseñaron otra respuesta: "${choca.respuestas[0]}". Si querés cambiarla, contame por qué o de dónde lo sacaste.` }, 409);
      lista = lista.filter(e => !e.preguntas.some(q => claves.has(normalizar(q))));
      const entrada = { id: String(b.id || ("c" + Date.now().toString(36))).slice(0, 40), preguntas, respuestas, tipo, fecha: new Date().toISOString() };
      if (autor) entrada.autor = autor;
      if (fuente) entrada.fuente = fuente;
      lista.push(entrada);
      if (lista.length > MAXIMO) lista = lista.slice(-MAXIMO);
      await env.FRANKERS.put("aprendido", JSON.stringify(lista));
      await env.FRANKERS.put(claveLimite, String(usadas + 1), { expirationTtl: 3600 });
      return json({ ok: true, entrada });
    }

    if (url.pathname === "/olvidar" && req.method === "POST") {
      if (!env.CLAVE || req.headers.get("X-Clave") !== env.CLAVE) return json({ ok: false, motivo: "Clave incorrecta." }, 403);
      let b; try { b = await req.json(); } catch { return json({ ok: false }, 400); }
      const lista = (await leer()).filter(e => e.id !== b.id);
      await env.FRANKERS.put("aprendido", JSON.stringify(lista));
      return json({ ok: true });
    }

    return json({ ok: true, nombre: "Servidor de Frankers", rutas: ["/aprendido", "/ensenar", "/olvidar"] });
  },
};

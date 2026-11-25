/* GeoSIG FI-UNAM · Motor de simulación en vivo y predicción por reglas.
 * Lógica pura (sin DOM): se puede probar con Node (tests/simulacion.test.js).
 *
 * - Afluencia "en tiempo real" simulada: perfil horario de kpi_data.json interpolado
 *   al minuto + variación determinística (misma hora => mismo valor en cualquier tableta).
 * - Predicción a 60 min: perfil del escenario + corrección por la desviación observada.
 * - Reglas: R1 demanda ordinaria, R2 periodo de exámenes, R3 saturación crítica.
 */
(function (global) {
  'use strict';

  let INICIO_MIN = 7 * 60;     // se ajusta con meta.horas al iniciar
  let FIN_MIN = 21 * 60;
  const DIAS_JS = [null, 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']; // getDay(): 0 = domingo (cerrado)
  const ESTADOS = ['bajo', 'moderado', 'alto', 'critico'];
  // Grupos de uso equivalente (para sugerir alternativas), por subtipo
  // Solo se sugiere un lugar del mismo tipo: biblioteca → biblioteca, PC-PUMA → PC-PUMA, recreativo → recreativo.
  const GRUPOS = { computo: 'computo', laboratorio: 'laboratorio', biblioteca: 'biblioteca', estudio: 'biblioteca',
    descanso: 'recreativo', jardin: 'recreativo', plaza: 'recreativo', cancha: 'recreativo', cafeteria: 'recreativo',
    auditorio: 'auditorio', estacionamiento: 'estacionamiento', motos: 'motos' };
  const aMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

  let KPI = null;
  let UMBRALES = { moderado: 0.5, alto: 0.75, critico: 0.9 };
  let PASO = 15;

  function init(kpi) {
    KPI = kpi;
    UMBRALES = kpi.meta.umbrales;
    PASO = kpi.meta.paso_min;
    INICIO_MIN = aMin(kpi.meta.horas[0]);
    FIN_MIN = aMin(kpi.meta.horas[kpi.meta.horas.length - 1]);
    api.INICIO_MIN = INICIO_MIN;
    api.FIN_MIN = FIN_MIN;
  }

  /** Zona simulada o edificio completo (kpi.edificios_sim). */
  function R(id) { return KPI.recintos[id] || (KPI.edificios_sim && KPI.edificios_sim[id]); }

  function horario(id) {
    const h = R(id).horario || {};
    return [h.apertura ? aMin(h.apertura) : INICIO_MIN, h.cierre ? aMin(h.cierre) : FIN_MIN];
  }

  function estado(sat) {
    if (sat >= UMBRALES.critico) return 'critico';
    if (sat >= UMBRALES.alto) return 'alto';
    if (sat >= UMBRALES.moderado) return 'moderado';
    return 'bajo';
  }

  /** Estado de una zona: por densidad (personas/m²) en exteriores, por saturación en lo demás. */
  function estadoZona(id, ocupacion, saturacion) {
    const r = R(id);
    if (r && r.tipo === 'estacionamiento') return saturacion < 0.45 ? 'bajo' : 'moderado';   // sin máximo: nunca alerta
    const u = r && r.umbrales_densidad;
    if (!u) return estado(saturacion);
    const d = ocupacion / r.superficie_m2;
    return d >= u[2] ? 'critico' : d >= u[1] ? 'alto' : d >= u[0] ? 'moderado' : 'bajo';
  }

  const pad = (n) => String(n).padStart(2, '0');
  const fechaISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const horaTxt = (min) => `${pad(Math.floor(min / 60))}:${pad(Math.round(min % 60))}`;
  const minutoDelDia = (d) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;

  /** Escenario según calendario (R2) o forzado por el usuario. */
  function escenarioPara(fecha, forzado) {
    if (forzado && forzado !== 'auto') return forzado;
    const f = fechaISO(fecha);
    const periodos = (KPI.meta.calendario && KPI.meta.calendario.examenes) || [];
    return periodos.some((p) => f >= p.inicio && f <= p.fin) ? 'examenes' : 'ordinario';
  }

  /** Valor del perfil (personas, real) interpolado al minuto. null = cerrado. */
  function perfilEn(id, escenario, dia, minuto) {
    const [ap, ci] = horario(id);
    if (!dia || minuto < Math.max(INICIO_MIN, ap) || minuto > Math.min(FIN_MIN, ci)) return null;
    const serie = R(id).perfiles[escenario][dia].ocupacion;
    const x = (minuto - INICIO_MIN) / PASO;
    const i = Math.min(Math.floor(x), serie.length - 1);
    const j = Math.min(i + 1, serie.length - 1);
    return serie[i] + (serie[j] - serie[i]) * (x - i);
  }

  // Ruido determinístico suave: valores en nodos cada 5 min, interpolados.
  function hash01(txt) {
    let h = 2166136261;
    for (let k = 0; k < txt.length; k++) { h ^= txt.charCodeAt(k); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 100000) / 100000;
  }
  function ruido(id, fecha, minuto, amplitud = 0.08) {
    const k = Math.floor(minuto / 5);
    const f = (minuto % 5) / 5;
    const base = `${id}|${fechaISO(fecha)}|`;
    const a = hash01(base + k), b = hash01(base + (k + 1));
    return 1 + amplitud * 2 * ((a + (b - a) * f) - 0.5);
  }

  /** Ocupación simulada "en vivo" de un recinto en la fecha/hora dada. */
  function ocupacionEnVivo(id, fecha, escenarioForzado) {
    const r = R(id);
    const esc = escenarioPara(fecha, escenarioForzado);
    const dia = DIAS_JS[fecha.getDay()];
    const m = minutoDelDia(fecha);
    const base = perfilEn(id, esc, dia, m);
    if (base === null) {
      return { id, abierto: false, ocupacion: 0, capacidad: r.capacidad_max, saturacion: 0, estado: 'cerrado', escenario: esc, unidad: r.unidad };
    }
    const ocup = Math.max(0, Math.min(r.capacidad_max, Math.round(base * ruido(id, fecha, m))));
    const sat = ocup / r.capacidad_max;
    return { id, abierto: true, ocupacion: ocup, capacidad: r.capacidad_max, saturacion: sat, estado: estadoZona(id, ocup, sat), escenario: esc, base, unidad: r.unidad,
      densidad: r.umbrales_densidad ? ocup / r.superficie_m2 : null };
  }

  /** Predicción a `horizonte` minutos con pasos de 15 min y reglas activadas. */
  function prediccion(id, fecha, escenarioForzado, horizonte = 60) {
    const r = R(id);
    const ahora = ocupacionEnVivo(id, fecha, escenarioForzado);
    const esc = ahora.escenario;
    const dia = DIAS_JS[fecha.getDay()];
    const m0 = minutoDelDia(fecha);
    const ratio = ahora.abierto && ahora.base > 0.5 ? Math.max(0.6, Math.min(1.4, ahora.ocupacion / ahora.base)) : 1;
    const puntos = [];
    for (let d = 15; d <= horizonte; d += 15) {
      const base = perfilEn(id, esc, dia, m0 + d);
      if (base === null) { puntos.push({ minuto: m0 + d, hora: horaTxt(m0 + d), ocupacion: 0, saturacion: 0, estado: 'cerrado' }); continue; }
      const oc = Math.max(0, Math.min(r.capacidad_max, Math.round(base * (1 + (ratio - 1) * Math.exp(-d / 45)))));
      const sat = oc / r.capacidad_max;
      puntos.push({ minuto: m0 + d, hora: horaTxt(m0 + d), ocupacion: oc, saturacion: sat, estado: estadoZona(id, oc, sat) });
    }
    const reglas = [];
    reglas.push(esc === 'examenes'
      ? { codigo: 'R2', nivel: 'info', texto: 'Periodo de exámenes: se espera más demanda de lo normal.' }
      : { codigo: 'R1', nivel: 'info', texto: 'Demanda ordinaria.' });
    const dens = !!r.umbrales_densidad;
    const val = (p) => (dens ? `${(p.ocupacion / r.superficie_m2).toFixed(2)} personas/m²` : `${Math.round(p.saturacion * 100)} %`);
    if (ahora.abierto && ahora.estado === 'critico') {
      reglas.push({ codigo: 'R3', nivel: 'critico', texto: `${dens ? 'Congestionado' : 'Lleno'} ahora (${val(ahora)}).` });
    } else {
      const crit = puntos.find((p) => p.estado === 'critico');
      if (crit) reglas.push({ codigo: 'R3', nivel: 'critico', texto: `${dens ? 'Se congestionará' : 'Se llenará'} hacia las ${crit.hora} (${val(crit)}).` });
      else {
        const alto = puntos.find((p) => p.estado === 'alto');
        if (alto) reglas.push({ codigo: 'R3', nivel: 'alto', texto: `${dens ? 'Estará concurrido' : 'Estará casi lleno'} hacia las ${alto.hora} (${val(alto)}).` });
      }
    }
    return { ahora, puntos, reglas, escenario: esc };
  }

  /** Día de hoy completo cada 15 min, la misma fuente para todas las pestañas:
   *  lo ya ocurrido (simulación en vivo de cada corte), el corte actual y el pronóstico del resto. */
  function diaCompleto(id, fecha, escenarioForzado) {
    const r = R(id);
    const ahora = ocupacionEnVivo(id, fecha, escenarioForzado);
    const esc = ahora.escenario, dia = DIAS_JS[fecha.getDay()], m0 = minutoDelDia(fecha);
    const ratio = ahora.abierto && ahora.base > 0.5 ? Math.max(0.6, Math.min(1.4, ahora.ocupacion / ahora.base)) : 1;
    const pts = [];
    for (let M = INICIO_MIN; M <= FIN_MIN; M += PASO) {
      let q, tipo;
      if (M <= m0 - PASO) {
        tipo = 'pasado';
        const f = new Date(fecha); f.setHours(0, M, 0, 0);
        const v = dia ? ocupacionEnVivo(id, f, escenarioForzado) : { ocupacion: 0, saturacion: 0, estado: 'cerrado' };
        q = { ocupacion: v.ocupacion, saturacion: v.saturacion, estado: v.estado };
      } else if (M <= m0) {
        tipo = 'ahora';
        q = { ocupacion: ahora.ocupacion, saturacion: ahora.saturacion, estado: ahora.estado };
      } else {
        tipo = 'futuro';
        const base = dia ? perfilEn(id, esc, dia, M) : null;
        if (base === null) q = { ocupacion: 0, saturacion: 0, estado: 'cerrado' };
        else {
          const oc = Math.max(0, Math.min(r.capacidad_max, Math.round(base * (1 + (ratio - 1) * Math.exp(-(M - m0) / 45)))));
          q = { ocupacion: oc, saturacion: oc / r.capacidad_max, estado: estadoZona(id, oc, oc / r.capacidad_max) };
        }
      }
      pts.push({ minuto: M, tipo, ...q });
    }
    return pts;
  }

  /** Día completo hora por hora (07:00–21:00): lo que ya pasó hoy (simulación en vivo de esa hora),
   *  la hora actual y el pronóstico del resto del día (perfil del escenario + corrección por lo observado). */
  function pronosticoDia(id, fecha, escenarioForzado) {
    const r = R(id);
    const ahora = ocupacionEnVivo(id, fecha, escenarioForzado);
    const esc = ahora.escenario, dia = DIAS_JS[fecha.getDay()], m0 = minutoDelDia(fecha);
    const ratio = ahora.abierto && ahora.base > 0.5 ? Math.max(0.6, Math.min(1.4, ahora.ocupacion / ahora.base)) : 1;
    const horas = [];
    for (let M = Math.ceil(INICIO_MIN / 60) * 60; M <= FIN_MIN; M += 60) {
      const tipo = m0 >= M && m0 < M + 60 ? 'ahora' : M < m0 ? 'pasado' : 'futuro';
      let q;
      if (tipo === 'ahora') q = { ocupacion: ahora.ocupacion, saturacion: ahora.saturacion, estado: ahora.estado };
      else if (tipo === 'pasado') {
        const f = new Date(fecha); f.setHours(M / 60, 0, 0, 0);
        const v = ocupacionEnVivo(id, f, escenarioForzado);
        q = { ocupacion: v.ocupacion, saturacion: v.saturacion, estado: v.estado };
      } else {
        const base = dia ? perfilEn(id, esc, dia, M) : null;
        if (base === null) q = { ocupacion: 0, saturacion: 0, estado: 'cerrado' };
        else {
          const oc = Math.max(0, Math.min(r.capacidad_max, Math.round(base * (1 + (ratio - 1) * Math.exp(-(M - m0) / 45)))));
          q = { ocupacion: oc, saturacion: oc / r.capacidad_max, estado: estadoZona(id, oc, oc / r.capacidad_max) };
        }
      }
      horas.push({ minuto: M, hora: horaTxt(M), tipo, ...q });
    }
    return horas;
  }

  /** Alternativas del mismo tipo con más espacio que donde estás, ordenadas por cercanía (la ocupación prevista a 30 min desempata). */
  function alternativas(id, fecha, escenarioForzado, distancias) {
    const g = grupo(id);
    if (!g) return [];
    const candidatos = Object.keys(KPI.recintos).concat(Object.keys(KPI.edificios_sim || {}));
    // Nivel del lugar donde estás (misma escala para todos los espacios)
    const origen = ocupacionEnVivo(id, fecha, escenarioForzado);
    const nivelOrigen = origen.abierto ? equivalente(id, origen.ocupacion) : 1;
    return candidatos
      .filter((o) => o !== id && grupo(o) === g)
      .map((o) => {
        const p = prediccion(o, fecha, escenarioForzado, 30);
        const fin = p.puntos.length ? p.puntos[p.puntos.length - 1] : p.ahora;
        const sat30 = fin.estado === 'cerrado' ? 1 : equivalente(o, fin.ocupacion);
        const dist = distancias ? distancias[o] : null;
        return { id: o, nombre: R(o).nombre, ahora: p.ahora, sat30, dist, esEdificio: !KPI.recintos[o],
          // Lo que manda es la cercanía; la ocupación solo desempata (lleno = +150 m equivalentes)
          puntaje: (dist || 0) + sat30 * 150 };
      })
      // Se sugiere si tiene lugar de verdad: no está llena (< 90 %) ni lo estará en 30 min,
      // y está al menos 8 puntos menos ocupada que donde estás. Un lugar al 80 % sí sirve si el tuyo está al 95 %.
      .filter((a) => a.ahora.abierto && a.ahora.estado !== 'critico' && a.sat30 < UMBRALES.critico
        && equivalente(a.id, a.ahora.ocupacion) <= nivelOrigen - 0.08)
      .sort((a, b) => a.puntaje - b.puntaje);
  }

  function grupo(id) {
    const r = R(id);
    if (r.tipo === 'edificio') return r.uso_principal === 'biblioteca' ? 'biblioteca' : null;
    return GRUPOS[r.subtipo] || null;
  }

  /** Flujo (personas que pasan por hora) alrededor de la hora dada: ocupación media de ±30 min × 60 / permanencia. */
  function flujoHora(id, fecha, escenarioForzado) {
    const r = R(id);
    const esc = escenarioPara(fecha, escenarioForzado);
    const dia = DIAS_JS[fecha.getDay()];
    const m = minutoDelDia(fecha);
    let suma = 0, n = 0;
    for (let d = -30; d <= 30; d += 5) { const v = perfilEn(id, esc, dia, m + d); if (v !== null) { suma += v; n++; } }
    if (!n || perfilEn(id, esc, dia, m) === null) return 0;
    return Math.round((suma / n) * ruido(id, fecha, m, 0.05) * 60 / (r.permanencia_min || 20));
  }

  /** Ocupación en una sola escala 0–1 para todos los espacios: en áreas abiertas la densidad se lleva
   *  a los mismos cortes que el semáforo (moderado 50 %, alto 75 %, crítico 90 %). */
  function equivalente(id, ocupacion) {
    const r = R(id), u = r.umbrales_densidad;
    if (!u) return Math.min(1, ocupacion / r.capacidad_max);
    const d = ocupacion / r.superficie_m2, xs = [0, u[0], u[1], u[2], u[2] * 1.5];
    const ys = [0, UMBRALES.moderado, UMBRALES.alto, UMBRALES.critico, 1];
    for (let k = 1; k < xs.length; k++) if (d <= xs[k]) return ys[k - 1] + (ys[k] - ys[k - 1]) * (d - xs[k - 1]) / (xs[k] - xs[k - 1]);
    return 1;
  }

  /** Conectividad: uso de la red Wi-Fi coherente con la ocupación (sigue el % de ocupación,
   *  o la densidad llevada a la misma escala en áreas abiertas, × un factor propio de la zona). */
  function wifi(id, ocupacion) {
    const r = R(id);
    const f = r.wifi_dispositivos_por_persona || 0;
    if (!f) return { aplica: false };
    const disp = Math.round(ocupacion * f);
    const cubre = r.wifi_cobertura !== undefined ? r.wifi_cobertura : !!r.wifi_ap;
    if (!cubre) return { aplica: true, cobertura: false, dispositivos: disp, saturacion: 0, estado: 'sin' };
    const eq = equivalente(id, ocupacion);
    const sat = Math.max(0, Math.min(1, eq * (r.wifi_factor || 1)));
    return { aplica: true, cobertura: true, vecina: !r.wifi_ap, dispositivos: disp, saturacion: sat, estado: estado(sat), ap: r.wifi_ap };
  }


  /** Acumulado del día hasta la hora dada (para visitas y préstamos de la Biblioteca). */
  function acumuladoDia(id, fecha, escenarioForzado) {
    const r = R(id);
    const esc = escenarioPara(fecha, escenarioForzado);
    const dia = DIAS_JS[fecha.getDay()];
    if (!dia) return 0;
    const serie = r.perfiles[esc][dia].ocupacion;
    const hasta = Math.floor((minutoDelDia(fecha) - INICIO_MIN) / PASO);
    let s = 0;
    for (let i = 0; i <= Math.min(hasta, serie.length - 1); i++) s += serie[i];
    return Math.round(s * PASO / (r.permanencia_min || 20));
  }

  /** Serie completa de un día (para gráficas y mapa de calor). */
  function serieDia(id, escenario, dia) {
    return R(id).perfiles[escenario][dia];
  }

  const api = { init, estado, estadoZona, equivalente, pronosticoDia, diaCompleto, escenarioPara, perfilEn, ocupacionEnVivo, prediccion, alternativas, serieDia, grupo, horario, flujoHora, wifi, acumuladoDia,
    horaTxt, fechaISO, minutoDelDia, DIAS_JS, ESTADOS, INICIO_MIN, FIN_MIN };
  global.Simulacion = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

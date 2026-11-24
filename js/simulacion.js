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
  const GRUPOS = { computo: 'computo', laboratorio: 'computo', biblioteca: 'estudio', estudio: 'estudio',
    descanso: 'estudio', jardin: 'estudio', plaza: 'convivencia', auditorio: 'auditorio', cafeteria: 'convivencia', estacionamiento: 'estacionamiento', motos: 'motos' };
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
      ? { codigo: 'R2', nivel: 'info', texto: 'Periodo de exámenes: se usa el perfil de alta demanda.' }
      : { codigo: 'R1', nivel: 'info', texto: 'Demanda ordinaria: se usa el perfil típico del día.' });
    const dens = !!r.umbrales_densidad;
    const val = (p) => (dens ? `${(p.ocupacion / r.superficie_m2).toFixed(2)} personas/m²` : `${Math.round(p.saturacion * 100)} %`);
    if (ahora.abierto && ahora.estado === 'critico') {
      reglas.push({ codigo: 'R3', nivel: 'critico', texto: `${dens ? 'Congestión' : 'Saturación crítica'} ahora (${val(ahora)}).` });
    } else {
      const crit = puntos.find((p) => p.estado === 'critico');
      if (crit) reglas.push({ codigo: 'R3', nivel: 'critico', texto: `Se prevé ${dens ? 'congestión' : 'saturación crítica'} a las ${crit.hora} (${val(crit)}).` });
      else {
        const alto = puntos.find((p) => p.estado === 'alto');
        if (alto) reglas.push({ codigo: 'R3', nivel: 'alto', texto: `${dens ? 'Zona concurrida' : 'Ocupación alta'} prevista a las ${alto.hora} (${val(alto)}).` });
      }
    }
    return { ahora, puntos, reglas, escenario: esc };
  }

  /** Alternativas del mismo grupo de uso, ordenadas por saturación prevista a 30 min (y distancia). */
  function alternativas(id, fecha, escenarioForzado, distancias) {
    const g = grupo(id);
    if (!g) return [];
    const candidatos = Object.keys(KPI.recintos).concat(Object.keys(KPI.edificios_sim || {}));
    return candidatos
      .filter((o) => o !== id && grupo(o) === g)
      .map((o) => {
        const p = prediccion(o, fecha, escenarioForzado, 30);
        const sat30 = p.puntos.length ? p.puntos[p.puntos.length - 1].saturacion : p.ahora.saturacion;
        const dist = distancias ? distancias[o] : null;
        return { id: o, nombre: R(o).nombre, ahora: p.ahora, sat30, dist, esEdificio: !KPI.recintos[o],
          puntaje: sat30 + (dist ? dist / 2000 : 0) };
      })
      .filter((a) => a.ahora.abierto && ['bajo', 'moderado'].includes(a.ahora.estado) && a.sat30 < UMBRALES.alto)
      .sort((a, b) => a.puntaje - b.puntaje);
  }

  function grupo(id) {
    const r = R(id);
    if (r.tipo === 'edificio') return r.uso_principal === 'biblioteca' ? 'estudio' : null;
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

  /** Conectividad: dispositivos conectados contra la capacidad de los puntos de acceso. */
  function wifi(id, ocupacion) {
    const r = R(id);
    const f = r.wifi_dispositivos_por_persona || 0;
    if (!f) return { aplica: false };
    const cap = (r.wifi_ap || 0) * KPI.meta.wifi.clientes_por_ap;
    const disp = Math.round(ocupacion * f);
    if (!cap) return { aplica: true, cobertura: false, dispositivos: disp, capacidad: 0, saturacion: 0, estado: 'sin' };
    const sat = disp / cap;
    return { aplica: true, cobertura: true, dispositivos: disp, capacidad: cap, saturacion: sat, estado: estado(sat), ap: r.wifi_ap };
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

  const api = { init, estado, estadoZona, escenarioPara, perfilEn, ocupacionEnVivo, prediccion, alternativas, serieDia, grupo, horario, flujoHora, wifi, acumuladoDia,
    horaTxt, fechaISO, minutoDelDia, DIAS_JS, ESTADOS, INICIO_MIN, FIN_MIN };
  global.Simulacion = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/* GeoSIG FI-UNAM · Visor (Leaflet) y tablero (Chart.js). Depende de js/simulacion.js
 * Capas: edificios (contexto), recintos (interiores, por nivel) y áreas comunes (exteriores). */
(function () {
  'use strict';
  const Sim = window.Simulacion;
  const VERSION = '20261124-1630';   // igual que en index.html: obliga al navegador a usar archivos de la misma versión

  const COLOR = { bajo: '#2e9e5b', moderado: '#e9c13b', alto: '#ee8a2b', critico: '#d43d3d', cerrado: '#9aa3ad', sin: '#7c6aa6' };
  const COLOR_PRIORIDAD = { alta: '#d43d3d', media: '#ee8a2b', baja: '#2e9e5b' };
  const ETQ_ESTADO = { bajo: 'Bajo', moderado: 'Moderado', alto: 'Alto', critico: 'Crítico', cerrado: 'Cerrado', sin: 'Sin cobertura' };
  const ETQ_SUBTIPO = { computo: 'Sala de cómputo', laboratorio: 'Laboratorio', biblioteca: 'Biblioteca', auditorio: 'Auditorio',
    cafeteria: 'Cafetería', sanitarios: 'Sanitarios', pasillo: 'Pasillo o andador', acceso: 'Acceso', plaza: 'Plaza o explanada',
    descanso: 'Área de descanso', estudio: 'Área de estudio', cancha: 'Cancha', estacionamiento: 'Estacionamiento',
    motos: 'Estacionamiento de motos', jardin: 'Jardín', restringida: 'Zona restringida', contexto: 'Zona de contexto', otro: 'Otro' };
  const ETQ_PLURAL = { plaza: 'plazas y explanadas', pasillo: 'pasillos y andadores', acceso: 'accesos', auditorio: 'auditorios',
    descanso: 'áreas de descanso', estudio: 'áreas de estudio', jardin: 'jardines', cancha: 'canchas', cafeteria: 'cafeterías', sanitarios: 'sanitarios' };
  const plural = (s) => ETQ_PLURAL[s] || (ETQ_SUBTIPO[s] || s).toLowerCase();
  const ETQ_LOS = { bajo: 'Libre', moderado: 'Cómodo', alto: 'Concurrido', critico: 'Congestionado', cerrado: 'Cerrado' };
  const DIAS_LARGO = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const SERIE = ['#002b5c', '#c99a2e', '#3a7bd5', '#8c5a00', '#5b6577', '#7aa6e0', '#b5651d', '#2e9e5b'];
  const RADIO_CU_M = 2500;

  const st = {
    kpi: null, edificios: null, zonas: null, escenario: 'auto', demo: null, capa: 'ocupacion', seleccion: null,
    piso: 'todas', filtro: 'todo', usuario: null, tab: 'ahora',
    capaEd: {}, capaZona: {}, vivoEd: {}, prop: {}, propEd: {}, origen: {}, centroides: {}, charts: {}, vivo: {}, play: null, centroFI: null,
  };
  let mapa, grupoEd, grupoZonas, grupoAP, grupoTramas, marcadorUsuario, circuloPrecision, lineaRuta;

  const $ = (id) => document.getElementById(id);
  const pct = (x) => `${Math.round(x * 100)} %`;
  const nombre = (id) => (st.prop[id] || st.propEd[id] || {}).nombre || id;
  const simulada = (id) => !!st.kpi.recintos[id];
  const esPark = (id) => !!(st.kpi.recintos[id] && st.kpi.recintos[id].tipo === 'estacionamiento');
  const ETQ_PARK = { bajo: 'Poca demanda', moderado: 'Mucha demanda', cerrado: 'Cerrado' };
  const esDens = (id) => !!(st.kpi.recintos[id] && st.kpi.recintos[id].umbrales_densidad);
  /** Valor a mostrar: densidad (personas/m²) en exteriores, % de capacidad en lo demás. */
  const valorTxt = (id, v) => (!v || !v.abierto ? '—' : esPark(id) ? `${v.ocupacion} veh.` : esDens(id) ? `${v.densidad.toFixed(2)} p/m²` : pct(v.saturacion));
  const estadoTxt = (id, e) => (esPark(id) ? ETQ_PARK[e] || e : esDens(id) ? ETQ_LOS[e] : ETQ_ESTADO[e]);
  const unidadTxt = (u, n) => (u === 'vehiculos' ? (n === 1 ? 'vehículo' : 'vehículos') : (n === 1 ? 'persona' : 'personas'));
  const nivelTxt = (n) => (n === 0 ? 'Planta baja' : `Nivel ${n}`);
  const est = () => '';
  const cap = (t) => (t ? String(t).charAt(0).toUpperCase() + String(t).slice(1) : t);
  /** "7.8 horas", "1 hora", "45 minutos" */
  const horasTxt = (h) => (h < 0.05 ? '0 horas' : h < 1 ? `${Math.round(h * 60)} minutos` : Math.abs(h - 1) < 0.05 ? '1 hora' : `${(Math.round(h * 10) / 10).toLocaleString('es-MX')} horas`);
  /** Artículo para un nombre de espacio: "el Edificio D", "la Biblioteca…", "los Pasillos centrales". */
  const articulo = (n) => (/^(Pasillos|Jardines|Laboratorios)\b/.test(n) ? 'los' : /^(Jardineras|Canchas)\b/.test(n) ? 'las'
    : /^(Edificio|Auditorio|Pasillo|Laboratorio|Aula|Estacionamiento|Área)\b/.test(n) ? 'el' : /^(Biblioteca|Sala|Entrada|Plaza|Zona|Explanada|Parte|Jefatura|Jardinera)\b/.test(n) ? 'la' : '');
  const conArt = (n) => (articulo(n) ? `${articulo(n)} ${n}` : n);
  /** Nombre en negritas con su artículo fuera: "la <b>Biblioteca…</b>" */
  const bArt = (n) => (articulo(n) ? `${articulo(n)} <b>${esc(n)}</b>` : `<b>${esc(n)}</b>`);
  /** Une nombres: "A", "A y B", "A, B y C" */
  const lista = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);
  /** Evita “..”: corta el punto final duplicado en textos que terminan en abreviatura (p. ej. “Auditorio Raúl J.”). */
  const limpiar = (html) => html.replace(/\.(<\/b>)?\./g, '.$1');
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ------------------------------------------------------------------ tiempo
  function ahora() {
    if (!st.demo) return new Date();
    const hoy = new Date();
    const diaHoy = hoy.getDay() === 0 ? 7 : hoy.getDay();
    const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + (st.demo.dia - diaHoy));
    d.setHours(Math.floor(st.demo.minuto / 60), st.demo.minuto % 60, 0, 0);
    return d;
  }
  const diaPerfil = (fecha) => Sim.DIAS_JS[fecha.getDay()] || 'lun';
  const escenarioActivo = () => Sim.escenarioPara(ahora(), st.escenario);

  // ------------------------------------------------------------------ carga
  async function cargar() {
    const leer = (url) => fetch(`${url}?v=${VERSION}`).then((r) => { if (!r.ok) throw new Error(url); return r.json(); });
    try {
      const [ed, rc, ac, kpi] = await Promise.all([leer('data/edificios.geojson'), leer('data/recintos.geojson'),
        leer('data/areas_comunes.geojson'), leer('data/kpi_data.json')]);
      st.edificios = ed; st.kpi = kpi;
      rc.features.forEach((f) => { st.origen[f.properties.id_recinto] = 'recinto'; });
      ac.features.forEach((f) => { st.origen[f.properties.id_recinto] = 'area'; });
      st.zonas = { type: 'FeatureCollection', features: ac.features.concat(rc.features) }; // áreas debajo, recintos encima
      st.zonas.features.forEach((f) => { st.prop[f.properties.id_recinto] = f.properties; });
      ed.features.forEach((f) => { st.propEd[f.properties.id_edificio] = f.properties; });
      Sim.init(kpi);
    } catch (e) {
      document.body.insertAdjacentHTML('afterbegin', `<div class="error-carga"><b>No se pudieron cargar los datos (${esc(e.message)}).</b><br>
        Abre el sitio desde un servidor: <code>python -m http.server 8000</code> y visita <code>http://localhost:8000</code>.</div>`);
      throw e;
    }
    if (!window.L) {
      document.querySelector('.mapa-wrap').insertAdjacentHTML('afterbegin', '<div class="error-carga">No se pudo cargar la biblioteca del mapa (Leaflet). Revisa la conexión o corre <code>python scripts/descargar_librerias.py</code>.</div>');
      return;
    }
    if (window.Chart) configurarChart();
    calcularCentroides();
    iniciarMapa();
    construirPisos();
    iniciarControles();
    iniciarExtras();
    actualizar();
    programarMinuto();
  }

  function anilloExterior(geom) { return geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0]; }
  function calcularCentroides() {
    const c = (f) => { const a = anilloExterior(f.geometry).slice(0, -1); return [a.reduce((s, p) => s + p[1], 0) / a.length, a.reduce((s, p) => s + p[0], 0) / a.length]; };
    st.zonas.features.forEach((f) => { st.centroides[f.properties.id_recinto] = c(f); });
    st.edificios.features.forEach((f) => { st.centroides['ed:' + f.properties.id_edificio] = c(f); });
    const todos = Object.values(st.centroides);
    st.centroFI = [todos.reduce((s, p) => s + p[0], 0) / todos.length, todos.reduce((s, p) => s + p[1], 0) / todos.length];
  }

  // ------------------------------------------------------------------ mapa
  function iniciarMapa() {
    mapa = L.map('mapa', { zoomControl: true, maxZoom: 20, tap: true });
    mapa.createPane('pEdificios').style.zIndex = 405;
    mapa.createPane('pAreas').style.zIndex = 410;
    mapa.createPane('pRecintos').style.zIndex = 420;
    let cargadas = 0, fallidas = 0;
    const base = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
    base.on('tileload', () => { cargadas++; document.body.classList.remove('sin-basemap'); });
    base.on('tileerror', () => {
      fallidas++;
      if (fallidas === 4 && cargadas === 0) { document.body.classList.add('sin-basemap'); toast('Sin conexión: el mapa de fondo no está disponible.', 5000); }
    });

    grupoEd = L.geoJSON(st.edificios, {
      pane: 'pEdificios',
      style: () => ({ weight: 1, color: '#7d8aa0', fillColor: '#c9d2df', fillOpacity: 0.9 }),
      onEachFeature: (f, capa) => {
        const id = f.properties.id_edificio;
        st.capaEd[id] = capa;
        capa.bindTooltip(id.length <= 3 ? id : esc(f.properties.nombre), { permanent: true, direction: 'center', className: 'etq-ed' });
        capa.on('click', (e) => { L.DomEvent.stopPropagation(e); ponerPunto(e.latlng); seleccionarEdificio(id, true); });
      },
    }).addTo(mapa);

    grupoZonas = L.geoJSON(st.zonas, {
      pane: 'pAreas',
      onEachFeature: (f, capa) => {
        const id = f.properties.id_recinto;
        if (st.origen[id] === 'recinto') capa.options.pane = 'pRecintos';
        st.capaZona[id] = capa;
        if (simulada(id)) capa.bindTooltip('', { permanent: true, direction: 'center', className: 'etq' });
        capa.on('click', (e) => { L.DomEvent.stopPropagation(e); ponerPunto(e.latlng); seleccionar(id, true); });
      },
    }).addTo(mapa);

    // Tramas por tipo de espacio (encima del color de saturación, sin taparlo)
    crearTramas();
    st.capaTrama = {};
    grupoTramas = L.layerGroup().addTo(mapa);
    st.zonas.features.forEach((f) => {
      const id = f.properties.id_recinto, tr = tramaDe(id);
      if (st.origen[id] === 'recinto') {   // recinto: doble línea (azul por fuera, blanca al centro)
        st.capaTrama[id] = L.geoJSON(f, { pane: 'pRecintos', interactive: false, style: { fill: false, color: '#ffffff', weight: 1.4 } });
        grupoTramas.addLayer(st.capaTrama[id]);
        return;
      }
      if (!tr) return;
      st.capaTrama[id] = L.geoJSON(f, { pane: st.origen[id] === 'recinto' ? 'pRecintos' : 'pAreas', interactive: false,
        style: { stroke: false, fillColor: `url(#t-${tr})`, fillOpacity: 1 } });
      grupoTramas.addLayer(st.capaTrama[id]);
      if (tr === 'park') {
        const c = st.centroides[id];
        st.marcaPark = st.marcaPark || {};
        grupoTramas.addLayer(st.marcaPark[id] = L.marker(c, { pane: 'pRecintos', interactive: false, keyboard: false,
          icon: L.divIcon({ className: '', html: `<span class="ico-park">${st.prop[id].subtipo === 'motos' ? 'P<small>Motos</small>' : 'P'}</span>`, iconSize: [26, 26], iconAnchor: [13, 34] }) }));
      }
    });

    // Antenas Wi-Fi: un distintivo por edificio (la asignación por edificio es la parte confiable del dato oficial)
    const red_ = st.kpi.red_pcpuma;
    if (red_) {
      const ICONO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 8.8a15 15 0 0 1 20 0M5.5 12.3a10 10 0 0 1 13 0M9 15.8a5 5 0 0 1 6 0" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="19.5" r="1.8" fill="currentColor"/></svg>';
      grupoAP = L.layerGroup(Object.entries(red_.ap_por_edificio).filter(([e, n]) => st.propEd[e] && n).map(([e]) => {
        const ed = st.propEd[e], pt = ed.punto_etiqueta || [st.centroides['ed:' + e][1], st.centroides['ed:' + e][0]];
        st.marcaAP = st.marcaAP || {};
        return st.marcaAP[e] = L.marker([pt[1], pt[0]], { pane: 'pRecintos', icon: L.divIcon({ className: '', html: `<span class="ap-badge">${ICONO}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }) })
          .bindTooltip(`<b>${esc(ed.nombre)}</b><br>Con Wi-Fi de la Red PC-PUMA`, { direction: 'top', offset: [0, -14] })
          .on('click', () => seleccionarEdificio(e));
      }));
    }
    st.limites = grupoEd.getBounds();
    mapa.fitBounds(st.limites, { padding: [20, 20] });
    const zoomCls = () => { const z = mapa.getZoom(); document.body.classList.toggle('zoom-lejos', z < 18); document.body.classList.toggle('zoom-muy-lejos', z < 17); };
    mapa.on('zoomend', zoomCls); zoomCls();
    mapa.on('click', (e) => { if (st.gpsId != null) detenerGPS('Seguimiento GPS detenido: usamos el punto que tocaste'); fijarUsuario(e.latlng, 'manual'); });
  }

  /** Tipo de trama: circulación (rayas), estancia (puntos), áreas verdes (pasto), estacionamientos (cuadrícula). */
  function tramaDe(id) {
    const p = st.prop[id];
    if (st.origen[id] === 'recinto' || p.subtipo === 'restringida' || p.subtipo === 'contexto') return null;
    if (p.tipo === 'estacionamiento') return 'park';
    if (['pasillo', 'acceso'].includes(p.subtipo)) return 'circ';
    if (p.tipo === 'area_verde' || p.subtipo === 'jardin') return 'verde';
    return 'estancia';
  }
  function crearTramas() {
    if (document.getElementById('defs-tramas')) return;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('id', 'defs-tramas'); svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.innerHTML = `<defs>
      <pattern id="t-circ" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="9" stroke="rgba(20,30,50,.5)" stroke-width="2"/></pattern>
      <pattern id="t-estancia" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="5" cy="5" r="1.7" fill="rgba(20,30,50,.6)"/></pattern>
      <pattern id="t-verde" width="14" height="12" patternUnits="userSpaceOnUse"><path d="M3 10 l2 -5 l2 5 M9 4 l2 -4 l2 4" fill="none" stroke="rgba(20,80,30,.7)" stroke-width="1.4" stroke-linecap="round"/></pattern>
      <pattern id="t-park" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M0 0 H12 M0 0 V12" stroke="rgba(255,255,255,.75)" stroke-width="1.6"/></pattern>
    </defs>`;
    document.body.appendChild(svg);
  }
  const MUESTRA = (tr, fondo, borde, w, dash) => `<svg class="muestra" viewBox="0 0 22 14"><rect x="1" y="1" width="20" height="12" rx="2" fill="${fondo}" stroke="${borde || '#9aa3ad'}" stroke-width="${w || 1}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>${tr ? `<rect x="1" y="1" width="20" height="12" rx="2" fill="url(#t-${tr})"/>` : ''}</svg>`;

  function visible(id) {
    const p = st.prop[id];
    if (st.piso === 'todas') return true;
    return (p.nivel || 0) === st.piso && (st.origen[id] === 'recinto' || st.piso === 0);
  }

  function estiloZona(id) {
    const p = st.prop[id], sel = st.seleccion === id, rec = st.origen[id] === 'recinto';
    const borde = sel ? { color: '#c99a2e', weight: 5 } : rec ? { color: '#002b5c', weight: 4.5 } : { color: '#ffffff', weight: 1.2 };
    if (!simulada(id)) {
      const verde = p.tipo === 'area_verde';
      return { ...borde, fillColor: verde ? '#9fd19a' : '#dfe3e8', fillOpacity: verde ? 0.55 : 0.5, dashArray: verde ? null : '4 4', color: sel ? '#c99a2e' : (verde ? '#7fbf79' : '#b8bec7') };
    }
    const dash = p.tipo === 'estacionamiento' ? '5 4' : null;
    if (st.capa === 'wifi') {
      const w = Sim.wifi(id, st.vivo[id].ocupacion);
      const c = !w.aplica ? '#e3e7ee' : !st.vivo[id].abierto ? COLOR.cerrado : COLOR[w.estado];
      return { ...borde, dashArray: dash, fillColor: c, fillOpacity: w.aplica ? (rec ? 0.8 : 0.55) : 0.25 };
    }
    return { ...borde, dashArray: dash, fillColor: COLOR[st.vivo[id].estado], fillOpacity: rec ? 0.85 : 0.5 };
  }

  const ICONO_WIFI = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 8.8a15 15 0 0 1 20 0M5.5 12.3a10 10 0 0 1 13 0M9 15.8a5 5 0 0 1 6 0" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="19.5" r="1.8" fill="currentColor"/></svg>';

  function estiloEdificio(id) {
    const sel = st.seleccion === 'ed:' + id;
    const ed = st.propEd[id];
    const sinPiso = typeof st.piso === 'number' && st.piso >= ed.niveles;
    let fill = '#c9d2df';
    if (st.capa === 'wifi') {
      const v = st.vivoEd[id], w = v ? Sim.wifi(id, v.ocupacion) : null;
      const c = !w || !w.aplica || !w.cobertura ? '#e3e7ee' : !v.abierto ? COLOR.cerrado : COLOR[w.estado];
      return { fillColor: c, fillOpacity: w && w.cobertura ? (sinPiso ? 0.15 : 0.42) : 0.6, color: sel ? '#c99a2e' : '#2f3a4d', weight: sel ? 5 : 2.2, dashArray: w && w.cobertura ? null : '4 3' };
    }
    if (st.capa === 'ocupacion' && st.vivoEd[id]) {
      return { fillColor: COLOR[st.vivoEd[id].estado], fillOpacity: sinPiso ? 0.15 : 0.42, color: sel ? '#c99a2e' : '#2f3a4d', weight: sel ? 5 : 2.2 };
    }
    return { fillColor: fill, fillOpacity: sinPiso ? 0.25 : 0.9, color: sel ? '#c99a2e' : '#7d8aa0', weight: sel ? 5 : 1 };
  }

  function pintarMapa() {
    if (grupoAP) { if (st.capa === 'wifi' && !mapa.hasLayer(grupoAP)) grupoAP.addTo(mapa); if (st.capa !== 'wifi' && mapa.hasLayer(grupoAP)) mapa.removeLayer(grupoAP); }
    // Planta elegida: solo los edificios que llegan a ese nivel (y sus antenas)
    const alcanza = (e) => st.piso === 'todas' || st.propEd[e].niveles > st.piso;
    const sync = (grupo, capa, ver) => { if (!capa || !grupo) return; if (ver && !grupo.hasLayer(capa)) grupo.addLayer(capa); if (!ver && grupo.hasLayer(capa)) grupo.removeLayer(capa); };
    Object.keys(st.capaEd).forEach((id) => sync(grupoEd, st.capaEd[id], alcanza(id)));
    Object.keys(st.marcaAP || {}).forEach((e) => sync(grupoAP, st.marcaAP[e], alcanza(e)));
    Object.keys(st.marcaPark || {}).forEach((id) => sync(grupoTramas, st.marcaPark[id], visible(id)));
    Object.keys(st.capaEd).forEach((id) => {
      if (!alcanza(id)) return;
      st.capaEd[id].setStyle(estiloEdificio(id));
      const v = st.vivoEd[id], et = id.length <= 3 ? id : st.propEd[id].nombre;
      let extra = '';
      if (v && v.abierto && st.capa === 'ocupacion') extra = pct(v.saturacion);
      if (v && v.abierto && st.capa === 'wifi') { const w = Sim.wifi(id, v.ocupacion); if (w.aplica && w.cobertura) extra = pct(w.saturacion); }
      st.capaEd[id].setTooltipContent(extra ? `${esc(et)} <small>${extra}</small>` : esc(et));
    });
    Object.keys(st.capaZona).forEach((id) => {
      const capa = st.capaZona[id];
      const ver = visible(id);
      if (ver && !grupoZonas.hasLayer(capa)) grupoZonas.addLayer(capa);
      if (!ver && grupoZonas.hasLayer(capa)) grupoZonas.removeLayer(capa);
      const tr = st.capaTrama && st.capaTrama[id];
      if (tr) { if (ver && !grupoTramas.hasLayer(tr)) grupoTramas.addLayer(tr); if (!ver && grupoTramas.hasLayer(tr)) grupoTramas.removeLayer(tr); }
      if (!ver) return;
      capa.setStyle(estiloZona(id));
      if (simulada(id)) {
        const v = st.vivo[id];
        let txt = valorTxt(id, v);
        if (st.capa === 'wifi') { const w = Sim.wifi(id, v.ocupacion); txt = !w.aplica ? '' : !w.cobertura ? 'Sin señal' : (v.abierto ? pct(w.saturacion) : '—'); }
        capa.setTooltipContent(esClave(id) && txt ? `★ ${txt}` : txt);
      }
    });
    const ley = $('leyenda');
    if (!ley.dataset.lista) {
      ley.dataset.lista = '1';
      if (window.innerWidth < 700 || $('mapa').clientHeight < 560) ley.classList.add('plegada');
      ley.addEventListener('click', () => ley.classList.toggle('plegada'));
    }
    const base = '<div class="ley-sep"></div><div class="tit">Tipo de espacio</div>' +
      `<div>${MUESTRA(null, '#fff', '#2f3a4d', 2.2)}Edificio</div>` +
      '<div><svg class="muestra" viewBox="0 0 22 14"><rect x="2" y="2" width="18" height="10" rx="2" fill="#fff" stroke="#002b5c" stroke-width="3.5"/><rect x="2" y="2" width="18" height="10" rx="2" fill="none" stroke="#fff" stroke-width="1"/></svg>Recinto</div>' +
      `<div>${MUESTRA('circ', '#fff')}Pasillo o acceso</div>` +
      `<div>${MUESTRA('estancia', '#fff')}Plaza o descanso</div>` +
      `<div>${MUESTRA('verde', '#fff')}Jardín</div>` +
      `<div><span class="ico-park mini">P</span>Estacionamiento</div>` +
      `<div>${MUESTRA(null, '#fff', '#9aa3ad', 1, '3 2')}Sin monitoreo</div>` +
      '<div><span class="ley-estrella">★</span>Salas PC-PUMA, bibliotecas y laboratorios de Geomática</div>';
    const u = st.kpi.meta.umbrales, P = (x) => Math.round(x * 100);
    const escala = ['bajo', 'moderado', 'alto', 'critico'].map((e, k) =>
      `<div><i style="background:${COLOR[e]}"></i>${[`&lt; ${P(u.moderado)} %`, `${P(u.moderado)}–${P(u.alto)} %`, `${P(u.alto)}–${P(u.critico)} %`, `≥ ${P(u.critico)} %`][k]}</div>`).join('');
    if (st.capa === 'wifi') {
      ley.innerHTML = '<div class="tit">Uso del Wi-Fi</div>' + escala +
        `<div><i style="background:${COLOR.sin}"></i>Sin cobertura</div>` +
        '<div><span class="ap-badge ap-ley">' + ICONO_WIFI + '</span>Antenas Wi-Fi</div>' + base;
    } else {
      ley.innerHTML = '<div class="tit">Ocupación</div>' + escala +
        `<div><i style="background:${COLOR.cerrado}"></i>Cerrado</div>` + base;
    }
  }

  // ------------------------------------------------------------------ pisos
  function construirPisos() {
    const conRec = new Set(Object.keys(st.prop).filter((id) => st.origen[id] === 'recinto').map((id) => st.prop[id].nivel || 0));
    const max = Math.max(0, ...conRec);
    const niveles = Array.from({ length: max + 1 }, (_, k) => max - k);
    const html = ['<span class="pisos-tit">Planta</span>', '<button class="piso activo" data-piso="todas">Todas</button>']
      .concat(niveles.map((n) => `<button class="piso" data-piso="${n}" title="${nivelTxt(n)}">${n === 0 ? 'PB' : n}</button>`)).join('');
    $('pisos').innerHTML = html;
    $('pisos').addEventListener('click', (e) => {
      const b = e.target.closest('[data-piso]');
      if (!b) return;
      st.piso = b.dataset.piso === 'todas' ? 'todas' : Number(b.dataset.piso);
      document.querySelectorAll('.piso').forEach((x) => x.classList.toggle('activo', x === b));
      const n = st.piso === 'todas' ? 0 : Object.keys(st.propEd).filter((e) => st.propEd[e].niveles > st.piso).length;
      toast(st.piso === 'todas' ? 'Todas las plantas' : `${nivelTxt(st.piso)} · ${n} edificios`, 1500);
      actualizar();
    });
  }

  // ------------------------------------------------------------------ ubicación
  function distanciaM(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function dentroAnillo(lat, lon, a) {
    let c = false;
    for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
      const [xi, yi] = a[i], [xj, yj] = a[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function dentro(lat, lon, geom) {
    const polis = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    return polis.some((p) => dentroAnillo(lat, lon, p[0]) && !p.slice(1).some((h) => dentroAnillo(lat, lon, h)));
  }
  function distanciasUsuario() {
    if (!st.usuario) return null;
    const d = {};
    Object.entries(st.centroides).forEach(([id, c]) => { d[id] = distanciaM(st.usuario, c); if (id.startsWith('ed:')) d[id.slice(3)] = d[id]; });
    return d;
  }

  /** Tocar el mapa: el punto del usuario queda donde tocó. */
  function ponerPunto(latlng) {
    if (st.gpsId != null) detenerGPS('Seguimiento GPS detenido: usamos el punto que tocaste');
    st.usuario = [latlng.lat, latlng.lng];
    const icono = L.divIcon({ className: '', html: '<div class="usuario-pin"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
    if (!marcadorUsuario) marcadorUsuario = L.marker(latlng, { icon: icono, zIndexOffset: 1000 }).addTo(mapa).bindTooltip('Tú');
    else marcadorUsuario.setLatLng(latlng);
    if (circuloPrecision) { mapa.removeLayer(circuloPrecision); circuloPrecision = null; }
    if (lineaRuta) { mapa.removeLayer(lineaRuta); lineaRuta = null; }
  }

  function fijarUsuario(latlng, fuente, precision) {
    st.usuario = [latlng.lat, latlng.lng];
    const icono = L.divIcon({ className: '', html: '<div class="usuario-pin"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
    if (!marcadorUsuario) marcadorUsuario = L.marker(latlng, { icon: icono, zIndexOffset: 1000 }).addTo(mapa).bindTooltip('Tú');
    else marcadorUsuario.setLatLng(latlng);
    if (circuloPrecision) { mapa.removeLayer(circuloPrecision); circuloPrecision = null; }
    if (precision) circuloPrecision = L.circle(latlng, { radius: precision, color: '#c99a2e', weight: 1, fillOpacity: 0.12 }).addTo(mapa);
    const dFI = distanciaM(st.usuario, st.centroFI);
    if (fuente === 'gps' && dFI > RADIO_CU_M) { toast(`Estás a ${(dFI / 1000).toFixed(1)} km de la FI. Toca el mapa donde estás.`, 6000); return; }
    const zona = st.zonas.features.filter((f) => visible(f.properties.id_recinto)).reverse()
      .find((f) => dentro(st.usuario[0], st.usuario[1], f.geometry));
    const edif = st.edificios.features.find((f) => dentro(st.usuario[0], st.usuario[1], f.geometry));
    if (lineaRuta) { mapa.removeLayer(lineaRuta); lineaRuta = null; }
    if (fuente === 'seguimiento') {   // GPS en movimiento: solo avisar cuando cambias de zona
      const zid = zona ? zona.properties.id_recinto : edif ? 'ed:' + edif.properties.id_edificio : null;
      if (zid !== st.zonaGPS) {
        st.zonaGPS = zid;
        if (zona) { toast(`Estás en: ${zona.properties.nombre}`, 3000); seleccionar(zona.properties.id_recinto, true); }
        else if (edif) { toast(`Estás en: ${edif.properties.nombre}`, 3000); seleccionarEdificio(edif.properties.id_edificio, true); }
        else actualizar();
      } else pintarAviso(ahora());
      return;
    }
    if (zona) { toast(`Estás en: ${zona.properties.nombre}`, 3500); seleccionar(zona.properties.id_recinto); }
    else if (edif) { toast(`Estás en: ${edif.properties.nombre}`, 3500); seleccionarEdificio(edif.properties.id_edificio); }
    else {
      const d = distanciasUsuario();
      const cerca = Object.keys(d).filter((k) => !k.startsWith('ed:')).sort((a, b) => d[a] - d[b])[0];
      toast(`Zona más cercana: ${nombre(cerca)} (${Math.round(d[cerca])} m)`, 3500);
      actualizar();
    }
  }

  /** Zona (o edificio) donde está el usuario. */
  function zonaDelUsuario() {
    if (!st.usuario) return null;
    const [la, lo] = st.usuario;
    const z = st.zonas.features.filter((f) => visible(f.properties.id_recinto) && simulada(f.properties.id_recinto)).reverse()
      .find((f) => dentro(la, lo, f.geometry));
    if (z) return { id: z.properties.id_recinto, ed: false };
    const e = st.edificios.features.find((f) => dentro(la, lo, f.geometry));
    return e ? { id: e.properties.id_edificio, ed: true } : null;
  }

  /** Si la zona del usuario está saturada (ahora o en la próxima hora), propone alternativas cercanas con espacio. */
  function sugerencia(t) {
    const z = zonaDelUsuario();
    if (!z) return null;
    const v = z.ed ? st.vivoEd[z.id] : st.vivo[z.id];
    if (!v) return null;
    const pr = Sim.prediccion(z.id, t, st.escenario);
    const r3 = pr.reglas.find((r) => r.codigo === 'R3' && r.nivel === 'critico');
    const saturada = v.abierto && (['alto', 'critico'].includes(v.estado) || r3);
    const d = distanciasUsuario();
    const alts = saturada ? Sim.alternativas(z.id, t, st.escenario, d) : [];   // solo del mismo tipo
    return { z, v, saturada, motivo: r3 ? r3.texto : null, alts: alts.slice(0, 2) };
  }

  function pintarSugerencia(t) {
    const caja = $('sugerencia');
    const sg = sugerencia(t);
    if (!sg) { caja.hidden = true; return; }
    const nom = sg.z.ed ? st.propEd[sg.z.id].nombre : nombre(sg.z.id);
    const val = sg.z.ed ? pct(sg.v.saturacion) : valorTxt(sg.z.id, sg.v);
    caja.hidden = false;
    caja.className = `sugerencia ${sg.saturada ? 'sat' : 'ok'}`;
    caja.innerHTML = `<div class="sug-cab">📍 Estás en <b>${esc(nom)}</b> · <span class="chip ${sg.v.estado}">${sg.v.abierto ? val : 'Cerrado'}</span></div>` +
      (sg.saturada
        ? `<p>${sg.motivo ? esc(sg.motivo) : 'Esta zona está muy ocupada.'} ${sg.alts.length ? 'Te sugerimos:' : 'No hay alternativas cercanas con espacio en este momento.'}</p>` +
          sg.alts.map((a) => `<button class="fila" ${a.esEdificio ? `data-ed="${a.id}"` : `data-ir="${a.id}"`}><span><span class="nom">${esc(a.nombre)}</span><br>
            <span class="meta">${valorTxt(a.id, a.ahora)} ahora${a.dist ? ` · A ${Math.round(a.dist)} m` : ''}</span></span><span class="chip ${a.ahora.estado}">Ir</span></button>`).join('')
        : '<p>Hay espacio aquí: no necesitas moverte.</p>');
  }

  /** Espacios públicos donde tiene sentido sugerir moverse (no salones ni laboratorios). */
  function espacioPublico(z) {
    if (!z) return false;
    return ['computo', 'biblioteca', 'recreativo'].includes(Sim.grupo(z.id));
  }

  const TIPO_SUG = { biblioteca: 'otras bibliotecas', computo: 'otras salas PC-PUMA', recreativo: 'otras áreas recreativas' };
  /** Ventana sobre el mapa: si estás en un espacio público saturado, sugiere el más cercano con lugar. */
  function pintarAviso(t) {
    const caja = $('aviso');
    const sg = st.usuario ? sugerencia(t) : null;
    if (!sg || !sg.saturada || !espacioPublico(sg.z)) { caja.hidden = true; st.avisoCerrado = null; return; }
    const clave = (sg.z.ed ? 'ed:' : '') + sg.z.id;
    if (st.avisoCerrado === clave) { caja.hidden = true; return; }
    const nom = sg.z.ed ? st.propEd[sg.z.id].nombre : nombre(sg.z.id);
    const val = sg.z.ed ? pct(sg.v.saturacion) : valorTxt(sg.z.id, sg.v);
    const a0 = sg.alts[0];
    caja.hidden = false;
    caja.innerHTML = `<button class="aviso-x" aria-label="Cerrar aviso">✕</button>
      <div class="aviso-cab" data-clave="${clave}"><span class="aviso-ico">!</span><span><b>${esc(nom)}</b> está ${sg.v.estado === 'critico' ? 'lleno' : 'casi lleno'} <span class="chip ${sg.v.estado}">${val}</span></span></div>` +
      (a0 ? `<p class="aviso-txt">Te sugerimos ir a:</p>` + sg.alts.map((a, k) => `<button class="aviso-alt${k === 0 ? ' prim' : ''}" ${a.esEdificio ? `data-ed="${a.id}"` : `data-ir="${a.id}"`}>
          <span><b>${esc(a.nombre)}</b><br><small>${a.dist ? `A ${Math.round(a.dist)} m, unos ${Math.max(1, Math.round(a.dist / 75))} min caminando · ` : ''}${valorTxt(a.id, a.ahora)} ahora</small></span>
          <span class="chip ${a.ahora.estado}">Ir</span></button>`).join('')
        : `<p class="aviso-txt">No hay ${TIPO_SUG[Sim.grupo(sg.z.id)] || 'lugares del mismo tipo'} con espacio en este momento.</p>`);
    caja.querySelector('.aviso-x').onclick = () => { st.avisoCerrado = clave; caja.hidden = true; };
  }

  function dibujarRuta(id, esEd) {
    const c = esEd ? st.centroides['ed:' + id] : st.centroides[id];
    if (!c || !st.usuario) return;
    const zu = zonaDelUsuario();
    if (zu) { st.avisoCerrado = (zu.ed ? 'ed:' : '') + zu.id; $('aviso').hidden = true; }
    if (lineaRuta) mapa.removeLayer(lineaRuta);
    lineaRuta = L.polyline([st.usuario, c], { color: '#c99a2e', weight: 5, dashArray: '10 8', opacity: 0.95 }).addTo(mapa);
    const dist = Math.round(distanciaM(st.usuario, c));
    toast(`A ${dist} m, unos ${Math.max(1, Math.round(dist / 75))} min caminando`, 5000);
    if (esEd) seleccionarEdificio(id); else seleccionar(id);
    mapa.fitBounds(L.latLngBounds([st.usuario, c]), { padding: [80, 80], maxZoom: 19 });
  }

  /** GPS: el botón activa el seguimiento continuo; tu punto, la zona y las sugerencias se actualizan al moverte. */
  function usarGPS() {
    if (st.gpsId != null) { detenerGPS('Seguimiento GPS detenido'); return; }
    if (!('geolocation' in navigator)) { toast('Este navegador no permite geolocalización. Toca el mapa donde estás.', 4000); return; }
    if (!window.isSecureContext) { toast('El GPS no está disponible en esta conexión. Toca el mapa donde estás.', 5000); return; }
    toast('Buscando tu ubicación…', 0);
    let primera = true;
    st.zonaGPS = undefined;
    st.gpsId = navigator.geolocation.watchPosition(
      (p) => {
        const ll = L.latLng(p.coords.latitude, p.coords.longitude);
        if (distanciaM([ll.lat, ll.lng], st.centroFI) > RADIO_CU_M) {
          detenerGPS(`Estás a ${(distanciaM([ll.lat, ll.lng], st.centroFI) / 1000).toFixed(1)} km de la FI. Toca el mapa donde estás.`); return;
        }
        if (primera) { primera = false; mapa.setView(ll, Math.max(mapa.getZoom(), 18)); }
        fijarUsuario(ll, 'seguimiento', p.coords.accuracy);
      },
      (e) => detenerGPS(e.code === 1 ? 'Permiso de ubicación denegado. Toca el mapa donde estás.' : 'No se obtuvo la ubicación. Toca el mapa donde estás.'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
    $('btn-ubicacion').classList.add('activo');
    $('btn-ubicacion').textContent = '📍 Siguiéndote';
  }
  function detenerGPS(msg) {
    if (st.gpsId != null && navigator.geolocation) navigator.geolocation.clearWatch(st.gpsId);
    st.gpsId = null;
    $('btn-ubicacion').classList.remove('activo');
    $('btn-ubicacion').textContent = '📍 Mi ubicación';
    if (msg) toast(msg, 4000);
  }

  // ------------------------------------------------------------------ actualización
  function actualizar() {
    const t = ahora();
    st.hoyCache = {};
    Object.keys(st.kpi.recintos).forEach((id) => { st.vivo[id] = Sim.ocupacionEnVivo(id, t, st.escenario); });
    Object.keys(st.kpi.edificios_sim || {}).forEach((id) => { st.vivoEd[id] = Sim.ocupacionEnVivo(id, t, st.escenario); });
    $('reloj-hora').textContent = Sim.horaTxt(t.getHours() * 60 + t.getMinutes());
    $('reloj-dia').textContent = `${cap(DIAS_LARGO[t.getDay()])} ${t.getDate()}/${t.getMonth() + 1}`;
    $('badge-demo').hidden = !st.demo;
    // Cada parte se pinta por separado: si una falla, las demás (y la ficha) siguen funcionando
    const paso = (f) => { try { f(); } catch (e) { console.error('GeoSIG:', e); } };
    paso(pintarMapa);
    paso(() => pintarAhora(t));
    paso(() => pintarSugerencia(t));
    paso(() => pintarAviso(t));
    if (st.tab === 'cuellos') paso(() => pintarCuellos(t));
    if (st.tab === 'generales') paso(() => pintarGenerales(t));
    if (st.tab === 'mantto') paso(pintarMantto);
    paso(pulirTextos);
    if (st.seleccion) paso(() => (st.seleccion.startsWith('ed:') ? pintarEdificio(st.seleccion.slice(3), t) : pintarDetalle(st.seleccion, t)));
  }

  function programarMinuto() {
    const tick = () => { $('prox-act').textContent = st.demo ? '(en pausa mientras eliges otra hora)' : `(próxima en ${60 - new Date().getSeconds()} s)`; };
    tick(); setInterval(tick, 1000);
    const alinear = () => setTimeout(() => { if (!st.demo) actualizar(); alinear(); }, (60 - new Date().getSeconds()) * 1000 + 50);
    alinear();
  }

  // ------------------------------------------------------------------ pestaña "Ahora"
  function categoria(id) {
    if (st.prop[id].tipo === 'estacionamiento') return 'estacionamientos';
    return st.origen[id] === 'recinto' ? 'recintos' : 'areas';
  }
  function ubicacionTxt(p) {
    if (p.id_edificio) return `${st.propEd[p.id_edificio] ? st.propEd[p.id_edificio].nombre : p.id_edificio} · ${nivelTxt(p.nivel || 0)}`;
    return `Exterior · Conjunto ${p.conjunto === 'norte' ? 'Norte' : 'Sur'}`;
  }

  function pintarAhora(t) {
    const ids = Object.keys(st.kpi.recintos);
    const ab = ids.filter((id) => st.vivo[id].abierto);
    const suma = (f) => ab.filter(f).reduce((s, id) => s + st.vivo[id].ocupacion, 0);
    const cajones = ids.filter((id) => categoria(id) === 'estacionamientos');
    const capCaj = cajones.reduce((s, id) => s + st.kpi.recintos[id].capacidad_max, 0);
    const eds = Object.keys(st.vivoEd);
    const enFI = eds.reduce((s_, e) => s_ + (st.vivoEd[e].abierto ? st.vivoEd[e].ocupacion : 0), 0) + suma((id) => categoria(id) === 'areas');
    const llenasN = ab.filter((id) => ['alto', 'critico'].includes(st.vivo[id].estado) && !esPark(id)).length;
    // Indicadores clave del alcance: salas PC-PUMA, horas pico de la Biblioteca, laboratorios de Geomática y tráfico
    const salas = ids.filter((id) => st.prop[id].subtipo === 'computo');
    const ocS = salas.reduce((a, id) => a + st.vivo[id].ocupacion, 0), capS = salas.reduce((a, id) => a + st.vivo[id].capacidad, 0);
    const salaTop = salas.slice().sort((a, b) => st.vivo[b].saturacion - st.vivo[a].saturacion)[0];
    const bib = ids.find((id) => st.prop[id].subtipo === 'biblioteca');
    const picosBib = bib ? horasPico(bib) : [];
    const labs = LABS_GEO.filter((id) => st.vivo[id]);
    const enUso = labs.filter((id) => st.vivo[id].abierto && st.vivo[id].ocupacion >= 4);
    const labTop = labs.slice().sort((a, b) => st.vivo[b].ocupacion - st.vivo[a].ocupacion)[0];
    const ocL = labs.reduce((a, id) => a + st.vivo[id].ocupacion, 0), capL = labs.reduce((a, id) => a + st.vivo[id].capacidad, 0);
    const trafico = ids.filter((id) => ['pasillo', 'acceso', 'plaza'].includes(st.prop[id].subtipo) && st.vivo[id].abierto)
      .reduce((a, id) => a + Sim.flujoHora(id, t, st.escenario), 0);
    const card = (attr, titulo, valor, sub, extra = '') => `<button class="kpi kpi-btn${extra}" ${attr}><span class="kpi-t">${titulo}</span><span class="kpi-v">${valor}</span><span class="kpi-l">${sub}</span></button>`;
    $('kpis-clave').innerHTML = !ab.length ? '' :
      card(salaTop ? `data-ir="${salaTop}"` : '', 'Salas PC-PUMA', capS ? pct(ocS / capS) : '—', `Ocupación ahora · ${ocS} de ${capS} lugares`) +
      card(bib ? `data-ir="${bib}"` : '', 'Horas pico de la Biblioteca', picosBib.length ? lista(picosBib.map((q) => q.hora)) : '—', bib ? `Ahora ${valorTxt(bib, st.vivo[bib])}` : '', ' destacado') +
      card(labTop ? `data-ir="${labTop}"` : '', 'Laboratorios de Geomática', `${enUso.length} de ${labs.length}`, `Con grupo ahora · ${capL ? pct(ocL / capL) : '—'} de ocupación`) +
      card('data-guia-tab="generales"', 'Tráfico en áreas comunes', Math.round(trafico).toLocaleString('es-MX'), 'Personas que pasan por hora');
    $('resumen-linea').innerHTML = `${enFI.toLocaleString('es-MX')} personas en la Facultad · ${capCaj ? suma((id) => categoria(id) === 'estacionamientos').toLocaleString('es-MX') : '0'} vehículos · ${llenasN} ${llenasN === 1 ? 'zona casi llena' : 'zonas casi llenas'} · ${escenarioActivo() === 'examenes' ? 'Periodo de exámenes' : 'Demanda ordinaria'}`;

    const alertas = [];
    ab.forEach((id) => {
      Sim.prediccion(id, t, st.escenario).reglas.filter((r) => r.codigo === 'R3' && r.nivel === 'critico').forEach((r) => alertas.push({ id, r }));
    });
    eds.filter((e) => st.vivoEd[e].abierto).forEach((e) => {
      Sim.prediccion(e, t, st.escenario).reglas.filter((r) => r.codigo === 'R3' && r.nivel === 'critico').forEach((r) => alertas.push({ id: e, r, ed: true }));
    });
    const pesoAlerta = (a) => (a.ed ? 1 : categoria(a.id) === 'recintos' ? 0 : 2);
    alertas.sort((a, b) => pesoAlerta(a) - pesoAlerta(b));
    $('lista-alertas').innerHTML = !ab.length
      ? '<div class="alerta info">Fuera del horario de servicio (7:00 a 21:00). Usa “Elegir hora” para explorar el día.</div>'
      : alertas.slice(0, 4).map(({ id, r, ed }) => `<div class="alerta critico"><span class="ico">!</span><span><b>${esc(ed ? st.propEd[id].nombre : nombre(id))}:</b> ${r.texto}</span>
          <button class="ctl" ${ed ? `data-ed="${id}"` : `data-ir="${id}"`}>Ver</button></div>`).join('') + (alertas.length > 4 ? `<p class="nota">Y ${alertas.length - 4} alertas más.</p>` : '');

    const d = distanciasUsuario();
    if (st.filtro === 'edificios') {
      $('lista-recintos').innerHTML = eds.sort((a, b) => st.vivoEd[b].saturacion - st.vivoEd[a].saturacion).map((e) => {
        const v = st.vivoEd[e], ed = st.propEd[e];
        return `<button class="fila" data-ed="${e}">
          <span><span class="nom">${esc(ed.nombre)}</span><br><span class="meta">${v.abierto ? `${v.ocupacion.toLocaleString('es-MX')} / ${v.capacidad.toLocaleString('es-MX')} personas` : 'Cerrado'} · ${ed.niveles} niveles · Conjunto ${ed.conjunto === 'norte' ? 'Norte' : 'Sur'}${d ? ` · A ${Math.round(d['ed:' + e])} m` : ''}</span></span>
          <span class="chip ${v.estado}">${v.abierto ? pct(v.saturacion) : ETQ_ESTADO.cerrado}</span>
          <span class="barra-ocup"><span style="width:${v.saturacion * 100}%;background:${COLOR[v.estado]}"></span></span></button>`;
      }).join('');
      return;
    }
    const zonasLista = ids.filter((id) => st.filtro === 'todo' || categoria(id) === st.filtro)
      .sort((a, b) => (esPark(a) - esPark(b)) || nivelQ(b, st.vivo[b]) - nivelQ(a, st.vivo[a]));
    $('lista-recintos').innerHTML = zonasLista.map((id) => {
      const v = st.vivo[id], p = st.prop[id];
      return `<button class="fila" data-ir="${id}">
        <span><span class="nom">${esc(p.nombre)}</span><br><span class="meta">${v.abierto ? (esPark(id) ? `${v.ocupacion} vehículos · ${ETQ_PARK[v.estado]}` : esDens(id) ? `${v.ocupacion} personas · ${ETQ_LOS[v.estado]}` : `${v.ocupacion} / ${v.capacidad} ${unidadTxt(v.unidad)}`) : 'Cerrado'} · ${esc(ubicacionTxt(p))}${d ? ` · A ${Math.round(d[id])} m` : ''}</span></span>
        <span class="chip ${v.estado}">${v.abierto ? valorTxt(id, v) : ETQ_ESTADO.cerrado}</span>
        <span class="barra-ocup"><span style="width:${v.saturacion * 100}%;background:${COLOR[v.estado]}"></span></span>
      </button>`;
    }).join('') || '<p class="nota">Sin zonas en esta categoría.</p>';
  }

  // ------------------------------------------------------------------ recintos clave y predicciones semanales
  const LABS_GEO = ['LAB_SIG', 'LABORATORIOS', 'LAB_FOTO'];           // los tres laboratorios de Geomática
  const esClave = (id) => !!st.prop[id] && (st.prop[id].subtipo === 'computo' || st.prop[id].subtipo === 'biblioteca' || LABS_GEO.includes(id));
  const DIAS_SEM = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
  const DIA_PL = { lun: 'lunes', mar: 'martes', mie: 'miércoles', jue: 'jueves', vie: 'viernes', sab: 'sábados' };
  const DIA_SG = { lun: 'lunes', mar: 'martes', mie: 'miércoles', jue: 'jueves', vie: 'viernes', sab: 'sábado' };
  function diasTxt(ds) {
    if (ds.length === 6) return 'todos los días';
    if (ds.length === 5 && !ds.includes('sab')) return 'de lunes a viernes';
    return `los ${lista(ds.map((d) => DIA_PL[d]))}`;
  }
  /** Horas pico de hoy (hasta dos, separadas al menos 2 h) a partir de la misma serie de la ficha. */
  function horasPico(id) {
    const v = st.vivo[id] || st.vivoEd[id];
    const hs = horasDeHoy(id, v || { ocupacion: 0, saturacion: 0, abierto: false }, ahora()).filter((q) => q.estado !== 'cerrado');
    const orden = hs.slice().sort((a, b) => nivelQ(id, b) - nivelQ(id, a));
    const out = [];
    orden.forEach((q) => { if (out.length < 2 && out.every((o) => Math.abs(o.minuto - q.minuto) >= 120)) out.push(q); });
    return out.sort((a, b) => a.minuto - b.minuto);
  }
  /** Comportamiento de cada día de la semana (perfil típico): momento más lleno y su nivel. */
  function tendencia(id) {
    const esc_ = escenarioActivo(), paso = st.kpi.meta.paso_min, r = Rz(id);
    return DIAS_SEM.map((dia) => {
      const serie = (r.perfiles[esc_] || {})[dia];
      if (!serie) return null;
      let k = -1, mejor = -1;
      serie.ocupacion.forEach((oc, i) => { const n = Sim.equivalente(id, oc); if (n > mejor) { mejor = n; k = i; } });
      if (k < 0 || mejor <= 0) return null;
      const oc = serie.ocupacion[k];
      return { dia, minuto: Sim.INICIO_MIN + k * paso, nivel: mejor, ocupacion: oc, estado: Sim.estadoZona(id, oc, oc / r.capacidad_max) };
    }).filter(Boolean);
  }
  const horaRedonda = (m) => Sim.horaTxt(Math.round(m / 60) * 60);
  /** Frase de predicción semanal al estilo “La Biblioteca se saturará los martes a las 17:00”. */
  function prediccionSemanal(id, nombreTxt) {
    const tds = tendencia(id);
    if (!tds.length) return null;
    const dens = esDens(id);
    const sat = tds.filter((q) => q.estado === 'critico'), alto = tds.filter((q) => q.estado === 'alto' || q.estado === 'critico');
    const grupoPorHora = (qs) => { const g = {}; qs.forEach((q) => { const h = horaRedonda(q.minuto); (g[h] = g[h] || []).push(q); });
      return Object.entries(g).sort((a, b) => b[1].length - a[1].length || Math.max(...b[1].map((q) => q.nivel)) - Math.max(...a[1].map((q) => q.nivel))); };
    const sujeto = cap(bArt(nombreTxt));
    if (alto.length) {
      const base = sat.length ? sat : alto;
      const grupos = grupoPorHora(base);
      const verbo = sat.length ? (dens ? 'se congestionará' : 'se saturará') : (dens ? 'estará concurrido' : 'estará casi lleno');
      let t = `${sujeto} ${verbo} ${diasTxt(grupos[0][1].map((q) => q.dia))} hacia las ${grupos[0][0]}`;
      if (grupos[1]) t += ` y ${diasTxt(grupos[1][1].map((q) => q.dia))} hacia las ${grupos[1][0]}`;
      const pico = base.reduce((a, q) => (q.nivel > a.nivel ? q : a));
      return { id, texto: `${t}.`, nivel: pico.nivel, dias: base.length, estado: sat.length ? 'critico' : 'alto' };
    }
    const pico = tds.reduce((a, q) => (q.nivel > a.nivel ? q : a));
    const val = esPark(id) ? `${pico.ocupacion} vehículos` : dens ? `${(pico.ocupacion / Rz(id).superficie_m2).toFixed(2)} personas por m²` : pct(pico.ocupacion / Rz(id).capacidad_max);
    return { id, texto: `${sujeto} tiene su mayor uso los ${DIA_PL[pico.dia]} hacia las ${horaRedonda(pico.minuto)} (${val}), sin llegar a llenarse.`, nivel: pico.nivel, dias: 0, estado: pico.estado };
  }

  // ------------------------------------------------------------------ P1 Cuellos de botella
  const res = (id) => st.kpi.recintos[id].resumen[escenarioActivo()];

  /** Hoy, la misma serie que ve la ficha y el mapa: lo ocurrido + ahora + pronóstico (cada 15 min). */
  const Rz = (id) => st.kpi.recintos[id] || st.kpi.edificios_sim[id];
  function nivelQ(id, q) { return !q || q.estado === 'cerrado' ? 0 : Sim.equivalente(id, q.ocupacion); }
  function hoy(id) {
    if (st.hoyCache[id]) return st.hoyCache[id];
    const serie = Sim.diaCompleto(id, ahora(), st.escenario), paso = st.kpi.meta.paso_min / 60;
    const o = { serie, horasAlto: 0, horasAltoPasadas: 0, horasCritico: 0, personasHora: 0, pico: null, wifiPico: null };
    serie.forEach((q) => {
      if (q.estado === 'alto' || q.estado === 'critico') { o.horasAlto += paso; if (q.tipo !== 'futuro') o.horasAltoPasadas += paso; }
      if (q.estado === 'critico') o.horasCritico += paso;
      o.personasHora += q.ocupacion * paso;
      if (q.estado !== 'cerrado' && (!o.pico || nivelQ(id, q) > nivelQ(id, o.pico))) o.pico = q;
      const w = Sim.wifi(id, q.ocupacion);
      if (w.aplica && w.cobertura && q.estado !== 'cerrado') o.wifiPico = Math.max(o.wifiPico || 0, w.saturacion);
    });
    o.horaPico = o.pico ? Sim.horaTxt(o.pico.minuto) : '—';
    o.valorPico = o.pico ? (esPark(id) ? `${o.pico.ocupacion} veh.` : esDens(id) ? `${(o.pico.ocupacion / Rz(id).superficie_m2).toFixed(2)} p/m²` : pct(o.pico.saturacion)) : '—';
    return (st.hoyCache[id] = o);
  }
  const hTxt = (h) => (h < 0.05 ? '0 h' : h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`);
  function contextoDia(t) {
    const esc_ = escenarioActivo();
    return `${cap(DIAS_LARGO[t.getDay()])} ${Sim.horaTxt(t.getHours() * 60 + t.getMinutes())} · ${esc_ === 'examenes' ? 'Periodo de exámenes' : 'Demanda ordinaria'}`;
  }

  function pintarCuellos(t) {
    $('ctx-cuellos').textContent = contextoDia(t);
    const ids = Object.keys(st.kpi.recintos);
    const ordenHoy = (a, b) => hoy(b).horasAlto - hoy(a).horasAlto || nivelQ(b, hoy(b).pico || {}) - nivelQ(a, hoy(a).pico || {});
    const interiores = ids.filter((id) => categoria(id) === 'recintos').sort(ordenHoy);
    const ext = ids.filter((id) => categoria(id) === 'areas').sort(ordenHoy);
    const edTop = Object.keys(st.kpi.edificios_sim || {}).sort(ordenHoy).slice(0, 6);
    const conSat = interiores.filter((id) => hoy(id).horasAlto > 0);
    const nE = (e) => bArt(st.propEd[e].nombre), nZ = (id) => bArt(nombre(id));
    const mAhora = Sim.minutoDelDia(t);
    const yaPaso = (h) => h.pico && h.pico.minuto <= mAhora;
    let txt = '';
    if (conSat.length) {
      const a = conSat[0], h = hoy(a);
      txt += `${cap(nZ(a))} es el espacio más saturado de hoy: pasa ${horasTxt(h.horasAlto)} por encima del 75 % de su capacidad`;
      txt += h.horasAltoPasadas > 0.05 && h.horasAltoPasadas < h.horasAlto - 0.05 ? `, de las cuales ya transcurrieron ${horasTxt(h.horasAltoPasadas)}` : '';
      txt += `, y su momento más lleno ${yaPaso(h) ? 'fue' : 'será'} a las ${h.horaPico}. `;
      const sig = conSat.slice(1, 3);
      if (sig.length) txt += `Le ${sig.length > 1 ? 'siguen' : 'sigue'} ${lista(sig.map((id) => `${nZ(id)} (${horasTxt(hoy(id).horasAlto)})`))}. `;
    } else txt += 'Hoy ningún recinto llega al 75 % de su capacidad. ';
    if (ext.length && hoy(ext[0]).horasAlto > 0) txt += `Al aire libre, ${nZ(ext[0])} se llena en cada cambio de clase. `;
    const edSat = edTop.filter((e) => hoy(e).horasAlto > 0).slice(0, 3);
    if (edSat.length) txt += `Entre los edificios, los que más se llenan son ${lista(edSat.map(nE))}. `;
    const visitasHoy = (e) => hoy(e).personasHora * 60 / (st.kpi.edificios_sim[e].permanencia_min || 120);
    const masGente = Object.keys(st.kpi.edificios_sim || {}).sort((a, b) => visitasHoy(b) - visitasHoy(a)).slice(0, 2);
    if (masGente.length) txt += `Por número de personas, los más concurridos son ${lista(masGente.map((e) => `${nE(e)} (unas ${Math.round(visitasHoy(e)).toLocaleString('es-MX')} hoy)`))}${masGente.some((e) => !edSat.includes(e)) ? ', aunque casi nunca llegan a llenarse' : ''}.`;
    $('txt-cuellos').innerHTML = txt;
    // Predicciones de la semana: recintos, exteriores y edificios que se llenan
    const cand = ids.filter((id) => !esPark(id)).map((id) => prediccionSemanal(id, nombre(id)))
      .concat(Object.keys(st.kpi.edificios_sim || {}).map((e) => { const p = prediccionSemanal(e, st.propEd[e].nombre); if (p) p.ed = true; return p; }))
      .filter((p) => p && p.dias > 0).sort((a, b) => (b.estado === 'critico') - (a.estado === 'critico') || (!b.ed && esClave(b.id)) - (!a.ed && esClave(a.id)) || b.dias - a.dias || b.nivel - a.nivel);
    // Tres más relevantes + la sala PC-PUMA más usada + el Laboratorio de Fotogrametría (recintos clave del proyecto)
    const preds = cand.slice(0, 3);
    const salaP = ids.filter((id) => st.prop[id].subtipo === 'computo').map((id) => prediccionSemanal(id, nombre(id))).filter(Boolean).sort((a, b) => b.nivel - a.nivel)[0];
    [salaP, prediccionSemanal('LAB_FOTO', nombre('LAB_FOTO'))].forEach((p) => { if (p && !preds.some((q) => q.id === p.id)) preds.push(p); });
    $('lista-predicciones').innerHTML = preds.map((p) => `<button class="pred" ${p.ed ? `data-ed="${p.id}"` : `data-ir="${p.id}"`}>
        <span class="pred-ico" style="background:${COLOR[p.estado] || COLOR.bajo}">${p.estado === 'critico' ? '!' : p.estado === 'alto' ? '↑' : '✓'}</span><span>${p.texto}</span></button>`).join('');

    // Mapa de calor de HOY: misma serie que la ficha (lo ocurrido + pronóstico)
    const est_ = ids.filter((id) => categoria(id) === 'estacionamientos').sort((a, b) => nivelQ(b, hoy(b).pico || {}) - nivelQ(a, hoy(a).pico || {}));
    const filas = interiores.concat(ext.slice(0, 4), est_.slice(0, 3), edTop.map((e) => 'ED:' + e));
    const porHora = 60 / st.kpi.meta.paso_min;
    const h0 = Sim.INICIO_MIN / 60, h1 = Sim.FIN_MIN / 60;
    const mAct = Sim.minutoDelDia(t);
    let html = '<tr><th></th>';
    for (let h = h0; h < h1; h++) html += `<th class="${mAct >= h * 60 && mAct < h * 60 + 60 ? 'ahora' : ''}">${h}</th>`;
    html += '</tr>';
    const n1 = interiores.length, n2 = n1 + Math.min(4, ext.length), n3 = n2 + Math.min(3, est_.length);
    filas.forEach((id, k) => {
      if (k === n1 || k === n2 || k === n3) html += `<tr class="sep"><td colspan="${h1 - h0 + 1}"></td></tr>`;
      const esEd = id.startsWith('ED:'), cl = esEd ? id.slice(3) : id;
      const serie = hoy(cl).serie, rz = Rz(cl);
      const nom = esEd ? st.propEd[cl].nombre : nombre(id);
      html += `<tr><th class="rec" title="${esc(nom)}"><button class="link" ${esEd ? `data-ed="${cl}"` : `data-ir="${id}"`}>${esc(nom)}</button></th>`;
      for (let h = h0; h < h1; h++) {
        const cls = mAct >= h * 60 && mAct < h * 60 + 60 ? 'ahora' : h * 60 + 60 <= mAct ? 'pasado' : '';
        const vv = esEd ? st.vivoEd[cl] : st.vivo[cl];
        let tramo = serie.slice((h - h0) * porHora, (h - h0) * porHora + porHora).filter((q) => q.estado !== 'cerrado');
        if (cls === 'ahora') tramo = vv && vv.abierto ? [vv] : [];   // la hora actual muestra el valor de ahora (igual que el mapa y la ficha)
        const oc = tramo.length ? Math.max(...tramo.map((q) => q.ocupacion)) : 0;
        const m = oc / rz.capacidad_max;
        const e = !tramo.length ? 'cerrado' : Sim.estadoZona(cl, oc, m);
        const dz = !esEd && esDens(cl);
        html += `<td class="${cls}" style="background:${COLOR[e]};${e === 'moderado' ? 'color:#3d3000' : ''}">${!tramo.length ? '' : esPark(cl) ? Math.round(oc) : dz ? (oc / rz.superficie_m2).toFixed(2).slice(1) : Math.round(m * 100)}</td>`;
      }
      html += '</tr>';
    });
    $('tabla-calor').innerHTML = html;
    $('cap-calor').textContent = 'Valor más alto de cada hora. Las celdas tenues ya ocurrieron. Exteriores en personas por m²; estacionamientos en vehículos.';

    // Horas saturadas HOY: ya ocurridas + previstas
    const rec = interiores.filter((id) => hoy(id).horasAlto > 0 || hoy(id).horasCritico > 0).concat(interiores.filter((id) => !(hoy(id).horasAlto > 0)).slice(0, Math.max(0, 6 - conSat.length)));
    grafica('g-cuellos', {
      type: 'bar',
      data: { labels: rec.map(nombre), datasets: [
        { label: 'Ya transcurridas', data: rec.map((id) => +hoy(id).horasAltoPasadas.toFixed(2)), backgroundColor: COLOR.alto, stack: 'h' },
        { label: 'Previstas', data: rec.map((id) => +(hoy(id).horasAlto - hoy(id).horasAltoPasadas).toFixed(2)), backgroundColor: 'rgba(238,138,43,.4)', stack: 'h' }] },
      options: { indexAxis: 'y', scales: { x: { stacked: true, title: { display: true, text: 'Horas' } }, y: { stacked: true } } },
    });

    const grupoHist = (f) => { const ids_ = ids.filter(f); const n = st.kpi.meta.historico.semanas.length;
      return [...Array(n)].map((_, i) => ids_.reduce((s_, id) => s_ + st.kpi.recintos[id].historico.sat_media[i], 0) / (ids_.length || 1)); };
    const sem = st.kpi.meta.historico.semanas.map((d) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`);
    const hSal = grupoHist((id) => st.prop[id].subtipo === 'computo'), hBib = grupoHist((id) => st.prop[id].subtipo === 'biblioteca'), hLab = grupoHist((id) => st.prop[id].subtipo === 'laboratorio');
    grafica('g-tendencia', {
      type: 'line',
      data: { labels: sem, datasets: [['Salas de cómputo', hSal], ['Biblioteca', hBib], ['Laboratorios', hLab]].map(([l, d], k) => ({
        label: l, data: d.map((x) => Math.round(x * 100)), borderColor: SERIE[k], backgroundColor: SERIE[k], tension: 0.3, pointRadius: 3, borderWidth: 2.5 })) },
      options: { scales: { y: { min: 0, title: { display: true, text: '% de ocupación media' } } } },
    });
    const bib = ids.find((id) => st.prop[id].subtipo === 'biblioteca');
    const cambio = Math.round((hSal[hSal.length - 1] / hSal[0] - 1) * 100);
    $('txt-tendencia').innerHTML = `A lo largo del semestre, la ocupación media de las salas de cómputo ${cambio >= 0 ? 'subió' : 'bajó'} <b>${Math.abs(cambio)} %</b>, con un repunte en la semana de parciales.` +
      (bib ? ` En un día normal, la ${nombre(bib)} recibe unas <b>${res(bib).visitas_dia.toLocaleString('es-MX')} visitas</b> y presta <b>${res(bib).prestamos_dia} libros</b>.` : '');

  }

  // ------------------------------------------------------------------ P2 Instalaciones generales
  function pintarGenerales(t) {
    $('ctx-generales').textContent = contextoDia(t);
    const ids = Object.keys(st.kpi.recintos);
    const ph = (id) => hoy(id).personasHora;
    const gen = ids.filter((id) => categoria(id) === 'areas' || st.prop[id].tipo === 'instalacion_general');
    const total = gen.reduce((s, id) => s + ph(id), 0);
    const porSub = {};
    gen.forEach((id) => { const s = st.prop[id].subtipo; porSub[s] = (porSub[s] || 0) + ph(id); });
    const subs = Object.keys(porSub).sort((a, b) => porSub[b] - porSub[a]);
    const top = gen.slice().sort((a, b) => ph(b) - ph(a)).slice(0, 6);
    const norte = gen.filter((id) => (st.prop[id].conjunto || (st.propEd[st.prop[id].id_edificio] || {}).conjunto) === 'norte').reduce((s, id) => s + ph(id), 0);
    const pc = (x) => Math.round(x / total * 100);
    const prD = gen.filter((id) => st.prop[id].descanso === 'principal'), tD = gen.filter((id) => st.prop[id].descanso);
    const sumD = tD.reduce((s_, id) => s_ + ph(id), 0), sumPr = prD.reduce((s_, id) => s_ + ph(id), 0);
    const surPc = 100 - pc(norte);
    const art = (x) => (['pasillo', 'acceso', 'jardin', 'auditorio'].includes(x) ? 'los' : 'las');
    $('txt-generales').innerHTML = `Hoy, ${art(subs[0])} ${plural(subs[0])} concentran el ${pc(porSub[subs[0]])} % del movimiento en las instalaciones generales, ${subs[1] ? `seguid${art(subs[0]) === 'los' ? 'os' : 'as'} de ${art(subs[1])} ${plural(subs[1])} (${pc(porSub[subs[1]])} %)` : ''}. ` +
      `El lugar más concurrido es ${bArt(nombre(top[0]))}, con su momento más lleno a las ${hoy(top[0]).horaPico}. ` +
      `${surPc >= 50 ? `La mayor parte de la actividad (${surPc} %) ocurre en el Conjunto Sur` : `La mayor parte de la actividad (${100 - surPc} %) ocurre en el Conjunto Norte`}. ` +
      (prD.length && sumD ? `Entre las áreas de descanso, las principales (${lista(prD.map((id) => esc(nombre(id))))}) reúnen el ${Math.round(sumPr / sumD * 100)} % de las visitas.` : '');
    $('cap-generales').textContent = 'Las seis zonas más usadas. Línea continua: lo que ya pasó; punteada: pronóstico.';
    const iAhora = hoy(top[0]).serie.findIndex((q) => q.tipo === 'ahora');
    grafica('g-generales-linea', {
      type: 'line',
      data: { labels: st.kpi.meta.horas, datasets: top.map((id, k) => ({
        label: nombre(id), data: hoy(id).serie.map((q) => Math.round(nivelQ(id, q) * 100)),
        segment: { borderDash: (c) => (iAhora >= 0 && c.p0DataIndex >= iAhora ? [5, 4] : undefined) },
        borderColor: SERIE[k % SERIE.length], backgroundColor: SERIE[k % SERIE.length], pointRadius: 0, tension: 0.3, borderWidth: 2.5 })) },
      options: { scales: { y: { min: 0, max: 100, title: { display: true, text: '% de ocupación' } }, x: { ticks: { maxTicksLimit: 8 } } },
        plugins: { marcaAhora: { minuto: Sim.minutoDelDia(t) }, umbrales: { valores: [[st.kpi.meta.umbrales.alto * 100, COLOR.alto], [st.kpi.meta.umbrales.critico * 100, COLOR.critico]] }, legend: { labels: { boxWidth: 10, font: { size: 11 } } } } },
    });
    grafica('g-generales-dona', {
      type: 'doughnut',
      data: { labels: subs.map((s) => ETQ_SUBTIPO[s] || s), datasets: [{ data: subs.map((s) => Math.round(porSub[s])), backgroundColor: subs.map((_, k) => SERIE[k % SERIE.length]), borderWidth: 2 }] },
      options: { plugins: { legend: { position: 'right' } } },
    });
    // Áreas de descanso
    const desc = ids.filter((id) => st.prop[id].descanso).sort((a, b) => (st.prop[a].descanso === 'principal' ? -1 : 1) - (st.prop[b].descanso === 'principal' ? -1 : 1) || ph(b) - ph(a));
    $('tabla-descanso').innerHTML = '<tr><th>Área</th><th>Tipo</th><th class="num">Ahora<br><small>Personas por m²</small></th><th class="num">Hora más llena</th><th>Wi-Fi ahora</th></tr>' +
      desc.map((id) => { const v = st.vivo[id], w = Sim.wifi(id, v.ocupacion);
        return `<tr><td><button class="link" data-ir="${id}">${esc(nombre(id))}</button></td><td>${st.prop[id].descanso === 'principal' ? '<b>Principal</b>' : 'Secundaria'}</td>
        <td class="num"><span class="chip ${v.estado}">${v.abierto ? (v.ocupacion / st.prop[id].superficie_m2).toFixed(2) : '—'}</span></td><td class="num">${hoy(id).horaPico}</td>
        <td>${!w.aplica || !w.cobertura ? '<span class="chip sin">Sin señal</span>' : `<span class="chip ${v.abierto ? w.estado : 'cerrado'}">${v.abierto ? pct(w.saturacion) : '—'}</span>`}</td></tr>`; }).join('');
    // Conectividad
    const conWifi = ids.filter((id) => st.kpi.recintos[id].wifi_dispositivos_por_persona);
    const sinCob = conWifi.filter((id) => !st.kpi.recintos[id].wifi_cobertura);
    const wp = (id) => hoy(id).wifiPico || 0;
    const wifiOrd = conWifi.filter((id) => st.kpi.recintos[id].wifi_cobertura).sort((a, b) => wp(b) - wp(a));
    const saturadas = wifiOrd.filter((id) => wp(id) >= 0.9);
    grafica('g-wifi', {
      type: 'bar',
      data: { labels: wifiOrd.slice(0, 12).map(nombre), datasets: [{ label: 'Uso máximo de hoy (%)', data: wifiOrd.slice(0, 12).map((id) => Math.round(wp(id) * 100)),
        backgroundColor: wifiOrd.slice(0, 12).map((id) => COLOR[Sim.estado(wp(id))]) }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { min: 0, title: { display: true, text: '% de uso de la red' } } } },
    });
    $('txt-wifi').innerHTML = (saturadas.length
      ? `Hoy la red Wi-Fi se satura en ${lista(saturadas.slice(0, 3).map((id) => bArt(nombre(id))))}${saturadas.length > 3 ? ` y ${saturadas.length - 3} zonas más` : ''} durante su hora más concurrida. `
      : 'Hoy la red Wi-Fi tiene capacidad suficiente en todas las zonas. ') +
      (wifiOrd.length ? `La zona con más demanda es ${bArt(nombre(wifiOrd[0]))}, con un uso máximo del ${pct(wp(wifiOrd[0]))}. ` : '') +
      (sinCob.length ? `Sin cobertura: ${lista(sinCob.map((id) => esc(nombre(id))))}.` : '');
    // Red PC-PUMA oficial vs. modelo
    if (red()) {
      const hs = red().uso.horas.map((h) => `${h}:00`);
      grafica('g-red-conj', {
        type: 'line',
        data: { labels: hs, datasets: [
          { label: 'Conjunto Norte', data: red().uso.conjuntos.norte.relativo.map((x) => Math.round(x * 100)), borderColor: '#002b5c', backgroundColor: '#002b5c', borderWidth: 3, tension: 0.3, pointRadius: 0 },
          { label: 'Conjunto Sur', data: red().uso.conjuntos.sur.relativo.map((x) => Math.round(x * 100)), borderColor: '#c99a2e', backgroundColor: '#c99a2e', borderWidth: 3, tension: 0.3, pointRadius: 0 }] },
        options: { scales: { y: { min: 0, max: 100, title: { display: true, text: '% del máximo del día' } } }, plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } } } },
      });
      $('txt-red').innerHTML = `La Facultad cuenta con <b>${red().ap_total} puntos de acceso</b> de la Red PC-PUMA, repartidos en ${Object.values(red().ap_por_edificio).filter((n) => n).length} edificios. ` +
        'Su uso crece desde las 7:00, se mantiene alto entre las 11:00 y las 17:00 y disminuye después de las 19:00, igual que la ocupación de los espacios.';
      const e_ = red().estadisticas;
      if (e_) {
        $('red-stats').innerHTML = [[e_.clientes_unicos.toLocaleString('es-MX'), `Usuarios distintos (${e_.periodo})`],
          [e_.clientes_promedio_dia.toLocaleString('es-MX'), 'Usuarios por día'], [`${e_.gb_promedio_por_cliente} GB`, 'Consumo medio por usuario'],
          [Math.round(e_.clientes_promedio_dia / red().ap_total), 'Usuarios por punto de acceso al día']]
          .map(([v, l]) => `<div class="kpi"><span class="kpi-v">${v}</span><span class="kpi-l">${l}</span></div>`).join('');
        const apps = Object.entries(e_.trafico_tb).sort((a_, b_) => b_[1] - a_[1]);
        grafica('g-red-apps', {
          type: 'bar',
          data: { labels: apps.map((x) => x[0]), datasets: [{ label: 'TB', data: apps.map((x) => x[1]), backgroundColor: apps.map((_, k) => SERIE[k % SERIE.length]) }] },
          options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: `Terabytes transferidos (${e_.periodo})` } } } },
        });
      }
    }
    // Tráfico
    const perm = (id) => st.kpi.recintos[id].permanencia_min || 20;
    const flujoPico = (id) => Math.round((hoy(id).pico ? hoy(id).pico.ocupacion : 0) * 60 / perm(id));
    const flujoDia = (id) => Math.round(ph(id) * 60 / perm(id));
    const traf = gen.filter((id) => ['pasillo', 'acceso', 'plaza'].includes(st.prop[id].subtipo)).sort((a, b) => flujoPico(b) - flujoPico(a));
    $('tabla-trafico').innerHTML = '<tr><th>Zona</th><th class="num">Ahora<br><small>Por hora</small></th><th class="num">Máximo hoy<br><small>Por hora</small></th><th class="num">Total hoy</th></tr>' +
      traf.map((id) => `<tr><td><button class="link" data-ir="${id}">${esc(nombre(id))}</button></td><td class="num">${Sim.flujoHora(id, t, st.escenario).toLocaleString('es-MX')}</td>
        <td class="num">${flujoPico(id).toLocaleString('es-MX')} <small>${hoy(id).horaPico}</small></td><td class="num">${flujoDia(id).toLocaleString('es-MX')}</td></tr>`).join('');

    const est_ = ids.filter((id) => categoria(id) === 'estacionamientos').sort((a, b) => (hoy(b).pico ? hoy(b).pico.ocupacion : 0) - (hoy(a).pico ? hoy(a).pico.ocupacion : 0));
    $('tabla-estac').innerHTML = '<tr><th>Estacionamiento</th><th class="num">Vehículos ahora</th><th class="num">Más demanda hoy</th></tr>' +
      est_.map((id) => `<tr><td><button class="link" data-ir="${id}">${esc(nombre(id))}</button></td>
        <td class="num"><span class="chip ${st.vivo[id].estado}">${valorTxt(id, st.vivo[id])}</span></td><td class="num">${hoy(id).horaPico} <small>${hoy(id).valorPico}</small></td></tr>`).join('');
  }

  // ------------------------------------------------------------------ P3 Mantenimiento
  function pintarMantto() {
    $('ctx-mantto').textContent = `Índice del semestre, de lunes a viernes · La columna “Hoy” corresponde al ${DIAS_LARGO[ahora().getDay()]}`;
    const esc_ = escenarioActivo();
    const eds = Object.keys(st.kpi.edificios).sort((a, b) => st.kpi.edificios[b][esc_].indice_prioridad - st.kpi.edificios[a][esc_].indice_prioridad);
    const re = (e) => st.kpi.edificios[e][esc_];
    const zonas = Object.keys(st.kpi.recintos).sort((a, b) => res(b).indice_prioridad - res(a).indice_prioridad);
    const num = (x) => Math.round(x).toLocaleString('es-MX');
    /** Razón principal (el criterio que más pesa) en palabras. */
    const razon = (r, paso) => { const c = r.componentes_atencion || {};
      const k = ['saturacion', 'volumen', 'intensidad'].sort((a, b) => (c[b] || 0) - (c[a] || 0))[0];
      return k === 'volumen' ? (paso ? `por donde pasan unas ${num(r.flujo_dia)} personas al día` : `que recibe unas ${num(r.flujo_dia)} personas al día`)
        : k === 'intensidad' ? 'que tiene un uso muy intenso para su tamaño' : `que pasa ${horasTxt(r.horas_alto_dia)} al día por encima del 75 %`; };
    const item = (n, r, paso) => `${bArt(n)}, ${razon(r, paso)}`;
    const listaPC = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join('; ')}; y ${xs[xs.length - 1]}`);
    const esPaso = (id) => ['pasillo', 'acceso'].includes(st.prop[id].subtipo);
    const personasZ = zonas.filter((id) => st.kpi.recintos[id].unidad === 'personas');
    const altos = eds.filter((e) => re(e).prioridad === 'alta').map((e) => item(st.propEd[e].nombre, re(e)))
      .concat(personasZ.filter((id) => res(id).prioridad === 'alta').map((id) => item(nombre(id), res(id), esPaso(id))));
    const medios = eds.filter((e) => re(e).prioridad === 'media').map((e) => item(st.propEd[e].nombre, re(e)))
      .concat(personasZ.filter((id) => res(id).prioridad === 'media').map((id) => item(nombre(id), res(id), esPaso(id))));
    const masVisitado = eds.slice().sort((a, b) => re(b).flujo_dia - re(a).flujo_dia).slice(0, 2);
    $('txt-mantto').innerHTML = 'Para decidir qué atender primero se combinan tres criterios: cuántas personas usan cada espacio, qué tan intenso es ese uso por metro cuadrado y cuántas horas al día pasa casi lleno. ' +
      (altos.length ? `Requieren atención prioritaria ${listaPC(altos)}. ` : '') +
      (medios.length ? `En un segundo nivel están ${listaPC(medios.slice(0, 3))}. ` : '') +
      `Los edificios con más visitas son ${lista(masVisitado.map((e) => bArt(st.propEd[e].nombre)))}: aunque casi nunca se llenan, su desgaste es mayor por la cantidad de gente que los recorre.`;
    const comp = (e, k) => +(((re(e).componentes_atencion || {})[k] || 0) / 3).toFixed(3);
    grafica('g-mantto', {
      type: 'bar',
      data: { labels: eds.map((e) => st.propEd[e].nombre), datasets: [
        { label: 'Personas al día', data: eds.map((e) => comp(e, 'volumen')), backgroundColor: '#3a7bd5', stack: 'i' },
        { label: 'Uso por m²', data: eds.map((e) => comp(e, 'intensidad')), backgroundColor: '#c99a2e', stack: 'i' },
        { label: 'Horas casi lleno', data: eds.map((e) => comp(e, 'saturacion')), backgroundColor: '#d43d3d', stack: 'i' }] },
      options: { indexAxis: 'y', scales: { x: { stacked: true, min: 0, max: 1, title: { display: true, text: 'Índice de atención' } }, y: { stacked: true } } },
    });
    if (red()) {
      const eds2 = Object.keys(st.propEd).filter((e) => red().uso.zonas[e]).sort((a, b) => red().uso.zonas[b].intensidad_pico - red().uso.zonas[a].intensidad_pico);
      const mx = red().uso.zonas[eds2[0]].intensidad_pico;
      grafica('g-red-ed', {
        type: 'bar',
        data: { labels: eds2.map((e) => st.propEd[e].nombre), datasets: [{ label: 'Uso de la red', data: eds2.map((e) => Math.round(red().uso.zonas[e].intensidad_pico / mx * 100)),
          backgroundColor: eds2.map((e, k) => (k < 5 ? '#d43d3d' : k < 12 ? '#ee8a2b' : '#7aa6e0')) }] },
        options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 100, title: { display: true, text: 'Uso en hora pico (100 = el más alto)' } } } },
      });
      $('txt-red-ed').innerHTML = `Los edificios con más dispositivos conectados en hora pico son ${lista(eds2.slice(0, 4).map((e) => bArt(st.propEd[e].nombre)))}. Son buenos candidatos para reforzar la red y el mantenimiento.`;
    }
    $('tabla-mantto').innerHTML = '<tr><th>Zona</th><th class="num">Personas al día</th><th class="num">Uso por m²</th><th class="num">Horas ≥ 75 %<br><small>Día normal</small></th><th class="num">Horas ≥ 75 %<br><small>Hoy</small></th><th>Atención</th></tr>' +
      zonas.map((id) => { const r = res(id), p = st.prop[id]; return `<tr><td><button class="link" data-ir="${id}">${esc(p.nombre)}</button></td>
        <td class="num">${p.tipo === 'estacionamiento' ? `${num(r.flujo_dia)} veh.` : num(r.flujo_dia)}</td><td class="num">${r.densidad_uso.toFixed(2)}</td><td class="num">${(Math.round(r.horas_alto_dia * 10) / 10).toLocaleString('es-MX')}</td><td class="num">${p.tipo === 'estacionamiento' ? '—' : (Math.round(hoy(id).horasAlto * 10) / 10).toLocaleString('es-MX')}</td><td><span class="chip p-${r.prioridad}">${cap(r.prioridad)}</span></td></tr>`; }).join('');
    $('nota-indice').textContent = 'El índice suma, a partes iguales, las personas al día, el uso por metro cuadrado y las horas al día por encima del 75 %, cada uno comparado dentro de su grupo. Los estacionamientos se comparan entre sí.';
  }

  // ------------------------------------------------------------------ fichas
  function abrirDetalle() {
    $('detalle').hidden = false;
    document.querySelector('.panel').classList.add('con-detalle');
    $('detalle').scrollTop = 0;
    if (window.innerWidth < 900) $('detalle').scrollIntoView({ block: 'start' });
  }
  function seleccionar(id, sinZoom) {
    const p = st.prop[id];
    if (!p) { if (st.propEd[id]) seleccionarEdificio(id, sinZoom); return; }
    if (st.piso !== 'todas' && !visible(id)) { st.piso = 'todas'; document.querySelectorAll('.piso').forEach((x) => x.classList.toggle('activo', x.dataset.piso === 'todas')); }
    st.seleccion = id;
    abrirDetalle();
    const c = st.capaZona[id];
    if (c && mapa && !sinZoom) mapa.fitBounds(c.getBounds(), { maxZoom: 19, padding: [60, 60] });
    if (!p) return;
    actualizar();
  }
  function seleccionarEdificio(id, sinZoom) {
    if (st.piso !== 'todas' && st.propEd[id] && st.propEd[id].niveles <= st.piso) { st.piso = 'todas'; document.querySelectorAll('.piso').forEach((x) => x.classList.toggle('activo', x.dataset.piso === 'todas')); }
    st.seleccion = 'ed:' + id;
    abrirDetalle();
    if (st.capaEd[id] && mapa && !sinZoom) mapa.fitBounds(st.capaEd[id].getBounds(), { maxZoom: 19, padding: [60, 60] });
    actualizar();
  }
  function cerrarDetalle() { st.seleccion = null; $('detalle').hidden = true; document.querySelector('.panel').classList.remove('con-detalle'); actualizar(); }

  function dato(etq, valor) { return valor === null || valor === undefined || valor === '' ? '' : `<span>${etq}<br><b>${valor}</b></span>`; }

  function pintarDetalle(id, t) {
    const p = st.prop[id];
    const d = distanciasUsuario();
    $('det-nombre').textContent = p.nombre;
    $('det-edificio').hidden = !p.id_edificio;
    if (p.id_edificio) $('det-edificio').textContent = `Ver ${st.propEd[p.id_edificio] ? st.propEd[p.id_edificio].nombre : 'edificio'} completo`;
    if (!simulada(id)) {
      $('det-cuerpo').innerHTML = `<div class="alerta info">${ETQ_SUBTIPO[p.subtipo] || 'Zona'} sin monitoreo de ocupación.</div>
        <div class="det-datos">${dato('Ubicación', esc(ubicacionTxt(p)))}${dato('Superficie', `${p.superficie_m2.toLocaleString('es-MX')} m²`)}
        ${d ? dato('Distancia', `${Math.round(d[id])} m`) : ''}${dato('Observaciones', esc(p.observaciones))}</div>`;
      $('det-reglas').innerHTML = ''; $('det-alternativas').innerHTML = ''; $('det-hist').hidden = true;
      graficaRed(id);
      return;
    }
    const r = st.kpi.recintos[id], v = st.vivo[id];
    const pr = Sim.prediccion(id, t, st.escenario);
    const rs = r.resumen[pr.escenario];
    const u = r.unidad;
    $('det-cuerpo').innerHTML = `
      <div class="det-grande"><span class="n">${v.ocupacion}</span><span>${esPark(id) ? 'vehículos estacionados' : esDens(id) ? 'personas' : `/ ${r.capacidad_max} ${unidadTxt(u)}`}</span>
        <span class="chip ${v.estado}">${estadoTxt(id, v.estado)}</span><span class="pct">${v.abierto ? valorTxt(id, v) : ''}</span></div>
      <div class="barra-ocup"><span style="width:${v.saturacion * 100}%;background:${COLOR[v.estado]}"></span></div>
      <div class="det-datos">
        ${dato('Tipo', (ETQ_SUBTIPO[p.subtipo] || p.tipo) + est(p, 'subtipo'))}
        ${dato('Ubicación', esc(ubicacionTxt(p)))}
        ${dato('Superficie', `${p.superficie_m2.toLocaleString('es-MX')} m²`)}
        ${dato('Horario', `${p.hora_apertura}–${p.hora_cierre}${est(p, 'hora_apertura')}`)}
        ${u === 'personas' ? dato('Densidad actual', `${(v.ocupacion / p.superficie_m2).toFixed(2)} personas/m²`) : ''}
        ${p.equipos ? dato('Equipos', `${p.equipos} <small>(${v.abierto ? (v.ocupacion / p.equipos).toFixed(1) : '0'} personas por equipo)</small>`) : ''}
        ${u === 'personas' && v.abierto ? dato('Personas que pasan por hora', Sim.flujoHora(id, t, st.escenario).toLocaleString('es-MX')) : ''}
        ${wifiTxt(id, v, p)}
        ${p.descanso ? dato('Área de descanso', (p.descanso === 'principal' ? 'Principal' : 'Secundaria') + est(p, 'descanso')) : ''}
        ${p.subtipo === 'biblioteca' ? dato('Visitas hoy', `${Sim.acumuladoDia(id, t, st.escenario).toLocaleString('es-MX')} <small>(unas ${rs.visitas_dia.toLocaleString('es-MX')} en un día normal)</small>`) +
          dato('Préstamos hoy', `${Math.round(Sim.acumuladoDia(id, t, st.escenario) * st.kpi.meta.prestamos_por_visita)} <small>(unos ${rs.prestamos_dia} en un día normal)</small>`) : ''}
        ${d ? dato('Distancia', `${Math.round(d[id])} m`) : ''}
        ${dato('Responsable', esc(p.responsable))}${dato('Observaciones', esc(p.observaciones))}
      </div>`;
    $('det-reglas').innerHTML = pronosticoHTML(id, v, pr, t);
    const alt = v.abierto ? Sim.alternativas(id, t, st.escenario, d) : [];
    const necesita = pr.reglas.some((q) => q.codigo === 'R3');
    $('det-alternativas').innerHTML = necesita && alt.length
      ? '<h3 class="h-sec">Alternativas con espacio</h3>' + alt.slice(0, 3).map((a) => `<button class="fila" ${a.esEdificio ? `data-ed="${a.id}"` : `data-ir="${a.id}"`}>
          <span><span class="nom">${esc(a.nombre)}</span><br><span class="meta">${valorTxt(a.id, a.ahora)} ahora · ${a.esEdificio ? 'Edificio' : esc(ubicacionTxt(st.prop[a.id]))}${a.dist ? ` · A ${Math.round(a.dist)} m` : ''}</span></span>
          <span class="chip ${a.ahora.estado}">Ir</span></button>`).join('')
      : (necesita ? '<p class="nota">No hay alternativas del mismo tipo con espacio en los próximos 30 min.</p>' : '');
    graficaHistorico([{ label: p.nombre, data: r.historico.sat_media }]);
    graficaRed(p.id_edificio || id);
  }

  /** Hoy por hora (valor más alto de cada hora; la hora actual = valor de ahora). Misma cifra que el mapa de calor. */
  function horasDeHoy(id, v, t) {
    const serie = hoy(id).serie, porHora = 60 / st.kpi.meta.paso_min, r = Rz(id), mAct = Sim.minutoDelDia(t), out = [];
    for (let M = Sim.INICIO_MIN; M <= Sim.FIN_MIN; M += 60) {
      const k = (M - Sim.INICIO_MIN) / st.kpi.meta.paso_min;
      const tramo = serie.slice(k, k + porHora).filter((q) => q.estado !== 'cerrado');
      const tipo = mAct >= M && mAct < M + 60 ? 'ahora' : M + 60 <= mAct ? 'pasado' : 'futuro';
      if (tipo === 'ahora') { out.push({ minuto: M, hora: Sim.horaTxt(M), tipo, ocupacion: v.ocupacion, saturacion: v.saturacion, estado: v.abierto ? v.estado : 'cerrado' }); continue; }
      if (!tramo.length) { out.push({ minuto: M, hora: Sim.horaTxt(M), tipo, ocupacion: 0, saturacion: 0, estado: 'cerrado' }); continue; }
      const oc = Math.max(...tramo.map((q) => q.ocupacion));
      out.push({ minuto: M, hora: Sim.horaTxt(M), tipo, ocupacion: oc, saturacion: oc / r.capacidad_max, estado: Sim.estadoZona(id, oc, oc / r.capacidad_max) });
    }
    return out;
  }

  /** Pronóstico de la próxima hora en lenguaje sencillo: titular + línea de tiempo con barras. */
  const DIA_NOMBRE = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  function pronosticoHTML(id, v, pr, t) {
    const r = st.kpi.recintos[id] || st.kpi.edificios_sim[id];
    const park = esPark(id), dens = esDens(id);
    const nivel = (q) => nivelQ(id, q);
    const valor = (q) => (q.estado === 'cerrado' ? 'Cerrado' : park ? `${q.ocupacion} veh.` : dens ? `${(q.ocupacion / r.superficie_m2).toFixed(2)} p/m²` : pct(q.saturacion));
    const corto = (q) => (q.estado === 'cerrado' ? '–' : park ? q.ocupacion : dens ? (q.ocupacion / r.superficie_m2).toFixed(2) : Math.round(q.saturacion * 100));
    const ahora = { ocupacion: v.ocupacion, saturacion: v.saturacion, estado: v.abierto ? v.estado : 'cerrado' };
    const diaH = horasDeHoy(id, v, t);
    // Titular (próxima hora)
    let ico = '✓', cls = 'bien', tit, sub = '';
    const crit = pr.puntos.find((q) => q.estado === 'critico'), alto = pr.puntos.find((q) => q.estado === 'alto');
    const cierra = v.abierto && pr.puntos.find((q) => q.estado === 'cerrado');
    if (!v.abierto) { ico = '–'; cls = 'neutro'; tit = 'Cerrado en este momento'; }
    else if (park) { tit = v.estado === 'moderado' ? 'Mucha demanda ahora' : 'Hay lugares disponibles'; cls = v.estado === 'moderado' ? 'medio' : 'bien'; ico = v.estado === 'moderado' ? '!' : '✓'; }
    else if (v.estado === 'critico') { ico = '!'; cls = 'mal'; tit = dens ? 'Congestionado ahora' : 'Lleno ahora'; sub = 'Conviene buscar una alternativa.'; }
    else if (crit) { ico = '!'; cls = 'mal'; tit = dens ? `Se congestionará hacia las ${crit.hora}` : `Se llenará hacia las ${crit.hora}`; sub = `Llegará a ${valor(crit)}.`; }
    else if (alto || v.estado === 'alto') { ico = '!'; cls = 'medio'; tit = v.estado === 'alto' ? (dens ? 'Concurrido ahora' : 'Casi lleno ahora') : `Se pondrá concurrido hacia las ${alto.hora}`; sub = 'Todavía hay espacio, pero poco.'; }
    else { tit = dens ? 'Seguirá despejado la próxima hora' : 'Seguirá con espacio la próxima hora'; }
    if (v.abierto && !park) {
      const fin = pr.puntos.filter((q) => q.estado !== 'cerrado').pop();
      if (fin) { const dif = nivel(fin) - nivel(ahora); sub += (sub ? ' ' : '') + (dif > 0.08 ? '↗ Va subiendo.' : dif < -0.08 ? '↘ Va bajando.' : '→ Se mantiene estable.'); }
    }
    if (cierra) sub += (sub ? ' ' : '') + `Cierra a las ${cierra.hora}.`;
    // Datos del día
    const abiertas = diaH.filter((q) => q.estado !== 'cerrado');
    const pico = hoy(id).pico ? { ...hoy(id).pico, hora: hoy(id).horaPico } : null;
    const futuras = abiertas.filter((q) => q.tipo === 'futuro' && q.minuto < Sim.FIN_MIN);
    const lleno = ['alto', 'critico'].includes(ahora.estado);
    const mejor = lleno ? futuras.find((q) => ['bajo', 'moderado'].includes(q.estado))
      : futuras.reduce((a, q) => (!a || nivel(q) < nivel(a) ? q : a), null);
    const chips = [
      r.subtipo === 'biblioteca' || r.uso_principal === 'biblioteca'
        ? `<span class="pron-chip destacado"><span>Horas pico de hoy</span><b>${lista(horasPico(id).map((q) => q.hora)) || '—'}</b></span>`
        : pico ? `<span class="pron-chip"><span>${park ? 'Más demanda' : 'Momento más lleno'}</span><b>${pico.hora} · ${valor(pico)}</b></span>` : '',
      mejor && !park ? `<span class="pron-chip bien"><span>${lleno ? 'Próxima hora con espacio' : 'Hora más tranquila'}</span><b>${mejor.hora} · ${valor(mejor)}</b></span>` : '',
      `<span class="pron-chip"><span>${park ? 'Ahora' : 'Ahora'}</span><b>${valor(ahora)}</b></span>`,
    ].join('');
    const unidad = park ? 'vehículos' : dens ? 'personas por m²' : '% de ocupación';
    const lineas = park ? [] : [{ y: st.kpi.meta.umbrales.alto, c: 'alto' }, { y: st.kpi.meta.umbrales.critico, c: 'critico' }];
    return `<h3 class="h-sec">Pronóstico del día <small>${cap(unidad)}</small></h3>
      <div class="pron">
        <div class="pron-tit ${cls}"><span class="pron-ico">${ico}</span><span><b>${tit}</b>${sub ? `<br><small>${sub}</small>` : ''}</span></div>
        <div class="pron-chips">${chips}</div>
        <div class="pron-dia">
          ${lineas.map((l) => `<span class="pron-umbral" style="bottom:calc(19px + ${l.y} * 130px);border-top:2px dashed ${COLOR[l.c]}"></span>`).join('')}
          ${diaH.map((q) => `<div class="pron-col ${q.tipo}" title="${q.hora} · ${valor(q)}${q.tipo === 'pasado' ? ' (ya pasó)' : q.tipo === 'futuro' ? ' (pronóstico)' : ' (ahora)'}">
            <span class="pron-val">${corto(q)}</span>
            <span class="pron-barra"><span style="height:${Math.max(3, nivel(q) * 100)}%;background:${COLOR[q.estado]}"></span></span>
            <span class="pron-hora">${q.tipo === 'ahora' ? 'Ahora' : q.hora.slice(0, 2).replace(/^0/, '')}</span></div>`).join('')}
        </div>
        ${lineas.length ? `<div class="pron-ley">${lineas.map((l) => `<span><i class="lin" style="border-top-color:${COLOR[l.c]}"></i>${l.c === 'alto' ? 'Alto' : 'Crítico'}</span>`).join('')}</div>` : ''}
        <p class="pron-pie">Las barras tenues son horas que ya pasaron.</p>
        ${!park && prediccionSemanal(id, r.nombre || nombre(id)) ? `<p class="pron-tend"><b>Predicción de la semana</b><br>${prediccionSemanal(id, r.nombre || nombre(id)).texto}</p>` : ''}
      </div>`;
  }

  function wifiTxt(id, v, p) {
    const w = Sim.wifi(id, v.ocupacion);
    if (!w.aplica) return '';
    if (!w.cobertura) return dato('Wi-Fi', '<span class="chip sin">Sin cobertura</span>');
    return dato('Uso del Wi-Fi', `<span class="chip ${v.abierto ? w.estado : 'cerrado'}">${v.abierto ? pct(w.saturacion) : '—'}</span> <small>${w.dispositivos.toLocaleString('es-MX')} dispositivos</small>`);
  }

  const red = () => st.kpi.red_pcpuma;
  function graficaRed(clave) {
    const z = red() && red().uso.zonas[clave];
    $('det-red').hidden = !z;
    if (!z) return;
    grafica('g-red', {
      type: 'line',
      data: { labels: red().uso.horas.map((h) => `${h}:00`), datasets: [{ label: 'Uso de la red', data: z.relativo.map((x) => Math.round(x * 100)),
        borderColor: '#3a7bd5', backgroundColor: 'rgba(58,123,213,.15)', fill: true, tension: 0.3, pointRadius: 2, borderWidth: 2.5 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, title: { display: true, text: '% del máximo del día' } } } },
    });
  }

  function graficaHistorico(series) {
    $('det-hist').hidden = false;
    const sem = st.kpi.meta.historico.semanas.map((d) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`);
    grafica('g-historico', {
      type: 'line',
      data: { labels: sem, datasets: series.map((sr, k) => ({ label: sr.label, data: sr.data.map((x) => Math.round(x * 100)),
        borderColor: SERIE[k % SERIE.length], backgroundColor: SERIE[k % SERIE.length], tension: 0.3, pointRadius: 3, borderWidth: 2.5 })) },
      options: { plugins: { legend: { display: series.length > 1 } }, scales: { y: { min: 0, title: { display: true, text: '% de ocupación media' } } } },
    });
  }

  function pintarEdificio(eid, t) {
    const ed = st.propEd[eid];
    const esc_ = escenarioActivo();
    const rids = Object.keys(st.prop).filter((id) => st.prop[id].id_edificio === eid);
    const simuladas = rids.filter(simulada);
    const ag = (st.kpi.edificios[eid] || {})[esc_];
    const es = st.kpi.edificios_sim && st.kpi.edificios_sim[eid];
    const v = st.vivoEd[eid];
    const ocupR = simuladas.reduce((s_, id) => s_ + st.vivo[id].ocupacion, 0);
    const capR = simuladas.reduce((s_, id) => s_ + st.kpi.recintos[id].capacidad_max, 0);
    $('det-nombre').textContent = ed.nombre;
    $('det-edificio').hidden = true;
    const niveles = [...new Set(rids.map((id) => st.prop[id].nivel || 0))].sort((a, b) => a - b);
    const pr = es ? Sim.prediccion(eid, t, st.escenario) : null;
    $('det-cuerpo').innerHTML = `
      ${v ? `<div class="det-grande"><span class="n">${v.ocupacion.toLocaleString('es-MX')}</span><span>/ ${v.capacidad.toLocaleString('es-MX')} personas en el edificio</span>
        <span class="chip ${v.estado}">${ETQ_ESTADO[v.estado]}</span><span class="pct">${v.abierto ? pct(v.saturacion) : ''}</span></div>
        <div class="barra-ocup"><span style="width:${v.saturacion * 100}%;background:${COLOR[v.estado]}"></span></div>` : ''}
      <div class="det-datos">
        ${dato('Conjunto', ed.conjunto === 'norte' ? 'Norte' : 'Sur (Anexo)')}${dato('Niveles', ed.niveles + est(ed, 'niveles'))}
        ${dato('Superficie construida', `${Math.round(ed.superficie_m2 * Math.max(1, ed.niveles)).toLocaleString('es-MX')} m²`)}${dato('Uso principal', cap(ed.uso_principal || '—'))}
        ${v && v.abierto ? dato('Densidad actual', `${(v.ocupacion / (ed.superficie_m2 * Math.max(1, ed.niveles)) * 100).toFixed(1)} personas/100 m²`) : ''}
        ${capR ? dato('En sus recintos', `${ocupR} / ${capR} personas`) : ''}
        ${ag ? dato('Nivel de atención', `<span class="chip p-${ag.prioridad}">${cap(ag.prioridad)}</span> <small>${Math.round(ag.flujo_dia).toLocaleString('es-MX')} personas en un día normal</small>`) : ''}
        ${es ? dato('Visitas hoy', Math.round(hoy(eid).personasHora * 60 / (es.permanencia_min || 120)).toLocaleString('es-MX')) : ''}
        ${v ? wifiTxtEd(eid, v) : ''}
        ${dato('Observaciones', esc(ed.observaciones))}
      </div>
      ${rids.length ? niveles.map((n) => `<h3 class="h-sec">${nivelTxt(n)}</h3>` + rids.filter((id) => (st.prop[id].nivel || 0) === n).map((id) => {
        const vr = st.vivo[id];
        return vr ? `<button class="fila" data-ir="${id}"><span><span class="nom">${esc(nombre(id))}</span><br><span class="meta">${vr.abierto ? `${vr.ocupacion} / ${vr.capacidad} personas` : 'Cerrado'}</span></span>
          <span class="chip ${vr.estado}">${vr.abierto ? pct(vr.saturacion) : 'Cerrado'}</span><span class="barra-ocup"><span style="width:${vr.saturacion * 100}%;background:${COLOR[vr.estado]}"></span></span></button>`
          : `<button class="fila" data-ir="${id}"><span class="nom">${esc(nombre(id))}</span></button>`;
      }).join('')).join('') : ''}`;
    $('det-reglas').innerHTML = pr ? pronosticoHTML(eid, v, pr, t) : '';
    $('det-alternativas').innerHTML = '';
    if (es) {
      graficaHistorico([{ label: ed.nombre, data: es.historico.sat_media }]);
    } else { $('det-hist').hidden = true; }
    graficaRed(eid);
  }

  function wifiTxtEd(eid, v) {
    const w = Sim.wifi(eid, v.ocupacion);
    if (!w.aplica) return '';
    if (!w.cobertura) return dato('Wi-Fi', '<span class="chip sin">Sin cobertura</span>');
    return dato('Uso del Wi-Fi', `<span class="chip ${v.abierto ? w.estado : 'cerrado'}">${v.abierto ? pct(w.saturacion) : '—'}</span> <small>${w.dispositivos.toLocaleString('es-MX')} dispositivos</small>`);
  }



  // ------------------------------------------------------------------ gráficas
  function configurarChart() {
    Chart.defaults.font.family = getComputedStyle(document.documentElement).fontFamily;
    Chart.defaults.color = '#14213d';
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.animation = false;
    Chart.defaults.plugins.legend.labels.boxWidth = 14;
    Chart.register({
      id: 'umbrales',
      afterDatasetsDraw(chart, _a, opts) {
        if (!opts || !opts.valores) return;
        const { left, right } = chart.chartArea, c = chart.ctx;
        opts.valores.forEach(([v, col]) => { const y = chart.scales.y.getPixelForValue(v);
          c.save(); c.strokeStyle = col; c.lineWidth = 1.5; c.setLineDash([6, 4]); c.beginPath(); c.moveTo(left, y); c.lineTo(right, y); c.stroke(); c.restore(); });
      },
    });
    Chart.register({
      id: 'marcaAhora',
      afterDraw(chart, _a, opts) {
        if (!opts || opts.minuto == null) return;
        const i = (opts.minuto - Sim.INICIO_MIN) / st.kpi.meta.paso_min;
        if (i < 0 || i > st.kpi.meta.horas.length - 1) return;
        const x = chart.scales.x.getPixelForValue(i), { top, bottom } = chart.chartArea, c = chart.ctx;
        c.save(); c.strokeStyle = '#c99a2e'; c.lineWidth = 2; c.setLineDash([4, 4]);
        c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke(); c.restore();
      },
    });
  }
  function grafica(idCanvas, cfg) {
    if (!window.Chart) return;
    const prev = st.charts[idCanvas];
    if (prev && prev.config.type === cfg.type && prev.data.datasets.length === cfg.data.datasets.length) {
      prev.data.labels = cfg.data.labels;
      cfg.data.datasets.forEach((ds, k) => Object.assign(prev.data.datasets[k], ds));
      prev.options = Object.assign(prev.options, cfg.options || {});
      prev.update('none');
      return;
    }
    if (prev) prev.destroy();
    st.charts[idCanvas] = new Chart($(idCanvas), cfg);
  }

  // ------------------------------------------------------------------ controles
  function iniciarControles() {
    document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
      st.tab = b.dataset.tab;
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('activo', x === b));
      document.querySelectorAll('.tab-body').forEach((x) => { x.hidden = x.id !== `tab-${st.tab}`; });
      if (st.seleccion) cerrarDetalle(); else actualizar();
    }));
    document.querySelectorAll('.filtro').forEach((b) => b.addEventListener('click', () => {
      st.filtro = b.dataset.filtro;
      document.querySelectorAll('.filtro').forEach((x) => x.classList.toggle('activo', x === b));
      actualizar();
    }));
    document.addEventListener('click', (e) => {
      if (e.target.closest('.aviso-alt')) { const k = $('aviso').querySelector('.aviso-cab'); st.avisoCerrado = k && k.dataset.clave; $('aviso').hidden = true; }
      const b = e.target.closest('[data-ir]'); if (b) { seleccionar(b.dataset.ir); return; }
      const bg = e.target.closest('[data-guia-tab]'); if (bg) { cerrarResumen(); if (st.seleccion) cerrarDetalle(); irTab(bg.dataset.guiaTab); return; }
      const br = e.target.closest('[data-ruta]'); if (br) { dibujarRuta(br.dataset.ruta, br.dataset.esed === '1'); return; }
      const be = e.target.closest('[data-ed]'); if (be) seleccionarEdificio(be.dataset.ed);
    });
    $('detalle-cerrar').addEventListener('click', cerrarDetalle);
    $('det-edificio').addEventListener('click', () => { const p = st.prop[st.seleccion]; if (p && p.id_edificio) seleccionarEdificio(p.id_edificio); });
    $('sel-escenario').addEventListener('change', (e) => { st.escenario = e.target.value; actualizar(); });
    $('btn-ubicacion').addEventListener('click', usarGPS);
    document.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
      st.capa = b.dataset.modo;
      document.querySelectorAll('[data-modo]').forEach((x) => x.classList.toggle('activo', x === b));
      actualizar();
    }));
    document.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
      const z = b.dataset.zoom;
      if (z === 'todo') { mapa.fitBounds(st.limites, { padding: [20, 20] }); return; }
      const capas = Object.keys(st.capaEd).filter((id) => st.propEd[id].conjunto === z).map((id) => st.capaEd[id]);
      if (capas.length) mapa.fitBounds(L.featureGroup(capas).getBounds(), { padding: [40, 40], maxZoom: 19 });
    }));

    const hoy = new Date().getDay();
    $('demo-dia').value = String(hoy === 0 ? 1 : hoy);
    $('demo-hora').min = String(Sim.INICIO_MIN);
    $('demo-hora').max = String(Sim.FIN_MIN);
    const fijarDemo = () => {
      st.demo = { dia: Number($('demo-dia').value), minuto: Number($('demo-hora').value) };
      $('demo-hora-txt').textContent = Sim.horaTxt(st.demo.minuto);
      actualizar();
    };
    $('btn-demo').addEventListener('click', () => {
      const abrir = $('demo-bar').hidden;
      $('demo-bar').hidden = !abrir;
      $('btn-demo').setAttribute('aria-expanded', String(abrir));
      if (abrir) {
        const n = new Date(), m = n.getHours() * 60 + n.getMinutes();
        $('demo-hora').value = String(Math.min(Sim.FIN_MIN, Math.max(Sim.INICIO_MIN, m - (m % 5))));
        fijarDemo();
      } else salirDemo();
      if (mapa) setTimeout(() => mapa.invalidateSize(), 50);
    });
    $('demo-dia').addEventListener('change', fijarDemo);
    $('demo-hora').addEventListener('input', fijarDemo);
    $('demo-play').addEventListener('click', () => {
      if (st.play) { detenerPlay(); return; }
      $('demo-play').textContent = '⏸ Pausa';
      st.play = setInterval(() => {
        let m = Number($('demo-hora').value) + 15;
        if (m > Sim.FIN_MIN) m = Sim.INICIO_MIN;
        $('demo-hora').value = String(m);
        fijarDemo();
      }, 1200);
    });
    $('demo-salir').addEventListener('click', () => { $('demo-bar').hidden = true; $('btn-demo').setAttribute('aria-expanded', 'false'); salirDemo(); setTimeout(() => mapa.invalidateSize(), 50); });
    window.addEventListener('resize', () => mapa && mapa.invalidateSize());
  }
  function detenerPlay() { clearInterval(st.play); st.play = null; $('demo-play').textContent = '▶ Reproducir'; }
  function salirDemo() { detenerPlay(); st.demo = null; actualizar(); }

  // ------------------------------------------------------------------ atajos para guía y escenario crítico
  function irTabSilencioso(t) { if (st.tab !== t) irTab(t); }
  function irTab(t) { const b = document.querySelector(`.tab[data-tab="${t}"]`); if (b) b.click(); }
  function ponerModo(m) { const b = document.querySelector(`[data-modo="${m}"]`); if (b) b.click(); }
  function ponerPiso(v) {
    st.piso = v;
    document.querySelectorAll('.piso').forEach((x) => x.classList.toggle('activo', x.dataset.piso === String(v)));
  }
  function ponerEscenario(e) { st.escenario = e; $('sel-escenario').value = e; }
  function ponerHora(dia, minuto) {
    detenerPlay();
    $('demo-bar').hidden = false;
    $('btn-demo').setAttribute('aria-expanded', 'true');
    $('demo-dia').value = String(dia);
    $('demo-hora').value = String(minuto);
    $('demo-hora-txt').textContent = Sim.horaTxt(minuto);
    st.demo = { dia, minuto };
    actualizar();
    setTimeout(() => mapa && mapa.invalidateSize(), 60);
  }
  function verTodo() { if (mapa) mapa.fitBounds(st.limites, { padding: [20, 20] }); }

  function escenarioCritico() {
    if (st.seleccion) cerrarDetalle();
    ponerEscenario('examenes');
    ponerPiso('todas');
    ponerModo('ocupacion');
    irTab('ahora');
    ponerHora(2, 1020);
    toast('Periodo de exámenes, martes 17:00', 3500);
  }

  // ------------------------------------------------------------------ demostración guiada
  const PASOS = [
    { tit: 'GeoSIG FI-UNAM', txt: 'El mapa muestra la ocupación de la Facultad: 26 edificios, 13 recintos y 23 áreas comunes. El color de cada espacio indica qué tan lleno está.',
      accion: () => { if (st.seleccion) cerrarDetalle(); ponerEscenario('auto'); ponerPiso('todas'); ponerModo('ocupacion'); irTab('ahora'); ponerHora(2, 450); verTodo(); } },
    { tit: 'Información en vivo', txt: 'El tablero se actualiza cada minuto. Son las 11:00 del martes, cambio de clase: los salones se vacían unos minutos y los pasillos se llenan. Durante la clase, las áreas comunes vuelven a la calma.',
      accion: () => { if (st.seleccion) cerrarDetalle(); irTab('ahora'); ponerHora(2, 660); } },
    { tit: 'Cuello de botella detectado', txt: 'A las 17:00 la Biblioteca Antonio Dovalí Jaime está llena: las bibliotecas son los espacios que más se saturan. Su ficha lo marca, muestra el pronóstico del día y sugiere otras bibliotecas con espacio. Los laboratorios, en cambio, casi nunca se llenan.',
      accion: () => { ponerHora(2, 1020); seleccionar('BIB'); } },
    { tit: 'Edificios y plantas', txt: 'Cada recinto está ligado a su edificio y su nivel. En el Edificio A: auditorio en planta baja, Biblioteca en el nivel 1 y laboratorios en el nivel 5.',
      accion: () => seleccionarEdificio('A') },
    { tit: '¿Dónde estoy y a dónde ir?', txt: 'Martes 11:00: estás en la Biblioteca del Edificio A y está llena. Con el GPS, o tocando el mapa, el sistema sabe dónde estás y te sugiere el lugar más cercano del mismo tipo que tiene espacio.',
      accion: () => { if (st.seleccion) cerrarDetalle(); ponerHora(2, 660); const c = st.centroides.BIB; if (c) fijarUsuario(L.latLng(c[0], c[1]), 'manual');
        setTimeout(() => { const b = document.querySelector('.aviso-alt'); if (b) b.click(); }, 1200); } },
    { tit: 'Instalaciones generales y conectividad', txt: 'Áreas de descanso, tráfico peatonal, estacionamientos y red Wi-Fi. El modo Wi-Fi del mapa muestra qué tan cargada está la red en cada espacio.',
      accion: () => { if (st.seleccion) cerrarDetalle(); ponerModo('wifi'); irTab('generales'); verTodo(); } },
    { tit: 'Escenario de exámenes', txt: 'En periodo de exámenes sube la demanda de bibliotecas y salas de cómputo; el mapa de calor y las alertas cambian.',
      accion: () => { ponerEscenario('examenes'); ponerModo('ocupacion'); irTab('cuellos'); ponerHora(3, 735); } },
    { tit: 'Zonas que requieren atención', txt: 'El índice de atención combina cuántas personas usan cada espacio, qué tan intenso es ese uso y cuántas horas al día pasa casi lleno. Así se decide qué atender primero.',
      accion: () => { ponerEscenario('auto'); ponerModo('ocupacion'); irTab('mantto'); } },
    { tit: 'Guía de uso', txt: 'La guía explica cómo usar el sistema y resume la situación de hoy, con accesos directos a cada pestaña.',
      accion: () => { salirGuia(); abrirResumen(); } },
  ];
  let pasoGuia = 0;
  function mostrarPaso(i) {
    pasoGuia = Math.max(0, Math.min(PASOS.length - 1, i));
    const p = PASOS[pasoGuia];
    $('guia').hidden = false;
    document.body.classList.add('guia-activa');
    $('guia-paso').textContent = `Paso ${pasoGuia + 1} de ${PASOS.length}`;
    $('guia-tit').textContent = p.tit;
    $('guia-txt').textContent = p.txt;
    $('guia-ant').disabled = pasoGuia === 0;
    $('guia-sig').textContent = pasoGuia === PASOS.length - 1 ? 'Terminar ✓' : 'Siguiente →';
    try { p.accion(); } catch (e) { console.warn(e); }
  }
  function salirGuia() { $('guia').hidden = true; document.body.classList.remove('guia-activa'); }

  // ------------------------------------------------------------------ guía de uso (con la situación de hoy)
  function abrirResumen() {
    const t = ahora();
    pintarCuellos(t); pintarGenerales(t); pintarMantto(); pulirTextos();
    const ids = Object.keys(st.kpi.recintos);
    const ab = ids.filter((id) => st.vivo[id].abierto);
    const enEd = Object.values(st.vivoEd).reduce((s_, v) => s_ + (v.abierto ? v.ocupacion : 0), 0);
    const enAreas = ab.filter((id) => categoria(id) === 'areas').reduce((s_, id) => s_ + st.vivo[id].ocupacion, 0);
    const llenas = ab.filter((id) => ['alto', 'critico'].includes(st.vivo[id].estado) && !esPark(id));
    const masLleno = ab.filter((id) => !esPark(id)).sort((a, b) => nivelQ(b, st.vivo[b]) - nivelQ(a, st.vivo[a]))[0];
    const recSat = ids.filter((id) => categoria(id) === 'recintos').sort((a, b) => hoy(b).horasAlto - hoy(a).horasAlto);
    const generalesTop = ids.filter((id) => categoria(id) === 'areas' || st.prop[id].tipo === 'instalacion_general').sort((a, b) => hoy(b).personasHora - hoy(a).personasHora)[0];
    const esc_ = escenarioActivo();
    const edAt = Object.keys(st.kpi.edificios).sort((a, b) => st.kpi.edificios[b][esc_].indice_prioridad - st.kpi.edificios[a][esc_].indice_prioridad);
    const nZ = (id) => bArt(nombre(id));
    const hora = Sim.horaTxt(t.getHours() * 60 + t.getMinutes());
    const total = enEd + enAreas;

    $('res-sub').textContent = `${cap(DIAS_LARGO[t.getDay()])} ${hora} · ${esc_ === 'examenes' ? 'Periodo de exámenes' : 'Demanda ordinaria'}${st.demo ? ' · Hora elegida' : ''}`;
    $('res-kpis').innerHTML = [[total.toLocaleString('es-MX'), 'Personas en la Facultad'], [llenas.length, 'Zonas casi llenas o llenas'],
      [masLleno ? valorTxt(masLleno, st.vivo[masLleno]) : '—', masLleno ? `Lo más lleno: ${nombre(masLleno)}` : 'Lo más lleno'],
      [recSat[0] ? horasTxt(hoy(recSat[0]).horasAlto) : '—', recSat[0] ? `Casi lleno hoy: ${nombre(recSat[0])}` : 'Casi lleno hoy']]
      .map(([v, l]) => `<div class="kpi"><span class="kpi-v">${v}</span><span class="kpi-l">${esc(l)}</span></div>`).join('');

    const sec = (ico, tit, cuerpo) => `<section class="guia-sec"><h3><span class="guia-ico">${ico}</span>${tit}</h3>${cuerpo}</section>`;
    const pasos = (xs) => `<ul class="guia-lista">${xs.map((x) => `<li>${x}</li>`).join('')}</ul>`;
    const ir = (tab) => `<button class="ctl ctl-chico" data-guia-tab="${tab}">Abrir →</button>`;
    const u = st.kpi.meta.umbrales, P = (x) => Math.round(x * 100);
    const muestra = (c) => `<i class="guia-color" style="background:${COLOR[c]}"></i>`;

    $('res-cuerpo').innerHTML =
      '<p class="guia-intro">GeoSIG muestra, minuto a minuto, qué tan ocupados están los espacios de la Facultad de Ingeniería: edificios, bibliotecas, salas PC-PUMA, laboratorios, auditorios, áreas comunes y estacionamientos. ' +
      (ab.length ? `Ahora mismo hay ${total.toLocaleString('es-MX')} personas en la Facultad${masLleno ? ` y el lugar más lleno es ${nZ(masLleno)} (${valorTxt(masLleno, st.vivo[masLleno])})` : ''}.` : 'En este momento la Facultad está fuera de su horario de servicio (7:00 a 21:00).') + '</p>' +

      sec('🗺️', 'Cómo leer el mapa', pasos([
        `El color de cada espacio indica su ocupación: ${muestra('bajo')} menos del ${P(u.moderado)} %, ${muestra('moderado')} de ${P(u.moderado)} a ${P(u.alto)} %, ${muestra('alto')} de ${P(u.alto)} a ${P(u.critico)} % y ${muestra('critico')} ${P(u.critico)} % o más.`,
        'La trama indica el tipo de espacio: rayas para pasillos, puntos para plazas y áreas de descanso, marcas de pasto para jardines y una “P” para estacionamientos. Los recintos llevan doble línea.',
        'Con <b>Ocupación</b> y <b>Wi-Fi</b>, arriba a la derecha, eliges qué muestran los colores.',
        'El selector <b>Planta</b>, a la izquierda, deja ver solo los edificios y recintos de ese nivel.',
        '<b>Conjunto Norte</b>, <b>Conjunto Sur</b> y <b>Todo</b> acercan el mapa a cada zona de la Facultad.',
      ])) +

      sec('👆', 'Consultar un espacio', pasos([
        'Toca cualquier espacio en el mapa, o en la lista de la pestaña <b>Ahora</b>, para abrir su ficha.',
        'La ficha muestra cuántas personas hay, el uso del Wi-Fi, el pronóstico de 7:00 a 21:00 y la predicción de la semana. Las barras tenues son las horas que ya pasaron.',
        'Los espacios marcados con ★ son las salas PC-PUMA, las bibliotecas y los laboratorios de Geomática.',
        'En un edificio verás también sus recintos, ordenados por planta.',
      ])) +

      sec('📍', 'Dónde estás y a dónde ir', pasos([
        'Al tocar el mapa, el punto azul marca dónde estás. Con <b>Mi ubicación</b>, el GPS lo actualiza mientras caminas.',
        'Si estás en una biblioteca, una sala PC-PUMA o un área recreativa que está casi llena, aparece una ventana con el lugar más cercano del mismo tipo que tiene espacio.',
        'Toca <b>Ir</b> y el mapa te lleva a ese lugar.',
      ])) +

      sec('📊', 'Las pestañas del panel',
        `<div class="guia-tabs">
          <div><b>Ahora</b><p>Los indicadores clave (salas PC-PUMA, horas pico de la Biblioteca, laboratorios de Geomática y tráfico), las alertas y la lista de espacios.${llenas.length ? ` Hay ${llenas.length} ${llenas.length === 1 ? 'zona casi llena' : 'zonas casi llenas o llenas'}.` : ''}</p>${ir('ahora')}</div>
          <div><b>Cuellos</b><p>Dónde y cuándo se satura la Facultad hoy, y las predicciones de la semana.${recSat[0] && hoy(recSat[0]).horasAlto > 0 ? ` Destaca ${nZ(recSat[0])}, con ${horasTxt(hoy(recSat[0]).horasAlto)} por encima del 75 %.` : ''}</p>${ir('cuellos')}</div>
          <div><b>Generales</b><p>Pasillos, plazas, áreas de descanso, Wi-Fi y estacionamientos.${generalesTop ? ` El lugar más concurrido hoy es ${nZ(generalesTop)}.` : ''}</p>${ir('generales')}</div>
          <div><b>Atención</b><p>Qué espacios necesitan primero mantenimiento o más recursos, según las personas que los usan, la intensidad de uso y las horas que pasan casi llenos.${edAt[0] ? ` Encabeza la lista ${bArt(st.propEd[edAt[0]].nombre)}.` : ''}</p>${ir('mantto')}</div>
        </div>`) +

      sec('🕑', 'Explorar otro momento', pasos([
        '<b>Elegir hora</b> muestra cualquier día y hora de la semana; <b>Reproducir</b> avanza el día de 15 en 15 minutos. <b>Volver a la hora actual</b> regresa al tiempo real.',
        'El <b>Escenario</b> cambia entre demanda ordinaria y periodo de exámenes, cuando bibliotecas y salas de cómputo se llenan más.',
        '<b>▶ Recorrido</b> presenta el sistema paso a paso.',
      ]));
    $('resumen').hidden = false;
    $('res-cerrar').focus();
  }
  function pulirTextos() { ['txt-cuellos', 'txt-generales', 'txt-wifi', 'txt-mantto', 'txt-red-ed', 'txt-tendencia', 'txt-red'].forEach((k) => { const el = $(k); if (el) el.innerHTML = limpiar(el.innerHTML); }); }
  function cerrarResumen() { $('resumen').hidden = true; }

  function pantallaCompleta() {
    const d = document;
    try {
      if (d.fullscreenElement) { d.exitFullscreen(); return; }
      const pr = d.documentElement.requestFullscreen && d.documentElement.requestFullscreen();
      if (pr && pr.catch) pr.catch(() => toast('Pantalla completa no disponible aquí. En la tableta: menú del navegador → “Agregar a pantalla de inicio”.', 5000));
      if (!d.documentElement.requestFullscreen) throw new Error('sin soporte');
    } catch (e) { toast('Pantalla completa no disponible aquí. En la tableta: menú del navegador → “Agregar a pantalla de inicio”.', 5000); }
  }

  function iniciarExtras() {
    $('btn-guia').addEventListener('click', () => mostrarPaso(0));
    $('guia-sig').addEventListener('click', () => (pasoGuia === PASOS.length - 1 ? (cerrarResumen(), salirGuia()) : mostrarPaso(pasoGuia + 1)));
    $('guia-ant').addEventListener('click', () => mostrarPaso(pasoGuia - 1));
    $('guia-salir').addEventListener('click', salirGuia);
    $('btn-resumen').addEventListener('click', abrirResumen);
    $('res-cerrar').addEventListener('click', cerrarResumen);
    $('resumen').addEventListener('click', (e) => { if (e.target.id === 'resumen') cerrarResumen(); });
    $('btn-pantalla').addEventListener('click', pantallaCompleta);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (!$('resumen').hidden) cerrarResumen(); else if (!$('guia').hidden) salirGuia(); }
      if (!$('guia').hidden && e.key === 'ArrowRight') $('guia-sig').click();
      if (!$('guia').hidden && e.key === 'ArrowLeft') $('guia-ant').click();
    });
  }

  let toastTimer;
  function toast(msg, ms = 3000) {
    const el = $('toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }
  function ocultarToast() { $('toast').hidden = true; }

  window.addEventListener('load', cargar);
  window.GeoSIG = { st, ponerPunto, ponerHora, seleccionar, seleccionarEdificio, actualizar, mostrarPaso, abrirResumen, escenarioCritico };
})();

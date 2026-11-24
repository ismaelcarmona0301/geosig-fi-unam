/* GeoSIG FI-UNAM · Visor (Leaflet) y tablero (Chart.js). Depende de js/simulacion.js
 * Capas: edificios (contexto), recintos (interiores, por nivel) y áreas comunes (exteriores). */
(function () {
  'use strict';
  const Sim = window.Simulacion;

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
    piso: 'todas', filtro: 'todo', usuario: null, modoAqui: false, tab: 'ahora',
    capaEd: {}, capaZona: {}, vivoEd: {}, prop: {}, propEd: {}, origen: {}, centroides: {}, charts: {}, vivo: {}, play: null, centroFI: null,
  };
  let mapa, grupoEd, grupoZonas, grupoAP, marcadorUsuario, circuloPrecision, lineaRuta;

  const $ = (id) => document.getElementById(id);
  const pct = (x) => `${Math.round(x * 100)} %`;
  const nombre = (id) => (st.prop[id] || st.propEd[id] || {}).nombre || id;
  const simulada = (id) => !!st.kpi.recintos[id];
  const esDens = (id) => !!(st.kpi.recintos[id] && st.kpi.recintos[id].umbrales_densidad);
  /** Valor a mostrar: densidad (personas/m²) en exteriores, % de capacidad en lo demás. */
  const valorTxt = (id, v) => (!v || !v.abierto ? '—' : esDens(id) ? `${v.densidad.toFixed(2)} p/m²` : pct(v.saturacion));
  const estadoTxt = (id, e) => (esDens(id) ? ETQ_LOS[e] : ETQ_ESTADO[e]);
  const unidadTxt = (u, n) => (u === 'vehiculos' ? (n === 1 ? 'vehículo' : 'vehículos') : (n === 1 ? 'persona' : 'personas'));
  const nivelTxt = (n) => (n === 0 ? 'Planta baja' : `Nivel ${n}`);
  const est = (p, campo) => ((p.campos_estimados || []).includes(campo) ? ' <span class="est" title="Dato estimado, por confirmar">est.</span>' : '');
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
    const leer = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.json(); });
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
      if (fallidas === 4 && cargadas === 0) { document.body.classList.add('sin-basemap'); toast('Sin conexión: el mapa base no está disponible; las capas sí.', 5000); }
    });

    grupoEd = L.geoJSON(st.edificios, {
      pane: 'pEdificios',
      style: () => ({ weight: 1, color: '#7d8aa0', fillColor: '#c9d2df', fillOpacity: 0.9 }),
      onEachFeature: (f, capa) => {
        const id = f.properties.id_edificio;
        st.capaEd[id] = capa;
        capa.bindTooltip(id.length <= 3 ? id : esc(f.properties.nombre), { permanent: true, direction: 'center', className: 'etq-ed' });
        capa.on('click', (e) => { if (st.modoAqui) return fijarUsuario(e.latlng, 'manual'); L.DomEvent.stopPropagation(e); seleccionarEdificio(id); });
      },
    }).addTo(mapa);

    grupoZonas = L.geoJSON(st.zonas, {
      pane: 'pAreas',
      onEachFeature: (f, capa) => {
        const id = f.properties.id_recinto;
        if (st.origen[id] === 'recinto') capa.options.pane = 'pRecintos';
        st.capaZona[id] = capa;
        if (simulada(id)) capa.bindTooltip('', { permanent: true, direction: 'center', className: 'etq' });
        capa.on('click', (e) => { if (st.modoAqui) return fijarUsuario(e.latlng, 'manual'); L.DomEvent.stopPropagation(e); seleccionar(id); });
      },
    }).addTo(mapa);

    // Antenas Wi-Fi: un distintivo por edificio (la asignación por edificio es la parte confiable del dato oficial)
    const red_ = st.kpi.red_pcpuma;
    if (red_) {
      const ICONO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 8.8a15 15 0 0 1 20 0M5.5 12.3a10 10 0 0 1 13 0M9 15.8a5 5 0 0 1 6 0" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="19.5" r="1.8" fill="currentColor"/></svg>';
      grupoAP = L.layerGroup(Object.entries(red_.ap_por_edificio).filter(([e]) => st.propEd[e]).map(([e, n]) => {
        const ed = st.propEd[e], pt = ed.punto_etiqueta || [st.centroides['ed:' + e][1], st.centroides['ed:' + e][0]];
        const dens = densidadAP(e);
        return L.marker([pt[1], pt[0]], { pane: 'pRecintos', icon: L.divIcon({ className: '', html: `<span class="ap-badge">${ICONO}<b>${n}</b></span>`, iconSize: [58, 30], iconAnchor: [29, 15] }) })
          .bindTooltip(`<b>${esc(ed.nombre)}</b> · ${n} antenas Wi-Fi<br>1 antena por cada ${Math.round(1000 / dens)} m² construidos<br><small>Red PC-PUMA (oficial)</small>`, { direction: 'top', offset: [0, -14] })
          .on('click', () => seleccionarEdificio(e));
      }));
    }
    mapa.fitBounds(grupoEd.getBounds(), { padding: [20, 20] });
    const zoomCls = () => { const z = mapa.getZoom(); document.body.classList.toggle('zoom-lejos', z < 18); document.body.classList.toggle('zoom-muy-lejos', z < 17); };
    mapa.on('zoomend', zoomCls); zoomCls();
    mapa.on('click', (e) => { if (st.modoAqui) fijarUsuario(e.latlng, 'manual'); });
  }

  function visible(id) {
    const p = st.prop[id];
    if (st.piso === 'todas') return true;
    return (p.nivel || 0) === st.piso && (st.origen[id] === 'recinto' || st.piso === 0);
  }

  function estiloZona(id) {
    const p = st.prop[id], sel = st.seleccion === id, rec = st.origen[id] === 'recinto';
    const borde = sel ? { color: '#c99a2e', weight: 5 } : rec ? { color: '#002b5c', weight: 2 } : { color: '#ffffff', weight: 1.2 };
    if (!simulada(id)) {
      const verde = p.tipo === 'area_verde';
      return { ...borde, fillColor: verde ? '#9fd19a' : '#dfe3e8', fillOpacity: verde ? 0.55 : 0.5, dashArray: verde ? null : '4 4', color: sel ? '#c99a2e' : (verde ? '#7fbf79' : '#b8bec7') };
    }
    const dash = p.tipo === 'estacionamiento' ? '5 4' : null;
    if (st.capa === 'prioridad') {
      const res = st.kpi.recintos[id].resumen[escenarioActivo()];
      return { ...borde, dashArray: dash, fillColor: COLOR_PRIORIDAD[res.prioridad], fillOpacity: rec ? 0.85 : 0.5 };
    }
    if (st.capa === 'wifi') {
      const w = Sim.wifi(id, st.vivo[id].ocupacion);
      const c = !w.aplica ? '#e3e7ee' : !st.vivo[id].abierto ? COLOR.cerrado : COLOR[w.estado];
      return { ...borde, dashArray: dash, fillColor: c, fillOpacity: w.aplica ? (rec ? 0.8 : 0.55) : 0.25 };
    }
    return { ...borde, dashArray: dash, fillColor: COLOR[st.vivo[id].estado], fillOpacity: rec ? 0.85 : 0.5 };
  }

  /** Antenas por cada 1,000 m² construidos (huella × niveles). */
  function densidadAP(e) {
    const n = (st.kpi.red_pcpuma && st.kpi.red_pcpuma.ap_por_edificio[e]) || 0, ed = st.propEd[e];
    return n ? (n / (ed.superficie_m2 * Math.max(1, ed.niveles))) * 1000 : 0;
  }
  const COLOR_COB = ['#eef2f7', '#cfe0f3', '#8fb8e6', '#4a86cf', '#1d4f99'];
  function claseCobertura(d) { return d === 0 ? 0 : d < 2 ? 1 : d < 5 ? 2 : d < 10 ? 3 : 4; }

  function estiloEdificio(id) {
    const sel = st.seleccion === 'ed:' + id;
    const ed = st.propEd[id];
    const sinPiso = typeof st.piso === 'number' && st.piso >= ed.niveles;
    let fill = '#c9d2df';
    if (st.capa === 'prioridad') {
      const r = (st.kpi.edificios[id] || {})[escenarioActivo()];
      fill = r ? COLOR_PRIORIDAD[r.prioridad] : '#e3e7ee';
    }
    if (st.capa === 'wifi') return { fillColor: COLOR_COB[claseCobertura(densidadAP(id))], fillOpacity: 0.95, color: sel ? '#c99a2e' : '#1d4f99', weight: sel ? 5 : 1.2 };
    if (st.capa === 'ocupacion' && st.vivoEd[id]) {
      return { fillColor: COLOR[st.vivoEd[id].estado], fillOpacity: sinPiso ? 0.15 : 0.42, color: sel ? '#c99a2e' : '#5b6577', weight: sel ? 5 : 1.2 };
    }
    return { fillColor: fill, fillOpacity: sinPiso ? 0.25 : (st.capa === 'prioridad' ? 0.55 : 0.9), color: sel ? '#c99a2e' : '#7d8aa0', weight: sel ? 5 : 1 };
  }

  function pintarMapa() {
    if (grupoAP) { if (st.capa === 'wifi' && !mapa.hasLayer(grupoAP)) grupoAP.addTo(mapa); if (st.capa !== 'wifi' && mapa.hasLayer(grupoAP)) mapa.removeLayer(grupoAP); }
    Object.keys(st.capaEd).forEach((id) => {
      st.capaEd[id].setStyle(estiloEdificio(id));
      const v = st.vivoEd[id], et = id.length <= 3 ? id : st.propEd[id].nombre;
      st.capaEd[id].setTooltipContent(st.capa === 'ocupacion' && v && v.abierto ? `${esc(et)} <small>${pct(v.saturacion)}</small>` : esc(et));
    });
    Object.keys(st.capaZona).forEach((id) => {
      const capa = st.capaZona[id];
      const ver = visible(id);
      if (ver && !grupoZonas.hasLayer(capa)) grupoZonas.addLayer(capa);
      if (!ver && grupoZonas.hasLayer(capa)) grupoZonas.removeLayer(capa);
      if (!ver) return;
      capa.setStyle(estiloZona(id));
      if (simulada(id)) {
        const v = st.vivo[id];
        let txt = valorTxt(id, v);
        if (st.capa === 'prioridad') txt = st.kpi.recintos[id].resumen[escenarioActivo()].prioridad;
        if (st.capa === 'wifi') { const w = Sim.wifi(id, v.ocupacion); txt = !w.aplica ? '' : !w.cobertura ? 'sin señal' : (v.abierto ? pct(w.saturacion) : '—'); }
        capa.setTooltipContent(txt);
      }
    });
    const ley = $('leyenda');
    if (!ley.dataset.lista) {
      ley.dataset.lista = '1';
      if (window.innerWidth < 700 || $('mapa').clientHeight < 560) ley.classList.add('plegada');
      ley.addEventListener('click', () => ley.classList.toggle('plegada'));
    }
    const base = '<div class="ley-sep"></div><div><i style="background:#c9d2df;border:1px solid #7d8aa0"></i>Edificio (tono claro = ocupación del edificio completo)</div><div><i style="background:#dfe3e8;border:1px dashed #b8bec7"></i>Zona no simulada</div><div><i class="rayado"></i>Estacionamiento</div>';
    if (st.capa === 'wifi') {
      ley.innerHTML = '<div class="tit">Wi-Fi: demanda / capacidad</div>' +
        ['bajo', 'moderado', 'alto', 'critico'].map((e, k) => `<div><i style="background:${COLOR[e]}"></i>${['< 50 %', '50–75 %', '75–90 %', '≥ 90 % (red saturada)'][k]}</div>`).join('') +
        `<div><i style="background:${COLOR.sin}"></i>Sin cobertura</div>` +
        (st.kpi.red_pcpuma ? '<div class="ley-sep"></div><div class="tit">Edificios: antenas por 1,000 m²</div>' +
          [['Sin antenas registradas', 0], ['< 2', 1], ['2 – 5', 2], ['5 – 10', 3], ['≥ 10', 4]].map(([t, k]) => `<div><i style="background:${COLOR_COB[k]};border:1px solid #9bb3d1"></i>${t}</div>`).join('') +
          '<div><span class="ap-badge ap-ley">▾ <b>n</b></span> antenas del edificio</div>' : '');
    } else if (st.capa === 'prioridad') {
      ley.innerHTML = '<div class="tit">Prioridad de mantenimiento</div>' +
        ['alta', 'media', 'baja'].map((p) => `<div><i style="background:${COLOR_PRIORIDAD[p]}"></i>${p[0].toUpperCase() + p.slice(1)}</div>`).join('') + base;
    } else {
      const u = st.kpi.meta.umbrales;
      ley.innerHTML = '<div class="tit">Saturación actual</div>' +
        `<div><i style="background:${COLOR.bajo}"></i>Bajo &lt; ${u.moderado * 100} %</div>` +
        `<div><i style="background:${COLOR.moderado}"></i>Moderado ${u.moderado * 100}–${u.alto * 100} %</div>` +
        `<div><i style="background:${COLOR.alto}"></i>Alto ${u.alto * 100}–${u.critico * 100} %</div>` +
        `<div><i style="background:${COLOR.critico}"></i>Crítico ≥ ${u.critico * 100} %</div>` +
        `<div><i style="background:${COLOR.cerrado}"></i>Cerrado</div>` +
        '<div class="nota">Áreas abiertas por densidad: libre &lt; 0.1, cómodo, concurrido ≥ 0.3, congestionado ≥ 0.6 personas/m²</div>' + base;
    }
  }

  // ------------------------------------------------------------------ pisos
  function construirPisos() {
    const niveles = [...new Set(Object.keys(st.prop).filter((id) => st.origen[id] === 'recinto').map((id) => st.prop[id].nivel || 0))].sort((a, b) => b - a);
    if (!niveles.includes(0)) niveles.push(0);
    const html = ['<span class="pisos-tit">Planta</span>', '<button class="piso activo" data-piso="todas">Todas</button>']
      .concat(niveles.map((n) => `<button class="piso" data-piso="${n}" title="${nivelTxt(n)}">${n === 0 ? 'PB' : n}</button>`)).join('');
    $('pisos').innerHTML = html;
    $('pisos').addEventListener('click', (e) => {
      const b = e.target.closest('[data-piso]');
      if (!b) return;
      st.piso = b.dataset.piso === 'todas' ? 'todas' : Number(b.dataset.piso);
      document.querySelectorAll('.piso').forEach((x) => x.classList.toggle('activo', x === b));
      toast(st.piso === 'todas' ? 'Mostrando todas las plantas' : `Mostrando ${nivelTxt(st.piso).toLowerCase()}${st.piso === 0 ? ' y exteriores' : ''}`, 1800);
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

  function fijarUsuario(latlng, fuente, precision) {
    st.usuario = [latlng.lat, latlng.lng];
    salirModoAqui();
    const icono = L.divIcon({ className: '', html: '<div class="usuario-pin"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
    if (!marcadorUsuario) marcadorUsuario = L.marker(latlng, { icon: icono, zIndexOffset: 1000 }).addTo(mapa).bindTooltip('Tú');
    else marcadorUsuario.setLatLng(latlng);
    if (circuloPrecision) { mapa.removeLayer(circuloPrecision); circuloPrecision = null; }
    if (precision) circuloPrecision = L.circle(latlng, { radius: precision, color: '#c99a2e', weight: 1, fillOpacity: 0.12 }).addTo(mapa);
    const dFI = distanciaM(st.usuario, st.centroFI);
    if (fuente === 'gps' && dFI > RADIO_CU_M) { toast(`Estás a ${(dFI / 1000).toFixed(1)} km de la FI. Usa “Estoy aquí” para marcar tu posición.`, 6000); return; }
    const zona = st.zonas.features.filter((f) => visible(f.properties.id_recinto)).reverse()
      .find((f) => dentro(st.usuario[0], st.usuario[1], f.geometry));
    const edif = st.edificios.features.find((f) => dentro(st.usuario[0], st.usuario[1], f.geometry));
    if (lineaRuta) { mapa.removeLayer(lineaRuta); lineaRuta = null; }
    const sg = sugerencia(ahora());
    if (sg && sg.saturada) {
      irTabSilencioso('ahora');
      toast(`${sg.z.ed ? st.propEd[sg.z.id].nombre : nombre(sg.z.id)} está saturado: revisa la sugerencia en el panel`, 4500);
      if (st.seleccion) cerrarDetalle(); else actualizar();
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
    let alts = saturada ? Sim.alternativas(z.id, t, st.escenario, d) : [];
    if (saturada && !alts.length) {   // sin equivalente del mismo tipo: áreas de descanso cercanas con espacio
      alts = Object.keys(st.kpi.recintos).filter((id) => st.prop[id].descanso && st.vivo[id].abierto && ['bajo', 'moderado'].includes(st.vivo[id].estado))
        .map((id) => ({ id, nombre: nombre(id), ahora: st.vivo[id], dist: d[id], esEdificio: false })).sort((a, b) => a.dist - b.dist);
    }
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
          sg.alts.map((a) => `<button class="fila" data-ruta="${a.id}" data-esed="${a.esEdificio ? 1 : 0}"><span><span class="nom">${esc(a.nombre)}</span><br>
            <span class="meta">${valorTxt(a.id, a.ahora)} ahora${a.dist ? ` · a ${Math.round(a.dist)} m` : ''} · toca para ver la ruta</span></span><span class="chip ${a.ahora.estado}">Ir</span></button>`).join('')
        : '<p>Hay espacio aquí: no necesitas moverte.</p>');
  }

  function dibujarRuta(id, esEd) {
    const c = esEd ? st.centroides['ed:' + id] : st.centroides[id];
    if (!c || !st.usuario) return;
    if (lineaRuta) mapa.removeLayer(lineaRuta);
    lineaRuta = L.polyline([st.usuario, c], { color: '#c99a2e', weight: 5, dashArray: '10 8', opacity: 0.95 }).addTo(mapa);
    const dist = Math.round(distanciaM(st.usuario, c));
    toast(`Ruta sugerida: ${dist} m en línea recta (~${Math.max(1, Math.round(dist / 75))} min caminando)`, 5000);
    if (esEd) seleccionarEdificio(id); else seleccionar(id);
    mapa.fitBounds(L.latLngBounds([st.usuario, c]), { padding: [80, 80], maxZoom: 19 });
  }

  function usarGPS() {
    if (!('geolocation' in navigator)) { toast('Este navegador no permite geolocalización. Usa “Estoy aquí”.', 4000); return; }
    if (!window.isSecureContext) { toast('El GPS requiere HTTPS o localhost. Usa “Estoy aquí”.', 5000); return; }
    toast('Buscando tu ubicación…', 0);
    navigator.geolocation.getCurrentPosition(
      (p) => { fijarUsuario(L.latLng(p.coords.latitude, p.coords.longitude), 'gps', p.coords.accuracy); mapa.setView([p.coords.latitude, p.coords.longitude], Math.max(mapa.getZoom(), 18)); },
      (e) => toast(e.code === 1 ? 'Permiso de ubicación denegado. Usa “Estoy aquí”.' : 'No se obtuvo la ubicación. Usa “Estoy aquí”.', 5000),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  }
  function entrarModoAqui() { st.modoAqui = true; document.body.classList.add('modo-aqui'); $('btn-aqui').classList.add('activo'); toast('Toca el mapa en el lugar donde estás', 0); }
  function salirModoAqui() { st.modoAqui = false; document.body.classList.remove('modo-aqui'); $('btn-aqui').classList.remove('activo'); ocultarToast(); }

  // ------------------------------------------------------------------ actualización
  function actualizar() {
    const t = ahora();
    Object.keys(st.kpi.recintos).forEach((id) => { st.vivo[id] = Sim.ocupacionEnVivo(id, t, st.escenario); });
    Object.keys(st.kpi.edificios_sim || {}).forEach((id) => { st.vivoEd[id] = Sim.ocupacionEnVivo(id, t, st.escenario); });
    $('reloj-hora').textContent = Sim.horaTxt(t.getHours() * 60 + t.getMinutes());
    $('reloj-dia').textContent = `${DIAS_LARGO[t.getDay()]} ${t.getDate()}/${t.getMonth() + 1}`;
    $('badge-demo').hidden = !st.demo;
    pintarMapa();
    pintarAhora(t);
    pintarSugerencia(t);
    if (st.tab === 'cuellos') pintarCuellos(t);
    if (st.tab === 'generales') pintarGenerales(t);
    if (st.tab === 'mantto') pintarMantto();
    if (st.seleccion) (st.seleccion.startsWith('ed:') ? pintarEdificio(st.seleccion.slice(3), t) : pintarDetalle(st.seleccion, t));
  }

  function programarMinuto() {
    const tick = () => { $('prox-act').textContent = st.demo ? '(pausada: hora simulada)' : `(próxima en ${60 - new Date().getSeconds()} s)`; };
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
    $('kpi-recintos').textContent = eds.reduce((s_, e) => s_ + (st.vivoEd[e].abierto ? st.vivoEd[e].ocupacion : 0), 0).toLocaleString('es-MX');
    $('kpi-areas').textContent = suma((id) => categoria(id) === 'areas').toLocaleString('es-MX');
    $('kpi-cajones').textContent = capCaj ? pct(suma((id) => categoria(id) === 'estacionamientos') / capCaj) : '–';
    $('kpi-alertas').textContent = ab.filter((id) => ['alto', 'critico'].includes(st.vivo[id].estado)).length;
    $('kpi-escenario').textContent = escenarioActivo() === 'examenes' ? 'Exámenes' : 'Ordinario';

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
      ? '<div class="alerta info">Fuera de horario de servicio. Usa “Simular hora” para explorar el día.</div>'
      : alertas.slice(0, 4).map(({ id, r, ed }) => `<div class="alerta critico"><span class="ico">!</span><span><b>${esc(ed ? st.propEd[id].nombre : nombre(id))}:</b> ${r.texto}</span>
          <button class="ctl" ${ed ? `data-ed="${id}"` : `data-ir="${id}"`}>Ver</button></div>`).join('') + (alertas.length > 4 ? `<p class="nota">y ${alertas.length - 4} alertas más</p>` : '');

    const d = distanciasUsuario();
    if (st.filtro === 'edificios') {
      $('lista-recintos').innerHTML = eds.sort((a, b) => st.vivoEd[b].saturacion - st.vivoEd[a].saturacion).map((e) => {
        const v = st.vivoEd[e], ed = st.propEd[e];
        return `<button class="fila" data-ed="${e}">
          <span><span class="nom">${esc(ed.nombre)}</span><br><span class="meta">${v.abierto ? `${v.ocupacion.toLocaleString('es-MX')} / ${v.capacidad.toLocaleString('es-MX')} personas` : 'Cerrado'} · ${ed.niveles} niveles · Conjunto ${ed.conjunto === 'norte' ? 'Norte' : 'Sur'}${d ? ` · a ${Math.round(d['ed:' + e])} m` : ''}</span></span>
          <span class="chip ${v.estado}">${v.abierto ? pct(v.saturacion) : ETQ_ESTADO.cerrado}</span>
          <span class="barra-ocup"><span style="width:${v.saturacion * 100}%;background:${COLOR[v.estado]}"></span></span></button>`;
      }).join('');
      return;
    }
    const lista = ids.filter((id) => st.filtro === 'todo' || categoria(id) === st.filtro)
      .sort((a, b) => st.vivo[b].saturacion - st.vivo[a].saturacion);
    $('lista-recintos').innerHTML = lista.map((id) => {
      const v = st.vivo[id], p = st.prop[id];
      return `<button class="fila" data-ir="${id}">
        <span><span class="nom">${esc(p.nombre)}</span><br><span class="meta">${v.abierto ? (esDens(id) ? `${v.ocupacion} personas · ${ETQ_LOS[v.estado].toLowerCase()}` : `${v.ocupacion} / ${v.capacidad} ${unidadTxt(v.unidad)}`) : 'Cerrado'} · ${esc(ubicacionTxt(p))}${d ? ` · a ${Math.round(d[id])} m` : ''}</span></span>
        <span class="chip ${v.estado}">${v.abierto ? valorTxt(id, v) : ETQ_ESTADO.cerrado}</span>
        <span class="barra-ocup"><span style="width:${v.saturacion * 100}%;background:${COLOR[v.estado]}"></span></span>
      </button>`;
    }).join('') || '<p class="nota">Sin zonas en esta categoría.</p>';
  }

  // ------------------------------------------------------------------ P1 Cuellos de botella
  const res = (id) => st.kpi.recintos[id].resumen[escenarioActivo()];

  function pintarCuellos(t) {
    const esc_ = escenarioActivo(), dia = diaPerfil(t);
    const ids = Object.keys(st.kpi.recintos);
    const interiores = ids.filter((id) => categoria(id) === 'recintos').sort((a, b) => res(b).horas_alto_dia - res(a).horas_alto_dia);
    const est_ = ids.filter((id) => categoria(id) === 'estacionamientos' && res(id).hora_llenado).sort((a, b) => res(a).hora_llenado.localeCompare(res(b).hora_llenado));
    const ext = ids.filter((id) => categoria(id) === 'areas').sort((a, b) => res(b).horas_alto_dia - res(a).horas_alto_dia);
    const top = interiores.slice(0, 3);
    $('txt-cuellos').innerHTML = `En los recintos, los cuellos de botella son ${top.map((id) =>
      `<b>${esc(nombre(id))}</b> (${res(id).horas_alto_dia.toFixed(1)} h/día ≥ 75 %, pico ${res(id).hora_pico})`).join(', ')}. ` +
      (ext.length && res(ext[0]).horas_alto_dia > 0 ? `En exteriores destaca <b>${esc(nombre(ext[0]))}</b> en los cambios de clase. ` : '') +
      (est_.length ? `Los estacionamientos se llenan desde las <b>${res(est_[0]).hora_llenado}</b> (${esc(nombre(est_[0]))}).` : '');

    const resEd = (e) => st.kpi.edificios_sim[e].resumen[esc_];
    const edTop = Object.keys(st.kpi.edificios_sim || {}).sort((a, b) => resEd(b).horas_alto_dia - resEd(a).horas_alto_dia).slice(0, 6);
    $('txt-cuellos').innerHTML += edTop.length ? ` Entre los edificios completos, la mayor afluencia está en ${edTop.slice(0, 3).map((e) => `<b>${esc(st.propEd[e].nombre)}</b> (${resEd(e).horas_alto_dia.toFixed(1)} h/día ≥ 75 %)`).join(', ')}.` : '';
    const filas = interiores.concat(ext.slice(0, 4), est_.slice(0, 3), edTop.map((e) => 'ED:' + e));
    const porHora = 60 / st.kpi.meta.paso_min;
    const h0 = Sim.INICIO_MIN / 60, h1 = Sim.FIN_MIN / 60;
    const hAct = t.getHours();
    let html = '<tr><th></th>';
    for (let h = h0; h < h1; h++) html += `<th>${h}</th>`;
    html += '</tr>';
    filas.forEach((id, k) => {
      const n1 = interiores.length, n2 = n1 + Math.min(4, ext.length), n3 = n2 + Math.min(3, est_.length);
      if (k === n1 || k === n2 || k === n3) html += `<tr class="sep"><td colspan="${h1 - h0 + 1}"></td></tr>`;
      const esEd = id.startsWith('ED:'), cl = esEd ? id.slice(3) : id;
      const sat = Sim.serieDia(cl, esc_, dia).saturacion;
      const nom = esEd ? st.propEd[cl].nombre : nombre(id);
      html += `<tr><th class="rec" title="${esc(nom)}"><button class="link" ${esEd ? `data-ed="${cl}"` : `data-ir="${id}"`}>${esc(nom)}</button></th>`;
      for (let h = h0; h < h1; h++) {
        const i0 = (h - h0) * porHora;
        const m = sat.slice(i0, i0 + porHora).reduce((a, b) => a + b, 0) / porHora;
        const rz = esEd ? st.kpi.edificios_sim[cl] : st.kpi.recintos[cl];
        const e = m === 0 ? 'cerrado' : Sim.estadoZona(cl, m * rz.capacidad_max, m);
        const dz = !esEd && esDens(cl);
        html += `<td class="${h === hAct && (esEd ? st.vivoEd[cl] : st.vivo[id]).abierto ? 'ahora' : ''}" style="background:${COLOR[e]};${e === 'moderado' ? 'color:#3d3000' : ''}">${m === 0 ? '' : dz ? (m * rz.capacidad_max / rz.superficie_m2).toFixed(2).slice(1) : Math.round(m * 100)}</td>`;
      }
      html += '</tr>';
    });
    $('tabla-calor').innerHTML = html;
    $('cap-calor').textContent = `${DIAS_LARGO[Sim.DIAS_JS.indexOf(dia)]}, % de capacidad · % de capacidad; áreas comunes en personas/m² (.12 = 0.12) · recintos | áreas comunes | estacionamientos | edificios`;

    const grupoHist = (f) => { const ids_ = ids.filter(f); const n = st.kpi.meta.historico.semanas.length;
      return [...Array(n)].map((_, i) => ids_.reduce((s_, id) => s_ + st.kpi.recintos[id].historico.sat_media[i], 0) / (ids_.length || 1)); };
    const sem = st.kpi.meta.historico.semanas.map((d) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`);
    const hSal = grupoHist((id) => st.prop[id].subtipo === 'computo'), hBib = grupoHist((id) => st.prop[id].subtipo === 'biblioteca'), hLab = grupoHist((id) => st.prop[id].subtipo === 'laboratorio');
    grafica('g-tendencia', {
      type: 'line',
      data: { labels: sem, datasets: [['Salas de cómputo', hSal], ['Biblioteca', hBib], ['Laboratorios', hLab]].map(([l, d], k) => ({
        label: l, data: d.map((x) => Math.round(x * 100)), borderColor: SERIE[k], backgroundColor: SERIE[k], tension: 0.3, pointRadius: 3, borderWidth: 2.5 })) },
      options: { scales: { y: { min: 0, title: { display: true, text: '% saturación media' } } } },
    });
    const bib = ids.find((id) => st.prop[id].subtipo === 'biblioteca');
    const cambio = Math.round((hSal[hSal.length - 1] / hSal[0] - 1) * 100);
    $('txt-tendencia').innerHTML = (bib ? `La Biblioteca recibe ~<b>${res(bib).visitas_dia.toLocaleString('es-MX')} visitas</b> y <b>${res(bib).prestamos_dia} préstamos</b> al día, con pico a las ${res(bib).hora_pico}. ` : '') +
      `En el semestre, la saturación media de las salas de cómputo ${cambio >= 0 ? 'subió' : 'bajó'} <b>${Math.abs(cambio)} %</b>, con repunte en la semana de parciales.`;

    grafica('g-cuellos', {
      type: 'bar',
      data: { labels: interiores.map(nombre), datasets: [
        { label: 'Alto o crítico (≥ 75 %)', data: interiores.map((id) => res(id).horas_alto_dia), backgroundColor: COLOR.alto },
        { label: 'Crítico (≥ 90 %)', data: interiores.map((id) => res(id).horas_critico_dia), backgroundColor: COLOR.critico }] },
      options: { indexAxis: 'y', scales: { x: { title: { display: true, text: 'horas por día' } } } },
    });
  }

  // ------------------------------------------------------------------ P2 Instalaciones generales
  function pintarGenerales(t) {
    const esc_ = escenarioActivo(), dia = diaPerfil(t);
    const ids = Object.keys(st.kpi.recintos);
    const gen = ids.filter((id) => categoria(id) === 'areas' || st.prop[id].tipo === 'instalacion_general');
    const total = gen.reduce((s, id) => s + res(id).personas_hora_dia, 0);
    const porSub = {};
    gen.forEach((id) => { const s = st.prop[id].subtipo; porSub[s] = (porSub[s] || 0) + res(id).personas_hora_dia; });
    const subs = Object.keys(porSub).sort((a, b) => porSub[b] - porSub[a]);
    const top = gen.slice().sort((a, b) => res(b).personas_hora_dia - res(a).personas_hora_dia).slice(0, 6);
    const norte = gen.filter((id) => (st.prop[id].conjunto || (st.propEd[st.prop[id].id_edificio] || {}).conjunto) === 'norte').reduce((s, id) => s + res(id).personas_hora_dia, 0);
    $('txt-generales').innerHTML = `Por tipo de espacio, <b>${plural(subs[0])}</b> concentran el ${Math.round(porSub[subs[0]] / total * 100)} % del uso ` +
      `y <b>${plural(subs[1])}</b> el ${Math.round(porSub[subs[1]] / total * 100)} %. ` +
      `La zona más usada es <b>${esc(nombre(top[0]))}</b> (pico ${res(top[0]).hora_pico}). ` +
      `El Conjunto Sur recibe el ${Math.round((1 - norte / total) * 100)} % del uso de las instalaciones generales. ` +
      (() => { const pr_ = gen.filter((id) => st.prop[id].descanso === 'principal'); const d_ = gen.filter((id) => st.prop[id].descanso);
        const sd = d_.reduce((s_, id) => s_ + res(id).personas_hora_dia, 0);
        return pr_.length ? `Las áreas de descanso principales (${pr_.map((id) => esc(nombre(id))).join(', ')}) reúnen el ${Math.round(pr_.reduce((s_, id) => s_ + res(id).personas_hora_dia, 0) / sd * 100)} % del uso de todas las áreas de descanso.` : ''; })();
    $('cap-generales').textContent = `${DIAS_LARGO[Sim.DIAS_JS.indexOf(dia)]}, 6 zonas más usadas, % de capacidad`;
    grafica('g-generales-linea', {
      type: 'line',
      data: { labels: st.kpi.meta.horas, datasets: top.map((id, k) => ({
        label: nombre(id), data: Sim.serieDia(id, esc_, dia).saturacion.map((s) => Math.round(s * 100)),
        borderColor: SERIE[k % SERIE.length], backgroundColor: SERIE[k % SERIE.length], pointRadius: 0, tension: 0.3, borderWidth: 2.5 })) },
      options: { scales: { y: { min: 0, max: 100, title: { display: true, text: '% de capacidad' } }, x: { ticks: { maxTicksLimit: 8 } } },
        plugins: { marcaAhora: { minuto: Sim.minutoDelDia(t) }, legend: { labels: { boxWidth: 10, font: { size: 11 } } } } },
    });
    grafica('g-generales-dona', {
      type: 'doughnut',
      data: { labels: subs.map((s) => ETQ_SUBTIPO[s] || s), datasets: [{ data: subs.map((s) => Math.round(porSub[s])), backgroundColor: subs.map((_, k) => SERIE[k % SERIE.length]), borderWidth: 2 }] },
      options: { plugins: { legend: { position: 'right' } } },
    });
    // Áreas de descanso
    const desc = ids.filter((id) => st.prop[id].descanso).sort((a, b) => (st.prop[a].descanso === 'principal' ? -1 : 1) - (st.prop[b].descanso === 'principal' ? -1 : 1) || res(b).personas_hora_dia - res(a).personas_hora_dia);
    $('tabla-descanso').innerHTML = '<tr><th>Área</th><th>Tipo</th><th class="num">Ahora<br><small>pers./m²</small></th><th class="num">Pico</th><th>Wi-Fi pico</th></tr>' +
      desc.map((id) => { const v = st.vivo[id], r = res(id), w = st.kpi.recintos[id].wifi_ap;
        return `<tr><td><button class="link" data-ir="${id}">${esc(nombre(id))}</button></td><td>${st.prop[id].descanso === 'principal' ? '<b>Principal</b>' : 'Secundaria'}</td>
        <td class="num"><span class="chip ${v.estado}">${valorTxt(id, v)}</span></td><td class="num">${r.hora_pico}</td>
        <td>${!w ? '<span class="chip sin">Sin señal</span>' : `<span class="chip ${Sim.estado(r.wifi_sat_pico)}">${pct(r.wifi_sat_pico)}</span>`}</td></tr>`; }).join('');
    // Conectividad
    const conWifi = ids.filter((id) => st.kpi.recintos[id].wifi_dispositivos_por_persona);
    const sinCob = conWifi.filter((id) => !st.kpi.recintos[id].wifi_ap);
    const wifiOrd = conWifi.filter((id) => st.kpi.recintos[id].wifi_ap).sort((a, b) => res(b).wifi_sat_pico - res(a).wifi_sat_pico);
    const saturadas = wifiOrd.filter((id) => res(id).wifi_sat_pico >= 0.9);
    grafica('g-wifi', {
      type: 'bar',
      data: { labels: wifiOrd.slice(0, 12).map(nombre), datasets: [{ label: 'Demanda pico / capacidad Wi-Fi (%)', data: wifiOrd.slice(0, 12).map((id) => Math.round(res(id).wifi_sat_pico * 100)),
        backgroundColor: wifiOrd.slice(0, 12).map((id) => COLOR[Sim.estado(res(id).wifi_sat_pico)]) }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { min: 0, title: { display: true, text: '% de la capacidad de los puntos de acceso' } } } },
    });
    $('txt-wifi').innerHTML = `${saturadas.length} zonas saturan su red en hora pico (${saturadas.slice(0, 3).map((id) => `<b>${esc(nombre(id))}</b>`).join(', ')}${saturadas.length > 3 ? '…' : ''}). ` +
      (sinCob.length ? `Sin cobertura: ${sinCob.map((id) => esc(nombre(id))).join(', ')}.` : '');
    // Red PC-PUMA oficial vs. modelo
    if (red()) {
      const v_ = red().validacion, hs = red().uso.horas.map((h) => `${h}:00`);
      grafica('g-red-conj', {
        type: 'line',
        data: { labels: hs, datasets: [
          { label: 'Norte · oficial', data: red().uso.conjuntos.norte.relativo.map((x) => Math.round(x * 100)), borderColor: '#002b5c', backgroundColor: '#002b5c', borderWidth: 3, tension: 0.3, pointRadius: 0 },
          { label: 'Norte · modelo', data: v_.norte.simulado_relativo.map((x) => Math.round(x * 100)), borderColor: '#002b5c', backgroundColor: '#002b5c', borderDash: [6, 4], borderWidth: 2, tension: 0.3, pointRadius: 0 },
          { label: 'Sur · oficial', data: red().uso.conjuntos.sur.relativo.map((x) => Math.round(x * 100)), borderColor: '#c99a2e', backgroundColor: '#c99a2e', borderWidth: 3, tension: 0.3, pointRadius: 0 },
          { label: 'Sur · modelo', data: v_.sur.simulado_relativo.map((x) => Math.round(x * 100)), borderColor: '#c99a2e', backgroundColor: '#c99a2e', borderDash: [6, 4], borderWidth: 2, tension: 0.3, pointRadius: 0 }] },
        options: { scales: { y: { min: 0, max: 100, title: { display: true, text: '% del máximo del día' } } }, plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } } } },
      });
      $('txt-red').innerHTML = `La Red PC-PUMA tiene <b>${red().ap_total} puntos de acceso</b> en la FI (${Object.values(red().ap_por_edificio).length} edificios con antenas). ` +
        `Su uso real crece desde las 7:00, se mantiene alto de 11:00 a 17:00 y cae después de las 19:00. ` +
        `El modelo de ocupación del SIG reproduce esa curva: correlación de <b>${v_.norte.correlacion.toFixed(2)}</b> en el Conjunto Norte y <b>${v_.sur.correlacion.toFixed(2)}</b> en el Sur.`;
      const e_ = red().estadisticas;
      if (e_) {
        $('red-stats').innerHTML = [[e_.clientes_unicos.toLocaleString('es-MX'), `clientes únicos (${e_.periodo})`],
          [e_.clientes_promedio_dia.toLocaleString('es-MX'), 'clientes por día'], [`${e_.gb_promedio_por_cliente} GB`, 'uso promedio por cliente'],
          [Math.round(e_.clientes_promedio_dia / red().ap_total), 'clientes por punto de acceso al día']]
          .map(([v, l]) => `<div class="kpi"><span class="kpi-v">${v}</span><span class="kpi-l">${l}</span></div>`).join('');
        const apps = Object.entries(e_.trafico_tb).sort((a_, b_) => b_[1] - a_[1]);
        grafica('g-red-apps', {
          type: 'bar',
          data: { labels: apps.map((x) => x[0]), datasets: [{ label: 'TB', data: apps.map((x) => x[1]), backgroundColor: apps.map((_, k) => SERIE[k % SERIE.length]) }] },
          options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: `terabytes transferidos (${e_.periodo})` } } } },
        });
      }
    }
    // Tráfico
    const traf = gen.filter((id) => ['pasillo', 'acceso', 'plaza'].includes(st.prop[id].subtipo)).sort((a, b) => res(b).flujo_pico_h - res(a).flujo_pico_h);
    $('tabla-trafico').innerHTML = '<tr><th>Zona</th><th class="num">Ahora<br><small>pers./h</small></th><th class="num">Pico<br><small>pers./h</small></th><th class="num">Al día</th></tr>' +
      traf.map((id) => `<tr><td><button class="link" data-ir="${id}">${esc(nombre(id))}</button></td><td class="num">${Sim.flujoHora(id, t, st.escenario).toLocaleString('es-MX')}</td>
        <td class="num">${res(id).flujo_pico_h.toLocaleString('es-MX')}</td><td class="num">${res(id).flujo_dia.toLocaleString('es-MX')}</td></tr>`).join('');

    const est_ = ids.filter((id) => categoria(id) === 'estacionamientos').sort((a, b) => (res(a).hora_llenado || '99').localeCompare(res(b).hora_llenado || '99'));
    $('tabla-estac').innerHTML = '<tr><th>Estacionamiento</th><th class="num">Cajones</th><th class="num">Se llena</th><th class="num">h ≥ 90 %</th><th class="num">Ahora</th></tr>' +
      est_.map((id) => `<tr><td><button class="link" data-ir="${id}">${esc(nombre(id))}</button></td><td class="num">${st.kpi.recintos[id].capacidad_max}</td>
        <td class="num">${res(id).hora_llenado || '—'}</td><td class="num">${res(id).horas_critico_dia.toFixed(1)}</td>
        <td class="num"><span class="chip ${st.vivo[id].estado}">${st.vivo[id].abierto ? pct(st.vivo[id].saturacion) : '—'}</span></td></tr>`).join('');
  }

  // ------------------------------------------------------------------ P3 Mantenimiento
  function pintarMantto() {
    const esc_ = escenarioActivo();
    const eds = Object.keys(st.kpi.edificios).sort((a, b) => st.kpi.edificios[b][esc_].indice_prioridad - st.kpi.edificios[a][esc_].indice_prioridad);
    const re = (e) => st.kpi.edificios[e][esc_];
    const zonas = Object.keys(st.kpi.recintos).sort((a, b) => res(b).indice_prioridad - res(a).indice_prioridad);
    const edAlta = eds.filter((e) => re(e).prioridad === 'alta');
    const zAlta = zonas.filter((id) => res(id).prioridad === 'alta' && st.kpi.recintos[id].unidad === 'personas');
    $('txt-mantto').innerHTML = (edAlta.length ? `Edificios con prioridad <b>alta</b>: ${edAlta.map((e) => `<b>${esc(st.propEd[e].nombre)}</b>`).join(', ')}. ` : `El edificio con mayor índice es <b>${esc(st.propEd[eds[0]].nombre)}</b> (${re(eds[0]).indice_prioridad.toFixed(2)}). `) +
      (zAlta.length ? `Zonas con prioridad alta: ${zAlta.map((id) => `<b>${esc(nombre(id))}</b>`).join(', ')}. ` : '') +
      'El índice combina uso por m², horas en saturación y estado físico: ahí conviene programar primero la revisión de equipo, mobiliario y limpieza, o ampliar capacidad en horas pico.';
    grafica('g-mantto', {
      type: 'bar',
      data: { labels: eds.map((e) => st.propEd[e].nombre), datasets: [{ label: 'Índice de prioridad', data: eds.map((e) => re(e).indice_prioridad), backgroundColor: eds.map((e) => COLOR_PRIORIDAD[re(e).prioridad]) }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 1 } } },
    });
    if (red()) {
      const eds2 = Object.keys(st.propEd).filter((e) => red().uso.zonas[e]).sort((a, b) => red().uso.zonas[b].intensidad_pico - red().uso.zonas[a].intensidad_pico);
      const mx = red().uso.zonas[eds2[0]].intensidad_pico;
      grafica('g-red-ed', {
        type: 'bar',
        data: { labels: eds2.map((e) => st.propEd[e].nombre), datasets: [{ label: 'Intensidad de uso de red (oficial)', data: eds2.map((e) => Math.round(red().uso.zonas[e].intensidad_pico / mx * 100)),
          backgroundColor: eds2.map((e, k) => (k < 5 ? '#d43d3d' : k < 12 ? '#ee8a2b' : '#7aa6e0')) }] },
        options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 100, title: { display: true, text: 'índice relativo en hora pico (100 = máximo)' } } } },
      });
      $('txt-red-ed').innerHTML = `Según la Red PC-PUMA, los edificios con mayor densidad de dispositivos en hora pico son ${eds2.slice(0, 4).map((e) => `<b>${esc(st.propEd[e].nombre)}</b>`).join(', ')}: evidencia real para priorizar mantenimiento y ampliar la red.`;
    }
    $('tabla-mantto').innerHTML = '<tr><th>Zona</th><th class="num">Densidad<br><small>uso·h/m²</small></th><th class="num">h ≥ 75 %</th><th>Estado</th><th>Prioridad</th></tr>' +
      zonas.map((id) => { const r = res(id), p = st.prop[id]; return `<tr><td><button class="link" data-ir="${id}">${esc(p.nombre)}</button>${p.tipo === 'estacionamiento' ? ' <small>(vehículos)</small>' : ''}</td>
        <td class="num">${r.densidad_uso.toFixed(2)}</td><td class="num">${r.horas_alto_dia.toFixed(1)}</td>
        <td>${p.estado_fisico || '—'}${est(p, 'estado_fisico')}</td><td><span class="chip p-${r.prioridad}">${r.prioridad}</span></td></tr>`; }).join('');
    $('nota-indice').textContent = `Índice = ${st.kpi.meta.indice_prioridad}. Personas y vehículos se comparan por separado. Promedio lunes a viernes, escenario ${esc_ === 'examenes' ? 'exámenes' : 'ordinario'}.`;
  }

  // ------------------------------------------------------------------ fichas
  function abrirDetalle() {
    $('detalle').hidden = false;
    document.querySelector('.panel').classList.add('con-detalle');
    $('detalle').scrollTop = 0;
    if (window.innerWidth < 900) $('detalle').scrollIntoView({ block: 'start' });
  }
  function seleccionar(id) {
    const p = st.prop[id];
    if (st.piso !== 'todas' && !visible(id)) { st.piso = 'todas'; document.querySelectorAll('.piso').forEach((x) => x.classList.toggle('activo', x.dataset.piso === 'todas')); }
    st.seleccion = id;
    abrirDetalle();
    const c = st.capaZona[id];
    if (c && mapa) mapa.fitBounds(c.getBounds(), { maxZoom: 19, padding: [60, 60] });
    if (!p) return;
    actualizar();
  }
  function seleccionarEdificio(id) {
    st.seleccion = 'ed:' + id;
    abrirDetalle();
    if (st.capaEd[id] && mapa) mapa.fitBounds(st.capaEd[id].getBounds(), { maxZoom: 19, padding: [60, 60] });
    actualizar();
  }
  function cerrarDetalle() { st.seleccion = null; $('detalle').hidden = true; document.querySelector('.panel').classList.remove('con-detalle'); actualizar(); }

  function dato(etq, valor) { return valor === null || valor === undefined || valor === '' ? '' : `<span>${etq}<br><b>${valor}</b></span>`; }

  function pintarDetalle(id, t) {
    const p = st.prop[id];
    const d = distanciasUsuario();
    $('det-nombre').textContent = p.nombre;
    $('det-aqui').textContent = '✋ Estoy aquí (esta zona)';
    $('det-edificio').hidden = !p.id_edificio;
    if (p.id_edificio) $('det-edificio').textContent = `Ver ${st.propEd[p.id_edificio] ? st.propEd[p.id_edificio].nombre : 'edificio'} completo`;
    if (!simulada(id)) {
      $('det-cuerpo').innerHTML = `<div class="alerta info">${ETQ_SUBTIPO[p.subtipo] || 'Zona'}: no se simula su ocupación.</div>
        <div class="det-datos">${dato('Ubicación', esc(ubicacionTxt(p)))}${dato('Superficie', `${p.superficie_m2.toLocaleString('es-MX')} m²`)}
        ${dato('Estado físico', (p.estado_fisico || '—') + est(p, 'estado_fisico'))}${dato('Piso', p.material_piso ? p.material_piso + est(p, 'material_piso') : null)}
        ${d ? dato('Distancia', `${Math.round(d[id])} m`) : ''}${dato('Observaciones', esc(p.observaciones))}</div>`;
      $('det-reglas').innerHTML = ''; $('det-alternativas').innerHTML = ''; $('det-graf').hidden = true; $('det-hist').hidden = true;
      graficaRed(id);
      return;
    }
    $('det-graf').hidden = false;
    const r = st.kpi.recintos[id], v = st.vivo[id];
    const pr = Sim.prediccion(id, t, st.escenario);
    const rs = r.resumen[pr.escenario];
    const u = r.unidad;
    $('det-cuerpo').innerHTML = `
      <div class="det-grande"><span class="n">${v.ocupacion}</span><span>${esDens(id) ? 'personas' : `/ ${r.capacidad_max} ${unidadTxt(u)}${est(p, 'capacidad_max')}`}</span>
        <span class="chip ${v.estado}">${estadoTxt(id, v.estado)}</span><span class="pct">${v.abierto ? valorTxt(id, v) : ''}</span></div>
      ${esDens(id) ? '<p class="nota">Área abierta: sin cupo fijo; se evalúa por nivel de servicio (personas por m²).</p>' : ''}
      <div class="barra-ocup"><span style="width:${v.saturacion * 100}%;background:${COLOR[v.estado]}"></span></div>
      <div class="det-datos">
        ${dato('Tipo', (ETQ_SUBTIPO[p.subtipo] || p.tipo) + est(p, 'subtipo'))}
        ${dato('Ubicación', esc(ubicacionTxt(p)))}
        ${dato('Superficie', `${p.superficie_m2.toLocaleString('es-MX')} m²`)}
        ${dato('Horario', `${p.hora_apertura}–${p.hora_cierre}${est(p, 'hora_apertura')}`)}
        ${u === 'personas' ? dato('Densidad actual', `${(v.ocupacion / p.superficie_m2).toFixed(2)} personas/m²`) : dato('Cajones libres', `${r.capacidad_max - v.ocupacion}`)}
        ${dato('Hora pico típica', rs.hora_pico)}
        ${p.equipos ? dato('Equipos', `${p.equipos}${est(p, 'equipos')} · ${v.abierto ? (v.ocupacion / p.equipos).toFixed(1) : '0'} pers./equipo`) : ''}
        ${dato('Estado físico', (p.estado_fisico || '—') + est(p, 'estado_fisico'))}
        ${p.material_piso ? dato('Piso', p.material_piso + est(p, 'material_piso')) : ''}
        ${u === 'personas' && v.abierto ? dato('Flujo ahora', `${Sim.flujoHora(id, t, st.escenario).toLocaleString('es-MX')} personas/h`) : ''}
        ${wifiTxt(id, v, p)}
        ${p.descanso ? dato('Área de descanso', (p.descanso === 'principal' ? 'Principal' : 'Secundaria') + est(p, 'descanso')) : ''}
        ${p.subtipo === 'biblioteca' ? dato('Visitas hoy', `${Sim.acumuladoDia(id, t, st.escenario).toLocaleString('es-MX')} <small>de ~${rs.visitas_dia.toLocaleString('es-MX')}/día</small>`) +
          dato('Préstamos hoy', `${Math.round(Sim.acumuladoDia(id, t, st.escenario) * st.kpi.meta.prestamos_por_visita)} <small>de ~${rs.prestamos_dia}/día</small>`) : ''}
        ${dato('Prioridad mantto.', `<span class="chip p-${rs.prioridad}">${rs.prioridad}</span>`)}
        ${d ? dato('Distancia', `${Math.round(d[id])} m`) : ''}
        ${dato('Responsable', esc(p.responsable))}${dato('Observaciones', esc(p.observaciones))}
      </div>`;
    $('det-reglas').innerHTML = '<h3 class="h-sec">Pronóstico próxima hora</h3>' +
      (v.abierto ? `<div class="det-datos cuatro">${pr.puntos.map((q) => `<span>${q.hora}<br><b style="color:${COLOR[q.estado]}">${q.estado === 'cerrado' ? 'Cerrado' : esDens(id) ? (q.ocupacion / p.superficie_m2).toFixed(2) + ' p/m²' : pct(q.saturacion)}</b></span>`).join('')}</div>` : '') +
      pr.reglas.map((q) => `<div class="alerta ${q.nivel}"><b>${q.codigo}</b> ${q.texto}</div>`).join('');
    const alt = v.abierto ? Sim.alternativas(id, t, st.escenario, d) : [];
    const necesita = pr.reglas.some((q) => q.codigo === 'R3');
    $('det-alternativas').innerHTML = necesita && alt.length
      ? '<h3 class="h-sec">Alternativas con espacio</h3>' + alt.slice(0, 3).map((a) => `<button class="fila" ${a.esEdificio ? `data-ed="${a.id}"` : `data-ir="${a.id}"`}>
          <span><span class="nom">${esc(a.nombre)}</span><br><span class="meta">${valorTxt(a.id, a.ahora)} ahora · ${a.esEdificio ? 'edificio' : esc(ubicacionTxt(st.prop[a.id]))}${a.dist ? ` · a ${Math.round(a.dist)} m` : ''}</span></span>
          <span class="chip ${a.ahora.estado}">Ir</span></button>`).join('')
      : (necesita ? '<p class="nota">No hay alternativas del mismo tipo con espacio en los próximos 30 min.</p>' : '');
    graficaPerfil(Sim.serieDia(id, pr.escenario, diaPerfil(t)).ocupacion, r.capacidad_max, u, v, pr, t);
    graficaHistorico([{ label: p.nombre, data: r.historico.sat_media }]);
    graficaRed(p.id_edificio || id);
  }

  function wifiTxt(id, v, p) {
    const w = Sim.wifi(id, v.ocupacion);
    if (!w.aplica) return '';
    if (!w.cobertura) return dato('Wi-Fi', `<span class="chip sin">Sin cobertura</span>${est(p, 'wifi_ap')}`);
    const ofi = (st.kpi.recintos[id].wifi_fuente || '').startsWith('oficial');
    return dato('Wi-Fi', `${w.dispositivos} / ${w.capacidad} disp. <span class="chip ${v.abierto ? w.estado : 'cerrado'}">${v.abierto ? pct(w.saturacion) : '—'}</span><br><small>${w.ap} punto${w.ap > 1 ? 's' : ''} de acceso${ofi ? ' · Red PC-PUMA' : ''}</small>${ofi ? '' : est(p, 'wifi_ap')}`);
  }

  const red = () => st.kpi.red_pcpuma;
  function graficaRed(clave) {
    const z = red() && red().uso.zonas[clave];
    $('det-red').hidden = !z;
    if (!z) return;
    grafica('g-red', {
      type: 'line',
      data: { labels: red().uso.horas.map((h) => `${h}:00`), datasets: [{ label: 'Uso de la red (oficial)', data: z.relativo.map((x) => Math.round(x * 100)),
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
      options: { plugins: { legend: { display: series.length > 1 } }, scales: { y: { min: 0, title: { display: true, text: '% saturación media' } } } },
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
    $('det-aqui').textContent = '✋ Estoy aquí (este edificio)';
    $('det-edificio').hidden = true;
    const niveles = [...new Set(rids.map((id) => st.prop[id].nivel || 0))].sort((a, b) => a - b);
    const pr = es ? Sim.prediccion(eid, t, st.escenario) : null;
    $('det-cuerpo').innerHTML = `
      ${v ? `<div class="det-grande"><span class="n">${v.ocupacion.toLocaleString('es-MX')}</span><span>/ ${v.capacidad.toLocaleString('es-MX')} personas en el edificio <span class="est" title="Capacidad estimada por superficie construida y calibrada con los clientes diarios de la Red PC-PUMA">est.</span></span>
        <span class="chip ${v.estado}">${ETQ_ESTADO[v.estado]}</span><span class="pct">${v.abierto ? pct(v.saturacion) : ''}</span></div>
        <div class="barra-ocup"><span style="width:${v.saturacion * 100}%;background:${COLOR[v.estado]}"></span></div>` : ''}
      <div class="det-datos">
        ${dato('Conjunto', ed.conjunto === 'norte' ? 'Norte' : 'Sur (Anexo)')}${dato('Niveles', ed.niveles + est(ed, 'niveles'))}
        ${dato('Superficie construida', `${Math.round(ed.superficie_m2 * Math.max(1, ed.niveles)).toLocaleString('es-MX')} m²`)}${dato('Uso principal', (ed.uso_principal || '—') + est(ed, 'uso_principal'))}
        ${v && v.abierto ? dato('Densidad actual', `${(v.ocupacion / (ed.superficie_m2 * Math.max(1, ed.niveles)) * 100).toFixed(1)} personas/100 m²`) : ''}
        ${ag ? dato('Hora pico típica', ag.hora_pico) : ''}
        ${capR ? dato('En sus recintos', `${ocupR} / ${capR} personas`) : ''}
        ${dato('Estado físico', (ed.estado_fisico || '—') + est(ed, 'estado_fisico'))}
        ${ag ? dato('Prioridad mantto.', `<span class="chip p-${ag.prioridad}">${ag.prioridad}</span> ${ag.indice_prioridad.toFixed(2)}`) : ''}
        ${ag ? dato('Uso diario', `${Math.round(ag.personas_hora_dia).toLocaleString('es-MX')} personas·h`) : ''}
        ${red() && red().ap_por_edificio[eid] ? dato('Puntos de acceso', `${red().ap_por_edificio[eid]} <small>Red PC-PUMA</small>`) : ''}
        ${v ? wifiTxtEd(eid, v) : ''}
        ${es ? dato('Forma del perfil', es.perfil_fuente) : ''}
        ${dato('Observaciones', esc(ed.observaciones))}
      </div>
      ${rids.length ? niveles.map((n) => `<h3 class="h-sec">${nivelTxt(n)}</h3>` + rids.filter((id) => (st.prop[id].nivel || 0) === n).map((id) => {
        const vr = st.vivo[id];
        return vr ? `<button class="fila" data-ir="${id}"><span><span class="nom">${esc(nombre(id))}</span><br><span class="meta">${vr.abierto ? `${vr.ocupacion} / ${vr.capacidad} personas` : 'Cerrado'}</span></span>
          <span class="chip ${vr.estado}">${vr.abierto ? pct(vr.saturacion) : 'Cerrado'}</span><span class="barra-ocup"><span style="width:${vr.saturacion * 100}%;background:${COLOR[vr.estado]}"></span></span></button>`
          : `<button class="fila" data-ir="${id}"><span class="nom">${esc(nombre(id))}</span></button>`;
      }).join('')).join('') : '<p class="nota">Este edificio no tiene recintos digitalizados; se simula su ocupación como edificio completo.</p>'}`;
    $('det-reglas').innerHTML = pr && v.abierto ? '<h3 class="h-sec">Pronóstico próxima hora</h3>' +
      `<div class="det-datos cuatro">${pr.puntos.map((q) => `<span>${q.hora}<br><b style="color:${COLOR[q.estado]}">${q.estado === 'cerrado' ? 'Cerrado' : pct(q.saturacion)}</b></span>`).join('')}</div>` +
      pr.reglas.map((q) => `<div class="alerta ${q.nivel}"><b>${q.codigo}</b> ${q.texto}</div>`).join('') : '';
    $('det-alternativas').innerHTML = '';
    $('det-graf').hidden = !es;
    if (es) {
      graficaPerfil(Sim.serieDia(eid, esc_, diaPerfil(t)).ocupacion, es.capacidad_max, 'personas', v, pr, t);
      graficaHistorico([{ label: ed.nombre, data: es.historico.sat_media }]);
    } else { $('det-hist').hidden = true; }
    graficaRed(eid);
  }

  function wifiTxtEd(eid, v) {
    const w = Sim.wifi(eid, v.ocupacion);
    if (!w.aplica) return '';
    if (!w.cobertura) return dato('Wi-Fi', '<span class="chip sin">Sin antenas registradas</span>');
    return dato('Wi-Fi del edificio', `${w.dispositivos.toLocaleString('es-MX')} / ${w.capacidad.toLocaleString('es-MX')} disp. <span class="chip ${v.abierto ? w.estado : 'cerrado'}">${v.abierto ? pct(w.saturacion) : '—'}</span>`);
  }

  function graficaPerfil(serie, cap, unidad, v, pr, t) {
    const horas = st.kpi.meta.horas;
    const idx = (m) => (m - Sim.INICIO_MIN) / st.kpi.meta.paso_min;
    const xAhora = idx(Sim.minutoDelDia(t));
    const actual = v.abierto ? [{ x: xAhora, y: v.ocupacion }] : [];
    const pron = v.abierto && pr ? [{ x: xAhora, y: v.ocupacion }].concat(pr.puntos.filter((q) => q.estado !== 'cerrado').map((q) => ({ x: idx(q.minuto), y: q.ocupacion }))) : [];
    grafica('g-detalle', {
      type: 'line',
      data: { labels: horas, datasets: [
        { label: 'Perfil típico', data: serie, borderColor: '#002b5c', backgroundColor: 'rgba(0,43,92,.08)', fill: true, pointRadius: 0, tension: 0.3, borderWidth: 2 },
        { label: 'Pronóstico 1 h', data: pron, parsing: false, borderColor: '#c99a2e', borderDash: [6, 4], borderWidth: 3, pointRadius: 3, pointBackgroundColor: '#c99a2e' },
        { label: 'Ahora', type: 'scatter', data: actual, parsing: false, pointRadius: 8, pointBackgroundColor: COLOR[v.estado], pointBorderColor: '#002b5c', pointBorderWidth: 2 },
        { label: 'Capacidad', data: horas.map(() => cap), borderColor: '#d43d3d', borderDash: [2, 3], pointRadius: 0, borderWidth: 1.5 }] },
      options: { scales: { y: { min: 0, suggestedMax: cap * 1.05, title: { display: true, text: unidadTxt(unidad) } },
        x: { type: 'linear', min: 0, max: horas.length - 1, ticks: { stepSize: 8, callback: (val) => horas[val] || '' } } } },
    });
  }

  // ------------------------------------------------------------------ gráficas
  function configurarChart() {
    Chart.defaults.font.family = getComputedStyle(document.documentElement).fontFamily;
    Chart.defaults.color = '#14213d';
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.animation = false;
    Chart.defaults.plugins.legend.labels.boxWidth = 14;
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
      const b = e.target.closest('[data-ir]'); if (b) { seleccionar(b.dataset.ir); return; }
      const br = e.target.closest('[data-ruta]'); if (br) { dibujarRuta(br.dataset.ruta, br.dataset.esed === '1'); return; }
      const be = e.target.closest('[data-ed]'); if (be) seleccionarEdificio(be.dataset.ed);
    });
    $('detalle-cerrar').addEventListener('click', cerrarDetalle);
    $('det-edificio').addEventListener('click', () => { const p = st.prop[st.seleccion]; if (p && p.id_edificio) seleccionarEdificio(p.id_edificio); });
    $('det-aqui').addEventListener('click', () => {
      const c = st.seleccion && st.centroides[st.seleccion.startsWith('ed:') ? st.seleccion : st.seleccion];
      if (c) fijarUsuario(L.latLng(c[0], c[1]), 'manual');
    });
    $('sel-escenario').addEventListener('change', (e) => { st.escenario = e.target.value; actualizar(); });
    $('btn-ubicacion').addEventListener('click', usarGPS);
    $('btn-aqui').addEventListener('click', () => (st.modoAqui ? salirModoAqui() : entrarModoAqui()));
    document.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
      st.capa = b.dataset.modo;
      document.querySelectorAll('[data-modo]').forEach((x) => x.classList.toggle('activo', x === b));
      actualizar();
    }));
    document.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
      const z = b.dataset.zoom;
      if (z === 'todo') { mapa.fitBounds(grupoEd.getBounds(), { padding: [20, 20] }); return; }
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
  function verTodo() { if (mapa) mapa.fitBounds(grupoEd.getBounds(), { padding: [20, 20] }); }

  function escenarioCritico() {
    if (st.seleccion) cerrarDetalle();
    ponerEscenario('examenes');
    ponerPiso('todas');
    ponerModo('ocupacion');
    irTab('ahora');
    ponerHora(2, 600);
    toast('Escenario crítico: periodo de exámenes, martes 10:00', 3500);
  }

  // ------------------------------------------------------------------ demostración guiada
  const PASOS = [
    { tit: 'GeoSIG FI-UNAM', txt: 'Mapa de ocupación de la Facultad: 26 edificios, 13 recintos y 23 áreas comunes digitalizados en QGIS. El color de cada zona indica su saturación.',
      accion: () => { if (st.seleccion) cerrarDetalle(); ponerEscenario('auto'); ponerPiso('todas'); ponerModo('ocupacion'); irTab('ahora'); ponerHora(2, 450); verTodo(); } },
    { tit: 'Simulación en vivo', txt: 'El tablero se actualiza cada minuto con el reloj de la tableta. Avanzamos al martes a las 10:00: suben las ocupaciones y aparecen las alertas.',
      accion: () => { if (st.seleccion) cerrarDetalle(); irTab('ahora'); ponerHora(2, 600); } },
    { tit: 'Cuello de botella detectado', txt: 'El Laboratorio de Fotogrametría se satura los martes a las 10:00, el caso del enunciado. La regla R3 lo marca, pronostica la siguiente hora y sugiere alternativas.',
      accion: () => seleccionar('LAB_FOTO') },
    { tit: 'Edificios y plantas', txt: 'Cada recinto está ligado a su edificio y su nivel. En el Edificio A: auditorio en planta baja, Biblioteca en el nivel 1 y laboratorios en el nivel 5.',
      accion: () => seleccionarEdificio('A') },
    { tit: '¿Dónde estoy? y ¿a dónde ir?', txt: 'Con el GPS, o con “Estoy aquí” cuando no hay señal en interiores, el SIG sabe en qué zona está el usuario. Si está saturada, sugiere la alternativa más cercana con espacio y traza la ruta.',
      accion: () => { if (st.seleccion) cerrarDetalle(); ponerHora(2, 600); const c = st.centroides.LAB_FOTO; if (c) fijarUsuario(L.latLng(c[0], c[1]), 'manual');
        setTimeout(() => { const b = document.querySelector('[data-ruta]'); if (b) b.click(); }, 400); } },
    { tit: 'Instalaciones generales y conectividad', txt: 'Áreas de descanso, tráfico peatonal y red Wi-Fi. Las antenas por edificio y la curva de uso por hora son datos oficiales de la Red PC-PUMA.',
      accion: () => { if (st.seleccion) cerrarDetalle(); ponerModo('wifi'); irTab('generales'); verTodo(); } },
    { tit: 'Escenario de exámenes', txt: 'En periodo de exámenes la demanda de la Biblioteca y de las salas de cómputo sube; el mapa de calor y las alertas cambian.',
      accion: () => { ponerEscenario('examenes'); ponerModo('ocupacion'); irTab('cuellos'); ponerHora(3, 735); } },
    { tit: 'Mantenimiento y recursos', txt: 'El índice de prioridad combina densidad de uso, horas saturadas y estado físico. La intensidad de uso de la red confirma qué edificios atender primero.',
      accion: () => { ponerEscenario('auto'); ponerModo('prioridad'); irTab('mantto'); } },
    { tit: 'Resumen para decidir', txt: 'Las tres preguntas de la Coordinación, respondidas en una sola pantalla y con acciones sugeridas.',
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

  // ------------------------------------------------------------------ resumen ejecutivo
  function abrirResumen() {
    const t = ahora();
    pintarCuellos(t); pintarGenerales(t); pintarMantto();
    const ids = Object.keys(st.kpi.recintos);
    const ab = ids.filter((id) => st.vivo[id].abierto);
    const personas = Object.values(st.vivoEd).reduce((s_, v) => s_ + (v.abierto ? v.ocupacion : 0), 0) +
      ab.filter((id) => categoria(id) === 'areas').reduce((s_, id) => s_ + st.vivo[id].ocupacion, 0);
    const alertas = ab.filter((id) => ['alto', 'critico'].includes(st.vivo[id].estado)).length;
    const r_ = st.kpi.red_pcpuma;
    $('res-sub').textContent = `${DIAS_LARGO[t.getDay()]} ${Sim.horaTxt(t.getHours() * 60 + t.getMinutes())} · escenario ${escenarioActivo() === 'examenes' ? 'de exámenes' : 'ordinario'}${st.demo ? ' (hora simulada)' : ''}`;
    $('res-kpis').innerHTML = [[personas.toLocaleString('es-MX'), 'personas en la FI ahora'], [alertas, 'zonas en alto o crítico'],
      [r_ ? `~${r_.ap_total}` : '—', 'antenas Wi-Fi (PC-PUMA)'], [r_ && r_.estadisticas ? r_.estadisticas.clientes_promedio_dia.toLocaleString('es-MX') : '—', 'clientes de red por día']]
      .map(([v, l]) => `<div class="kpi"><span class="kpi-v">${v}</span><span class="kpi-l">${l}</span></div>`).join('');

    const rec = ids.filter((id) => categoria(id) === 'recintos').sort((a, b) => res(b).horas_alto_dia - res(a).horas_alto_dia);
    const wifiSat = ids.filter((id) => st.kpi.recintos[id].wifi_ap && res(id).wifi_sat_pico >= 0.9).sort((a, b) => res(b).wifi_sat_pico - res(a).wifi_sat_pico);
    const sinCob = ids.filter((id) => st.kpi.recintos[id].wifi_dispositivos_por_persona && !st.kpi.recintos[id].wifi_ap);
    const descP = ids.filter((id) => st.prop[id].descanso === 'principal').sort((a, b) => res(b).personas_hora_dia - res(a).personas_hora_dia);
    const eds = Object.keys(st.kpi.edificios).sort((a, b) => st.kpi.edificios[b][escenarioActivo()].indice_prioridad - st.kpi.edificios[a][escenarioActivo()].indice_prioridad);
    const n_ = (id) => `<b>${esc(nombre(id))}</b>`;
    const bloque = (tit, cuerpo, accion) => `<div class="res-bloque"><h3>${tit}</h3><p>${cuerpo}</p><p class="res-accion"><b>Acción sugerida:</b> ${accion}</p></div>`;
    $('res-cuerpo').innerHTML =
      bloque('1. ¿Dónde están los cuellos de botella?', $('txt-cuellos').innerHTML,
        `ampliar horario o número de equipos en ${n_(rec[0])} y ${n_(rec[1])}, y canalizar la demanda en hora pico hacia salas del mismo tipo con espacio (el SIG las sugiere en cada alerta).`) +
      bloque('2. ¿Cómo se distribuye el uso de las instalaciones generales?', `${$('txt-generales').innerHTML} ${$('txt-wifi').innerHTML}`,
        `${wifiSat.length ? `reforzar la red Wi-Fi en ${wifiSat.slice(0, 2).map(n_).join(' y ')}` : 'mantener la red actual'}${sinCob.length ? `, dar cobertura a ${sinCob.map(n_).join(', ')}` : ''}${descP.length ? ` y ampliar mobiliario de descanso en ${n_(descP[0])}` : ''}.`) +
      bloque('3. ¿Qué edificios o zonas requieren mantenimiento o más recursos?', `${$('txt-mantto').innerHTML} ${$('txt-red-ed').innerHTML || ''}`,
        `programar primero la revisión de ${eds.slice(0, 2).map((e) => `<b>${esc(st.propEd[e].nombre)}</b>`).join(' y ')} y confirmar en sitio el estado físico de las zonas marcadas como estimadas.`);
    $('resumen').hidden = false;
    $('res-cerrar').focus();
  }
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
    $('btn-critico').addEventListener('click', escenarioCritico);
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
  window.GeoSIG = { st, seleccionar, seleccionarEdificio, actualizar, mostrarPaso, abrirResumen, escenarioCritico };
})();

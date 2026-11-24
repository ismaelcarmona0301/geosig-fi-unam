"""Prueba de humo de la interfaz en Chrome headless (sin internet).

Sustituye Leaflet y Chart.js por dobles mínimos para verificar que app.js no
tiene errores de ejecución y que el tablero se llena. Toma capturas en
tests/capturas/. Uso:  python tests/prueba_humo.py
(La prueba con las bibliotecas reales se hace en la tableta, paquete 1.5.2.)
"""
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / "tests" / "capturas"
SALIDA.mkdir(exist_ok=True)

FAKE_L = r"""
(function(){
 function capa(){ return { _h:{}, options:{}, addTo(){return this}, on(e,f){this._h[e]=f;return this}, bindTooltip(){return this},
   setStyle(s){this._s=s;return this}, setTooltipContent(t){this._t=t;return this}, getBounds(){return {}},
   setLatLng(){return this} }; }
 function grupo(){ const g=capa(); g._set=new Set(); g.addLayer=(l)=>{g._set.add(l);return g}; g.removeLayer=(l)=>{g._set.delete(l);return g};
   g.hasLayer=(l)=>g._set.has(l); return g; }
 window.L = {
  map(){ const m=capa(); m.fitBounds=()=>m; m.getZoom=()=>18; m.setView=()=>m; m.invalidateSize=()=>{}; m.removeLayer=()=>{};
    m.hasLayer=()=>true; m.createPane=()=>({style:{}}); window.__mapa=m; return m; },
  tileLayer(){ return capa(); },
  geoJSON(geo,o){ const g=grupo(); (geo.features||[]).forEach(f=>{const c=capa(); o.onEachFeature&&o.onEachFeature(f,c); g.addLayer(c);}); return g; },
  marker(){return capa()}, circle(){return capa()}, divIcon(o){return o}, latLng(a,b){return {lat:a,lng:b}},
  featureGroup(){return capa()}, layerGroup(){return grupo()}, polyline(){return capa()}, latLngBounds(){return {}}, DomEvent:{stopPropagation(){}}
 };
})();"""

FAKE_CHART = r"""
(function(){
 function Chart(el,cfg){ this.config=cfg; this.data=cfg.data; this.options=cfg.options||{}; window.__charts=(window.__charts||0)+1;
   const c=el.getContext('2d'); c.fillStyle='#e8eef7'; c.fillRect(0,0,el.width,el.height); c.fillStyle='#002b5c'; c.font='14px sans-serif';
   c.fillText('[gráfica '+cfg.type+': '+cfg.data.datasets.length+' series]',10,24); }
 Chart.prototype.update=function(){}; Chart.prototype.destroy=function(){};
 Chart.defaults={font:{},plugins:{legend:{labels:{}}}}; Chart.register=function(){};
 window.Chart=Chart;
})();"""


def main():
    srv = subprocess.Popen([sys.executable, "-m", "http.server", "8765"], cwd=RAIZ,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    errores = []
    try:
        with sync_playwright() as p:
            nav = p.chromium.launch(executable_path="/usr/bin/google-chrome")
            for nombre, ancho, alto in [("tableta_horizontal", 1280, 800), ("tableta_vertical", 800, 1280), ("telefono", 390, 844)]:
                pag = nav.new_page(viewport={"width": ancho, "height": alto}, has_touch=True)
                pag.on("pageerror", lambda e: errores.append(str(e)))
                pag.route("**/leaflet.js", lambda r: r.fulfill(body=FAKE_L, content_type="text/javascript"))
                pag.route("**/chart.umd.js", lambda r: r.fulfill(body=FAKE_CHART, content_type="text/javascript"))
                pag.route("**/*.css", lambda r: r.continue_() if "styles.css" in r.request.url else r.fulfill(body="", content_type="text/css"))
                pag.route("**/*.png", lambda r: r.fulfill(status=404))
                t0 = time.time()
                pag.goto("http://localhost:8765/index.html")
                pag.wait_for_selector("#lista-recintos .fila")
                carga = time.time() - t0
                # Simular hora: martes 10:00 (ejemplo del plan)
                pag.click("#btn-demo")
                pag.select_option("#demo-dia", "2")
                pag.eval_on_selector("#demo-hora", "e => { e.value = '600'; e.dispatchEvent(new Event('input')); }")
                pag.screenshot(path=str(SALIDA / f"{nombre}_ahora.png"))
                for tab in ("cuellos", "generales", "mantto"):
                    pag.click(f'.tab[data-tab="{tab}"]')
                    pag.screenshot(path=str(SALIDA / f"{nombre}_{tab}.png"), full_page=True)
                pag.click('.tab[data-tab="ahora"]')
                pag.click('.filtro[data-filtro="edificios"]')
                pag.screenshot(path=str(SALIDA / f'{nombre}_lista_edificios.png'))
                pag.click('#lista-recintos .fila[data-ed="M"]')
                pag.click('#detalle-cerrar')
                pag.click('.filtro[data-filtro="recintos"]')
                pag.click('.piso[data-piso="1"]')
                pag.click('.piso[data-piso="todas"]')
                pag.click('#lista-recintos .fila[data-ir="LAB_FOTO"]')
                pag.screenshot(path=str(SALIDA / f"{nombre}_detalle.png"), full_page=True)
                det = pag.inner_text("#detalle")
                pag.click('#det-edificio')
                pag.screenshot(path=str(SALIDA / f"{nombre}_edificio.png"), full_page=True)
                ed_txt = pag.inner_text("#detalle")
                pag.evaluate("GeoSIG.seleccionar('AV_POSGRADO')")
                pag.evaluate("GeoSIG.seleccionar('EST_PROFESORES_FI')")
                pag.click('[data-modo="wifi"]')
                pag.evaluate("GeoSIG.seleccionar('BIB')")
                pag.evaluate("GeoSIG.seleccionarEdificio('A')")
                pag.screenshot(path=str(SALIDA / f'{nombre}_edificioA.png'), full_page=True)
                pag.click('#detalle-cerrar')
                pag.click('.tab[data-tab="generales"]')
                pag.screenshot(path=str(SALIDA / f'{nombre}_generales2.png'), full_page=True)
                pag.click('.tab[data-tab="mantto"]')
                pag.screenshot(path=str(SALIDA / f'{nombre}_mantto2.png'), full_page=True)
                pag.evaluate("GeoSIG.seleccionar('BIB')")
                bib = pag.inner_text('#detalle')
                pag.click('[data-modo="ocupacion"]')
                pag.evaluate("GeoSIG.seleccionar('AC_TREN')")
                pag.screenshot(path=str(SALIDA / f'{nombre}_tren.png'), full_page=True)
                pag.evaluate('GeoSIG.escenarioCritico()')
                pag.click('#btn-guia')
                for k in range(8):
                    pag.click('#guia-sig')
                    if k == 3:
                        pag.screenshot(path=str(SALIDA / f"{nombre}_guia.png"))
                pag.screenshot(path=str(SALIDA / f"{nombre}_resumen.png"))
                resumen = pag.inner_text('#resumen')
                assert pag.is_hidden('#guia')
                pag.click('#res-cerrar')
                assert pag.is_hidden('#resumen')
                desborde = pag.evaluate("document.documentElement.scrollWidth > window.innerWidth")
                print(f"{nombre}: carga {carga:.2f} s · desbordamiento horizontal: {desborde} · gráficas: {pag.evaluate('window.__charts')}")
                if nombre == "tableta_horizontal":
                    print("  detalle LAB_FOTO →", " | ".join(l for l in det.splitlines() if l.strip())[:500])
                    print("  RESUMEN →", " | ".join(l for l in resumen.splitlines() if l.strip())[:1600])
                    print("  BIB →", " | ".join(l for l in bib.splitlines() if l.strip())[:700])
                    print("  edificio R →", " | ".join(l for l in ed_txt.splitlines() if l.strip())[:300])
                pag.close()
            nav.close()
    finally:
        srv.terminate()
    if errores:
        print("ERRORES JS:", *errores, sep="\n  ")
        sys.exit(1)
    print("Sin errores de JavaScript.")


if __name__ == "__main__":
    main()

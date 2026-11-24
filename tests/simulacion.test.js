// Pruebas del motor de simulación:  node tests/simulacion.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Sim = require('../js/simulacion.js');

const kpi = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'kpi_data.json'), 'utf8'));
Sim.init(kpi);
const ids = Object.keys(kpi.recintos);
let n = 0;
const ok = (msg) => { n++; console.log('  ✓', msg); };

// 1. Nunca excede capacidad, en todo el día y ambos escenarios
for (const esc of ['ordinario', 'examenes']) {
  for (let m = 6 * 60; m <= 22 * 60; m++) {
    const d = new Date(2026, 10, 26, Math.floor(m / 60), m % 60); // jueves 26-nov-2026
    for (const id of ids) {
      const v = Sim.ocupacionEnVivo(id, d, esc);
      assert(v.ocupacion >= 0 && v.ocupacion <= v.capacidad, `${id} ${m} fuera de rango`);
    }
  }
}
ok('ocupación en vivo dentro de [0, capacidad_max] todo el día');

// 2. Cerrado fuera de 07:00–20:00 y en domingo
assert.strictEqual(Sim.ocupacionEnVivo('BIB', new Date(2026, 10, 26, 6, 30)).estado, 'cerrado');
assert.strictEqual(Sim.ocupacionEnVivo('BIB', new Date(2026, 10, 26, 21, 30)).estado, 'cerrado');
assert.strictEqual(Sim.ocupacionEnVivo('BIB', new Date(2026, 10, 26, 7, 15)).estado, 'cerrado'); // abre 07:30
assert.strictEqual(Sim.ocupacionEnVivo('BIB', new Date(2026, 10, 29, 12, 0)).estado, 'cerrado');
ok('respeta el horario de cada zona (Biblioteca 07:30–21:00) y cierra en domingo');

// 3. Determinista: misma hora => mismo valor (dos tabletas muestran lo mismo)
const t = new Date(2026, 10, 26, 12, 7);
assert.deepStrictEqual(Sim.ocupacionEnVivo('SALA_COMPUTO_1', t), Sim.ocupacionEnVivo('SALA_COMPUTO_1', new Date(t)));
ok('simulación determinística por minuto');

// 4. Cambio suave minuto a minuto (sin saltos bruscos)
let maxSalto = 0;
for (let m = 7 * 60 + 31; m < 21 * 60; m++) {
  const a = Sim.ocupacionEnVivo('BIB', new Date(2026, 10, 26, 0, m - 1)).ocupacion;
  const b = Sim.ocupacionEnVivo('BIB', new Date(2026, 10, 26, 0, m)).ocupacion;
  maxSalto = Math.max(maxSalto, Math.abs(b - a));
}
assert(maxSalto <= 0.06 * 250, `salto máximo ${maxSalto}`);
ok(`variación por minuto acotada (máx. ${maxSalto} personas en Biblioteca)`);

// 5. Escenario automático por calendario (R2)
assert.strictEqual(Sim.escenarioPara(new Date(2026, 10, 26), 'auto'), 'ordinario');
assert.strictEqual(Sim.escenarioPara(new Date(2026, 11, 2), 'auto'), 'examenes');
ok('R2: escenario de exámenes según calendario');

// 6. Exámenes elevan la demanda de la Biblioteca
const sumDia = (esc) => kpi.recintos.BIB.perfiles[esc].mie.ocupacion.reduce((a, b) => a + b, 0);
assert(sumDia('examenes') > sumDia('ordinario') * 1.15);
ok('exámenes incrementan la demanda de Biblioteca');

// 7. R3: alerta crítica en la Biblioteca en periodo de exámenes (las bibliotecas sí se saturan)
let hallada = null;
for (let m = 8 * 60; m < 20 * 60 && !hallada; m += 5) {
  const p = Sim.prediccion('BIB', new Date(2026, 10, 25, 0, m), 'examenes');
  if (p.reglas.some((r) => r.codigo === 'R3' && r.nivel === 'critico')) hallada = Sim.horaTxt(m);
}
assert(hallada, 'la Biblioteca debería disparar R3 en exámenes');
ok(`R3: saturación crítica de la Biblioteca en exámenes desde las ${hallada}`);

// 7b. Estacionamientos sin máximo: nunca alertan
for (let m = 7 * 60; m < 21 * 60; m += 15) {
  const v = Sim.ocupacionEnVivo('EST_PROFESORES_FI', new Date(2026, 10, 24, 0, m), 'ordinario');
  assert(['bajo', 'moderado', 'cerrado'].includes(v.estado));
}
ok('estacionamientos sin alertas (solo demanda baja o alta)');

// 8. Labs de Geomática: nunca se llenan (grupos de 4 a 12)
const foto = Sim.ocupacionEnVivo('LAB_FOTO', new Date(2026, 10, 24, 10, 0), 'ordinario');
assert(foto.ocupacion >= 4 && foto.ocupacion <= 13 && foto.saturacion < 0.75, `Fotogrametría martes 10:00 = ${foto.ocupacion}`);
ok(`Fotogrametría el martes 10:00: ${foto.ocupacion} personas (${Math.round(foto.saturacion * 100)} %), sin llenarse`);

// 9. Biblioteca llena: solo se sugieren otras bibliotecas con espacio
const bib = Sim.ocupacionEnVivo('BIB', new Date(2026, 10, 24, 17, 0), 'ordinario');
assert(['alto', 'critico'].includes(bib.estado), `Biblioteca 17:00 = ${bib.estado}`);
const alt = Sim.alternativas('BIB', new Date(2026, 10, 24, 11, 0), 'ordinario');
assert(alt.length > 0, 'a las 11:00 debe haber otra biblioteca con espacio');
alt.forEach((a) => assert.strictEqual(Sim.grupo(a.id), 'biblioteca'));
['AC_TREN', 'SALA_COMPUTO_1'].forEach((o) => Sim.alternativas(o, new Date(2026, 10, 24, 13, 0), 'ordinario')
  .forEach((a) => assert.strictEqual(Sim.grupo(a.id), Sim.grupo(o))));
ok(`Biblioteca 17:00 al ${Math.round(bib.saturacion * 100)} %; a las 11:00 sugiere: ${alt.map((a) => a.id).join(', ')} (mismo tipo)`);

console.log(`\n${n} pruebas aprobadas`);

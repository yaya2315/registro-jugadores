// Interpreta el texto que devuelve el OCR de un DUI o carnet de fútbol.
// Es lógica pura (sin DOM) para poder probarla en Node.

const MESES = {
  ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6,
  JUL: 7, AGO: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12,
};

/** Mayúsculas y sin tildes, para comparar etiquetas sin importar el OCR. */
export function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
}

/** Dígito verificador del DUI salvadoreño (módulo 10, pesos 9..2). */
export function validarDUI(valor) {
  const d = String(valor || '').replace(/\D/g, '');
  if (d.length !== 9) return false;
  let suma = 0;
  for (let i = 0; i < 8; i++) suma += Number(d[i]) * (9 - i);
  const verificador = (10 - (suma % 10)) % 10;
  return verificador === Number(d[8]);
}

/** "012345678" -> "01234567-8" */
export function formatearDUI(valor) {
  const d = String(valor || '').replace(/\D/g, '');
  return d.length === 9 ? `${d.slice(0, 8)}-${d[8]}` : String(valor || '').trim();
}

const aDigito = (c) => ({ O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', S: '5', B: '8' }[c] ?? c);

function buscarDUI(textoNorm) {
  // El OCR suele confundir O/0, I/1... solo se corrige cuando hay guion.
  const candidatos = [];
  const estricto = /(?<!\d)(\d{8})\s*[-–—_.]?\s*(\d)(?!\d)/g;
  const laxo = /(?<![A-Z0-9])([0-9OQDILSB|]{8})\s*[-–—_]\s*([0-9OQDILSB|])(?![A-Z0-9])/g;
  for (const re of [estricto, laxo]) {
    for (const m of textoNorm.matchAll(re)) {
      const num = [...(m[1] + m[2])].map(aDigito).join('');
      if (/^\d{9}$/.test(num)) candidatos.push(num);
    }
  }
  const valido = candidatos.find(validarDUI);
  const elegido = valido || candidatos[0];
  return elegido ? formatearDUI(elegido) : '';
}

function fechaISO(d, m, a) {
  const dia = Number(d), mes = Number(m), anio = Number(a);
  const hoy = new Date().getFullYear();
  if (anio < 1930 || anio > hoy - 3) return null;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function buscarFechas(textoNorm) {
  const fechas = [];
  const num = /(?<!\d)(\d{1,2})\s*[\/\-. ]\s*(\d{1,2})\s*[\/\-. ]\s*(\d{4})(?!\d)/g;
  for (const m of textoNorm.matchAll(num)) {
    const f = fechaISO(m[1], m[2], m[3]);
    if (f) fechas.push({ f, idx: m.index });
  }
  const txt = /(?<!\d)(\d{1,2})\s*(?:DE\s+)?(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|SET|OCT|NOV|DIC)[A-Z]*\.?\s*(?:DE\s+|DEL\s+)?(\d{4})/g;
  for (const m of textoNorm.matchAll(txt)) {
    const f = fechaISO(m[1], MESES[m[2]], m[3]);
    if (f) fechas.push({ f, idx: m.index });
  }
  return fechas;
}

function elegirFechaNacimiento(textoNorm) {
  const fechas = buscarFechas(textoNorm);
  if (!fechas.length) return '';
  const etiqueta = textoNorm.search(/NACIMIENTO|NACIM|BIRTH/);
  if (etiqueta >= 0) {
    // La fecha más cercana después de la etiqueta.
    const despues = fechas.filter((x) => x.idx >= etiqueta).sort((a, b) => a.idx - b.idx)[0];
    if (despues) return despues.f;
  }
  return fechas[0].f;
}

const ETIQUETAS = /(APELLIDOS?|NOMBRES?|SURNAMES?|GIVEN|SEXO|SEX|FECHA|NACIMIENTO|LUGAR|DOMICILIO|ESTADO|PROFESION|EQUIPO|CLUB|CATEGORIA|CARNET|CARNE|NUMERO|REPUBLICA|DOCUMENTO|IDENTIDAD|UNICO|NACIONALIDAD)/;

function limpiarNombre(s) {
  return s
    .replace(/\/.*$/, ' ') // quita la traducción en inglés ("NOMBRES / GIVEN NAMES")
    .replace(/[^A-ZÑ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Valor que sigue a una etiqueta: en la misma línea o en la siguiente(s). */
function valorDeEtiqueta(lineas, regexEtiqueta, { excluir } = {}) {
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (!regexEtiqueta.test(linea)) continue;
    if (excluir && excluir.test(linea)) continue;
    const resto = limpiarNombre(linea.replace(new RegExp(`^.*?${regexEtiqueta.source}\\S*`), ' '));
    const valido = (v) => v.length >= 2 && !ETIQUETAS.test(v);
    if (valido(resto)) return resto;
    for (let j = i + 1; j <= i + 2 && j < lineas.length; j++) {
      const sig = limpiarNombre(lineas[j]);
      if (valido(sig)) return sig;
      if (ETIQUETAS.test(lineas[j])) break;
    }
  }
  return '';
}

/** Capitaliza: "JUAN CARLOS" -> "Juan Carlos". */
export function capitalizar(s) {
  return String(s || '')
    .toLocaleLowerCase('es')
    .replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase('es'));
}

function buscarNumeroCarnet(lineas, textoNorm) {
  const porEtiqueta = /(?:CARNET|CARNE|N[O°º]\.?|NUM(?:ERO)?\.?|ID|FICHA|LICENCIA)\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/;
  for (const l of lineas) {
    const m = l.match(porEtiqueta);
    if (m && /\d/.test(m[1])) return m[1];
  }
  const dui = buscarDUI(textoNorm);
  if (dui) return dui;
  const suelto = textoNorm.match(/(?<![A-Z0-9])(\d{4,})(?![A-Z0-9])/);
  return suelto ? suelto[1] : '';
}

/**
 * @param {'DUI'|'CARNET'} tipo
 * @param {string} textoOcr  texto reconocido (puede combinar frente y reverso)
 */
export function parsearDocumento(tipo, textoOcr) {
  const textoNorm = normalizar(textoOcr);
  const lineas = textoNorm.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const resultado = {
    numero: '',
    nombres: '',
    apellidos: '',
    fechaNacimiento: elegirFechaNacimiento(textoNorm),
    equipo: '',
  };

  resultado.numero = tipo === 'DUI' ? buscarDUI(textoNorm) : buscarNumeroCarnet(lineas, textoNorm);
  resultado.apellidos = capitalizar(valorDeEtiqueta(lineas, /APELLIDOS?|SURNAMES?/));
  resultado.nombres = capitalizar(valorDeEtiqueta(lineas, /NOMBRES?|GIVEN/, { excluir: /APELLIDO|SURNAME/ }));
  if (tipo === 'CARNET') resultado.equipo = capitalizar(valorDeEtiqueta(lineas, /EQUIPO|CLUB/));

  return resultado;
}

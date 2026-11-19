import assert from 'node:assert/strict';
import { parsearDocumento, validarDUI, formatearDUI } from '../js/parser.js';

// Dígito verificador
assert.equal(validarDUI('12345678-4'), true);
assert.equal(validarDUI('12345678-5'), false);
assert.equal(validarDUI('00000000-0'), true);
assert.equal(validarDUI('1234'), false);
assert.equal(formatearDUI('123456784'), '12345678-4');

// DUI típico (texto tal como podría salir del OCR)
const dui = `REPUBLICA DE EL SALVADOR
DOCUMENTO UNICO DE IDENTIDAD
APELLIDOS / SURNAMES
PÉREZ MARTÍNEZ
NOMBRES / GIVEN NAMES
JUAN CARLOS
SEXO / SEX  M
FECHA DE NACIMIENTO / DATE OF BIRTH
14 JUNIO 1998
12345678-4`;
let r = parsearDocumento('DUI', dui);
assert.equal(r.numero, '12345678-4');
assert.equal(r.apellidos, 'Perez Martinez');
assert.equal(r.nombres, 'Juan Carlos');
assert.equal(r.fechaNacimiento, '1998-06-14');

// Etiqueta y valor en la misma línea, fecha numérica, O en lugar de 0
r = parsearDocumento('DUI', `Apellidos: Lopez Garcia\nNombres: Maria Jose\nNacimiento 03/11/2001\nDUI 0123456O-7`);
assert.equal(r.apellidos, 'Lopez Garcia');
assert.equal(r.nombres, 'Maria Jose');
assert.equal(r.fechaNacimiento, '2001-11-03');
assert.match(r.numero, /^\d{8}-\d$/);

// La fecha de emisión/vencimiento no debe ganar a la de nacimiento
r = parsearDocumento('DUI', `FECHA DE NACIMIENTO 01 ENE 2000\nFECHA DE EMISION 05/05/2023\n12345678-4`);
assert.equal(r.fechaNacimiento, '2000-01-01');

// Carnet de fútbol
r = parsearDocumento('CARNET', `LIGA MAYOR\nCARNET No. FB-00123\nNOMBRE: Luis Alberto\nAPELLIDO: Ramos\nEQUIPO: Aguilas FC`);
assert.equal(r.numero, 'FB-00123');
assert.equal(r.nombres, 'Luis Alberto');
assert.equal(r.apellidos, 'Ramos');
assert.equal(r.equipo, 'Aguilas Fc');

// --- Número del DUI: casos que antes se escapaban ---
assert.equal(validarDUI('05482135-1'), true);

// Número partido en dos por el OCR
r = parsearDocumento('DUI', 'DOCUMENTO UNICO DE IDENTIDAD\n0548 2135-1\nSEXO M');
assert.equal(r.numero, '05482135-1');

// Entre dos candidatos gana el que cumple el dígito verificador
r = parsearDocumento('DUI', 'EMISION 20231105 7\nNUMERO 05482135-1');
assert.equal(r.numero, '05482135-1');

// El texto completo no trae el número, pero la lectura de dígitos sí (con espacios sueltos)
r = parsearDocumento('DUI', 'REPUBLICA DE EL SALVADOR\nAPELLIDOS\nGARCIA', '05 48 21 35 1\n1998\n');
assert.equal(r.numero, '05482135-1');

// Lectura de dígitos con guion
r = parsearDocumento('DUI', 'texto sin numero', '\n05482135-1\n');
assert.equal(r.numero, '05482135-1');

// Zona legible por máquina del reverso
r = parsearDocumento('DUI', 'IDSLV054821351<<<<<<<<<<<<<<<\n9806143M3001012SLV<<<<<<<<<<<0');
assert.equal(r.numero, '05482135-1');

// Líneas de dígitos largas (teléfonos, etc.) no se confunden con el DUI
r = parsearDocumento('DUI', 'sin numero', '2234567890123\n');
assert.equal(r.numero, '');

// Texto basura no debe romper nada
r = parsearDocumento('DUI', '###  ~~ \n\n  ');
assert.deepEqual(r, { numero: '', nombres: '', apellidos: '', fechaNacimiento: '', equipo: '' });

console.log('parser: todas las pruebas pasaron');

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, crearZip } from '../js/zip.js';

// CRC32 conocido: "123456789" -> cbf43926
assert.equal(crc32(new TextEncoder().encode('123456789')).toString(16), 'cbf43926');

const foto = Uint8Array.from({ length: 5000 }, (_, i) => (i * 31) % 256);
const blob = crearZip([
  { nombre: 'LEEME.txt', datos: 'Respaldo de prueba' },
  { nombre: 'jugadores.csv', datos: '﻿"Nombre"\r\n"José Ñandú"' },
  { nombre: 'fotos/Pérez_Juan_abc123/cara.webp', datos: foto },
  { nombre: 'fotos/vacia/nada.bin', datos: new Uint8Array(0) },
]);
const zip = Buffer.from(await blob.arrayBuffer());

const dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
try {
  const archivo = join(dir, 'prueba.zip');
  writeFileSync(archivo, zip);
  const salida = join(dir, 'salida');
  mkdirSync(salida);
  // bsdtar (el tar de Windows 10+, macOS y muchas distros) sabe leer ZIP y valida los CRC al extraer.
  // En Windows se usa el del sistema: el que trae Git Bash es GNU tar y no lee ZIP.
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', 'prueba.zip', '-C', 'salida'], { cwd: dir });

  assert.equal(readFileSync(join(salida, 'LEEME.txt'), 'utf8'), 'Respaldo de prueba');
  assert.equal(readFileSync(join(salida, 'jugadores.csv'), 'utf8'), '﻿"Nombre"\r\n"José Ñandú"');
  assert.deepEqual(Buffer.compare(readFileSync(join(salida, 'fotos', 'Pérez_Juan_abc123', 'cara.webp')), Buffer.from(foto)), 0);
  assert.equal(readFileSync(join(salida, 'fotos', 'vacia', 'nada.bin')).length, 0);
  assert.deepEqual(readdirSync(join(salida, 'fotos')).sort(), ['Pérez_Juan_abc123', 'vacia'].sort());
  console.log('zip: todas las pruebas pasaron (extraído con tar)');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

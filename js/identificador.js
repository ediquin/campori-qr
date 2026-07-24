// Identificadores breves para stickers. Se usa Base32 sin caracteres ambiguos.

const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function tokenAleatorio(largo) {
  const bytes = new Uint8Array(largo);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256) ^ (Date.now() >> (i % 6));
    }
  }
  return [...bytes].map(b => ALFABETO[b & 31]).join('');
}

/**
 * Crea un identificador que no figure en `usados`.
 * `prefijo` permite que la unicidad incluya el código del evento.
 */
export function crearIdentificador(usados = new Set(), prefijo = '', largo = 8) {
  let token, clave;
  do {
    token = tokenAleatorio(largo);
    clave = prefijo ? `${prefijo}-${token}` : token;
  } while (usados.has(clave));
  usados.add(clave);
  return token;
}

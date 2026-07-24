// Lectura de codigos QR con la camara del celular.
//
// Hay dos motores y se elige solo:
//
//   - BarcodeDetector, la API que trae el navegador. Esta acelerada por hardware y es
//     la mas rapida. La tienen Chrome y Edge en Android y en computadora.
//   - js/qr-decoder.js, el lector propio del proyecto. Entra donde no existe la API,
//     que es el caso de Safari en iPhone.
//
// Los dos funcionan sin internet.
//
// Importante: la camara solo se abre en HTTPS o en localhost. Abrir el archivo con
// doble clic no alcanza.

import { decodificar } from './qr-decoder.js';

export const VERSION_LECTOR = '4 · rápido y tolerante';

// Con el lector propio conviene trabajar sobre una imagen mas chica que la del video:
// alcanza y sobra para un codigo que ocupa buena parte del cuadro, y baja mucho el
// costo por cuadro. A 480 de ancho un sticker que ocupe un tercio de la pantalla
// deja unos 5 pixeles por modulo, de sobra para leerlo.
const ANCHO_ANALISIS = 480;
const MARGEN_MIRA = 0.12;

/**
 * Traduce el recuadro visible de la cámara a coordenadas del video original.
 * El video usa object-fit: cover, así que primero quitamos la parte que queda
 * recortada por la pantalla y después aplicamos el margen de la mira.
 */
export function calcularRecorteCentral(vw, vh, anchoVista = vw, altoVista = vh, margen = MARGEN_MIRA) {
  if (!(vw > 0 && vh > 0 && anchoVista > 0 && altoVista > 0)) return null;
  const aspectoVideo = vw / vh;
  const aspectoVista = anchoVista / altoVista;
  let visibleX = 0, visibleY = 0, visibleW = vw, visibleH = vh;

  if (aspectoVideo > aspectoVista) {
    visibleW = vh * aspectoVista;
    visibleX = (vw - visibleW) / 2;
  } else if (aspectoVideo < aspectoVista) {
    visibleH = vw / aspectoVista;
    visibleY = (vh - visibleH) / 2;
  }

  return {
    x: visibleX + visibleW * margen,
    y: visibleY + visibleH * margen,
    ancho: visibleW * (1 - margen * 2),
    alto: visibleH * (1 - margen * 2),
  };
}

/** Elige el QR más cercano a la mira cuando el navegador ve varios a la vez. */
export function codigoMasCercano(codigos, cx, cy) {
  if (!codigos?.length) return null;
  return [...codigos].sort((a, b) => {
    const distancia = codigo => {
      const caja = codigo.boundingBox;
      if (!caja) return Number.POSITIVE_INFINITY;
      const dx = caja.x + caja.width / 2 - cx;
      const dy = caja.y + caja.height / 2 - cy;
      return dx * dx + dy * dy;
    };
    return distancia(a) - distancia(b);
  })[0] || null;
}

export class Escaner {
  /**
   * @param {HTMLVideoElement} video
   * @param {(texto: string) => void} alDetectar  se llama una vez por codigo nuevo
   */
  constructor(video, alDetectar) {
    this.video = video;
    this.alDetectar = alDetectar;
    this.detector = null;      // BarcodeDetector, si el navegador lo tiene
    this.lienzo = null;        // canvas de trabajo para el lector propio
    this.contexto = null;
    this.motor = null;         // 'navegador' o 'propio'
    this.flujo = null;
    this.activo = false;
    this.ultimoCodigo = null;
    this.vacioDesde = 0;
    this.pista = null;
  }

  /** Que motor se va a usar en este navegador. Nunca devuelve "ninguno". */
  static async motorDisponible() {
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        const formatos = await window.BarcodeDetector.getSupportedFormats();
        if (formatos.includes('qr_code')) return 'navegador';
      } catch { /* seguimos con el propio */ }
    }
    return 'propio';
  }

  static async descripcionMotor() {
    return (await Escaner.motorDisponible()) === 'navegador'
      ? 'Lector del navegador (acelerado por hardware)'
      : 'Lector propio de la app (para Safari y iPhone)';
  }

  /** Enumera las camaras para poder elegir entre la frontal y la trasera. */
  static async camaras() {
    try {
      const equipos = await navigator.mediaDevices.enumerateDevices();
      return equipos.filter(d => d.kind === 'videoinput');
    } catch {
      return [];
    }
  }

  async iniciar(idCamara = null) {
    this.motor = await Escaner.motorDisponible();
    if (this.motor === 'navegador') {
      this.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    }
    // El lector propio necesita un canvas. El lector nativo trabaja directamente
    // sobre el video: conserva toda la resolución y evita una copia por cuadro.
    if (this.motor === 'propio') {
      this.lienzo = document.createElement('canvas');
      this.contexto = this.lienzo.getContext('2d', { willReadFrequently: true });
    }

    const video = idCamara
      ? { deviceId: { exact: idCamara } }
      : { facingMode: { ideal: 'environment' } };
    // Pedimos buena resolucion: los stickers son de 24 mm y con video de baja
    // definicion el codigo queda con muy pocos pixeles por modulo.
    Object.assign(video, { width: { ideal: 1280 }, height: { ideal: 720 } });

    this.flujo = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    this.pista = this.flujo.getVideoTracks()[0];

    // El enfoque continuo ayuda muchisimo de cerca. No todos los equipos lo aceptan,
    // por eso va aparte y sin romper si falla.
    try {
      const capacidades = this.pista.getCapabilities?.() || {};
      if (capacidades.focusMode?.includes('continuous')) {
        await this.pista.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      }
    } catch { /* el equipo no lo permite: seguimos igual */ }

    this.video.srcObject = this.flujo;
    this.video.setAttribute('playsinline', '');   // iOS no abre el video a pantalla completa
    this.video.muted = true;
    await this.video.play();

    this.activo = true;
    this._bucle();
  }

  detener() {
    this.activo = false;
    this.pista = null;
    this.flujo?.getTracks().forEach(t => t.stop());
    this.flujo = null;
    if (this.video) this.video.srcObject = null;
  }

  /** Enciende o apaga la linterna, si el equipo la expone. */
  async linterna(encender) {
    if (!this.pista) return false;
    try {
      const capacidades = this.pista.getCapabilities?.() || {};
      if (!capacidades.torch) return false;
      await this.pista.applyConstraints({ advanced: [{ torch: encender }] });
      return true;
    } catch {
      return false;
    }
  }

  async hayLinterna() {
    return Boolean(this.pista?.getCapabilities?.().torch);
  }

  /** Lee un cuadro con el motor que corresponda. Devuelve el texto o null. */
  async _leerCuadro() {
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    if (!vw || !vh) return null;

    if (this.motor === 'navegador') {
      // Esta era la ruta rápida original. BarcodeDetector recibe el video completo
      // con su resolución real; si aparecen varios QR elegimos el más centrado.
      const codigos = await this.detector.detect(this.video);
      const visible = calcularRecorteCentral(
        vw, vh,
        this.video.clientWidth || vw,
        this.video.clientHeight || vh,
        0
      );
      const elegido = codigoMasCercano(
        codigos,
        visible ? visible.x + visible.ancho / 2 : vw / 2,
        visible ? visible.y + visible.alto / 2 : vh / 2
      );
      return elegido?.rawValue?.trim() || null;
    }

    const recorte = calcularRecorteCentral(
      vw, vh,
      this.video.clientWidth || vw,
      this.video.clientHeight || vh
    );
    if (!recorte) return null;

    // Primero miramos una zona central amplia para no elegir un sticker vecino.
    // Si no aparece nada, repetimos sobre todo el campo visible: así un QR válido
    // no se pierde solamente porque quedó rozando el borde de la mira.
    const central = this._leerRecorte(recorte);
    if (central) return central;
    const completo = calcularRecorteCentral(
      vw, vh,
      this.video.clientWidth || vw,
      this.video.clientHeight || vh,
      0
    );
    return completo ? this._leerRecorte(completo) : null;
  }

  _leerRecorte(recorte) {
    const escala = Math.min(1, ANCHO_ANALISIS / recorte.ancho);
    const w = Math.round(recorte.ancho * escala);
    const h = Math.round(recorte.alto * escala);
    if (this.lienzo.width !== w || this.lienzo.height !== h) {
      this.lienzo.width = w;
      this.lienzo.height = h;
    }
    this.contexto.drawImage(
      this.video,
      recorte.x, recorte.y, recorte.ancho, recorte.alto,
      0, 0, w, h
    );
    const imagen = this.contexto.getImageData(0, 0, w, h);
    return decodificar(imagen.data, w, h)?.texto?.trim() || null;
  }

  async _bucle() {
    while (this.activo) {
      const arranque = performance.now();
      try {
        if (this.video.readyState >= 2) {
          const texto = await this._leerCuadro();

          if (texto) {
            // La camara ve el mismo sticker muchas veces por segundo. Solo avisamos
            // cuando aparece un codigo distinto del anterior, o cuando el anterior
            // dejo de verse un momento: asi se puede volver a escanear el mismo.
            if (texto !== this.ultimoCodigo) {
              this.ultimoCodigo = texto;
              this.vacioDesde = 0;
              this.alDetectar(texto);
            } else {
              this.vacioDesde = 0;
            }
          } else if (this.ultimoCodigo) {
            const ahora = performance.now();
            if (!this.vacioDesde) this.vacioDesde = ahora;
            else if (ahora - this.vacioDesde > 700) this.ultimoCodigo = null;
          }
        }
      } catch { /* un cuadro fallido no importa: seguimos con el siguiente */ }

      // Apuntamos a unos 12 cuadros por segundo. Descontamos lo que tardo el
      // analisis para no acumular retraso ni fundir la bateria.
      const resto = 80 - (performance.now() - arranque);
      await new Promise(r => setTimeout(r, Math.max(0, resto)));
    }
  }
}

// ------------------------------------------------------------------ avisos

// Un pitido corto generado al vuelo, sin archivos de sonido. El evaluador no va a
// estar mirando la pantalla mientras pasa la camara por la ficha, asi que el sonido
// y la vibracion son la confirmacion real de que el escaneo entro.
let audio = null;

/**
 * Prepara el audio. Hay que llamarla desde un toque del usuario: iOS no deja crear
 * ni reanudar el sonido fuera de un gesto, y si no, el primer pitido no suena.
 */
export function activarSonido() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    return true;
  } catch {
    return false;
  }
}

export function pitido(tipo = 'ok') {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();

    const tonos = {
      ok: [[880, 0], [1320, .07]],           // dos notas ascendentes
      aviso: [[520, 0], [520, .12]],          // dos golpes iguales
      error: [[300, 0], [200, .1], [150, .2]], // descendente
    }[tipo] || [[880, 0]];

    for (const [frecuencia, retraso] of tonos) {
      const osc = audio.createOscillator();
      const vol = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = frecuencia;
      const t0 = audio.currentTime + retraso;
      vol.gain.setValueAtTime(0, t0);
      vol.gain.linearRampToValueAtTime(.22, t0 + .01);
      vol.gain.exponentialRampToValueAtTime(.001, t0 + .09);
      osc.connect(vol).connect(audio.destination);
      osc.start(t0);
      osc.stop(t0 + .1);
    }
  } catch { /* sin audio la app funciona igual */ }
}

export function vibrar(tipo = 'ok') {
  try {
    navigator.vibrate?.({ ok: 40, aviso: [60, 50, 60], error: [90, 60, 90, 60, 90] }[tipo] || 40);
  } catch { /* muchos navegadores de escritorio no vibran */ }
}

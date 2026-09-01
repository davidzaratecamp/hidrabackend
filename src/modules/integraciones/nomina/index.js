'use strict';

/**
 * Desprendibles de nómina: puerto + adaptadores.
 *
 * Es funcionalidad de EMPLEADOS, ajena al embudo de reclutamiento: consulta una
 * API externa por la cédula del usuario logueado.
 *
 * Portado de `desprendibles.controller.js`, con tres correcciones:
 *   - Era el único módulo que respondía `{ ok, message }` en vez del sobre del
 *     resto del sistema; ahora usa el manejador de errores central.
 *   - Devolvía `error.message` crudo al cliente en el catch, filtrando detalle
 *     interno.
 *   - Reenviaba el status del proveedor tal cual; ahora un fallo externo se
 *     traduce a 502, que es lo que realmente ocurrió desde el punto de vista
 *     de quien llama a Hidra.
 */

const { HttpError } = require('../../../shared/errors/HttpError');

function crearNominaHttp({ config, logger }) {
  if (!config.configurado) {
    throw new Error('El adaptador de nómina requiere NOMINA_BASE_URL y API_KEY_NOMINA');
  }

  async function pedir(ruta) {
    const respuesta = await fetch(`${config.url}${ruta}`, {
      headers: { 'X-Api-Key': config.apiKey },
    });
    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => '');
      logger.error(
        { ruta, estado: respuesta.status, detalle: detalle.slice(0, 300) },
        'La API de nómina respondió con error'
      );
      throw HttpError.servicioExterno('El servicio de nómina no está disponible', {
        codigo: 'NOMINA_ERROR',
        detalles: { estadoProveedor: respuesta.status },
      });
    }
    return respuesta;
  }

  return {
    nombre: 'nomina-http',

    async mesesDisponibles(cedula) {
      const respuesta = await pedir(`/meses?cedula=${encodeURIComponent(cedula)}`);
      return respuesta.json();
    },

    async descargarPdf(cedula, anio, mes) {
      const respuesta = await pedir(
        `/pdf/${anio}/${mes}?cedula=${encodeURIComponent(cedula)}`
      );
      return Buffer.from(await respuesta.arrayBuffer());
    },
  };
}

/** Adaptador de memoria, para desarrollo y pruebas sin la API externa. */
function crearNominaMemoria() {
  return {
    nombre: 'nomina-memoria',
    async mesesDisponibles() {
      return { meses: [] };
    },
    async descargarPdf() {
      throw HttpError.servicioExterno('La integración de nómina no está configurada', {
        codigo: 'NOMINA_NO_CONFIGURADA',
      });
    },
  };
}

module.exports = { crearNominaHttp, crearNominaMemoria };

'use strict';

/**
 * Sobre único de respuesta.
 *
 * Todo endpoint responde con la misma forma, para que el cliente no tenga que
 * adivinar dónde vienen los datos ni cómo se llama el campo de error:
 *
 *   éxito → { ok: true,  datos, meta? }
 *   error → { ok: false, error: { codigo, mensaje, detalles? } }
 */

function ok(res, datos, { estado = 200, meta } = {}) {
  const cuerpo = { ok: true, datos };
  if (meta) cuerpo.meta = meta;
  return res.status(estado).json(cuerpo);
}

function creado(res, datos) {
  return ok(res, datos, { estado: 201 });
}

function sinContenido(res) {
  return res.status(204).end();
}

/**
 * Respuesta paginada. `meta` lleva siempre la misma forma para que el frontend
 * pueda tener un solo componente de paginación.
 */
function paginado(res, items, { pagina, porPagina, total }) {
  return ok(res, items, {
    meta: {
      pagina,
      porPagina,
      total,
      totalPaginas: porPagina > 0 ? Math.ceil(total / porPagina) : 0,
    },
  });
}

module.exports = { ok, creado, sinContenido, paginado };

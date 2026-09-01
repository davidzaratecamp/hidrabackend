'use strict';

/**
 * Desprendibles de nómina del usuario logueado.
 *
 * No lleva permiso: cualquiera con sesión puede ver SUS propios desprendibles.
 * La cédula sale del token, nunca de la petición, así que un usuario no puede
 * pedir los de otro.
 */

const { Router } = require('express');
const { z } = require('zod');
const { validar } = require('../../shared/middleware/validar');
const { ok } = require('../../shared/utils/respuesta');
const { HttpError } = require('../../shared/errors/HttpError');

const periodo = z.object({
  anio: z.coerce.number().int().min(2000).max(2100),
  mes: z.coerce.number().int().min(1).max(12),
});

function crearDesprendiblesRutas({ nomina, autenticar }) {
  const router = Router();
  router.use(autenticar);

  /** La integración identifica al empleado por cédula. */
  function exigirCedula(req) {
    const cedula = req.usuario.numeroDocumento;
    if (!cedula) {
      throw HttpError.peticionInvalida(
        'Tu usuario no tiene número de documento registrado. Contacta al administrador.',
        { codigo: 'SIN_DOCUMENTO' }
      );
    }
    return cedula;
  }

  router.get('/meses', async (req, res) =>
    ok(res, await nomina.mesesDisponibles(exigirCedula(req)))
  );

  router.get('/:anio/:mes.pdf', validar({ params: periodo }), async (req, res) => {
    const { anio, mes } = req.params;
    const pdf = await nomina.descargarPdf(exigirCedula(req), anio, mes);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="desprendible-${anio}-${mes}.pdf"`);
    return res.send(pdf);
  });

  return router;
}

module.exports = { crearDesprendiblesRutas };

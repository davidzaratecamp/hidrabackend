'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { validar } = require('../../shared/middleware/validar');
const { requierePermiso } = require('../../shared/middleware/autorizar');
const { crearSubidor } = require('../../shared/middleware/subirArchivo');
const { ok } = require('../../shared/utils/respuesta');

const params = z.object({ id: z.coerce.number().int().positive() });

const registrar = z.object({
  tipo: z.enum(['adres', 'policia', 'comparendos', 'procuraduria']),
  estado: z.enum(['aprobado', 'no_aprobado']),
  novedad: z.string().trim().min(3).max(255).optional(),
});

function crearAntecedentesRutas({ antecedentesServicio, autenticar }) {
  const router = Router();
  const campos = crearSubidor('antecedentes');

  router.use(autenticar);

  router.get(
    '/candidatos/:id',
    requierePermiso('ver_candidatos'),
    validar({ params }),
    async (req, res) => ok(res, await antecedentesServicio.listar(req.params.id, req.usuario))
  );

  router.post(
    '/candidatos/:id',
    requierePermiso('gestionar_antecedentes'),
    // multipart: el subidor va ANTES de la validación, porque hasta que multer
    // no procesa el cuerpo, `req.body` está vacío.
    campos([{ name: 'documento', maxCount: 1 }]),
    validar({ params, body: registrar }),
    async (req, res) =>
      ok(
        res,
        await antecedentesServicio.registrar(
          req.params.id,
          req.body,
          req.files?.documento?.[0],
          req.usuario
        )
      )
  );

  router.get(
    '/candidatos/:id/documento/:documentoId',
    requierePermiso('ver_candidatos'),
    validar({ params: params.extend({ documentoId: z.coerce.number().int().positive() }) }),
    async (req, res) => {
      const { contenido, mimeType, documentoId } = await antecedentesServicio.descargar(
        req.params.id,
        req.params.documentoId,
        req.usuario
      );
      res.set('Content-Type', mimeType);
      // Nombre generado, nunca el original del archivo: el nombre que sube el
      // usuario es entrada no confiable y acaba en una cabecera HTTP.
      res.set('Content-Disposition', `inline; filename="antecedente-${documentoId}"`);
      return res.send(contenido);
    }
  );

  return router;
}

module.exports = { crearAntecedentesRutas };

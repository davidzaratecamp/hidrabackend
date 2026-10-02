'use strict';

/**
 * Formulario público del candidato.
 *
 * Son las únicas rutas sin autenticación que escriben en la base.
 *
 * La autorización es el token: quien lo tiene puede editar ESE candidato y solo
 * ese. Por eso el `candidato_id` nunca viaja en la URL ni en el cuerpo, se
 * deduce del token.
 */

const { Router } = require('express');
const { validar } = require('../../shared/middleware/validar');
const { ok } = require('../../shared/utils/respuesta');
const { enviarPdfComoAdjunto } = require('../../shared/utils/descarga');
const esquema = require('./formulario.schema');

function crearFormularioRutas({ formularioServicio }) {
  const router = Router();

  const conToken = (parteCuerpo, metodo) => [
    validar({ params: esquema.parametrosToken, body: parteCuerpo }),
    async (req, res) => ok(res, await formularioServicio[metodo](req.params.token, req.body)),
  ];

  router.get(
    '/:token',
    validar({ params: esquema.parametrosToken }),
    async (req, res) => ok(res, await formularioServicio.abrirFormulario(req.params.token))
  );

  router.put('/:token/hoja-vida', ...conToken(esquema.hojaVida, 'guardarHojaVida'));
  router.put('/:token/datos-basicos', ...conToken(esquema.datosBasicos, 'guardarDatosBasicos'));
  router.put('/:token/estudios', ...conToken(esquema.estudios, 'guardarEstudios'));
  router.put('/:token/experiencia', ...conToken(esquema.experiencia, 'guardarExperiencia'));
  router.put('/:token/personal', ...conToken(esquema.personal, 'guardarPersonal'));
  router.put('/:token/consentimiento', ...conToken(esquema.consentimiento, 'guardarConsentimiento'));

  return router;
}

/** Rutas de firma electrónica: internas, requieren sesión. */
function crearFirmaRutas({ formularioServicio, autenticar }) {
  const { requierePermiso } = require('../../shared/middleware/autorizar');
  const { z } = require('zod');
  const router = Router();
  router.use(autenticar, requierePermiso('ver_candidatos'));

  const params = z.object({ id: z.coerce.number().int().positive() });

  router.get('/:id/estado', validar({ params }), async (req, res) =>
    ok(res, await formularioServicio.estadoFirma(req.params.id, req.usuario))
  );

  router.get(
    '/:id/documento/:tipo',
    validar({ params: params.extend({ tipo: z.enum(['cv', 'tratamiento']) }) }),
    async (req, res) => {
      const { contenido, mimeType } = await formularioServicio.descargarDocumentoFirmado(
        req.params.id,
        req.params.tipo,
        req.usuario
      );
      res.set('Content-Type', mimeType);
      // Nombre fijo y sin datos del usuario: evita inyección en la cabecera,
      // que era un riesgo real en la descarga de antecedentes del sistema viejo.
      res.set('Content-Disposition', `inline; filename="${req.params.tipo}-${req.params.id}.pdf"`);
      return res.send(contenido);
    }
  );

  router.get('/:id/unificado', validar({ params }), async (req, res) => {
    const { contenido, nombreCandidato } = await formularioServicio.unificarDocumentosFirmados(
      req.params.id,
      req.usuario
    );
    return enviarPdfComoAdjunto(res, contenido, nombreCandidato, `candidato-${req.params.id}`);
  });

  router.post('/:id/reenviar', validar({ params }), async (req, res) =>
    ok(res, await formularioServicio.reenviarAFirmar(req.params.id, req.usuario))
  );

  const firmarHojaVida = z.object({
    signatureDataUrl: z.string().startsWith('data:image/png;base64,'),
    signatureMode: z.enum(['draw', 'font']),
  });

  // Segunda firma (Selección/Administrador) sobre la hoja de vida ya firmada por el candidato.
  // El router ya exige `ver_candidatos` arriba (router.use); este middleware adicional exige
  // ADEMÁS `firmar_hoja_vida` — ambos deben cumplirse.
  router.post(
    '/:id/firmar-hoja-vida',
    requierePermiso('firmar_hoja_vida'),
    validar({ params, body: firmarHojaVida }),
    async (req, res) =>
      ok(res, await formularioServicio.firmarHojaVida(req.params.id, req.body, req.usuario))
  );

  return router;
}

module.exports = { crearFormularioRutas, crearFirmaRutas };

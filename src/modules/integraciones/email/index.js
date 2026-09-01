'use strict';

/**
 * Envío de correo: puerto + adaptadores.
 *
 * El puerto es una sola operación: `enviar({ para, asunto, html })`, que
 * RESUELVE si el correo salió y LANZA si no. Eso es lo contrario del servicio
 * viejo, que ante un fallo de `sendMail` devolvía
 * `{ success: true, message: 'Email simulado...' }` y el usuario veía "Email
 * reenviado exitosamente" aunque no hubiera salido nada.
 *
 * Hay dos adaptadores:
 *   - nodemailer, para desarrollo y producción
 *   - memoria, para las pruebas: guarda los mensajes en un array y permite
 *     leer el link del formulario sin montar un servidor SMTP
 */

const { HttpError } = require('../../../shared/errors/HttpError');

/** Adaptador real. Falla ruidosamente: quien llame decide qué hacer. */
function crearEmailNodemailer({ config, logger }) {
  if (!config.configurado) {
    throw new Error('El adaptador de correo requiere EMAIL_HOST, EMAIL_USER y EMAIL_PASS');
  }

  // Se importa aquí y no arriba para que el módulo se pueda cargar en pruebas
  // sin tener nodemailer configurado.
  const nodemailer = require('nodemailer');
  const transporte = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure ?? true,
    auth: { user: config.usuario, pass: config.password },
  });

  return {
    nombre: 'nodemailer',
    async enviar({ para, asunto, html, texto }) {
      try {
        const info = await transporte.sendMail({
          from: config.remitente ?? config.usuario,
          to: para,
          subject: asunto,
          html,
          text: texto,
        });
        logger.info({ para, messageId: info.messageId }, 'Correo enviado');
        return { messageId: info.messageId };
      } catch (error) {
        logger.error({ err: error, para }, 'Falló el envío de correo');
        throw HttpError.servicioExterno('No se pudo enviar el correo', {
          codigo: 'EMAIL_FALLIDO',
          causa: error,
        });
      }
    },
  };
}

/**
 * Adaptador de memoria. Cumple el mismo contrato, así que el servicio no
 * distingue cuál está usando (sustitución de Liskov).
 */
function crearEmailMemoria({ logger } = {}) {
  const enviados = [];
  let fallarProximo = null;

  return {
    nombre: 'memoria',
    enviados,

    /** Fuerza el fallo del próximo envío, para probar el camino de error. */
    hacerFallarProximo(mensaje = 'Fallo simulado de SMTP') {
      fallarProximo = mensaje;
    },

    async enviar({ para, asunto, html, texto }) {
      if (fallarProximo) {
        const mensaje = fallarProximo;
        fallarProximo = null;
        throw HttpError.servicioExterno(mensaje, { codigo: 'EMAIL_FALLIDO' });
      }
      const mensaje = { para, asunto, html, texto, fecha: new Date() };
      enviados.push(mensaje);
      logger?.debug({ para, asunto }, 'Correo capturado por el adaptador de memoria');
      return { messageId: `memoria-${enviados.length}` };
    },

    ultimoPara(para) {
      return [...enviados].reverse().find((m) => m.para === para) ?? null;
    },

    limpiar() {
      enviados.length = 0;
      fallarProximo = null;
    },
  };
}

module.exports = { crearEmailNodemailer, crearEmailMemoria };

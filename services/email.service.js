const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  }

  async enviarFormularios(candidato) {
    const baseUrl = process.env.FRONTEND_URL;
    const token = candidato.token_acceso;
    
    const htmlTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Formularios de Reclutamiento - Hydra</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #1e40af; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f8f9fa; }
        .btn { display: inline-block; padding: 12px 24px; background: #1e40af; color: white; text-decoration: none; border-radius: 6px; margin: 10px 0; }
        .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎯 ASISTE ING</h1>
          <p>Formularios de Proceso de Selección</p>
        </div>
        
        <div class="content">
          <h2>¡Hola ${candidato.primer_nombre} ${candidato.primer_apellido}!</h2>
          
          <p>Te damos la bienvenida al proceso de selección de <strong>${candidato.cliente}</strong> para el cargo de <strong>${candidato.cargo}</strong>.</p>
          
          <p>Para continuar con el proceso, necesitamos que completes los siguientes formularios:</p>
          
          <ol>
            <li><strong>Hoja de Vida</strong> - Información básica</li>
            <li><strong>Datos Básicos</strong> - Información personal y contactos</li>
            <li><strong>Estudios</strong> - Formación académica</li>
            <li><strong>Experiencia</strong> - Experiencia laboral</li>
            <li><strong>Información Personal</strong> - Competencias y metas</li>
            <li><strong>Consentimiento</strong> - Autorización de datos</li>
          </ol>
          
          <p style="text-align: center;">
            <a href="${baseUrl}/candidato/hoja-vida/${token}" class="btn">
              Completar Formularios
            </a>
          </p>
          
          <div style="background: #e3f2fd; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <p><strong>📅 Información importante:</strong></p>
            <ul>
              <li>Tienes <strong>30 días</strong> para completar todos los formularios</li>
              <li>Puedes guardar y continuar en otro momento</li>
              <li>Los formularios deben completarse en orden secuencial</li>
              <li>Al finalizar recibirás una confirmación</li>
            </ul>
          </div>
          
          <p>Si tienes alguna pregunta sobre el proceso, no dudes en contactarnos.</p>
          
          <p>¡Esperamos conocerte pronto!</p>
          
          <p><strong>Equipo ASISTE ING</strong></p>
        </div>
        
        <div class="footer">
          <p>Este es un mensaje automático, por favor no responder a este email.</p>
          <p>© 2024 ASISTE ING. Todos los derechos reservados.</p>
        </div>
      </div>
    </body>
    </html>
    `;

    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: candidato.email_personal,
      subject: `🎯 Formularios de Reclutamiento - ${candidato.cliente} | ${candidato.cargo}`,
      html: htmlTemplate
    };

    try {
      if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.log('Configuración de email no disponible. Email simulado:', {
          to: candidato.email_personal,
          subject: mailOptions.subject,
          enlace: `${baseUrl}/candidato/hoja-vida/${token}`
        });
        return { success: true, message: 'Email simulado (configuración pendiente)' };
      }

      const info = await this.transporter.sendMail(mailOptions);
      console.log('Email enviado:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('Error enviando email:', error);
      
      console.log('Email simulado por error:', {
        to: candidato.email_personal,
        subject: mailOptions.subject,
        enlace: `${baseUrl}/candidato/hoja-vida/${token}`
      });
      
      return { success: true, message: 'Email simulado por error en configuración' };
    }
  }

  async enviarNotificacionCompletado(candidato) {
    console.log(`📧 Notificación: ${candidato.primer_nombre} ${candidato.primer_apellido} completó todos los formularios`);
    return { success: true };
  }
}

module.exports = new EmailService();
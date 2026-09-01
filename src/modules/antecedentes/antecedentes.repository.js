'use strict';

/** Repositorio de antecedentes y documentos adjuntos. */

function crearAntecedentesRepositorio({ db }) {
  async function registrarDocumento({ candidatoId, tipoCodigo, rutaArchivo, nombreOriginal, mimeType, tamanoBytes, subidoPorId }) {
    const [res] = await db.query(
      `INSERT INTO candidato_documentos
         (candidato_id, tipo_id, ruta_archivo, nombre_original, mime_type, tamano_bytes, subido_por_id)
       SELECT ?, t.id, ?, ?, ?, ?, ?
         FROM tipos_documento_adjunto t
        WHERE t.codigo = ?`,
      [candidatoId, rutaArchivo, nombreOriginal, mimeType, tamanoBytes, subidoPorId ?? null, tipoCodigo]
    );
    return res.insertId || null;
  }

  async function buscarDocumento(documentoId) {
    const [filas] = await db.query(
      `SELECT d.id, d.candidato_id, d.ruta_archivo, d.nombre_original, d.mime_type
         FROM candidato_documentos d WHERE d.id = ?`,
      [documentoId]
    );
    return filas[0] ?? null;
  }

  async function eliminarDocumento(documentoId) {
    await db.query('DELETE FROM candidato_documentos WHERE id = ?', [documentoId]);
  }

  /**
   * Alta o actualización de una verificación. El UNIQUE(candidato, tipo) hace
   * que re-verificar reemplace en vez de duplicar.
   */
  async function guardar({ candidatoId, tipoCodigo, estado, novedad, documentoId, verificadoPorId }) {
    const [res] = await db.query(
      `INSERT INTO candidato_antecedentes
         (candidato_id, tipo_antecedente_id, estado, novedad, documento_id, verificado_por_id)
       SELECT ?, t.id, ?, ?, ?, ?
         FROM tipos_antecedente t
        WHERE t.codigo = ?
       ON DUPLICATE KEY UPDATE
         estado = VALUES(estado), novedad = VALUES(novedad),
         documento_id = COALESCE(VALUES(documento_id), documento_id),
         verificado_por_id = VALUES(verificado_por_id)`,
      [candidatoId, estado, novedad ?? null, documentoId ?? null, verificadoPorId ?? null, tipoCodigo]
    );
    return res.affectedRows > 0;
  }

  /** Documento anterior de una verificación, para poder borrarlo del disco. */
  async function documentoAnterior(candidatoId, tipoCodigo) {
    const [filas] = await db.query(
      `SELECT a.documento_id, d.ruta_archivo
         FROM candidato_antecedentes a
         JOIN tipos_antecedente t ON t.id = a.tipo_antecedente_id
         LEFT JOIN candidato_documentos d ON d.id = a.documento_id
        WHERE a.candidato_id = ? AND t.codigo = ?`,
      [candidatoId, tipoCodigo]
    );
    return filas[0] ?? null;
  }

  async function listarDe(candidatoId) {
    const [filas] = await db.query(
      `SELECT t.codigo AS tipo, t.nombre, a.estado, a.novedad, a.documento_id,
              d.nombre_original, a.updated_at,
              u.nombre_completo AS verificado_por
         FROM tipos_antecedente t
         LEFT JOIN candidato_antecedentes a
                ON a.tipo_antecedente_id = t.id AND a.candidato_id = ?
         LEFT JOIN candidato_documentos d ON d.id = a.documento_id
         LEFT JOIN usuarios u ON u.id = a.verificado_por_id
        WHERE t.activo = TRUE
        ORDER BY t.orden`,
      [candidatoId]
    );
    return filas;
  }

  return {
    registrarDocumento, buscarDocumento, eliminarDocumento,
    guardar, documentoAnterior, listarDe,
  };
}

module.exports = { crearAntecedentesRepositorio };

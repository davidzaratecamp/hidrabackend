'use strict';

const ExcelJS = require('exceljs');
const { HttpError } = require('../../shared/errors/HttpError');
const { separarNombreCompleto } = require('../../shared/utils/nombreCompleto');
const { citarEnTransaccion } = require('../seleccion/citar');
const esquema = require('./candidato.schema');
const { parsearWorkbook, COLUMNAS, etiquetaDe } = require('./candidato.importarExcel');
const visibilidad = require('./visibilidad');

const ESTADO_INICIAL = 'nuevo';

function crearCandidatoServicio({ candidatoRepo, catalogoRepo, estadoServicio, uow }) {
  /**
   * Traduce los códigos de catálogo que envía el cliente a ids.
   *
   * El cliente nunca manda ids: manda 'CC', 'Obamacare', 'Agente'. Así el
   * frontend no depende de las claves primarias y la API es legible.
   */
  /**
   * `flexible` (usado solo por `importarExcel`): compara códigos ignorando
   * mayúsculas/espacios, para tolerar cómo suele escribirse un Excel a mano.
   * El camino normal (formulario web) sigue exigiendo el código exacto que
   * ya elige el propio `<select>` — no cambia nada para ese caso.
   */
  async function resolverReferencias(datos, { parcial = false, flexible = false } = {}) {
    const ref = {};
    const idPorCodigo = flexible ? catalogoRepo.idPorCodigoFlexible : catalogoRepo.idPorCodigo;
    const idCliente = flexible ? catalogoRepo.idClienteFlexible : catalogoRepo.idCliente;
    const idCargoParaCliente = flexible
      ? catalogoRepo.idCargoParaClienteFlexible
      : catalogoRepo.idCargoParaCliente;
    const idEstadoGestion = flexible ? catalogoRepo.idEstadoGestionFlexible : catalogoRepo.idEstadoGestion;

    if (datos.tipoDocumento !== undefined) {
      ref.tipoDocumentoId = await idPorCodigo('tipos_documento', datos.tipoDocumento);
      if (!ref.tipoDocumentoId) {
        throw HttpError.peticionInvalida(`Tipo de documento inválido: ${datos.tipoDocumento}`, {
          codigo: 'CATALOGO_INVALIDO',
        });
      }
    }

    if (datos.cliente !== undefined) {
      ref.clienteId = await idCliente(datos.cliente);
      if (!ref.clienteId) {
        throw HttpError.peticionInvalida(`Cliente inválido: ${datos.cliente}`, {
          codigo: 'CATALOGO_INVALIDO',
        });
      }
    }

    // El cargo se valida CONTRA el cliente: no basta con que exista, tiene que
    // estar habilitado para esa campaña (tabla puente cliente_cargos).
    if (datos.cargo !== undefined) {
      if (!ref.clienteId && parcial) {
        throw HttpError.peticionInvalida('Para cambiar el cargo debes enviar también el cliente', {
          codigo: 'CARGO_SIN_CLIENTE',
        });
      }
      ref.cargoId = await idCargoParaCliente(ref.clienteId, datos.cargo);
      if (!ref.cargoId) {
        throw HttpError.peticionInvalida(
          `El cargo "${datos.cargo}" no está habilitado para el cliente "${datos.cliente}"`,
          { codigo: 'CARGO_NO_DISPONIBLE' }
        );
      }
    }

    const opcionales = [
      ['ciudad', 'ciudades', 'ciudadId'],
      ['fuenteReclutamiento', 'fuentes_reclutamiento', 'fuenteReclutamientoId'],
      ['tipificacionLlamada', 'tipificaciones_llamada', 'tipificacionLlamadaId'],
    ];
    for (const [campo, catalogo, destino] of opcionales) {
      if (datos[campo] === undefined) continue;
      if (datos[campo] === null) {
        ref[destino] = null;
        continue;
      }
      ref[destino] = await idPorCodigo(catalogo, datos[campo]);
      if (!ref[destino]) {
        throw HttpError.peticionInvalida(`Valor inválido para ${campo}: ${datos[campo]}`, {
          codigo: 'CATALOGO_INVALIDO',
        });
      }
    }

    if (datos.estadoGestion !== undefined) {
      ref.estadoGestionId = datos.estadoGestion === null ? null : await idEstadoGestion(datos.estadoGestion);
      if (datos.estadoGestion !== null && !ref.estadoGestionId) {
        throw HttpError.peticionInvalida(`Estado de gestión inválido: ${datos.estadoGestion}`, {
          codigo: 'CATALOGO_INVALIDO',
        });
      }
    }

    return ref;
  }

  /**
   * Alta de un candidato dentro de una transacción ya abierta: candidato,
   * historial, asignación inicial y —si `Citado=Sí`— la citación real. Es el
   * cuerpo que antes vivía inline en `crear()`; se extrajo para que
   * `importarExcel` pueda repetirlo N veces dentro de UNA sola transacción
   * (todo el archivo se confirma o se revierte junto, ver `importarExcel`).
   */
  async function altaCandidatoEnTransaccion(repos, { datos, ref, usuario, estadoInicial }) {
    const nombre = separarNombreCompleto(datos.nombreCompleto);
    const repo = repos.candidatoRepo;

    const nuevoId = await repo.crear({
      primerNombre: nombre.primerNombre,
      segundoNombre: nombre.segundoNombre,
      primerApellido: nombre.primerApellido,
      segundoApellido: nombre.segundoApellido,
      numeroDocumento: datos.numeroDocumento ?? null,
      edad: datos.edad ?? null,
      email: datos.email ?? null,
      celular: datos.celular,
      contactoLlamada: datos.contactoLlamada ?? null,
      contactoWhatsapp: datos.contactoWhatsapp ?? null,
      observacionesGenerales: datos.observacionesGenerales ?? null,
      perfil: datos.perfil ?? null,
      citado: datos.citado ?? null,
      estadoId: estadoInicial.id,
      reclutadorId: usuario.id,
      ...ref,
      ciudadId: ref.ciudadId ?? null,
      fuenteReclutamientoId: ref.fuenteReclutamientoId ?? null,
      tipificacionLlamadaId: ref.tipificacionLlamadaId ?? null,
      estadoGestionId: ref.estadoGestionId ?? null,
    });

    // El registro de creación queda en el historial con estado anterior NULL.
    await repo.registrarHistorial({
      candidatoId: nuevoId,
      estadoAnteriorId: null,
      estadoNuevoId: estadoInicial.id,
      usuarioId: usuario.id,
      motivo: 'Registro del candidato',
    });
    await repo.registrarAsignacion({
      candidatoId: nuevoId,
      anteriorId: null,
      nuevoId: usuario.id,
      asignadoPorId: usuario.id,
      motivo: 'Asignación inicial',
    });

    // Citado = Sí en el formulario ES citar al candidato (decisión de
    // negocio, 2026-08-30): queda en estado 'citado' y con su citación, sin
    // pasar por Selección. Va dentro de la misma transacción porque un alta
    // que dijera "citado" sin la citación —o al revés— es precisamente la
    // contradicción que el esquema nuevo vino a eliminar.
    if (datos.citado === true) {
      await citarEnTransaccion(repos, {
        candidato: { id: nuevoId, estado: ESTADO_INICIAL },
        usuarioId: usuario.id,
        motivo: 'Citado al registrar',
        estadoServicio,
      });
    }

    return nuevoId;
  }

  /** Carga el candidato y comprueba que el usuario tenga derecho a verlo. */
  async function obtenerAccesible(id, usuario) {
    const candidato = await candidatoRepo.buscarPorId(id);
    if (!candidato) throw HttpError.noEncontrado('Candidato no encontrado');
    if (!visibilidad.puedeAcceder(usuario, candidato)) {
      // Mismo 404 que si no existiera: un 403 confirmaría que el candidato existe.
      throw HttpError.noEncontrado('Candidato no encontrado');
    }
    return candidato;
  }

  return {
    obtenerAccesible,

    async crear(datos, usuario) {
      const nombre = separarNombreCompleto(datos.nombreCompleto);

      if (datos.numeroDocumento && (await candidatoRepo.existeDocumento(datos.numeroDocumento))) {
        throw HttpError.conflicto('Ya existe un candidato con ese número de documento', {
          codigo: 'DOCUMENTO_DUPLICADO',
        });
      }

      const ref = await resolverReferencias(datos);
      const estadoInicial = await estadoServicio.estadoPorCodigo(ESTADO_INICIAL);

      const id = await uow.ejecutar((repos) =>
        altaCandidatoEnTransaccion(repos, { datos, ref, usuario, estadoInicial })
      );

      return candidatoRepo.buscarPorId(id);
    },

    /**
     * Carga masiva desde un Excel: cada fila termina en la base exactamente
     * igual que si viniera de `crear()` — misma validación, mismo alta,
     * mismo `reclutador_id = quien sube el archivo`. Ver la nota de
     * "Garantía central" del plan de este feature.
     *
     * Todo o nada: se valida el archivo COMPLETO antes de escribir nada; si
     * una sola fila falla, no se registra ningún candidato del archivo y se
     * devuelve el detalle de cada fila con error (no solo la primera).
     */
    async importarExcel(buffer, usuario) {
      let filas;
      try {
        filas = await parsearWorkbook(buffer);
      } catch (e) {
        throw HttpError.peticionInvalida(e.message, { codigo: 'ARCHIVO_INVALIDO' });
      }

      if (filas.length === 0) {
        throw HttpError.peticionInvalida('El archivo no tiene filas para importar', {
          codigo: 'ARCHIVO_VACIO',
        });
      }

      const estadoInicial = await estadoServicio.estadoPorCodigo(ESTADO_INICIAL);
      const documentosEnArchivo = new Map();
      const filasValidas = [];
      const filasConError = [];

      for (const { fila, datos: crudo, errores: erroresPrevios } of filas) {
        const errores = [...erroresPrevios];

        const resultado = esquema.crear.safeParse(crudo);
        let datos = null;
        if (!resultado.success) {
          for (const issue of resultado.error.issues) {
            errores.push(`${etiquetaDe(issue.path[0])}: ${issue.message}`);
          }
        } else {
          datos = resultado.data;
        }

        let ref = null;
        if (datos) {
          try {
            ref = await resolverReferencias(datos, { flexible: true });
          } catch (e) {
            errores.push(e.message);
          }
        }

        if (datos?.numeroDocumento) {
          const primeraFila = documentosEnArchivo.get(datos.numeroDocumento);
          if (primeraFila) {
            errores.push(`${etiquetaDe('numeroDocumento')}: repetido, ya aparece en la fila ${primeraFila}`);
          } else {
            documentosEnArchivo.set(datos.numeroDocumento, fila);
            if (await candidatoRepo.existeDocumento(datos.numeroDocumento)) {
              errores.push(`${etiquetaDe('numeroDocumento')}: ya existe un candidato con ese documento`);
            }
          }
        }

        if (errores.length > 0) {
          filasConError.push({ fila, errores });
        } else {
          filasValidas.push({ fila, datos, ref });
        }
      }

      if (filasConError.length > 0) {
        throw HttpError.peticionInvalida('El archivo tiene errores, no se registró ningún candidato', {
          codigo: 'ERRORES_EN_ARCHIVO',
          detalles: { filas: filasConError },
        });
      }

      // Una sola transacción para TODO el archivo: si algo falla acá (una
      // restricción de BD que la validación de arriba no pudo anticipar), se
      // revierte el lote completo en vez de dejarlo a medias.
      await uow.ejecutar(async (repos) => {
        for (const { fila, datos, ref } of filasValidas) {
          try {
            await altaCandidatoEnTransaccion(repos, { datos, ref, usuario, estadoInicial });
          } catch (e) {
            // Carrera entre dos cargas simultáneas con el mismo documento: la
            // validación de arriba (fuera de la transacción) no lo vio porque
            // ninguna de las dos había confirmado todavía, pero la restricción
            // UNIQUE de la base sí lo frena acá. Se traduce al mismo formato
            // de error por fila en vez del 409 genérico, para que quien pierde
            // la carrera sepa exactamente cuál fue la fila y pueda reintentar.
            if (e.code === 'ER_DUP_ENTRY' && String(e.sqlMessage ?? '').includes('uq_candidatos_documento')) {
              throw HttpError.peticionInvalida('El archivo tiene errores, no se registró ningún candidato', {
                codigo: 'ERRORES_EN_ARCHIVO',
                detalles: {
                  filas: [
                    {
                      fila,
                      errores: [
                        `${etiquetaDe('numeroDocumento')}: ya existe un candidato con ese documento (lo registró otra carga al mismo tiempo)`,
                      ],
                    },
                  ],
                },
              });
            }
            throw e;
          }
        }
      });

      return { creados: filasValidas.length };
    },

    /** Workbook de la plantilla descargable: encabezados + hoja de referencia de catálogos. */
    async construirPlantillaImportacion() {
      const workbook = new ExcelJS.Workbook();

      const hoja = workbook.addWorksheet('Candidatos');
      const encabezados = COLUMNAS.map((c) => c.encabezado);
      hoja.addRow(encabezados);
      hoja.getRow(1).font = { bold: true };
      hoja.columns = encabezados.map((h) => ({ width: Math.max(h.length + 2, 16) }));

      const referencia = workbook.addWorksheet('Referencia');
      referencia.columns = [{ width: 28 }, { width: 40 }];
      let fila = 1;
      const seccion = (titulo) => {
        referencia.getRow(fila).getCell(1).value = titulo;
        referencia.getRow(fila).getCell(1).font = { bold: true };
        fila += 1;
      };
      const linea = (a, b) => {
        referencia.getRow(fila).getCell(1).value = a;
        if (b !== undefined) referencia.getRow(fila).getCell(2).value = b;
        fila += 1;
      };

      seccion('CAMPAÑA / CARGO (el cargo debe estar habilitado para esa campaña)');
      const cargosPorCliente = await catalogoRepo.listarCargosPorCliente();
      for (const [cliente, cargos] of Object.entries(cargosPorCliente)) {
        for (const cargo of cargos) linea(cliente, `${cargo.codigo} — ${cargo.nombre}`);
      }
      fila += 1;

      seccion('TIPO DE DOCUMENTO');
      for (const t of await catalogoRepo.listarSimple('tipos_documento')) linea(t.codigo, t.nombre);
      fila += 1;

      seccion('FUENTE DE RECLUTAMIENTO (opcional)');
      for (const f of await catalogoRepo.listarSimple('fuentes_reclutamiento')) linea(f.codigo, f.nombre);
      fila += 1;

      seccion('ESTADO GESTIÓN RECLUTAMIENTO (opcional, aplica cuando CITADO = No)');
      for (const e of await catalogoRepo.listarEstadosGestion()) linea(e.codigo, e.nombre);
      fila += 1;

      seccion('CONTACTO LLAMADA / CONTACTO WHATSAPP / CITADO');
      linea('Acepta únicamente "Sí" o "No" (sin distinguir mayúsculas/tilde).');

      return workbook;
    },

    async listar(filtros, usuario) {
      const { items, total } = await candidatoRepo.listar({
        ...filtros,
        visibilidad: visibilidad.filtroSql(usuario),
      });
      return { items, total, pagina: filtros.pagina, porPagina: filtros.porPagina };
    },

    async resumenEstados(usuario, filtros = {}) {
      return candidatoRepo.resumenPorEstado({
        visibilidad: visibilidad.filtroSql(usuario),
        agentes: filtros.agentes,
        staff: filtros.staff,
      });
    },

    async obtener(id, usuario) {
      const candidato = await obtenerAccesible(id, usuario);
      const [historial, pasos] = await Promise.all([
        candidatoRepo.historial(id),
        candidatoRepo.pasosCompletados(id),
      ]);
      return {
        ...candidato,
        historial,
        formulario: { pasosCompletados: pasos, total: 6, completados: pasos.length },
      };
    },

    async actualizar(id, cambios, usuario) {
      const candidato = await obtenerAccesible(id, usuario);

      if (
        cambios.numeroDocumento &&
        (await candidatoRepo.existeDocumento(cambios.numeroDocumento, id))
      ) {
        throw HttpError.conflicto('Ya existe otro candidato con ese número de documento', {
          codigo: 'DOCUMENTO_DUPLICADO',
        });
      }

      const ref = await resolverReferencias(cambios, { parcial: true });
      const nombre = cambios.nombreCompleto ? separarNombreCompleto(cambios.nombreCompleto) : {};

      await candidatoRepo.actualizar(id, { ...cambios, ...nombre, ...ref });
      return candidatoRepo.buscarPorId(candidato.id);
    },

    /** Cambio de estado manual. Pasa por la máquina de estados como todo lo demás. */
    async cambiarEstado(id, { estado, motivo }, usuario) {
      const candidato = await obtenerAccesible(id, usuario);

      await uow.ejecutar(async ({ candidatoRepo: repo }) =>
        estadoServicio.cambiar({
          repo,
          candidato,
          codigoDestino: estado,
          usuarioId: usuario.id,
          motivo,
        })
      );

      return candidatoRepo.buscarPorId(id);
    },

    async transicionesDisponibles(id, usuario) {
      const candidato = await obtenerAccesible(id, usuario);
      return {
        actual: candidato.estado,
        disponibles: await estadoServicio.transicionesDesde(candidato.estado),
      };
    },

    /**
     * Reasignación masiva de toda la cartera de un reclutador a otro.
     *
     * Deja una fila de traza POR CANDIDATO, no una sola por la operación: de lo
     * contrario el historial de un candidato tendría un hueco inexplicable.
     */
    async reasignarCartera({ origenId, destinoId, motivo }, usuario) {
      if (origenId === destinoId) {
        throw HttpError.peticionInvalida('El origen y el destino son el mismo reclutador', {
          codigo: 'REASIGNACION_SIN_CAMBIO',
        });
      }

      const ids = await candidatoRepo.idsDeReclutador(origenId);
      if (ids.length === 0) {
        return { reasignados: 0, candidatos: [] };
      }

      await uow.ejecutar(async ({ candidatoRepo: repo }) => {
        await repo.reasignarTodos(origenId, destinoId);
        for (const id of ids) {
          await repo.registrarAsignacion({
            candidatoId: id,
            anteriorId: origenId,
            nuevoId: destinoId,
            asignadoPorId: usuario.id,
            motivo: motivo ?? 'Reasignación masiva de cartera',
          });
        }
      });

      return { reasignados: ids.length, candidatos: ids };
    },

    /** Reasignación a otro reclutador, con traza de quién y por qué. */
    async reasignar(id, { reclutadorId, motivo }, usuario) {
      const candidato = await obtenerAccesible(id, usuario);
      if (candidato.reclutador_id === reclutadorId) {
        throw HttpError.conflicto('El candidato ya está asignado a ese reclutador', {
          codigo: 'REASIGNACION_SIN_CAMBIO',
        });
      }

      await uow.ejecutar(async ({ candidatoRepo: repo }) => {
        await repo.actualizar(id, { reclutadorId });
        await repo.registrarAsignacion({
          candidatoId: id,
          anteriorId: candidato.reclutador_id,
          nuevoId: reclutadorId,
          asignadoPorId: usuario.id,
          motivo,
        });
      });

      return candidatoRepo.buscarPorId(id);
    },
  };
}

module.exports = { crearCandidatoServicio };

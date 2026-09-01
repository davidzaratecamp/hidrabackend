'use strict';

const { HttpError } = require('../../shared/errors/HttpError');
const { separarNombreCompleto } = require('../../shared/utils/nombreCompleto');
const { citarEnTransaccion } = require('../seleccion/citar');
const visibilidad = require('./visibilidad');

const ESTADO_INICIAL = 'nuevo';

function crearCandidatoServicio({ candidatoRepo, catalogoRepo, estadoServicio, uow }) {
  /**
   * Traduce los códigos de catálogo que envía el cliente a ids.
   *
   * El cliente nunca manda ids: manda 'CC', 'Obamacare', 'Agente'. Así el
   * frontend no depende de las claves primarias y la API es legible.
   */
  async function resolverReferencias(datos, { parcial = false } = {}) {
    const ref = {};

    if (datos.tipoDocumento !== undefined) {
      ref.tipoDocumentoId = await catalogoRepo.idPorCodigo('tipos_documento', datos.tipoDocumento);
      if (!ref.tipoDocumentoId) {
        throw HttpError.peticionInvalida(`Tipo de documento inválido: ${datos.tipoDocumento}`, {
          codigo: 'CATALOGO_INVALIDO',
        });
      }
    }

    if (datos.cliente !== undefined) {
      ref.clienteId = await catalogoRepo.idCliente(datos.cliente);
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
      ref.cargoId = await catalogoRepo.idCargoParaCliente(ref.clienteId, datos.cargo);
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
      ref[destino] = await catalogoRepo.idPorCodigo(catalogo, datos[campo]);
      if (!ref[destino]) {
        throw HttpError.peticionInvalida(`Valor inválido para ${campo}: ${datos[campo]}`, {
          codigo: 'CATALOGO_INVALIDO',
        });
      }
    }

    if (datos.estadoGestion !== undefined) {
      ref.estadoGestionId =
        datos.estadoGestion === null ? null : await catalogoRepo.idEstadoGestion(datos.estadoGestion);
      if (datos.estadoGestion !== null && !ref.estadoGestionId) {
        throw HttpError.peticionInvalida(`Estado de gestión inválido: ${datos.estadoGestion}`, {
          codigo: 'CATALOGO_INVALIDO',
        });
      }
    }

    return ref;
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

      // Alta, historial y —si se registra ya citado— citación son un solo hecho.
      const id = await uow.ejecutar(async (repos) => {
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
      });

      return candidatoRepo.buscarPorId(id);
    },

    async listar(filtros, usuario) {
      const { items, total } = await candidatoRepo.listar({
        ...filtros,
        visibilidad: visibilidad.filtroSql(usuario),
      });
      return { items, total, pagina: filtros.pagina, porPagina: filtros.porPagina };
    },

    async resumenEstados(usuario) {
      return candidatoRepo.resumenPorEstado({ visibilidad: visibilidad.filtroSql(usuario) });
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

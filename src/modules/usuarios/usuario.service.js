'use strict';

/**
 * Reglas de negocio de usuarios. Sin SQL y sin nada de HTTP.
 *
 * Unifica lo que en el sistema viejo eran tres funciones casi idénticas
 * (`crearUsuario`, `crearReclutador`, `crearUsuarioDesdeSeleccion`, unas 200
 * líneas repitiendo validar → comprobar email → hashear → INSERT) y otras tres
 * para listar y otras dos para eliminar.
 */

const { HttpError } = require('../../shared/errors/HttpError');
const { evaluarRobustez } = require('../../shared/seguridad/password');

const ROL_ADMINISTRADOR = 'administrador';

function crearUsuarioServicio({ usuarioRepo, rolRepo, servicioPassword, uow }) {
  /**
   * Solo un administrador puede otorgar el rol de administrador.
   *
   * Sin esta regla, cualquiera con `crear_usuarios` podría fabricarse un
   * administrador y escalar privilegios. En el sistema viejo la protección
   * equivalente estaba escrita a mano dentro de `crearUsuarioDesdeSeleccion`.
   */
  function verificarEscalacion(rolesSolicitados, actor) {
    if (!rolesSolicitados.includes(ROL_ADMINISTRADOR)) return;
    if (!actor.roles.includes(ROL_ADMINISTRADOR)) {
      throw HttpError.prohibido('Solo un administrador puede otorgar el rol de administrador', {
        codigo: 'ESCALACION_DENEGADA',
      });
    }
  }

  /** Traduce códigos de rol a ids y falla si alguno no existe o está inactivo. */
  async function resolverRoles(codigos) {
    const encontrados = await rolRepo.idsPorCodigos(codigos);
    if (encontrados.length !== codigos.length) {
      const validos = new Set(encontrados.map((r) => r.codigo));
      const invalidos = codigos.filter((c) => !validos.has(c));
      throw HttpError.peticionInvalida(`Rol no válido: ${invalidos.join(', ')}`, {
        codigo: 'ROL_INVALIDO',
        detalles: { invalidos },
      });
    }
    return encontrados.map((r) => r.id);
  }

  function exigirPasswordRobusta(password) {
    const problemas = evaluarRobustez(password);
    if (problemas.length > 0) {
      throw HttpError.peticionInvalida('La contraseña no cumple los requisitos', {
        codigo: 'PASSWORD_DEBIL',
        detalles: problemas,
      });
    }
  }

  return {
    async listar({ pagina, porPagina, busqueda, rol, activo, ordenarPor, direccion }) {
      const { items, total } = await usuarioRepo.listar({
        pagina,
        porPagina,
        busqueda,
        rol,
        activo,
        ordenarPor,
        direccion,
      });
      return { items, total, pagina, porPagina };
    },

    async obtener(id) {
      const usuario = await usuarioRepo.buscarPorId(id);
      if (!usuario) throw HttpError.noEncontrado('Usuario no encontrado');
      return usuario;
    },

    /**
     * Alta de usuario. Un usuario puede recibir varios roles de una vez, que es
     * la razón por la que `roles` es una lista y no un campo único.
     */
    async crear({ nombreCompleto, email, password, numeroDocumento, roles }, actor) {
      verificarEscalacion(roles, actor);
      exigirPasswordRobusta(password);

      if (await usuarioRepo.existeEmail(email)) {
        throw HttpError.conflicto('Ya existe un usuario con ese correo', {
          codigo: 'EMAIL_EN_USO',
        });
      }

      const rolIds = await resolverRoles(roles);
      const passwordHash = await servicioPassword.hashear(password);

      // Alta y roles son un solo hecho: o se guardan ambos, o ninguno.
      const id = await uow.ejecutar(async (repos) => {
        const nuevoId = await repos.usuarioRepo.crear({
          nombreCompleto,
          email,
          passwordHash,
          numeroDocumento,
        });
        await repos.usuarioRepo.reemplazarRoles(nuevoId, rolIds, actor.id);
        return nuevoId;
      });

      return usuarioRepo.buscarPorId(id);
    },

    async actualizar(id, cambios, actor) {
      const usuario = await usuarioRepo.buscarPorId(id);
      if (!usuario) throw HttpError.noEncontrado('Usuario no encontrado');

      if (cambios.email && (await usuarioRepo.existeEmail(cambios.email, id))) {
        throw HttpError.conflicto('Ya existe otro usuario con ese correo', {
          codigo: 'EMAIL_EN_USO',
        });
      }

      if (cambios.roles) {
        verificarEscalacion(cambios.roles, actor);
        const perderiaAdmin =
          id === actor.id &&
          usuario.roles.some((r) => r.codigo === ROL_ADMINISTRADOR) &&
          !cambios.roles.includes(ROL_ADMINISTRADOR);
        if (perderiaAdmin) {
          throw HttpError.conflicto('No puedes quitarte a ti mismo el rol de administrador', {
            codigo: 'AUTO_DEGRADACION',
          });
        }
      }

      const rolIds = cambios.roles ? await resolverRoles(cambios.roles) : null;

      await uow.ejecutar(async (repos) => {
        await repos.usuarioRepo.actualizar(id, cambios);
        if (rolIds) await repos.usuarioRepo.reemplazarRoles(id, rolIds, actor.id);
      });

      return usuarioRepo.buscarPorId(id);
    },

    /**
     * Baja lógica. No existe borrado físico de usuarios: sus decisiones quedan
     * referenciadas desde el historial de candidatos, evaluaciones y citaciones.
     */
    async desactivar(id, actor) {
      if (id === actor.id) {
        throw HttpError.conflicto('No puedes desactivar tu propio usuario', {
          codigo: 'AUTO_DESACTIVACION',
        });
      }

      const usuario = await usuarioRepo.buscarPorId(id);
      if (!usuario) throw HttpError.noEncontrado('Usuario no encontrado');
      if (!usuario.activo) {
        throw HttpError.conflicto('El usuario ya está desactivado', {
          codigo: 'YA_DESACTIVADO',
        });
      }

      await usuarioRepo.desactivar(id);
    },

    async reactivar(id) {
      const usuario = await usuarioRepo.buscarPorId(id);
      if (!usuario) throw HttpError.noEncontrado('Usuario no encontrado');
      await usuarioRepo.actualizar(id, { activo: true });
      return usuarioRepo.buscarPorId(id);
    },

    async reclutadoresActivos() {
      return usuarioRepo.reclutadoresActivos();
    },

    async resumenRoles() {
      return usuarioRepo.resumenPorRol();
    },

    async listarRoles() {
      return rolRepo.listarRoles();
    },

    async listarPermisos() {
      return rolRepo.listarPermisos();
    },
  };
}

module.exports = { crearUsuarioServicio };

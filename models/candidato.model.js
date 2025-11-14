class CandidatoModel {
  static getEstadosValidos() {
    return [
      'nuevo',
      'contacto_fallido',
      'no_contesta',
      'reagendar',
      'no_interesado',
      'numero_incorrecto',
      'contacto_exitoso',
      'formularios_enviados', 
      'formularios_completados',
      'citado',
      'entrevistado', 
      'aprobado',
      'rechazado',
      'contratado'
    ];
  }

  static getEstadosConfig() {
    return {
      'nuevo': { 
        label: 'Nuevo', 
        color: 'bg-gray-100 text-gray-800',
        descripcion: 'Candidato recién registrado'
      },
      'contacto_fallido': { 
        label: 'Contacto Fallido', 
        color: 'bg-red-100 text-red-800',
        descripcion: 'No se logró establecer contacto'
      },
      'no_contesta': { 
        label: 'No Contesta', 
        color: 'bg-orange-100 text-orange-800',
        descripcion: 'No responde llamadas'
      },
      'reagendar': { 
        label: 'Reagendar', 
        color: 'bg-yellow-100 text-yellow-800',
        descripcion: 'Pendiente reagendar llamada'
      },
      'no_interesado': { 
        label: 'No Interesado', 
        color: 'bg-red-100 text-red-800',
        descripcion: 'No está interesado en el cargo'
      },
      'numero_incorrecto': { 
        label: 'Número Incorrecto', 
        color: 'bg-red-100 text-red-800',
        descripcion: 'Número telefónico incorrecto'
      },
      'contacto_exitoso': { 
        label: 'Contacto Exitoso', 
        color: 'bg-green-100 text-green-800',
        descripcion: 'Contacto establecido exitosamente'
      },
      'formularios_enviados': { 
        label: 'Formularios Enviados', 
        color: 'bg-blue-100 text-blue-800',
        descripcion: 'Formularios enviados al candidato'
      },
      'formularios_completados': { 
        label: 'Formularios Completados', 
        color: 'bg-green-100 text-green-800',
        descripcion: 'Candidato completó formularios'
      },
      'citado': { 
        label: 'Citado', 
        color: 'bg-purple-100 text-purple-800',
        descripcion: 'Citado para entrevista'
      },
      'entrevistado': { 
        label: 'Entrevistado', 
        color: 'bg-indigo-100 text-indigo-800',
        descripcion: 'Entrevista realizada'
      },
      'aprobado': { 
        label: 'Aprobado', 
        color: 'bg-emerald-100 text-emerald-800',
        descripcion: 'Candidato aprobado'
      },
      'rechazado': { 
        label: 'Rechazado', 
        color: 'bg-red-100 text-red-800',
        descripcion: 'Candidato rechazado'
      },
      'contratado': { 
        label: 'Contratado', 
        color: 'bg-green-100 text-green-800',
        descripcion: 'Candidato contratado'
      }
    };
  }

  static getOpcionesCatalogo() {
    return {
      nacionalidades: [
        { value: 'Colombiano', label: 'Colombiano' },
        { value: 'Venezolano', label: 'Venezolano' }
      ],
      tipos_documento_extranjero: [
        { value: 'Pasaporte', label: 'Pasaporte' },
        { value: 'CE', label: 'CE (Cédula de Extranjería)' },
        { value: 'DNI', label: 'DNI' },
        { value: 'Otro', label: 'Otro' }
      ],
      clientes: [
        { value: 'Staff Operacional', label: 'Staff Operacional' },
        { value: 'Staff Administrativo', label: 'Staff Administrativo' },
        { value: 'Claro', label: 'Claro' },
        { value: 'Obamacare', label: 'Obamacare' },
        { value: 'Majority', label: 'Majority' }
      ],
      ciudades: [
        { value: 'Bogotá', label: 'Bogotá' },
        { value: 'Barranquilla', label: 'Barranquilla' }
      ],
      fuentes_reclutamiento: [
        { value: 'Portal Web', label: 'Portal Web' },
        { value: 'LinkedIn', label: 'LinkedIn' },
        { value: 'Referido Empleado', label: 'Referido Empleado' },
        { value: 'Referido Externo', label: 'Referido Externo' },
        { value: 'Redes Sociales', label: 'Redes Sociales' },
        { value: 'Ferias de Empleo', label: 'Ferias de Empleo' },
        { value: 'Universidades', label: 'Universidades' },
        { value: 'Base de Datos', label: 'Base de Datos' },
        { value: 'Otro', label: 'Otro' }
      ],
      observaciones_llamada: [
        { value: 'Contacto exitoso', label: 'Contacto exitoso' },
        { value: 'No contesta', label: 'No contesta' },
        { value: 'Ocupado', label: 'Ocupado' },
        { value: 'Número incorrecto', label: 'Número incorrecto' },
        { value: 'Interesado', label: 'Interesado' },
        { value: 'No interesado', label: 'No interesado' },
        { value: 'Reagendar', label: 'Reagendar' },
        { value: 'No apto', label: 'No apto' }
      ],
      cargos_staff: [
        'Analista Administrativa Y Contable', 'Analista De Calidad', 'Analista De Calidad Pe',
        'Analista De Contratacion', 'Analista De Reclutamiento', 'Analista De Seleccion',
        'Analista De Usuarios', 'Analista PQR', 'Auditor/Gestor Calidad Comercial',
        'Auxiliar De Gestion Humana', 'Auxiliar De Servicios Generales', 'Auxiliar Juridico',
        'Auxiliar Mantenimiento', 'Auxiliar SST', 'Ayudante De Obra', 'Backoffice',
        'Backoffice Pe', 'Community Manager', 'Contador', 'Coordinador',
        'Coordinador BackOffice', 'Coordinador Datamarshall', 'Coordinador De Contratacion',
        'Coordinador De Nomina', 'Coordinador De Tecnologia', 'Coordinador De Usuarios',
        'Coordinador Pe', 'Coordinador Tecnico', 'Coordinadora Backoffice',
        'Coordinadora De Calidad', 'Datamarshall', 'Datamarshall Senior Pe',
        'Desarrollador Web', 'Director de formación', 'Director de Operaciones',
        'Director de Operaciones Pe', 'Director De Tecnologia', 'Diseñador Grafico',
        'Formador', 'Formador Pe', 'Formador Senior', 'Gestora De Marketing Y Calidad De Se',
        'GTR', 'Jefe Backoffice', 'Jefe De Manteniminento', 'Jefe de operacion',
        'Jefe de workforce', 'Jefe Financiero', 'Jefe Juridica', 'Legalizador',
        'Maestro De Obra', 'Profesional De SST', 'Psicologo De Seleccion',
        'Recepcionista', 'Subgerente De Operaciones', 'Tecnico De Soporte', 'Staff'
      ],
      cargos_claro: [
        'Agente Call Center', 'Agente Call Center Plus'
      ],
      cargos_obamacare: [
        'Customer Service', 'Agente Call Center'
      ],
      cargos_majority: [
        'Agente Call Center'
      ],
      estados_civiles: [
        { value: 'soltero', label: 'Soltero(a)' },
        { value: 'casado', label: 'Casado(a)' },
        { value: 'union_libre', label: 'Unión libre' },
        { value: 'separado', label: 'Separado(a)' },
        { value: 'divorciado', label: 'Divorciado(a)' },
        { value: 'viudo', label: 'Viudo(a)' }
      ],
      generos: [
        { value: 'masculino', label: 'Masculino' },
        { value: 'femenino', label: 'Femenino' }
      ],
      grupos_sanguineos: ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'],
      eps_opciones: [
        'Sura EPS', 'Nueva EPS', 'Sanitas EPS', 'Salud Total EPS', 
        'Compensar EPS', 'Famisanar EPS', 'Medimás EPS', 'Aliansalud EPS',
        'EPS SOAS', 'Coosalud EPS', 'Mutual SER', 'Capital Salud',
        'Régimen Especial', 'No tengo EPS'
      ],
      afp_opciones: [
        'Protección', 'Porvenir', 'Colfondos', 'Old Mutual', 
        'Skandia', 'Colpensiones', 'No tengo AFP'
      ],
      niveles_estudios: [
        { value: 'primaria', label: 'Primaria' },
        { value: 'bachillerato', label: 'Bachillerato' },
        { value: 'tecnico', label: 'Técnico' },
        { value: 'tecnologo', label: 'Tecnólogo' },
        { value: 'universitario', label: 'Universitario' },
        { value: 'especialista', label: 'Especialista' },
        { value: 'magister', label: 'Magíster' },
        { value: 'doctorado', label: 'Doctorado' }
      ],
      tipos_pariente: [
        'Padre', 'Madre', 'Hermano(a)', 'Hijo(a)', 'Abuelo(a)', 
        'Tío(a)', 'Primo(a)', 'Cónyuge', 'Pareja', 'Otro'
      ],
      parentesco_opciones: [
        'Padre', 'Madre', 'Hermano(a)', 'Hijo(a)', 'Cónyuge', 
        'Pareja', 'Tío(a)', 'Primo(a)', 'Abuelo(a)', 'Amigo(a)', 'Otro'
      ],
      si_no: [
        { value: 'si', label: 'Sí' },
        { value: 'no', label: 'No' }
      ],
      calificaciones: [
        { value: 1, label: '1 - Básico' },
        { value: 2, label: '2 - Principiante' },
        { value: 3, label: '3 - Intermedio' },
        { value: 4, label: '4 - Avanzado' },
        { value: 5, label: '5 - Experto' }
      ]
    };
  }

  static generarAnios() {
    const anioActual = new Date().getFullYear();
    const anios = [];
    for (let i = anioActual; i >= 1950; i--) {
      anios.push(i);
    }
    return anios;
  }

  static calcularProgreso(candidato) {
    const formularios = [
      candidato.formulario_hoja_vida_completado,
      candidato.formulario_datos_basicos_completado, 
      candidato.formulario_estudios_completado,
      candidato.formulario_experiencia_completado,
      candidato.formulario_personal_completado,
      candidato.formulario_consentimiento_completado
    ];
    
    return formularios.filter(Boolean).length;
  }

  static getEstadosConfig() {
    return {
      nuevo: { label: 'Nuevos', color: 'bg-gray-100 text-gray-800' },
      formularios_enviados: { label: 'Formularios Enviados', color: 'bg-blue-100 text-blue-800' },
      formularios_completados: { label: 'Formularios Completados', color: 'bg-green-100 text-green-800' },
      citado: { label: 'Citados', color: 'bg-yellow-100 text-yellow-800' },
      entrevistado: { label: 'Entrevistados', color: 'bg-purple-100 text-purple-800' },
      aprobado: { label: 'Aprobados', color: 'bg-emerald-100 text-emerald-800' },
      rechazado: { label: 'Rechazados', color: 'bg-red-100 text-red-800' },
      contratado: { label: 'Contratados', color: 'bg-indigo-100 text-indigo-800' }
    };
  }
}

module.exports = CandidatoModel;
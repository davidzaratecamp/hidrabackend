-- Migración 006: "Conocimientos Informáticos" (una de las 4 filas del bloque
-- "INFORMACIÓN ACADEMICA" del Excel, ver migración 005) no es un nivel académico con
-- institución/título/año como las otras 3 - el usuario pidió que sea un campo de texto
-- libre (máx. 500 caracteres) donde el candidato describe sus conocimientos.
-- Fecha: 2026-08-18
--
-- Se agrega una columna nueva en vez de reusar nombre_institucion/titulo_obtenido
-- (varchar(200), muy cortas para 500 caracteres) - para la fila 'conocimientos_informaticos'
-- se usa `descripcion` y las otras 3 columnas quedan NULL; para las otras 3 niveles es al
-- revés (descripcion queda NULL).
ALTER TABLE hyd_candidato_estudios
  ADD COLUMN descripcion VARCHAR(500) NULL AFTER nivel_estudios;

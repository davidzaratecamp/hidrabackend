-- MySQL dump 10.13  Distrib 9.0.0, for macos14 (x86_64)
--
-- Host: localhost    Database: noviembrehidra
-- ------------------------------------------------------
-- Server version	9.0.0

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Current Database: `noviembrehidra`
--

/*!40000 DROP DATABASE IF EXISTS `noviembrehidra`*/;

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `noviembrehidra` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `noviembrehidra`;

--
-- Table structure for table `hyd_candidatos`
--

DROP TABLE IF EXISTS `hyd_candidatos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hyd_candidatos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `primer_nombre` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `primer_apellido` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email_personal` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `numero_celular` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nacionalidad` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tipo_documento` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `numero_documento` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cliente` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cargo` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `oleada` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ciudad` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fecha_citacion_entrevista` date DEFAULT NULL,
  `estado_civil` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fuente_reclutamiento` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `segundo_apellido` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `segundo_nombre` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `genero` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fecha_nacimiento` date DEFAULT NULL,
  `grupo_sanguineo` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nombre_emergencia` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `numero_emergencia` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `parentesco_emergencia` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `eps` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `afp` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nivel_estudios` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `titulo_obtenido` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nombre_institucion` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ano_finalizacion` year DEFAULT NULL,
  `nombre_empresa` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cargo_desempenado` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `salario_experiencia` decimal(15,2) DEFAULT NULL,
  `fecha_inicio_experiencia` date DEFAULT NULL,
  `fecha_retiro_experiencia` date DEFAULT NULL,
  `tiempo_laborado_anos` int DEFAULT NULL,
  `tiempo_laborado_meses` int DEFAULT NULL,
  `motivo_retiro` text COLLATE utf8mb4_unicode_ci,
  `ha_trabajado_asiste` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `genograma` json DEFAULT NULL,
  `fortalezas` text COLLATE utf8mb4_unicode_ci,
  `aspectos_mejorar` text COLLATE utf8mb4_unicode_ci,
  `competencias_laborales` text COLLATE utf8mb4_unicode_ci,
  `metas_largo_plazo` text COLLATE utf8mb4_unicode_ci,
  `metas_mediano_plazo` text COLLATE utf8mb4_unicode_ci,
  `metas_corto_plazo` text COLLATE utf8mb4_unicode_ci,
  `conocimiento_excel` int DEFAULT NULL,
  `conocimiento_powerpoint` int DEFAULT NULL,
  `conocimiento_word` int DEFAULT NULL,
  `autoevaluacion` int DEFAULT NULL,
  `experiencia_comercial_certificada` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `experiencia_comercial_no_certificada` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `primer_empleo_formal` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ciudad_consentimiento` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dia_consentimiento` int DEFAULT NULL,
  `mes_consentimiento` int DEFAULT NULL,
  `ano_consentimiento` year DEFAULT NULL,
  `consentimiento_aceptado` tinyint(1) DEFAULT '0',
  `formulario_hoja_vida_completado` tinyint(1) DEFAULT '0',
  `formulario_datos_basicos_completado` tinyint(1) DEFAULT '0',
  `formulario_estudios_completado` tinyint(1) DEFAULT '0',
  `formulario_experiencia_completado` tinyint(1) DEFAULT '0',
  `formulario_personal_completado` tinyint(1) DEFAULT '0',
  `formulario_consentimiento_completado` tinyint(1) DEFAULT '0',
  `fecha_completado_hoja_vida` timestamp NULL DEFAULT NULL,
  `fecha_completado_datos_basicos` timestamp NULL DEFAULT NULL,
  `fecha_completado_estudios` timestamp NULL DEFAULT NULL,
  `fecha_completado_experiencia` timestamp NULL DEFAULT NULL,
  `fecha_completado_personal` timestamp NULL DEFAULT NULL,
  `fecha_completado_consentimiento` timestamp NULL DEFAULT NULL,
  `token_acceso` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fecha_vencimiento_token` timestamp NULL DEFAULT NULL,
  `estado` enum('nuevo','formularios_enviados','formularios_completados','citado','entrevistado','aprobado','rechazado','contratado') COLLATE utf8mb4_unicode_ci DEFAULT 'nuevo',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `observaciones_llamada` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `observaciones_generales` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email_personal` (`email_personal`),
  UNIQUE KEY `token_acceso` (`token_acceso`),
  KEY `idx_estado` (`estado`),
  KEY `idx_token` (`token_acceso`),
  KEY `idx_email` (`email_personal`),
  KEY `idx_documento` (`numero_documento`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `hyd_candidatos`
--

LOCK TABLES `hyd_candidatos` WRITE;
/*!40000 ALTER TABLE `hyd_candidatos` DISABLE KEYS */;
INSERT INTO `hyd_candidatos` VALUES (1,'Juan','Pérez','juan.perez@email.com','3001234567','Colombiana','CC','12345678','Empresa ABC','Desarrollador Frontend','Q4-2024','Bogotá',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,0,0,0,0,0,0,NULL,NULL,NULL,NULL,NULL,NULL,'75063dfa-c0d0-11f0-bc71-eb737e1e1a28','2025-12-13 20:36:39','nuevo','2025-11-13 20:36:39','2025-11-13 20:36:39',NULL,NULL),(2,'María','González','maria.gonzalez@email.com','3007654321','Colombiana','CC','87654321','TechCorp','Analista de Datos','Q4-2024','Medellín',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,0,0,0,0,0,0,NULL,NULL,NULL,NULL,NULL,NULL,'750677de-c0d0-11f0-bc71-eb737e1e1a28','2025-12-13 20:36:39','formularios_enviados','2025-11-13 20:36:39','2025-11-13 20:36:39',NULL,NULL),(3,'Carlos','Rodríguez','carlos.rodriguez@email.com','3009876543','Colombiana','CC','11223344','Innovate SA','Project Manager',NULL,'Cali',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,0,0,0,0,0,0,NULL,NULL,NULL,NULL,NULL,NULL,'7506dada-c0d0-11f0-bc71-eb737e1e1a28','2025-12-13 20:36:39','formularios_completados','2025-11-13 20:36:39','2025-11-13 20:36:39',NULL,NULL),(4,'Anderson','Zarate','davidzaratecamp@gmail.com','3007727550','Colombiano','CC','1118572769','Staff Operacional','Desarrollador Web',NULL,'Bogotá','2025-11-15','soltero','Portal Web','Zarate','David','masculino','1998-10-23','A+','Elizabeth','3009987800','Tío(a)','Sura EPS','Protección','tecnologo','Analisis y Desarrollo de Software','Sena',2023,'Renault','Desarrollador FullStack',2000000.00,'2025-01-01','2025-10-01',0,9,'Porque si.','no',NULL,'Desarrollador FullStack','Desarrollador FullStack','Desarrollador FullStack',NULL,NULL,NULL,5,5,5,1,NULL,NULL,NULL,'Bogota',13,11,2025,1,1,1,1,1,1,1,'2025-11-14 01:27:41','2025-11-14 01:35:59','2025-11-14 01:36:25','2025-11-14 01:43:14','2025-11-14 01:49:25','2025-11-14 01:59:46','5ccf2798-af22-46b5-bc95-dbedc09612b7','2025-12-14 00:55:53','formularios_completados','2025-11-14 00:55:53','2025-11-14 01:59:46','Contacto exitoso','Contacto muy, muy exitoso.');
/*!40000 ALTER TABLE `hyd_candidatos` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `hyd_usuarios`
--

DROP TABLE IF EXISTS `hyd_usuarios`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hyd_usuarios` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre_completo` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rol` enum('reclutador','seleccion','administrador') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'reclutador',
  `activo` tinyint(1) DEFAULT '1',
  `ultimo_acceso` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_email` (`email`),
  KEY `idx_rol` (`rol`),
  KEY `idx_activo` (`activo`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `hyd_usuarios`
--

LOCK TABLES `hyd_usuarios` WRITE;
/*!40000 ALTER TABLE `hyd_usuarios` DISABLE KEYS */;
INSERT INTO `hyd_usuarios` VALUES (1,'Administrador','admin@asisteing.com','$2b$10$7YVmsY5ZUa5WWBWNn5kXS.H8wQA.j1YKHfKCnw8hwSPanCljUfaiu','administrador',1,'2025-11-14 02:30:55','2025-11-14 02:25:39','2025-11-14 02:30:55'),(2,'María García','reclutador@asisteing.com','$2b$10$7YVmsY5ZUa5WWBWNn5kXS.H8wQA.j1YKHfKCnw8hwSPanCljUfaiu','reclutador',1,'2025-11-14 02:37:09','2025-11-14 02:25:39','2025-11-14 02:37:09'),(3,'Juan Pérez','seleccion@asisteing.com','$2b$10$7YVmsY5ZUa5WWBWNn5kXS.H8wQA.j1YKHfKCnw8hwSPanCljUfaiu','seleccion',1,'2025-11-14 02:33:56','2025-11-14 02:25:39','2025-11-14 02:33:56');
/*!40000 ALTER TABLE `hyd_usuarios` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping routines for database 'noviembrehidra'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-11-14  8:09:31

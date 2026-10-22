<?php
/* ============================================================
   CONFIGURACIÓN · Marrón King
   Ajusta estos valores a tu servidor (XAMPP / hosting).
   ============================================================ */
return [
    // Conexión a MySQL (valores por defecto de XAMPP)
    'db' => [
        'host'    => 'localhost',
        'port'    => 3306,
        'name'    => 'marron_king',
        'user'    => 'root',
        'pass'    => '',
        'charset' => 'utf8mb4',
    ],

    // Direcciones desde las que la página React puede llamar a la API
    // (Vite usa el 5173). Si publicas el sitio, agrega aquí tu dominio.
    'cors_origins' => [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
    ],

    // Correo de la empresa que recibe cada folio nuevo
    'empresa_email'    => 'ventas@marronking.mx',
    'correo_remitente' => 'no-reply@marronking.mx',
    'enviar_correo'    => true,   // false = no intenta enviar (solo guarda en correos_pendientes.log)

    // IVA
    'iva' => 0.16,
];

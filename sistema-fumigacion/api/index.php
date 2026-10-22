<?php
declare(strict_types=1);

/* ============================================================
   API · Marrón King  (punto de entrada único)
   Todas las rutas responden JSON.  Ej.: GET /api/catalogos
   ============================================================ */

ini_set('display_errors', '0');
require __DIR__ . '/helpers.php';

cors();
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

set_exception_handler(function (Throwable $e) {
    if ($e instanceof ApiError) {
        out(['error' => $e->getMessage(), 'campos' => $e->campos], $e->status);
    }
    error_log((string)$e);
    out(['error' => 'Error interno del servidor.'], 500);
});

start_session();
guard_csrf();

/* ---------- Enrutador ---------- */

$metodo = $_SERVER['REQUEST_METHOD'];
$base   = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'])), '/');
$ruta   = (string)parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$ruta   = substr($ruta, strlen($base));
$ruta   = trim((string)preg_replace('#^/index\.php#', '', $ruta), '/');
$partes = $ruta === '' ? [] : explode('/', $ruta);

$ids = [];
$patron = [];
foreach ($partes as $p) {
    if (ctype_digit($p)) { $ids[] = (int)$p; $patron[] = '{id}'; }
    else $patron[] = $p;
}
$id    = $ids[0] ?? 0;
$clave = $metodo . ' /' . implode('/', $patron);

/* Rutas públicas; todas las demás exigen sesión */
$publicas = ['GET /catalogos', 'POST /cotizar', 'POST /solicitudes', 'POST /auth/login', 'POST /auth/logout', 'GET /auth/me'];
/* Rutas solo para el Administrador */
$soloAdmin = [
    'DELETE /tecnicos', 'DELETE /tecnicos/{id}',
    'DELETE /proveedores', 'DELETE /proveedores/{id}',
    'DELETE /materia-prima', 'DELETE /materia-prima/{id}',
    'GET /usuarios', 'POST /usuarios',
    'POST /promociones', 'DELETE /promociones/{id}',
    'POST /servicio-insumos', 'DELETE /servicio-insumos',
];
if (!in_array($clave, $publicas, true)) requiere_login();
if (in_array($clave, $soloAdmin, true))  requiere_admin();

$pdo = db();

switch ($clave) {
    case 'GET /catalogos':            catalogos($pdo);                      break;
    case 'POST /cotizar':             cotizar_ruta($pdo);                   break;
    case 'POST /auth/login':          auth_login($pdo);                     break;
    case 'POST /auth/logout':         auth_logout();                        break;
    case 'GET /auth/me':              out(['usuario' => usuario_actual()]); break;

    case 'POST /solicitudes':         solicitud_crear($pdo);                break;
    case 'GET /solicitudes':          solicitudes_listar($pdo);             break;
    case 'PATCH /solicitudes/{id}/estado':  solicitud_estado($pdo, $id);    break;
    case 'PATCH /solicitudes/{id}/tecnico': solicitud_tecnico($pdo, $id);   break;

    case 'GET /clientes':             clientes_listar($pdo);                break;

    case 'GET /tecnicos':             tecnicos_listar($pdo);                break;
    case 'POST /tecnicos':            tecnico_crear($pdo);                  break;
    case 'DELETE /tecnicos/{id}':     tecnico_eliminar($pdo, $id);          break;
    case 'DELETE /tecnicos':          tecnicos_vaciar($pdo);                break;

    case 'GET /proveedores':          proveedores_listar($pdo);             break;
    case 'POST /proveedores':         proveedor_crear($pdo);                break;
    case 'DELETE /proveedores/{id}':  proveedor_eliminar($pdo, $id);        break;
    case 'DELETE /proveedores':       proveedores_vaciar($pdo);             break;

    case 'GET /materia-prima':        materia_listar($pdo);                 break;
    case 'POST /materia-prima':       materia_crear($pdo);                  break;
    case 'DELETE /materia-prima/{id}':materia_eliminar($pdo, $id);          break;
    case 'DELETE /materia-prima':     materia_vaciar($pdo);                 break;

    case 'GET /servicio-insumos':     servicio_insumos_listar($pdo);        break;
    case 'POST /servicio-insumos':    servicio_insumo_guardar($pdo);        break;
    case 'DELETE /servicio-insumos':  servicio_insumo_eliminar($pdo);       break;

    case 'GET /compras':              compras_listar($pdo);                 break;
    case 'POST /compras':             compra_crear($pdo);                   break;

    case 'GET /promociones':          promociones_listar($pdo);             break;
    case 'POST /promociones':         promocion_crear($pdo);                break;
    case 'DELETE /promociones/{id}':  promocion_eliminar($pdo, $id);        break;

    case 'GET /usuarios':             usuarios_listar($pdo);                break;
    case 'POST /usuarios':            usuario_crear($pdo);                  break;

    case 'GET /estadisticas':         estadisticas($pdo);                   break;

    default: throw new ApiError('Ruta no encontrada.', 404);
}

/* ============================================================
   CATÁLOGOS Y COTIZACIÓN
   ============================================================ */

function catalogos(PDO $pdo): void
{
    $plagas = fetch_all($pdo, "SELECT p.plaga_id AS id, p.nombre, p.recargo, p.servicio_id, p.signos, c.descripcion AS categoria
                               FROM plaga p JOIN categoria c ON c.categoria_id = p.categoria_id ORDER BY p.plaga_id");
    foreach ($plagas as &$p) {
        $p['signos'] = array_values(array_filter(array_map('trim', explode("\n", (string)$p['signos']))));
    }
    out([
        'servicios'   => nums(fetch_all($pdo, "SELECT servicio_id AS id, nombre, codigo, precio_base, descripcion FROM servicio ORDER BY servicio_id"), ['precio_base']),
        'plagas'      => nums($plagas, ['recargo']),
        'inmuebles'   => nums(fetch_all($pdo, "SELECT inmueble_id AS id, tipo, descripcion, multiplicador FROM inmueble ORDER BY inmueble_id"), ['multiplicador']),
        'tamanos'     => nums(fetch_all($pdo, "SELECT tamano_id AS id, rango_m2, descripcion, multiplicador FROM tamano ORDER BY tamano_id"), ['multiplicador']),
        'estados'     => fetch_all($pdo, "SELECT estado_id AS id, nombre FROM estado_orden ORDER BY estado_id"),
        'horarios'    => HORARIOS,
        'unidades'    => UNIDADES,
        'categorias_proveedor' => CATEGORIAS_PROVEEDOR,
        'promociones' => nums(fetch_all($pdo, "SELECT promocion_id AS id, nombre, estacion, descuento_porcentaje, fecha_inicio, fecha_fin, plaga_id, inmueble_id
                                               FROM promocion WHERE CURDATE() BETWEEN fecha_inicio AND fecha_fin"), ['descuento_porcentaje']),
        'iva'         => cfg('iva'),
    ]);
}

/* Calcula el precio (misma fórmula que el cotizador de la página).
   El servidor SIEMPRE recalcula: nunca confía en el precio que manda el navegador. */
function calcular_cotizacion(PDO $pdo, int $inmueble, int $plaga, int $tamano, int $servicio): array
{
    $i = fetch_one($pdo, "SELECT inmueble_id, tipo, multiplicador FROM inmueble WHERE inmueble_id = ?", [$inmueble]);
    $p = fetch_one($pdo, "SELECT plaga_id, nombre, recargo FROM plaga WHERE plaga_id = ?", [$plaga]);
    $t = fetch_one($pdo, "SELECT tamano_id, rango_m2, multiplicador FROM tamano WHERE tamano_id = ?", [$tamano]);
    $s = fetch_one($pdo, "SELECT servicio_id, nombre, precio_base FROM servicio WHERE servicio_id = ?", [$servicio]);
    if (!$i || !$p || !$t || !$s) throw new ApiError('La selección de la cotización no es válida.', 422);

    $raw      = (float)$s['precio_base'] * (float)$t['multiplicador'] * (float)$i['multiplicador'] + (float)$p['recargo'];
    $subtotal = (int)(round($raw / 10) * 10);

    $promo = fetch_one($pdo, "SELECT promocion_id, nombre, descuento_porcentaje FROM promocion
                              WHERE CURDATE() BETWEEN fecha_inicio AND fecha_fin
                                AND (plaga_id IS NULL OR plaga_id = ?) AND (inmueble_id IS NULL OR inmueble_id = ?)
                              ORDER BY descuento_porcentaje DESC LIMIT 1", [$plaga, $inmueble]);
    $descuento = $promo ? (int)round($subtotal * (float)$promo['descuento_porcentaje'] / 100) : 0;
    $iva       = (int)round(($subtotal - $descuento) * (float)cfg('iva'));
    $total     = $subtotal - $descuento + $iva;

    return [
        'inmueble'  => $i['tipo'], 'plaga' => $p['nombre'], 'tamano' => $t['rango_m2'], 'servicio' => $s['nombre'],
        'subtotal'  => $subtotal, 'descuento' => $descuento, 'iva' => $iva, 'total' => $total,
        'rango_bajo'=> (int)(round($total * 0.92 / 10) * 10), 'rango_alto' => (int)(round($total * 1.08 / 10) * 10),
        'promocion' => $promo ? ['id' => (int)$promo['promocion_id'], 'nombre' => $promo['nombre']] : null,
    ];
}

function cotizar_ruta(PDO $pdo): void
{
    $d = body();
    out(calcular_cotizacion($pdo, (int)($d['inmueble_id'] ?? 0), (int)($d['plaga_id'] ?? 0), (int)($d['tamano_id'] ?? 0), (int)($d['servicio_id'] ?? 0)));
}

/* ============================================================
   AUTENTICACIÓN
   ============================================================ */

function auth_login(PDO $pdo): void
{
    $d      = body();
    $correo = strtolower(txt($d, 'correo'));
    $pass   = (string)($d['contrasena'] ?? '');
    $u = fetch_one($pdo, "SELECT u.usuario_id, u.nombre, u.apellido_paterno, u.correo, u.contrasena_hash, r.nombre AS rol
                          FROM usuario u JOIN rol r ON r.rol_id = u.rol_id WHERE u.correo = ? AND u.activo = 1", [$correo]);
    if (!$u || !password_verify($pass, $u['contrasena_hash'])) {
        usleep(300000); // frena intentos masivos
        throw new ApiError('Correo o contraseña incorrectos.', 401);
    }
    session_regenerate_id(true);
    $_SESSION['usuario'] = [
        'id'     => (int)$u['usuario_id'],
        'nombre' => trim($u['nombre'] . ' ' . $u['apellido_paterno']),
        'correo' => $u['correo'],
        'rol'    => $u['rol'],
    ];
    out(['usuario' => $_SESSION['usuario']]);
}

function auth_logout(): void
{
    $_SESSION = [];
    if (session_status() === PHP_SESSION_ACTIVE) session_destroy();
    out(['ok' => true]);
}

/* ============================================================
   SOLICITUDES
   ============================================================ */

function solicitud_por_id(PDO $pdo, int $ordenId): ?array
{
    return nums1(fetch_one($pdo, "SELECT * FROM v_solicitudes WHERE orden_id = ?", [$ordenId]),
        ['subtotal', 'descuento', 'iva', 'total']);
}

function solicitud_crear(PDO $pdo): void
{
    $d   = body();
    $c   = is_array($d['cliente']    ?? null) ? $d['cliente']    : [];
    $dir = is_array($d['direccion']  ?? null) ? $d['direccion']  : [];
    $q   = is_array($d['cotizacion'] ?? null) ? $d['cotizacion'] : [];
    $e   = [];

    $nombre = txt($c, 'nombre'); $ap = txt($c, 'apellido_paterno'); $am = txt($c, 'apellido_materno');
    $tel    = digitos(txt($c, 'telefono')); $correo = strtolower(txt($c, 'correo')); $rfc = mayus(txt($c, 'rfc'));
    if ($nombre === '' || largo($nombre) > 60) $e['nombre'] = 'Ingresa tu nombre.';
    if ($ap === '' || largo($ap) > 60)         $e['apellido_paterno'] = 'Ingresa apellido paterno.';
    if ($am === '' || largo($am) > 60)         $e['apellido_materno'] = 'Ingresa apellido materno.';
    if (strlen($tel) !== 10)                       $e['telefono'] = 'Ingresa un teléfono de 10 dígitos.';
    if (!email_ok($correo) || strlen($correo) > 120) $e['correo'] = 'Correo inválido.';
    if ($rfc !== '' && !preg_match('/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/u', $rfc)) $e['rfc'] = 'RFC inválido.';

    $calle = txt($dir, 'calle'); $num = txt($dir, 'numero'); $col = txt($dir, 'colonia'); $cp = txt($dir, 'codigo_postal');
    if ($calle === '' || largo($calle) > 100) $e['calle'] = 'Ingresa la calle.';
    if ($num === '' || largo($num) > 15)      $e['numero'] = 'Ingresa el número.';
    if ($col === '' || largo($col) > 80)      $e['colonia'] = 'Ingresa la colonia.';
    if (!preg_match('/^\d{5}$/', $cp))            $e['codigo_postal'] = 'El código postal debe tener 5 dígitos.';

    $fecha   = txt($d, 'fecha'); $horario = txt($d, 'horario'); $notas = recorta(txt($d, 'notas'), 500);
    $f = DateTime::createFromFormat('Y-m-d', $fecha);
    if (!$f || $f->format('Y-m-d') !== $fecha)      $e['fecha'] = 'Selecciona una fecha válida.';
    elseif ($fecha < date('Y-m-d'))                 $e['fecha'] = 'La fecha no puede ser anterior a hoy.';
    if (!in_array($horario, HORARIOS, true))        $e['horario'] = 'Selecciona un horario.';
    lanza_si_errores($e);

    $cot = calcular_cotizacion($pdo, (int)($q['inmueble_id'] ?? 0), (int)($q['plaga_id'] ?? 0), (int)($q['tamano_id'] ?? 0), (int)($q['servicio_id'] ?? 0));

    $pdo->beginTransaction();
    try {
        // Cliente: se reutiliza por correo (no se sobrescriben sus datos desde el formulario público)
        $cli = fetch_one($pdo, "SELECT cliente_id FROM cliente WHERE correo = ?", [$correo]);
        if ($cli) {
            $clienteId = (int)$cli['cliente_id'];
        } else {
            $pdo->prepare("INSERT INTO cliente (nombre, apellido_paterno, apellido_materno, telefono, correo, rfc) VALUES (?,?,?,?,?,?)")
                ->execute([$nombre, $ap, $am, $tel, $correo, $rfc !== '' ? $rfc : null]);
            $clienteId = (int)$pdo->lastInsertId();
        }
        $dr = fetch_one($pdo, "SELECT direccion_id FROM direccion WHERE cliente_id = ? AND calle = ? AND numero = ? AND colonia = ? AND codigo_postal = ?",
            [$clienteId, $calle, $num, $col, $cp]);
        if ($dr) {
            $direccionId = (int)$dr['direccion_id'];
        } else {
            $pdo->prepare("INSERT INTO direccion (cliente_id, calle, numero, colonia, codigo_postal) VALUES (?,?,?,?,?)")
                ->execute([$clienteId, $calle, $num, $col, $cp]);
            $direccionId = (int)$pdo->lastInsertId();
        }
        $pdo->prepare("INSERT INTO orden (cliente_id, direccion_id, estado_id, promocion_id, fecha_servicio, horario, notas, subtotal, descuento, iva)
                       VALUES (?,?,1,?,?,?,?,?,?,?)")
            ->execute([$clienteId, $direccionId, $cot['promocion']['id'] ?? null, $fecha, $horario, $notas !== '' ? $notas : null,
                       $cot['subtotal'], $cot['descuento'], $cot['iva']]);
        $ordenId = (int)$pdo->lastInsertId();
        $pdo->prepare("INSERT INTO detalle_orden (orden_id, servicio_id, plaga_id, inmueble_id, tamano_id, precio_linea) VALUES (?,?,?,?,?,?)")
            ->execute([$ordenId, (int)$q['servicio_id'], (int)$q['plaga_id'], (int)$q['inmueble_id'], (int)$q['tamano_id'], $cot['subtotal']]);
        $pdo->commit();
    } catch (Throwable $ex) {
        $pdo->rollBack();
        throw $ex;
    }

    $sol = solicitud_por_id($pdo, $ordenId);
    $correoEnviado = enviar_folio_empresa($sol);
    out(['folio' => $sol['folio'], 'solicitud' => $sol, 'correo_enviado' => $correoEnviado], 201);
}

function solicitudes_listar(PDO $pdo): void
{
    $sql = "SELECT * FROM v_solicitudes WHERE 1=1";
    $par = [];
    if (!empty($_GET['estado_id'])) { $sql .= " AND estado_id = ?"; $par[] = (int)$_GET['estado_id']; }
    if (!empty($_GET['q']))         { $sql .= " AND (cliente LIKE ? OR folio LIKE ?)"; $par[] = '%' . $_GET['q'] . '%'; $par[] = '%' . $_GET['q'] . '%'; }
    $sql .= " ORDER BY fecha_creacion DESC, orden_id DESC";
    out(nums(fetch_all($pdo, $sql, $par), ['subtotal', 'descuento', 'iva', 'total']));
}

function solicitud_estado(PDO $pdo, int $ordenId): void
{
    $nuevo = (int)(body()['estado_id'] ?? 0);
    if (!fetch_one($pdo, "SELECT 1 FROM estado_orden WHERE estado_id = ?", [$nuevo])) throw new ApiError('Estado inválido.', 422);

    $avisos = [];
    $pdo->beginTransaction();
    try {
        $o = fetch_one($pdo, "SELECT estado_id, tecnico_id FROM orden WHERE orden_id = ? FOR UPDATE", [$ordenId]);
        if (!$o) throw new ApiError('Solicitud no encontrada.', 404);
        $actual = (int)$o['estado_id'];

        if ($nuevo === $actual) { $pdo->rollBack(); out(['solicitud' => solicitud_por_id($pdo, $ordenId), 'avisos' => []]); }
        if (in_array($actual, ESTADOS_CERRADOS, true)) throw new ApiError('La solicitud ya está cerrada y no se puede modificar.', 409);
        if (in_array($nuevo, ESTADOS_REQUIEREN_TECNICO, true) && !$o['tecnico_id']) {
            throw new ApiError('Asigna un técnico antes de cambiar a este estado.', 409);
        }
        $pdo->prepare("UPDATE orden SET estado_id = ? WHERE orden_id = ?")->execute([$nuevo, $ordenId]);
        if ($nuevo === 4) $avisos = descontar_inventario($pdo, $ordenId);
        $pdo->commit();
    } catch (Throwable $ex) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $ex;
    }
    out(['solicitud' => solicitud_por_id($pdo, $ordenId), 'avisos' => $avisos]);
}

/* Al completar un servicio se descuentan los insumos configurados en servicio_insumo,
   multiplicados por el factor del tamaño. Devuelve avisos de stock bajo. */
function descontar_inventario(PDO $pdo, int $ordenId): array
{
    $avisos = [];
    $detalles = fetch_all($pdo, "SELECT d.detalle_orden_id, d.servicio_id, t.multiplicador
                                 FROM detalle_orden d JOIN tamano t ON t.tamano_id = d.tamano_id WHERE d.orden_id = ?", [$ordenId]);
    foreach ($detalles as $d) {
        $insumos = fetch_all($pdo, "SELECT si.materia_prima_id, si.cantidad_base, m.nombre, m.cantidad, m.stock_minimo, m.unidad
                                    FROM servicio_insumo si JOIN materia_prima m ON m.materia_prima_id = si.materia_prima_id
                                    WHERE si.servicio_id = ? FOR UPDATE", [$d['servicio_id']]);
        foreach ($insumos as $m) {
            $uso     = round((float)$m['cantidad_base'] * (float)$d['multiplicador'], 3);
            $actual  = (float)$m['cantidad'];
            $nueva   = max(0.0, round($actual - $uso, 2));
            $pdo->prepare("UPDATE materia_prima SET cantidad = ? WHERE materia_prima_id = ?")->execute([$nueva, $m['materia_prima_id']]);
            $pdo->prepare("INSERT INTO consumo_insumo (detalle_orden_id, materia_prima_id, cantidad_usada) VALUES (?,?,?)")
                ->execute([$d['detalle_orden_id'], $m['materia_prima_id'], $uso]);
            if ($actual < $uso)                         $avisos[] = "Existencia insuficiente de {$m['nombre']}: faltaron " . round($uso - $actual, 2) . " {$m['unidad']}.";
            elseif ($nueva <= (float)$m['stock_minimo']) $avisos[] = "Stock bajo de {$m['nombre']}: quedan $nueva {$m['unidad']}.";
        }
    }
    return $avisos;
}

function solicitud_tecnico(PDO $pdo, int $ordenId): void
{
    $tec = body()['tecnico_id'] ?? null;
    $tec = ($tec === null || $tec === '') ? null : (int)$tec;
    if ($tec !== null && !fetch_one($pdo, "SELECT 1 FROM tecnico WHERE tecnico_id = ?", [$tec])) throw new ApiError('Técnico no encontrado.', 404);

    $o = fetch_one($pdo, "SELECT estado_id FROM orden WHERE orden_id = ?", [$ordenId]);
    if (!$o) throw new ApiError('Solicitud no encontrada.', 404);
    $estado = (int)$o['estado_id'];
    if (in_array($estado, ESTADOS_CERRADOS, true)) throw new ApiError('La solicitud ya está cerrada y no se puede modificar.', 409);
    if ($tec === null && in_array($estado, ESTADOS_REQUIEREN_TECNICO, true)) {
        throw new ApiError('Primero regresa la solicitud a "Pendiente" para quitar al técnico.', 409);
    }
    $pdo->prepare("UPDATE orden SET tecnico_id = ? WHERE orden_id = ?")->execute([$tec, $ordenId]);
    out(['solicitud' => solicitud_por_id($pdo, $ordenId)]);
}

/* ============================================================
   CLIENTES
   ============================================================ */

function clientes_listar(PDO $pdo): void
{
    out(fetch_all($pdo, "SELECT c.cliente_id AS id, c.nombre, c.apellido_paterno, c.apellido_materno, c.telefono, c.correo, c.rfc,
                                d.calle, d.numero, d.colonia, d.codigo_postal,
                                (SELECT COUNT(*) FROM orden o WHERE o.cliente_id = c.cliente_id) AS servicios
                         FROM cliente c
                         LEFT JOIN direccion d ON d.direccion_id = (SELECT MAX(x.direccion_id) FROM direccion x WHERE x.cliente_id = c.cliente_id)
                         ORDER BY c.cliente_id"));
}

/* ============================================================
   TÉCNICOS
   ============================================================ */

function tecnicos_listar(PDO $pdo): void
{
    out(fetch_all($pdo, "SELECT t.tecnico_id AS id, t.nombre, t.apellido_paterno, t.apellido_materno, t.telefono, t.correo, t.rfc, t.nss, t.zona,
                                t.servicio_id, s.nombre AS especialidad, t.contacto_emergencia_nombre, t.contacto_emergencia_telefono,
                                (SELECT COUNT(*) FROM orden o WHERE o.tecnico_id = t.tecnico_id AND o.estado_id NOT IN (4,5)) AS asignaciones_activas
                         FROM tecnico t LEFT JOIN servicio s ON s.servicio_id = t.servicio_id ORDER BY t.tecnico_id"));
}

function tecnico_crear(PDO $pdo): void
{
    $d = body(); $e = [];
    $nombre = txt($d, 'nombre'); $ap = txt($d, 'apellido_paterno'); $am = txt($d, 'apellido_materno');
    $tel = digitos(txt($d, 'telefono')); $correo = strtolower(txt($d, 'correo')); $rfc = mayus(txt($d, 'rfc'));
    $nss = digitos(txt($d, 'nss')); $zona = txt($d, 'zona'); $serv = (int)($d['servicio_id'] ?? 0);
    $cn = txt($d, 'contacto_emergencia_nombre'); $ct = digitos(txt($d, 'contacto_emergencia_telefono'));

    if ($nombre === '') $e['nombre'] = 'Ingresa el nombre.';
    if ($ap === '')     $e['apellido_paterno'] = 'Ingresa el apellido paterno.';
    if (strlen($tel) !== 10)  $e['telefono'] = 'Ingresa un teléfono de 10 dígitos.';
    if (!email_ok($correo))   $e['correo'] = 'Correo inválido.';
    if (!preg_match('/^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/u', $rfc)) $e['rfc'] = 'RFC inválido (persona física, 13 caracteres).';
    if (strlen($nss) !== 11)  $e['nss'] = 'El NSS debe tener 11 dígitos.';
    if ($zona === '')         $e['zona'] = 'Selecciona la zona o sucursal.';
    if (!fetch_one($pdo, "SELECT 1 FROM servicio WHERE servicio_id = ?", [$serv])) $e['servicio_id'] = 'Selecciona una especialidad.';
    if ($cn === '')           $e['contacto_emergencia_nombre'] = 'Ingresa el nombre del contacto de emergencia.';
    if (strlen($ct) !== 10)   $e['contacto_emergencia_telefono'] = 'Ingresa un teléfono de 10 dígitos.';
    elseif ($ct === $tel)     $e['contacto_emergencia_telefono'] = 'Debe ser distinto al teléfono del técnico.';
    lanza_si_errores($e);

    try {
        $pdo->prepare("INSERT INTO tecnico (nombre, apellido_paterno, apellido_materno, telefono, correo, rfc, nss, zona, servicio_id, contacto_emergencia_nombre, contacto_emergencia_telefono)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)")
            ->execute([$nombre, $ap, $am !== '' ? $am : null, $tel, $correo, $rfc, $nss, $zona, $serv, $cn, $ct]);
    } catch (PDOException $ex) {
        if ($ex->getCode() === '23000') throw new ApiError(mensaje_duplicado($ex), 409);
        throw $ex;
    }
    out(['id' => (int)$pdo->lastInsertId()], 201);
}

/* Al quitar un técnico, sus solicitudes activas regresan a "Pendiente" sin asignar */
function liberar_solicitudes_de_tecnico(PDO $pdo, ?int $tecnicoId): void
{
    $where = $tecnicoId === null ? "tecnico_id IS NOT NULL" : "tecnico_id = " . (int)$tecnicoId;
    $pdo->exec("UPDATE orden SET estado_id = 1 WHERE $where AND estado_id IN (2,3)");
    $pdo->exec("UPDATE orden SET tecnico_id = NULL WHERE $where");
}

function tecnico_eliminar(PDO $pdo, int $id): void
{
    $pdo->beginTransaction();
    liberar_solicitudes_de_tecnico($pdo, $id);
    $st = $pdo->prepare("DELETE FROM tecnico WHERE tecnico_id = ?");
    $st->execute([$id]);
    $pdo->commit();
    if ($st->rowCount() === 0) throw new ApiError('Técnico no encontrado.', 404);
    out(['ok' => true]);
}

function tecnicos_vaciar(PDO $pdo): void
{
    $pdo->beginTransaction();
    liberar_solicitudes_de_tecnico($pdo, null);
    $pdo->exec("DELETE FROM tecnico");
    $pdo->commit();
    out(['ok' => true]);
}

/* ============================================================
   PROVEEDORES
   ============================================================ */

function proveedores_listar(PDO $pdo): void
{
    out(fetch_all($pdo, "SELECT proveedor_id AS id, nombre, telefono, correo, rfc, categoria_proveedor, direccion FROM proveedor ORDER BY proveedor_id"));
}

function proveedor_crear(PDO $pdo): void
{
    $d = body(); $e = [];
    $nombre = txt($d, 'nombre'); $cat = txt($d, 'categoria_proveedor'); $tel = digitos(txt($d, 'telefono'));
    $correo = strtolower(txt($d, 'correo')); $rfc = mayus(txt($d, 'rfc')); $dir = txt($d, 'direccion');

    if ($nombre === '') $e['nombre'] = 'Ingresa la razón social.';
    if (!in_array($cat, CATEGORIAS_PROVEEDOR, true)) $e['categoria_proveedor'] = 'Selecciona una categoría.';
    if (strlen($tel) !== 10)  $e['telefono'] = 'Ingresa un teléfono de 10 dígitos.';
    if (!email_ok($correo))   $e['correo'] = 'Correo inválido.';
    if (!preg_match('/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/u', $rfc)) $e['rfc'] = 'RFC inválido.';
    if ($dir === '')          $e['direccion'] = 'Ingresa la dirección.';
    lanza_si_errores($e);

    try {
        $pdo->prepare("INSERT INTO proveedor (nombre, telefono, direccion, categoria_proveedor, correo, rfc) VALUES (?,?,?,?,?,?)")
            ->execute([$nombre, $tel, $dir, $cat, $correo, $rfc]);
    } catch (PDOException $ex) {
        if ($ex->getCode() === '23000') throw new ApiError(mensaje_duplicado($ex), 409);
        throw $ex;
    }
    out(['id' => (int)$pdo->lastInsertId()], 201);
}

function proveedor_eliminar(PDO $pdo, int $id): void
{
    $uso = fetch_one($pdo, "SELECT COUNT(*) AS n FROM materia_prima WHERE proveedor_id = ?", [$id]);
    if ((int)$uso['n'] > 0) throw new ApiError('No puedes eliminar un proveedor con insumos asociados.', 409);
    $st = $pdo->prepare("DELETE FROM proveedor WHERE proveedor_id = ?");
    $st->execute([$id]);
    if ($st->rowCount() === 0) throw new ApiError('Proveedor no encontrado.', 404);
    out(['ok' => true]);
}

function proveedores_vaciar(PDO $pdo): void
{
    // Los insumos quedan sin proveedor y las compras conservan su historial (proveedor en NULL)
    $pdo->exec("DELETE FROM proveedor");
    out(['ok' => true]);
}

/* ============================================================
   MATERIA PRIMA (INVENTARIO)
   ============================================================ */

function materia_listar(PDO $pdo): void
{
    out(nums(fetch_all($pdo, "SELECT m.materia_prima_id AS id, m.nombre, m.descripcion, m.cantidad, m.unidad, m.stock_minimo,
                                     m.precio_unitario, m.proveedor_id, p.nombre AS proveedor,
                                     (m.cantidad <= m.stock_minimo) AS bajo_stock
                              FROM materia_prima m LEFT JOIN proveedor p ON p.proveedor_id = m.proveedor_id ORDER BY m.materia_prima_id"),
        ['cantidad', 'stock_minimo', 'precio_unitario', 'bajo_stock']));
}

function materia_crear(PDO $pdo): void
{
    $d = body(); $e = [];
    $nombre = txt($d, 'nombre'); $desc = txt($d, 'descripcion'); $unidad = txt($d, 'unidad');
    $cant = $d['cantidad'] ?? null; $min = $d['stock_minimo'] ?? 0; $precio = $d['precio_unitario'] ?? null;
    $prov = ($d['proveedor_id'] ?? '') === '' || ($d['proveedor_id'] ?? null) === null ? null : (int)$d['proveedor_id'];

    if ($nombre === '') $e['nombre'] = 'Ingresa el nombre del insumo.';
    if (!is_numeric($cant) || (float)$cant < 0)     $e['cantidad'] = 'Cantidad inválida.';
    if (!is_numeric($min) || (float)$min < 0)       $e['stock_minimo'] = 'Stock mínimo inválido.';
    if (!is_numeric($precio) || (float)$precio < 0) $e['precio_unitario'] = 'Precio inválido.';
    if (!in_array($unidad, UNIDADES, true))         $e['unidad'] = 'Unidad inválida.';
    if ($prov !== null && !fetch_one($pdo, "SELECT 1 FROM proveedor WHERE proveedor_id = ?", [$prov])) $e['proveedor_id'] = 'Proveedor no encontrado.';
    lanza_si_errores($e);

    $pdo->prepare("INSERT INTO materia_prima (nombre, descripcion, cantidad, unidad, stock_minimo, precio_unitario, proveedor_id) VALUES (?,?,?,?,?,?,?)")
        ->execute([$nombre, $desc !== '' ? $desc : null, (float)$cant, $unidad, (float)$min, (float)$precio, $prov]);
    out(['id' => (int)$pdo->lastInsertId()], 201);
}

function materia_eliminar(PDO $pdo, int $id): void
{
    $st = $pdo->prepare("DELETE FROM materia_prima WHERE materia_prima_id = ?");
    $st->execute([$id]);
    if ($st->rowCount() === 0) throw new ApiError('Insumo no encontrado.', 404);
    out(['ok' => true]);
}

function materia_vaciar(PDO $pdo): void
{
    $pdo->exec("DELETE FROM materia_prima");
    out(['ok' => true]);
}

/* ---------- Consumo por servicio (receta de insumos) ---------- */

function servicio_insumos_listar(PDO $pdo): void
{
    out(nums(fetch_all($pdo, "SELECT si.servicio_id, s.nombre AS servicio, si.materia_prima_id, m.nombre AS insumo, m.unidad, si.cantidad_base
                              FROM servicio_insumo si JOIN servicio s ON s.servicio_id = si.servicio_id
                              JOIN materia_prima m ON m.materia_prima_id = si.materia_prima_id ORDER BY si.servicio_id, m.nombre"),
        ['cantidad_base']));
}

function servicio_insumo_guardar(PDO $pdo): void
{
    $d = body();
    $s = (int)($d['servicio_id'] ?? 0); $m = (int)($d['materia_prima_id'] ?? 0); $c = $d['cantidad_base'] ?? null;
    if (!is_numeric($c) || (float)$c <= 0) throw new ApiError('La cantidad base debe ser mayor a 0.', 422, ['cantidad_base' => 'Cantidad inválida.']);
    if (!fetch_one($pdo, "SELECT 1 FROM servicio WHERE servicio_id = ?", [$s]) || !fetch_one($pdo, "SELECT 1 FROM materia_prima WHERE materia_prima_id = ?", [$m])) {
        throw new ApiError('Servicio o insumo no encontrado.', 404);
    }
    $pdo->prepare("INSERT INTO servicio_insumo (servicio_id, materia_prima_id, cantidad_base) VALUES (?,?,?)
                   ON DUPLICATE KEY UPDATE cantidad_base = VALUES(cantidad_base)")->execute([$s, $m, (float)$c]);
    out(['ok' => true], 201);
}

function servicio_insumo_eliminar(PDO $pdo): void
{
    $st = $pdo->prepare("DELETE FROM servicio_insumo WHERE servicio_id = ? AND materia_prima_id = ?");
    $st->execute([(int)($_GET['servicio_id'] ?? 0), (int)($_GET['materia_prima_id'] ?? 0)]);
    if ($st->rowCount() === 0) throw new ApiError('Registro no encontrado.', 404);
    out(['ok' => true]);
}

/* ============================================================
   COMPRAS (entrada de inventario)
   ============================================================ */

function compras_listar(PDO $pdo): void
{
    $compras = nums(fetch_all($pdo, "SELECT c.compra_id AS id, c.proveedor_id, p.nombre AS proveedor, c.fecha_compra, c.subtotal, c.iva, c.total
                                     FROM compra c LEFT JOIN proveedor p ON p.proveedor_id = c.proveedor_id ORDER BY c.compra_id DESC"),
        ['subtotal', 'iva', 'total']);
    foreach ($compras as &$c) {
        $c['detalle'] = nums(fetch_all($pdo, "SELECT d.materia_prima_id, m.nombre AS insumo, m.unidad, d.cantidad, d.costo_unitario, d.subtotal
                                              FROM detalle_compra d JOIN materia_prima m ON m.materia_prima_id = d.materia_prima_id WHERE d.compra_id = ?", [$c['id']]),
            ['cantidad', 'costo_unitario', 'subtotal']);
    }
    out($compras);
}

function compra_crear(PDO $pdo): void
{
    $d = body();
    $prov  = (int)($d['proveedor_id'] ?? 0);
    $items = is_array($d['items'] ?? null) ? $d['items'] : [];
    if (!fetch_one($pdo, "SELECT 1 FROM proveedor WHERE proveedor_id = ?", [$prov])) throw new ApiError('Selecciona un proveedor.', 422, ['proveedor_id' => 'Obligatorio.']);
    if (!$items) throw new ApiError('Agrega al menos un insumo a la compra.', 422);

    $subtotal = 0.0; $lineas = [];
    foreach ($items as $it) {
        $mid = (int)($it['materia_prima_id'] ?? 0); $cant = $it['cantidad'] ?? null; $costo = $it['costo_unitario'] ?? null;
        if (!fetch_one($pdo, "SELECT 1 FROM materia_prima WHERE materia_prima_id = ?", [$mid])) throw new ApiError('Insumo no encontrado.', 404);
        if (!is_numeric($cant) || (float)$cant <= 0)     throw new ApiError('Cantidad inválida.', 422);
        if (!is_numeric($costo) || (float)$costo < 0)    throw new ApiError('Costo inválido.', 422);
        $lineas[]  = [$mid, (float)$cant, (float)$costo];
        $subtotal += (float)$cant * (float)$costo;
    }
    $subtotal = round($subtotal, 2);
    $iva      = round($subtotal * (float)cfg('iva'), 2);

    $pdo->beginTransaction();
    try {
        $pdo->prepare("INSERT INTO compra (proveedor_id, subtotal, iva) VALUES (?,?,?)")->execute([$prov, $subtotal, $iva]);
        $compraId = (int)$pdo->lastInsertId();
        foreach ($lineas as [$mid, $cant, $costo]) {
            $pdo->prepare("INSERT INTO detalle_compra (compra_id, materia_prima_id, cantidad, costo_unitario) VALUES (?,?,?,?)")->execute([$compraId, $mid, $cant, $costo]);
            $pdo->prepare("UPDATE materia_prima SET cantidad = cantidad + ?, precio_unitario = ? WHERE materia_prima_id = ?")->execute([$cant, $costo, $mid]);
        }
        $pdo->commit();
    } catch (Throwable $ex) {
        $pdo->rollBack();
        throw $ex;
    }
    out(['id' => $compraId, 'subtotal' => $subtotal, 'iva' => $iva, 'total' => $subtotal + $iva], 201);
}

/* ============================================================
   PROMOCIONES
   ============================================================ */

function promociones_listar(PDO $pdo): void
{
    out(nums(fetch_all($pdo, "SELECT p.promocion_id AS id, p.nombre, p.estacion, p.descuento_porcentaje, p.fecha_inicio, p.fecha_fin,
                                     p.plaga_id, pl.nombre AS plaga, p.inmueble_id, i.tipo AS inmueble
                              FROM promocion p LEFT JOIN plaga pl ON pl.plaga_id = p.plaga_id LEFT JOIN inmueble i ON i.inmueble_id = p.inmueble_id
                              ORDER BY p.fecha_inicio DESC"), ['descuento_porcentaje']));
}

function promocion_crear(PDO $pdo): void
{
    $d = body(); $e = [];
    $nombre = txt($d, 'nombre'); $est = txt($d, 'estacion'); $pct = $d['descuento_porcentaje'] ?? null;
    $ini = txt($d, 'fecha_inicio'); $fin = txt($d, 'fecha_fin');
    $plaga = empty($d['plaga_id']) ? null : (int)$d['plaga_id']; $inm = empty($d['inmueble_id']) ? null : (int)$d['inmueble_id'];

    if ($nombre === '') $e['nombre'] = 'Ingresa el nombre.';
    if (!is_numeric($pct) || (float)$pct <= 0 || (float)$pct > 100) $e['descuento_porcentaje'] = 'El descuento debe estar entre 1 y 100.';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $ini)) $e['fecha_inicio'] = 'Fecha inválida.';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $fin)) $e['fecha_fin'] = 'Fecha inválida.';
    if (!$e && $fin < $ini) $e['fecha_fin'] = 'La fecha final no puede ser anterior a la inicial.';
    if ($plaga !== null && !fetch_one($pdo, "SELECT 1 FROM plaga WHERE plaga_id = ?", [$plaga])) $e['plaga_id'] = 'Plaga no encontrada.';
    if ($inm !== null && !fetch_one($pdo, "SELECT 1 FROM inmueble WHERE inmueble_id = ?", [$inm])) $e['inmueble_id'] = 'Inmueble no encontrado.';
    lanza_si_errores($e);

    $pdo->prepare("INSERT INTO promocion (nombre, estacion, descuento_porcentaje, fecha_inicio, fecha_fin, plaga_id, inmueble_id) VALUES (?,?,?,?,?,?,?)")
        ->execute([$nombre, $est !== '' ? $est : null, (float)$pct, $ini, $fin, $plaga, $inm]);
    out(['id' => (int)$pdo->lastInsertId()], 201);
}

function promocion_eliminar(PDO $pdo, int $id): void
{
    $st = $pdo->prepare("DELETE FROM promocion WHERE promocion_id = ?");
    $st->execute([$id]);
    if ($st->rowCount() === 0) throw new ApiError('Promoción no encontrada.', 404);
    out(['ok' => true]);
}

/* ============================================================
   USUARIOS DEL PANEL
   ============================================================ */

function usuarios_listar(PDO $pdo): void
{
    out(fetch_all($pdo, "SELECT u.usuario_id AS id, u.nombre, u.apellido_paterno, u.apellido_materno, u.telefono, u.correo, r.nombre AS rol, u.activo
                         FROM usuario u JOIN rol r ON r.rol_id = u.rol_id ORDER BY u.usuario_id"));
}

function usuario_crear(PDO $pdo): void
{
    $d = body(); $e = [];
    $nombre = txt($d, 'nombre'); $ap = txt($d, 'apellido_paterno'); $am = txt($d, 'apellido_materno');
    $correo = strtolower(txt($d, 'correo')); $pass = (string)($d['contrasena'] ?? ''); $rol = (int)($d['rol_id'] ?? 0);
    if ($nombre === '') $e['nombre'] = 'Obligatorio.';
    if ($ap === '')     $e['apellido_paterno'] = 'Obligatorio.';
    if (!email_ok($correo)) $e['correo'] = 'Correo inválido.';
    if (strlen($pass) < 8)  $e['contrasena'] = 'La contraseña debe tener al menos 8 caracteres.';
    if (!fetch_one($pdo, "SELECT 1 FROM rol WHERE rol_id = ?", [$rol])) $e['rol_id'] = 'Rol inválido.';
    lanza_si_errores($e);
    try {
        $pdo->prepare("INSERT INTO usuario (nombre, apellido_paterno, apellido_materno, correo, contrasena_hash, rol_id) VALUES (?,?,?,?,?,?)")
            ->execute([$nombre, $ap, $am !== '' ? $am : null, $correo, password_hash($pass, PASSWORD_DEFAULT), $rol]);
    } catch (PDOException $ex) {
        if ($ex->getCode() === '23000') throw new ApiError('Ya existe un usuario con ese correo.', 409);
        throw $ex;
    }
    out(['id' => (int)$pdo->lastInsertId()], 201);
}

/* ============================================================
   ESTADÍSTICAS
   ============================================================ */

function estadisticas(PDO $pdo): void
{
    $r = fetch_one($pdo, "SELECT COUNT(*) AS total,
                                 SUM(estado_id = 1) AS pendientes,
                                 COALESCE(SUM(CASE WHEN estado_id = 4 THEN total END), 0) AS ingresos,
                                 COALESCE(AVG(CASE WHEN estado_id = 4 THEN total END), 0) AS promedio
                          FROM v_solicitudes");
    $porMesBD = [];
    foreach (fetch_all($pdo, "SELECT DATE_FORMAT(fecha_servicio, '%Y-%m') AS mes, COUNT(*) AS n FROM orden
                              WHERE estado_id <> 5 AND fecha_servicio >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 5 MONTH)
                              GROUP BY mes") as $m) {
        $porMesBD[$m['mes']] = (int)$m['n'];
    }
    $nombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    $porMes  = [];
    for ($i = 5; $i >= 0; $i--) {
        $f = new DateTime('first day of this month');
        $f->modify("-$i month");
        $porMes[] = ['mes' => $nombres[(int)$f->format('n') - 1], 'servicios' => $porMesBD[$f->format('Y-m')] ?? 0];
    }
    $inv = fetch_one($pdo, "SELECT COALESCE(SUM(cantidad * precio_unitario), 0) AS valor, COALESCE(SUM(cantidad <= stock_minimo), 0) AS bajo_stock FROM materia_prima");

    out([
        'total'        => (int)$r['total'],
        'pendientes'   => (int)$r['pendientes'],
        'ingresos'     => (float)$r['ingresos'],
        'promedio'     => (float)round((float)$r['promedio']),
        'por_mes'      => $porMes,
        'por_servicio' => nums(fetch_all($pdo, "SELECT s.servicio_id AS id, s.codigo, s.nombre AS servicio, COUNT(d.detalle_orden_id) AS cantidad
                                                FROM servicio s LEFT JOIN detalle_orden d ON d.servicio_id = s.servicio_id GROUP BY s.servicio_id ORDER BY s.servicio_id"), ['cantidad']),
        'inventario'   => ['valor_total' => (float)$inv['valor'], 'insumos_bajo_stock' => (int)$inv['bajo_stock']],
    ]);
}

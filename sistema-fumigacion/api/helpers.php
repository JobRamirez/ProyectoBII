<?php
declare(strict_types=1);

/* ============================================================
   HELPERS · conexión, respuestas JSON, sesión, validaciones, correo
   Requiere PHP 8.0 o superior.
   ============================================================ */

const HORARIOS                  = ['08:00 – 10:00', '10:00 – 12:00', '12:00 – 14:00', '14:00 – 16:00', '16:00 – 18:00'];
const UNIDADES                  = ['L', 'kg', 'piezas', 'bloques', 'cajas'];
const CATEGORIAS_PROVEEDOR      = ['Químicos', 'Equipos', 'Cebos y trampas', 'Desinfectantes', 'Otros'];
const ESTADOS_CERRADOS          = [4, 5];      // Completado, Cancelado
const ESTADOS_REQUIEREN_TECNICO = [2, 3, 4];   // Confirmado, En proceso, Completado

class ApiError extends Exception
{
    public function __construct(string $message, public int $status = 400, public array $campos = [])
    {
        parent::__construct($message);
    }
}

function cfg(?string $key = null)
{
    static $c = null;
    $c ??= require __DIR__ . '/config.php';
    return $key === null ? $c : $c[$key];
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    $c = cfg('db');
    $pdo = new PDO(
        "mysql:host={$c['host']};port={$c['port']};dbname={$c['name']};charset={$c['charset']}",
        $c['user'], $c['pass'],
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]
    );
    return $pdo;
}

/* ---------- Respuestas ---------- */

function out($data, int $code = 200): never
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function cors(): void
{
    header('Content-Type: application/json; charset=utf-8');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '' && in_array($origin, cfg('cors_origins'), true)) {
        header("Access-Control-Allow-Origin: $origin");
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Headers: Content-Type, X-Requested-With');
        header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS');
        header('Vary: Origin');
    }
}

function start_session(): void
{
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure'   => !empty($_SERVER['HTTPS']),
    ]);
    session_name('mk_sesion');
    session_start();
}

/* Protección CSRF: toda petición que modifica datos debe traer esta cabecera.
   Un sitio externo no puede enviarla sin pasar por CORS, que está restringido. */
function guard_csrf(): void
{
    $m = $_SERVER['REQUEST_METHOD'];
    if (in_array($m, ['GET', 'HEAD', 'OPTIONS'], true)) return;
    if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'fetch') {
        throw new ApiError('Petición no permitida.', 403);
    }
}

function body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') return [];
    $d = json_decode($raw, true);
    if (!is_array($d)) throw new ApiError('El cuerpo de la petición no es JSON válido.', 400);
    return $d;
}

/* ---------- Sesión / permisos ---------- */

function usuario_actual(): ?array
{
    return $_SESSION['usuario'] ?? null;
}

function requiere_login(): array
{
    $u = usuario_actual();
    if (!$u) throw new ApiError('Inicia sesión para continuar.', 401);
    return $u;
}

function requiere_admin(): array
{
    $u = requiere_login();
    if ($u['rol'] !== 'Administrador') throw new ApiError('Solo el administrador puede realizar esta acción.', 403);
    return $u;
}

/* ---------- Utilidades ---------- */

function folio(int $ordenId): string
{
    return 'MK-2026-' . str_pad((string)$ordenId, 5, '0', STR_PAD_LEFT);
}

function fetch_one(PDO $pdo, string $sql, array $params = []): ?array
{
    $st = $pdo->prepare($sql);
    $st->execute($params);
    $r = $st->fetch();
    return $r === false ? null : $r;
}

function fetch_all(PDO $pdo, string $sql, array $params = []): array
{
    $st = $pdo->prepare($sql);
    $st->execute($params);
    return $st->fetchAll();
}

/* Convierte a número las columnas indicadas (MySQL devuelve los DECIMAL como texto) */
function nums(array $rows, array $keys): array
{
    foreach ($rows as &$r) {
        foreach ($keys as $k) {
            if (array_key_exists($k, $r) && $r[$k] !== null) $r[$k] = $r[$k] + 0;
        }
    }
    return $rows;
}

function nums1(?array $row, array $keys): ?array
{
    return $row === null ? null : nums([$row], $keys)[0];
}

function txt(array $d, string $k): string
{
    $v = $d[$k] ?? '';
    return is_string($v) ? trim((string)preg_replace('/\s+/u', ' ', $v)) : '';
}

/* Funciones de texto que funcionan aunque la extensión mbstring no esté activa */
function largo(string $s): int
{
    return function_exists('mb_strlen') ? mb_strlen($s) : (int)preg_match_all('/./us', $s);
}

function recorta(string $s, int $n): string
{
    return function_exists('mb_substr')
        ? mb_substr($s, 0, $n)
        : implode('', array_slice(preg_split('//u', $s, -1, PREG_SPLIT_NO_EMPTY) ?: [], 0, $n));
}

function mayus(string $s): string
{
    return function_exists('mb_strtoupper') ? mb_strtoupper($s) : strtoupper($s);
}

function digitos(string $v): string
{
    return (string)preg_replace('/\D/', '', $v);
}

function email_ok(string $v): bool
{
    return (bool)filter_var($v, FILTER_VALIDATE_EMAIL);
}

function lanza_si_errores(array $e): void
{
    if ($e) throw new ApiError('Revisa los campos marcados.', 422, $e);
}

/* Traduce un error de llave duplicada de MySQL a un mensaje entendible */
function mensaje_duplicado(PDOException $ex): string
{
    $m = strtolower($ex->getMessage());
    foreach (['correo' => 'correo', 'rfc' => 'RFC', 'nss' => 'NSS', 'nombre' => 'nombre'] as $k => $label) {
        if (str_contains($m, $k)) return "Ya existe un registro con ese $label.";
    }
    return 'Ya existe un registro con esos datos.';
}

/* ---------- Correo ---------- */

function enviar_folio_empresa(array $o): bool
{
    $cuerpo = implode("\n", [
        "Nueva solicitud de servicio — {$o['folio']}",
        '',
        "Cliente:   {$o['cliente']}",
        "Teléfono:  {$o['telefono_cliente']}",
        "Correo:    {$o['correo_cliente']}",
        "Servicio:  {$o['servicio']}",
        "Plaga:     {$o['plaga']}",
        "Inmueble:  {$o['inmueble']} · {$o['tamano']}",
        "Dirección: {$o['direccion']}",
        "Fecha:     {$o['fecha_servicio']} · {$o['horario']}",
        ($o['notas'] ?? '') !== '' ? "Notas:     {$o['notas']}" : '',
        '',
        'Subtotal: $' . number_format((float)$o['subtotal'], 2),
        'IVA (16%): $' . number_format((float)$o['iva'], 2),
        'Total estimado: $' . number_format((float)$o['total'], 2),
    ]);
    $asunto  = '=?UTF-8?B?' . base64_encode("Nueva solicitud {$o['folio']}") . '?=';
    $headers = "From: Marrón King <" . cfg('correo_remitente') . ">\r\n"
             . "Reply-To: " . $o['correo_cliente'] . "\r\n"
             . "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n";

    $enviado = false;
    if (cfg('enviar_correo')) {
        $enviado = @mail(cfg('empresa_email'), $asunto, $cuerpo, $headers);
    }
    if (!$enviado) {
        // Respaldo: queda el registro para reenviarlo manualmente
        @file_put_contents(
            __DIR__ . '/correos_pendientes.log',
            '[' . date('Y-m-d H:i:s') . "] Para: " . cfg('empresa_email') . "\n$cuerpo\n" . str_repeat('-', 50) . "\n",
            FILE_APPEND
        );
    }
    return $enviado;
}

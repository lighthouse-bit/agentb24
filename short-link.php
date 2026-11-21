<?php
// Persistent URL mappings live outside Git in the protected data directory.
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
header('X-Content-Type-Options: nosniff');
function linkError($message, $status) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $message]);
    exit;
}
function validateDestination($url) {
    if (!is_string($url) || strlen($url) > 4096 || preg_match('/[\x00-\x20\x7f\\\\]/', $url) || !filter_var($url, FILTER_VALIDATE_URL)) return false;
    $parts = parse_url($url);
    if (!$parts || !in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true) || isset($parts['user']) || isset($parts['pass'])) return false;
    $host = strtolower(rtrim($parts['host'] ?? '', '.'));
    if (!$host || !str_contains($host, '.') || preg_match('/(?:^|\.)(localhost|local|internal|test|invalid)$/', $host)) return false;
    if (filter_var(trim($host, '[]'), FILTER_VALIDATE_IP) && !filter_var(trim($host, '[]'), FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) return false;
    if (in_array($host, ['agentb24.com', 'www.agentb24.com'], true) && preg_match('~^/(?:s(?:/|$)|short-link\.php)~i', $parts['path'] ?? '')) return false;
    return true;
}

$method = $_SERVER['REQUEST_METHOD'];
if (!in_array($method, ['POST', 'GET', 'HEAD'], true)) linkError('Method not allowed', 405);
$code = $_GET['code'] ?? '';
if ($method !== 'POST' && (!is_string($code) || !preg_match('/^[a-z0-9][a-z0-9_-]{3,39}$/D', $code))) linkError('This short link does not exist.', 404);
$data = null;
if ($method === 'POST') {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin && strcasecmp((string)parse_url($origin, PHP_URL_HOST), preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST'] ?? '')) !== 0) linkError('Request origin not allowed.', 403);
    $data = json_decode(file_get_contents('php://input', false, null, 0, 8193), true);
    if (!is_array($data)) linkError('Send a valid URL.', 400);
    $url = $data['url'] ?? null;
    if (!validateDestination($url)) linkError('Enter a public http:// or https:// URL without spaces or embedded passwords. Existing AgentB24 short links cannot be shortened again.', 400);
    $alias = $data['alias'] ?? '';
    if (!is_string($alias)) linkError('Invalid custom ending.', 400);
    $alias = strtolower(trim($alias));
    if ($alias !== '' && !preg_match('/^[a-z0-9][a-z0-9_-]{3,39}$/D', $alias)) linkError('Custom endings need 4–40 letters, numbers, hyphens or underscores, starting with a letter or number.', 400);
    $days = $data['days'] ?? 0;
    if (!in_array($days, [0, 7, 30, 90], true)) linkError('Choose a supported expiry.', 400);
}

$db = null;
try {
    $directory = __DIR__ . '/data';
    if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) throw new RuntimeException('Storage unavailable');
    if (!file_exists($directory . '/.htaccess') && file_put_contents($directory . '/.htaccess', "Require all denied\n") === false) throw new RuntimeException('Cannot protect storage');
    $db = new PDO('sqlite:' . $directory . '/short-links.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA busy_timeout=5000');
    $db->exec('CREATE TABLE IF NOT EXISTS links (code TEXT PRIMARY KEY, destination TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER, enabled INTEGER NOT NULL DEFAULT 1)');
    $db->exec('CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)');
    if ($method !== 'POST') {
        $statement = $db->prepare('SELECT destination, expires_at, enabled FROM links WHERE code = ?');
        $statement->execute([$code]);
        $link = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$link) linkError('This short link does not exist.', 404);
        if (!$link['enabled'] || ($link['expires_at'] !== null && (int)$link['expires_at'] <= time())) linkError('This short link has expired or has been disabled.', 410);
        if (!validateDestination($link['destination'])) linkError('This destination is no longer supported.', 410);
        header('Referrer-Policy: no-referrer');
        header('Location: ' . $link['destination'], true, 302);
        exit;
    }

    $now = time();
    // Serialize alias reservations and rate-limit counters across concurrent requests.
    $db->exec('BEGIN IMMEDIATE');
    $db->exec('DELETE FROM rate_limits WHERE expires_at < ' . $now);
    $ipHash = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown');
    foreach ([[60, 10], [86400, 100]] as [$window, $limit]) {
        $bucket = hash('sha256', $ipHash . ':' . $window . ':' . intdiv($now, $window));
        $query = $db->prepare('SELECT count FROM rate_limits WHERE bucket = ?');
        $query->execute([$bucket]);
        if ((int)$query->fetchColumn() >= $limit) {
            $db->exec('ROLLBACK');
            header('Retry-After: ' . ($window - $now % $window));
            linkError('Too many links created from this network. Please try again later.', 429);
        }
        $query = $db->prepare('INSERT INTO rate_limits (bucket, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET count = count + 1');
        $query->execute([$bucket, (intdiv($now, $window) + 1) * $window]);
    }
    $expires = $days ? $now + $days * 86400 : null;
    $insert = $db->prepare('INSERT OR IGNORE INTO links (code, destination, created_at, expires_at) VALUES (?, ?, ?, ?)');
    for ($attempt = 0; $attempt < 5; $attempt++) {
        $code = $alias ?: bin2hex(random_bytes(5));
        $insert->execute([$code, $url, $now, $expires]);
        if ($insert->rowCount() === 1) break;
        if ($alias !== '') {
            $db->exec('ROLLBACK');
            linkError('That custom ending is already taken. Choose another one.', 409);
        }
    }
    if ($insert->rowCount() !== 1) throw new RuntimeException('Could not reserve a short link');
    $db->exec('COMMIT');
    // Production URLs are canonical; local PHP development uses the query route.
    $shortUrl = 'https://agentb24.com/s/' . $code;
    $host = $_SERVER['HTTP_HOST'] ?? '';
    if (in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true) && preg_match('/^(localhost|127\.0\.0\.1)(:\d+)?$/D', $host)) {
        $shortUrl = 'http://' . $host . '/short-link.php?code=' . $code;
    }
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(201);
    echo json_encode(['code' => $code, 'shortUrl' => $shortUrl, 'destination' => $url, 'expiresAt' => $expires ? gmdate('c', $expires) : null]);
} catch (Throwable $error) {
    if ($db) { try { $db->exec('ROLLBACK'); } catch (Throwable $ignored) {} }
    error_log('URL shortener: ' . $error->getMessage());
    linkError('The shortener is temporarily unavailable. Please try again later.', 503);
}

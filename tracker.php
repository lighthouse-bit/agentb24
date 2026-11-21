<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
require_once __DIR__ . '/analytics-store.php';
function trackingError($message, $status) {
    http_response_code($status);
    echo json_encode(['error' => $message]);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') trackingError('Method not allowed', 405);
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && strcasecmp((string)parse_url($origin, PHP_URL_HOST), preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST'] ?? '')) !== 0) {
    trackingError('Origin not allowed', 403);
}
$raw = file_get_contents('php://input', false, null, 0, 16385);
if (strlen($raw) > 16384) trackingError('Payload too large', 413);
$data = json_decode($raw, true);
if (!is_array($data) || !is_string($data['page'] ?? null) || !is_string($data['visitorId'] ?? null) || !preg_match('/^[a-zA-Z0-9_-]{1,120}$/D', $data['visitorId'])) trackingError('Invalid tracking data', 400);
foreach (['eventId', 'sessionId'] as $key) {
    if (($data['version'] ?? 0) === 2 && (!is_string($data[$key] ?? null) || !preg_match('/^[a-zA-Z0-9_-]{1,120}$/D', $data[$key]))) trackingError('Invalid event identity', 400);
}
foreach (['path', 'referrer', 'device', 'browser', 'os', 'language', 'country', 'countryCode', 'region', 'city', 'timezone'] as $key) {
    if (isset($data[$key]) && !is_string($data[$key])) trackingError('Invalid tracking field', 400);
}
if (preg_match('/bot|crawl|spider|slurp|mediapartners/i', $_SERVER['HTTP_USER_AGENT'] ?? '') || preg_match('~/admin(?:\.html)?/?$~i', $data['path'] ?? '')) {
    echo json_encode(['status' => 'ignored']); exit;
}
$directory = __DIR__ . '/data';
if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) trackingError('Cannot create analytics directory', 500);
if (!file_exists($directory . '/.htaccess')) file_put_contents($directory . '/.htaccess', "Require all denied\n");
$handle = fopen($directory . '/visits.json', 'c+');
if (!$handle || !flock($handle, LOCK_EX)) trackingError('Analytics storage unavailable', 503);
try {
    $storage = analyticsRead($handle);
    $created = analyticsApply($storage, $data, time());
    $json = json_encode($storage, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    rewind($handle);
    if (fwrite($handle, $json) !== strlen($json) || !ftruncate($handle, strlen($json)) || !fflush($handle)) throw new RuntimeException('Cannot save analytics data');
    echo json_encode(['status' => 'ok', 'created' => $created]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode(['error' => $error->getMessage()]);
} finally {
    flock($handle, LOCK_UN);
    fclose($handle);
}

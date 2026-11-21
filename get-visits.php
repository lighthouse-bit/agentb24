<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}
$config = __DIR__ . '/admin-config.php';
if (file_exists($config)) {
    require_once $config;
}
$body = json_decode(file_get_contents('php://input'), true) ?: [];
$password = (string)($body['password'] ?? '');
$hash = defined('AGENTB24_ADMIN_PASSWORD_HASH') ? AGENTB24_ADMIN_PASSWORD_HASH : '';
$expected = getenv('AGENTB24_ADMIN_PASSWORD') ?: '';
if ($hash) {
    $authorized = password_verify($password, $hash);
} elseif ($expected) {
    $authorized = hash_equals($expected, $password);
} else {
    http_response_code(503);
    echo json_encode(['error' => 'Admin password is not configured']);
    exit;
}
if (!$authorized) {
    http_response_code(403);
    echo json_encode(['error' => 'Forbidden']);
    exit;
}
$file = __DIR__ . '/data/visits.json';
require_once __DIR__ . '/analytics-store.php';
if (!file_exists($file)) {
    echo json_encode(['visits' => [], 'pageviews' => 0, 'sessions' => 0, 'storageBytes' => 0]);
    exit;
}
$handle = fopen($file, 'r');
if (!$handle || !flock($handle, LOCK_SH)) {
    http_response_code(503);
    echo json_encode(['error' => 'Analytics storage unavailable']);
    exit;
}
try {
    $storage = analyticsRead($handle);
    $storage['storageBytes'] = fstat($handle)['size'];
    $storage['serverTime'] = gmdate('c');
    $storage['historyIncomplete'] = (int)($storage['pageviews'] ?? 0) > count($storage['visits']);
    echo json_encode($storage, JSON_THROW_ON_ERROR);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode(['error' => $error->getMessage()]);
} finally {
    flock($handle, LOCK_UN);
    fclose($handle);
}

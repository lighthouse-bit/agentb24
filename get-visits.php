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
echo file_exists($file) ? file_get_contents($file) : '{"visits":[],"pageviews":0,"sessions":0}';

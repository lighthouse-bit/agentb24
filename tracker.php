<?php
// ================================================
//  PIXLIT VISITOR TRACKER — tracker.php
//  Saves visitor data to server
//  Place in: public_html/tracker.php
// ================================================

// Allow requests from your own site only
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Only accept POST requests
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit();
}

// ---- Config ----
define('DATA_FILE',    __DIR__ . '/data/visits.json');
define('MAX_RECORDS',  5000);
define('SECRET_KEY',   getenv('AGENTB24_TRACKER_SECRET') ?: 'change-this-secret');
define('DATA_DIR',     __DIR__ . '/data');

function failJson($message, $status = 500) {
    http_response_code($status);
    echo json_encode(['error' => $message]);
    exit();
}

// Create data directory if it doesn't exist
if (!is_dir(DATA_DIR)) {
    if (!mkdir(DATA_DIR, 0755, true)) {
        failJson('Could not create analytics data directory');
    }
}

// Block direct access to data folder
$htaccess = DATA_DIR . '/.htaccess';
if (!file_exists($htaccess)) {
    file_put_contents($htaccess, "Deny from all\n");
}

if (!file_exists(DATA_FILE)) {
    if (file_put_contents(DATA_FILE, '{"visits":[],"pageviews":0,"sessions":0}', LOCK_EX) === false) {
        failJson('Could not create visits.json. Check data folder permissions.');
    }
}

if (!is_writable(DATA_FILE)) {
    failJson('visits.json is not writable. Check file permissions.');
}

// ---- Read incoming data ----
$raw  = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!$data || !isset($data['page'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid data']);
    exit();
}

// ---- Get visitor IP ----
function getIP() {
    $keys = [
        'HTTP_CLIENT_IP',
        'HTTP_X_FORWARDED_FOR',
        'HTTP_X_FORWARDED',
        'HTTP_FORWARDED_FOR',
        'HTTP_FORWARDED',
        'REMOTE_ADDR'
    ];
    foreach ($keys as $key) {
        if (!empty($_SERVER[$key])) {
            $ip = trim(explode(',', $_SERVER[$key])[0]);
            if (filter_var($ip, FILTER_VALIDATE_IP)) {
                return $ip;
            }
        }
    }
    return '0.0.0.0';
}

// ---- Hash IP for privacy ----
function hashIP($ip) {
    return substr(md5($ip . SECRET_KEY), 0, 16);
}

// ---- Load existing data ----
function loadData() {
    if (!file_exists(DATA_FILE)) {
        return ['visits' => [], 'pageviews' => 0, 'sessions' => 0];
    }
    $content = file_get_contents(DATA_FILE);
    $decoded = json_decode($content, true);
    return $decoded ?: ['visits' => [], 'pageviews' => 0, 'sessions' => 0];
}

// ---- Save data ----
function saveData($storage) {
    // Keep only last MAX_RECORDS
    if (count($storage['visits']) > MAX_RECORDS) {
        $storage['visits'] = array_slice(
            $storage['visits'],
            -MAX_RECORDS
        );
    }
    $json = json_encode($storage);
    if ($json === false) {
        failJson('Could not encode analytics data');
    }
    if (file_put_contents(DATA_FILE, $json, LOCK_EX) === false) {
        failJson('Could not write visits.json. Check file permissions.');
    }
}

// ---- Build visit record ----
$ip        = getIP();
$visitorId = hashIP($ip);
$storage   = loadData();

// Time-on-page updates enrich the most recent matching visit instead of
// creating a second pageview.
if (($data['type'] ?? '') === 'time') {
    for ($i = count($storage['visits']) - 1; $i >= 0; $i--) {
        if (($storage['visits'][$i]['visitorId'] ?? '') === $visitorId &&
            ($storage['visits'][$i]['page'] ?? '') === ($data['page'] ?? '')) {
            $storage['visits'][$i]['timeOnPage'] = max(0, intval($data['timeOnPage'] ?? 0));
            saveData($storage);
            echo json_encode(['status' => 'ok', 'updated' => true]);
            exit();
        }
    }
    echo json_encode(['status' => 'ok', 'updated' => false]);
    exit();
}

$visit = [
    'id'          => uniqid('v', true),
    'visitorId'   => $visitorId,
    'timestamp'   => date('c'), // ISO 8601
    'page'        => substr(htmlspecialchars($data['page']        ?? 'Unknown'), 0, 100),
    'path'        => substr(htmlspecialchars($data['path']        ?? '/'),       0, 200),
    'referrer'    => substr(htmlspecialchars($data['referrer']    ?? 'Direct'),  0, 100),
    'device'      => substr(htmlspecialchars($data['device']      ?? 'Unknown'), 0, 50),
    'browser'     => substr(htmlspecialchars($data['browser']     ?? 'Unknown'), 0, 50),
    'os'          => substr(htmlspecialchars($data['os']          ?? 'Unknown'), 0, 50),
    'screenW'     => intval($data['screenW']    ?? 0),
    'screenH'     => intval($data['screenH']    ?? 0),
    'language'    => substr(htmlspecialchars($data['language']    ?? 'unknown'), 0, 20),
    'country'     => substr(htmlspecialchars($data['country']     ?? 'Unknown'), 0, 100),
    'countryCode' => substr(htmlspecialchars($data['countryCode'] ?? 'XX'),      0, 5),
    'region'      => substr(htmlspecialchars($data['region']      ?? 'Unknown'), 0, 100),
    'city'        => substr(htmlspecialchars($data['city']        ?? 'Unknown'), 0, 100),
    'timezone'    => substr(htmlspecialchars($data['timezone']    ?? 'Unknown'), 0, 100),
    'isNew'       => isset($data['isNew'])     ? (bool)$data['isNew']     : true,
    'isSession'   => isset($data['isSession']) ? (bool)$data['isSession'] : true,
    'timeOnPage'  => intval($data['timeOnPage'] ?? 0),
];

// ---- Update counts ----
$storage['visits'][]   = $visit;
$storage['pageviews']  = ($storage['pageviews'] ?? 0) + 1;
if ($visit['isSession']) {
    $storage['sessions'] = ($storage['sessions'] ?? 0) + 1;
}

// ---- Save ----
saveData($storage);

// ---- Return success ----
echo json_encode([
    'status'  => 'ok',
    'id'      => $visit['id'],
    'time'    => $visit['timestamp']
]);
exit();
?>

<?php
require __DIR__ . '/../analytics-store.php';
function check($condition, $message) { if (!$condition) throw new RuntimeException($message); }
$data = ['visits' => [], 'pageviews' => 0, 'sessions' => 0];
$now = 1800000000;
$view = ['version' => 2, 'eventId' => 'page-1', 'visitorId' => 'browser-1', 'sessionId' => 'session-1', 'page' => 'Homepage', 'path' => '/', 'isNew' => true];
analyticsApply($data, $view, $now);
analyticsApply($data, $view, $now + 1);
check(count($data['visits']) === 1 && $data['pageviews'] === 1, 'Retry duplicated page view');
analyticsApply($data, array_merge($view, ['timeOnPage' => 30, 'country' => 'Nigeria']), $now + 30);
analyticsApply($data, array_merge($view, ['timeOnPage' => 10]), $now + 31);
check($data['visits'][0]['timeOnPage'] === 30, 'Out-of-order heartbeat reduced time');
check($data['visits'][0]['country'] === 'Nigeria', 'Geo enrichment was lost');
analyticsApply($data, array_merge($view, ['eventId' => 'page-2']), $now + 40);
check($data['sessions'] === 1 && !$data['visits'][1]['isNew'], 'Same session counted twice');
analyticsApply($data, array_merge($view, ['visitorId' => 'browser-2']), $now + 50);
check($data['pageviews'] === 3 && $data['sessions'] === 2, 'Different browsers merged');
analyticsApply($data, array_merge($view, ['sessionId' => 'session-2', 'eventId' => 'page-3']), $now + 2000);
check($data['sessions'] === 3, 'Return session missing');
analyticsApply($data, array_merge($view, ['timeOnPage' => 99999]), $now + 60);
check($data['visits'][0]['timeOnPage'] === 60, 'Time exceeds page lifetime');
$handle = fopen('php://temp', 'w+');
fwrite($handle, '{invalid');
$failed = false;
try { analyticsRead($handle); } catch (RuntimeException $error) { $failed = true; }
check($failed, 'Corrupt data silently reset');
rewind($handle);
check(stream_get_contents($handle) === '{invalid', 'Corrupt data modified');
fclose($handle);
$legacy = ['visits' => [['visitorId' => 'old', 'timestamp' => gmdate('c', $now), 'page' => 'Old', 'isSession' => true]], 'pageviews' => 9000, 'sessions' => 5000];
analyticsApply($legacy, $view, $now);
check(count($legacy['visits']) === 2 && $legacy['pageviews'] === 9001, 'Existing history overwritten');
echo "Storage tests passed: idempotency, sessions, browser identity, time, geo, corruption and legacy preservation.\n";

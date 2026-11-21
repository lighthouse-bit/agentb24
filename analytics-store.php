<?php
// All callers must lock the file before reading or changing records.
function analyticsRead($handle) {
    rewind($handle);
    $raw = stream_get_contents($handle);
    if ($raw === '') return ['visits' => [], 'pageviews' => 0, 'sessions' => 0];
    $storage = json_decode($raw, true);
    if (!is_array($storage) || !isset($storage['visits']) || !is_array($storage['visits'])) {
        throw new RuntimeException('Analytics data is invalid. Restore a valid backup; existing data was not replaced.');
    }
    return $storage;
}

function analyticsApply(&$storage, $data, $now) {
    $visitor = $data['visitorId'];
    $event = $data['eventId'] ?? '';
    $modern = ($data['version'] ?? 0) === 2 && $event !== '';
    $match = null;
    $seenVisitor = false;
    $seenSession = false;
    foreach ($storage['visits'] as $i => $visit) {
        if (($visit['visitorId'] ?? '') !== $visitor) continue;
        $seenVisitor = true;
        if (($visit['sessionId'] ?? '') === ($data['sessionId'] ?? '') && !empty($data['sessionId'])) $seenSession = true;
        if ($modern && ($visit['eventId'] ?? '') === $event) $match = $i;
        // Old cached clients do not have event IDs; keep their time updates compatible.
        if (!$modern && ($data['type'] ?? '') === 'time' && ($visit['page'] ?? '') === ($data['page'] ?? '')) $match = $i;
    }
    if ($match !== null) {
        $visit =& $storage['visits'][$match];
        $age = max(0, $now - strtotime($visit['timestamp']));
        $visit['timeOnPage'] = max((int)($visit['timeOnPage'] ?? 0), min($age, max(0, (int)($data['timeOnPage'] ?? 0))));
        $visit['lastSeen'] = gmdate('c', $now);
        foreach (['country', 'countryCode', 'region', 'city'] as $key) {
            if (!empty($data[$key]) && !in_array($data[$key], ['Unknown', 'XX'], true)) {
                $visit[$key] = htmlspecialchars(substr((string)$data[$key], 0, 100), ENT_QUOTES, 'UTF-8');
            }
        }
        return false;
    }
    if (($data['type'] ?? '') === 'time') return false;
    $visit = [
        'id' => $modern ? $event : uniqid('v', true), 'eventId' => $event,
        'visitorId' => $visitor, 'sessionId' => $data['sessionId'] ?? '',
        'timestamp' => gmdate('c', $now), 'lastSeen' => gmdate('c', $now),
        'isNew' => !$seenVisitor && ($data['isNew'] ?? false) === true,
        'isSession' => $modern ? !$seenSession : ($data['isSession'] ?? false) === true,
        'timeOnPage' => 0, 'trackingVersion' => $modern ? 2 : 1
    ];
    foreach (['page', 'path', 'referrer', 'device', 'browser', 'os', 'language', 'country', 'countryCode', 'region', 'city', 'timezone'] as $key) {
        $default = $key === 'countryCode' ? 'XX' : ($key === 'referrer' ? 'Direct' : 'Unknown');
        $visit[$key] = htmlspecialchars(substr((string)($data[$key] ?? $default), 0, 200), ENT_QUOTES, 'UTF-8');
    }
    $visit['screenW'] = max(0, (int)($data['screenW'] ?? 0));
    $visit['screenH'] = max(0, (int)($data['screenH'] ?? 0));
    $storage['visits'][] = $visit;
    $storage['pageviews'] = (int)($storage['pageviews'] ?? 0) + 1;
    $storage['sessions'] = (int)($storage['sessions'] ?? 0) + ($visit['isSession'] ? 1 : 0);
    return true;
}

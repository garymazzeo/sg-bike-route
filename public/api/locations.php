<?php
header('Content-Type: application/json');
header('Cache-Control: no-cache');

$url = 'https://aadl.org/summergame/map/data/SummerGame2026';
$ctx = stream_context_create(['http' => ['timeout' => 30]]);
$data = @file_get_contents($url, false, $ctx);

if ($data === false) {
    $fallback = __DIR__ . '/../data/locations.json';
    if (is_readable($fallback)) {
        readfile($fallback);
        exit;
    }
    http_response_code(502);
    echo json_encode(['error' => 'Could not fetch location data']);
    exit;
}

echo $data;

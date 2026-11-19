<?php
declare(strict_types=1);

// Exakte URL der GitHub-Pages-Site eintragen, z. B. https://name.github.io
// Alternativ per Umgebungsvariable STEIGWETTER_ALLOWED_ORIGINS (kommagetrennt).
$configuredOrigins = getenv('STEIGWETTER_ALLOWED_ORIGINS') ?: 'https://ferrata.libralo.com';
return [
    'allowed_origins' => array_values(array_filter(array_map('trim', explode(',', $configuredOrigins)))),
    'max_request_bytes' => 8192,
    'max_response_bytes' => 2 * 1024 * 1024,
    'connect_timeout_seconds' => 5,
    'request_timeout_seconds' => 15,
    'max_redirects' => 3,
];

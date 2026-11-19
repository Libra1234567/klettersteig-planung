<?php
declare(strict_types=1);

/*
 * STEIGWETTER route-page importer. This endpoint fetches untrusted public HTML
 * as data only. It never evaluates page scripts or follows redirects blindly.
 */
$config = require __DIR__ . '/config.php';
header('Content-Type: application/json; charset=utf-8');
header('Vary: Origin');

final class ImportException extends RuntimeException {
    public function __construct(string $message, public readonly int $status = 422) { parent::__construct($message); }
}

function respond(int $status, array $payload): never {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
    if (!in_array($origin, $config['allowed_origins'], true)) {
        respond(403, ['success' => false, 'error' => 'Diese Website ist für die Import-API nicht freigeschaltet.']);
    }
    header('Access-Control-Allow-Origin: ' . $origin);
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Max-Age: 600');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST, OPTIONS');
    respond(405, ['success' => false, 'error' => 'Nur POST-Anfragen werden unterstützt.']);
}
$contentLength = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
if ($contentLength > $config['max_request_bytes']) {
    respond(413, ['success' => false, 'error' => 'Die Anfrage ist zu groß.']);
}
$body = file_get_contents('php://input', false, null, 0, $config['max_request_bytes'] + 1);
if ($body === false || strlen($body) > $config['max_request_bytes']) {
    respond(413, ['success' => false, 'error' => 'Die Anfrage ist zu groß oder konnte nicht gelesen werden.']);
}
$request = json_decode($body, true);
$inputUrl = is_array($request) ? trim((string)($request['url'] ?? '')) : '';
if (filter_var($inputUrl, FILTER_VALIDATE_URL) === false) {
    respond(400, ['success' => false, 'error' => 'Bitte eine vollständige, gültige URL eingeben.']);
}

function publicIpv4(string $ip): bool {
    return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4 | FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false;
}

/** Validate URL, resolve all A records, reject private/mixed DNS answers and pin the selected address. */
function validatedTarget(string $url): array {
    $parts = parse_url($url);
    if (!is_array($parts) || !isset($parts['scheme'], $parts['host']) || isset($parts['user']) || isset($parts['pass'])) {
        throw new RuntimeException('Die URL muss HTTP oder HTTPS ohne Zugangsdaten verwenden.');
    }
    $scheme = strtolower($parts['scheme']);
    $host = strtolower(rtrim($parts['host'], '.'));
    $port = (int)($parts['port'] ?? ($scheme === 'https' ? 443 : 80));
    if (!in_array($scheme, ['http', 'https'], true) || !in_array($port, [80, 443], true) || ($scheme === 'https' && $port !== 443) || ($scheme === 'http' && $port !== 80)) {
        throw new RuntimeException('Nur HTTP/HTTPS über die Standardports 80 und 443 ist erlaubt.');
    }
    if ($host === '' || $host === 'localhost' || str_ends_with($host, '.localhost') || str_ends_with($host, '.local') || str_ends_with($host, '.internal') || str_ends_with($host, '.test')) {
        throw new RuntimeException('Lokale oder reservierte Hostnamen sind nicht erlaubt.');
    }
    if (filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) !== false) {
        throw new RuntimeException('IPv6-Adressen als direkte URL werden aus Sicherheitsgründen nicht unterstützt.');
    }
    if (filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
        if (!publicIpv4($host)) throw new RuntimeException('Private oder reservierte IP-Adressen sind nicht erlaubt.');
        $address = $host;
    } else {
        if (!preg_match('/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i', $host)) {
            throw new RuntimeException('Der Hostname ist ungültig.');
        }
        $records = @dns_get_record($host, DNS_A);
        $addresses = array_values(array_unique(array_filter(array_map(static fn($record) => $record['ip'] ?? '', is_array($records) ? $records : []))));
        if (!$addresses) {
            $fallback = @gethostbynamel($host);
            $addresses = is_array($fallback) ? array_values(array_unique($fallback)) : [];
        }
        if (!$addresses) throw new RuntimeException('Der Hostname konnte nicht zu einer IPv4-Adresse aufgelöst werden.');
        foreach ($addresses as $ip) {
            if (!publicIpv4($ip)) throw new RuntimeException('Der Hostname verweist auch auf eine private oder reservierte IP-Adresse.');
        }
        $address = $addresses[0];
    }
    $path = $parts['path'] ?? '/';
    if ($path === '') $path = '/';
    $normalized = $scheme . '://' . $host . ($port === ($scheme === 'https' ? 443 : 80) ? '' : ':' . $port) . $path;
    if (isset($parts['query'])) $normalized .= '?' . $parts['query'];
    return ['url' => $normalized, 'scheme' => $scheme, 'host' => $host, 'port' => $port, 'ip' => $address];
}

function resolveRedirect(string $base, string $location): string {
    $location = trim($location);
    if ($location === '') throw new RuntimeException('Die Zielseite lieferte eine leere Weiterleitung.');
    if (preg_match('~^https?://~i', $location)) return $location;
    $baseParts = parse_url($base);
    if (!is_array($baseParts)) throw new RuntimeException('Weiterleitungsziel ungültig.');
    $authority = $baseParts['scheme'] . '://' . $baseParts['host'] . (isset($baseParts['port']) ? ':' . $baseParts['port'] : '');
    if (str_starts_with($location, '//')) return $baseParts['scheme'] . ':' . $location;
    if (str_starts_with($location, '?')) return $authority . ($baseParts['path'] ?? '/') . $location;
    if (str_starts_with($location, '/')) return $authority . $location;
    $directory = preg_replace('~/[^/]*$~', '/', $baseParts['path'] ?? '/');
    return $authority . $directory . $location;
}

function fetchHtml(string $url, array $config): array {
    for ($redirects = 0; $redirects <= $config['max_redirects']; $redirects++) {
        $target = validatedTarget($url);
        $html = '';
        $tooLarge = false;
        $responseHeaders = [];
        $curl = curl_init($target['url']);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_CONNECTTIMEOUT => $config['connect_timeout_seconds'],
            CURLOPT_TIMEOUT => $config['request_timeout_seconds'],
            CURLOPT_MAXREDIRS => 0,
            CURLOPT_PROXY => '',
            CURLOPT_NETRC => CURL_NETRC_IGNORED,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            CURLOPT_HTTPHEADER => ['Accept: text/html,application/xhtml+xml;q=0.9', 'Accept-Language: de,en;q=0.6'],
            CURLOPT_RESOLVE => [$target['host'] . ':' . $target['port'] . ':' . $target['ip']],
            CURLOPT_HEADERFUNCTION => static function ($curl, string $line) use (&$responseHeaders): int {
                $length = strlen($line);
                if (str_contains($line, ':')) {
                    [$name, $value] = explode(':', $line, 2);
                    $responseHeaders[strtolower(trim($name))] = trim($value);
                }
                return $length;
            },
            CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$html, &$tooLarge, $config): int {
                if (strlen($html) + strlen($chunk) > $config['max_response_bytes']) {
                    $tooLarge = true;
                    return 0;
                }
                $html .= $chunk;
                return strlen($chunk);
            },
        ]);
        $ok = curl_exec($curl);
        $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $contentType = strtolower((string)curl_getinfo($curl, CURLINFO_CONTENT_TYPE));
        $curlError = curl_error($curl);
        $curlErrno = curl_errno($curl);
        curl_close($curl);
        if ($tooLarge) throw new ImportException('Die Webseite überschreitet die maximale Downloadgröße von 2 MB.', 413);
        if ($ok === false) {
            throw new ImportException('Die Webseite konnte nicht abgerufen werden: ' . ($curlError ?: 'Netzwerkfehler'), $curlErrno === CURLE_OPERATION_TIMEDOUT ? 504 : 502);
        }
        if (in_array($status, [301, 302, 303, 307, 308], true)) {
            if ($redirects >= $config['max_redirects']) throw new RuntimeException('Zu viele Weiterleitungen.');
            $url = resolveRedirect($target['url'], $responseHeaders['location'] ?? '');
            continue;
        }
        if ($status < 200 || $status >= 300) throw new ImportException('Die Zielseite antwortete mit HTTP ' . $status . '.', 502);
        if (!preg_match('~^(text/html|application/xhtml\+xml)(?:\s*;|$)~i', $contentType)) throw new ImportException('Die Zielseite liefert kein HTML-Dokument.', 415);
        return [$html, $target['url']];
    }
    throw new RuntimeException('Die Weiterleitung konnte nicht verarbeitet werden.');
}

function cleanText(string $text): string {
    $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = preg_replace('/[\x{00A0}\s]+/u', ' ', $text) ?? $text;
    return trim($text);
}

function lowerUtf8(string $value): string {
    return function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value);
}

function subUtf8(string $value, int $start, ?int $length = null): string {
    if (function_exists('mb_substr')) return mb_substr($value, $start, $length, 'UTF-8');
    return $length === null ? substr($value, $start) : substr($value, $start, $length);
}

function pageContent(string $html): array {
    $title = '';
    $description = '';
    $h1 = '';
    $anchors = [];
    $text = '';
    $jsonLd = [];
    if (class_exists(DOMDocument::class)) {
        $previous = libxml_use_internal_errors(true);
        $dom = new DOMDocument();
        $dom->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NONET | LIBXML_NOWARNING | LIBXML_NOERROR);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
        $xpath = new DOMXPath($dom);
        $titleNode = $xpath->query('//title')->item(0);
        if ($titleNode) $title = cleanText($titleNode->textContent);
        foreach ($xpath->query('//meta[@property="og:title" or @name="twitter:title"]/@content | //meta[@name="description" or @property="og:description"]/@content') as $meta) {
            $content = cleanText($meta->nodeValue ?? '');
            if ($content !== '' && $title === '') $title = $content;
            elseif ($content !== '' && $description === '') $description = $content;
        }
        $h1Node = $xpath->query('//h1')->item(0);
        if ($h1Node) $h1 = cleanText($h1Node->textContent);
        foreach ($xpath->query('//a[@href]') as $anchor) {
            $anchors[] = ['text' => cleanText($anchor->textContent), 'href' => trim($anchor->getAttribute('href'))];
        }
        foreach ($xpath->query('//script[@type="application/ld+json"]') as $script) {
            $decoded = json_decode($script->textContent, true);
            if (is_array($decoded)) $jsonLd[] = $decoded;
        }
        foreach ($xpath->query('//script|//style|//noscript|//svg') as $node) $node->parentNode?->removeChild($node);
        $body = $xpath->query('//body')->item(0);
        $text = cleanText($body?->textContent ?? strip_tags($html));
    } else {
        if (preg_match('~<title[^>]*>(.*?)</title>~is', $html, $match)) $title = cleanText(strip_tags($match[1]));
        if (preg_match('~<h1[^>]*>(.*?)</h1>~is', $html, $match)) $h1 = cleanText(strip_tags($match[1]));
        if (preg_match('~<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)~i', $html, $match)) $description = cleanText($match[1]);
        $text = cleanText(strip_tags(preg_replace('~<(script|style|noscript)\b[^>]*>.*?</\1>~is', ' ', $html) ?? $html));
    }
    $walkJsonLd = static function ($node) use (&$walkJsonLd, &$title, &$description, &$anchors): void {
        if (!is_array($node)) return;
        if ($title === '' && is_string($node['name'] ?? null)) $title = cleanText($node['name']);
        if ($description === '' && is_string($node['description'] ?? null)) $description = cleanText($node['description']);
        $geo = $node['geo'] ?? null;
        if (is_array($geo) && is_numeric($geo['latitude'] ?? null) && is_numeric($geo['longitude'] ?? null)) {
            $anchors[] = ['text' => is_string($node['name'] ?? null) ? $node['name'] : '', 'href' => (string)$geo['latitude'] . ',' . (string)$geo['longitude']];
        }
        foreach ($node as $value) if (is_array($value)) $walkJsonLd($value);
    };
    foreach ($jsonLd as $item) $walkJsonLd($item);
    $title = $h1 !== '' ? $h1 : $title;
    $text = subUtf8($text, 0, 16000);
    return [$title, $description, $text, $anchors, $jsonLd];
}

function parseDifficulty(string $text): ?string {
    $forms = ['[A-F](?:\s*[\/-]\s*[A-F]){1,2}', '[A-F]'];
    foreach (preg_split('/(?<=[.!?])\s+|\n/u', $text) as $line) {
        if (preg_match('/(schwierigkeit|schwierigkeitsgrad|klettersteiggrad|bewertung)\D{0,25}(' . implode('|', $forms) . ')/iu', $line, $match)) {
            return strtoupper(preg_replace('/\s+/u', '', $match[2]));
        }
    }
    return null;
}

function parseMinutes(string $text, array $labels): ?int {
    $label = implode('|', array_map(static fn($v) => preg_quote($v, '/'), $labels));
    if (!preg_match('/(?:' . $label . ')\s*(?:beträgt|ca\.?|etwa|:|–|-)*\s*(\d+(?:[.,]\d+)?)\s*(stunden?|std\.?|h|minuten?|min\.?)/iu', $text, $match)) return null;
    $value = (float)str_replace(',', '.', $match[1]);
    $unit = lowerUtf8($match[2]);
    return (int)round($value * (preg_match('/^(min|minute)/', $unit) ? 1 : 60));
}

function parseElevation(string $text, array $labels): ?int {
    $label = implode('|', array_map(static fn($v) => preg_quote($v, '/'), $labels));
    if (!preg_match('/(?:' . $label . ')\D{0,32}(\d{3,4}(?:[ .]\d{3})?)\s*(?:m(?:\s*ü\.?\s*(?:NN|NHN|A\.?))?|hm\b)/iu', $text, $match)) return null;
    return (int)preg_replace('/\D/', '', $match[1]);
}

function validCoordinate(float $lat, float $lon): bool {
    return $lat >= -90 && $lat <= 90 && $lon >= -180 && $lon <= 180 && !($lat === 0.0 && $lon === 0.0);
}

function coordinatesInString(string $value): array {
    $found = [];
    $patterns = [
        '/@(-?\d{1,2}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})/i',
        '/#map=\d+\/(-?\d{1,2}\.\d{4,})\/(-?\d{1,3}\.\d{4,})/i',
        '/[?&#](?:mlat|lat|latitude)=(-?\d{1,2}\.\d{4,})[^#&]*[&#](?:mlon|lon|lng|longitude)=(-?\d{1,3}\.\d{4,})/i',
        '/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/i',
        '/(?:lat|latitude)\s*[:=]\s*["\']?(-?\d{1,2}\.\d{4,}).{0,100}?(?:lon|lng|longitude)\s*[:=]\s*["\']?(-?\d{1,3}\.\d{4,})/is',
        '/(?<!\d)(-?\d{1,2}\.\d{4,})\s*[,;\s]\s*(-?\d{1,3}\.\d{4,})(?!\d)/',
    ];
    foreach ($patterns as $pattern) {
        if (preg_match_all($pattern, $value, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $match) {
                $lat = (float)$match[1]; $lon = (float)$match[2];
                if (validCoordinate($lat, $lon)) $found[] = ['latitude' => $lat, 'longitude' => $lon];
            }
        }
    }
    return $found;
}

function findCoordinates(string $html, string $text, array $anchors): array {
    $entry = null; $summit = null; $candidates = [];
    foreach ($anchors as $anchor) {
        $points = coordinatesInString($anchor['href']);
        foreach ($points as $point) {
            $label = lowerUtf8($anchor['text']);
            if ($entry === null && preg_match('/einstieg|startpunkt|start\b/u', $label)) { $entry = $point + ['confidence' => 'medium', 'source' => 'Link mit Start-/Einstiegsbeschriftung']; }
            elseif ($summit === null && preg_match('/gipfel|ausstieg|ziel\b/u', $label)) { $summit = $point + ['confidence' => 'medium', 'source' => 'Link mit Gipfel-/Ausstiegsbeschriftung']; }
            else $candidates[] = $point + ['confidence' => 'low', 'source' => 'Kartenlink ohne eindeutige Punktbeschriftung'];
        }
    }
    foreach (coordinatesInString($html) as $point) {
        $key = $point['latitude'] . ',' . $point['longitude'];
        if (!array_filter($candidates, static fn($candidate) => $candidate['latitude'] . ',' . $candidate['longitude'] === $key)) $candidates[] = $point + ['confidence' => 'low', 'source' => 'Koordinatenfund im Seitencode'];
    }
    foreach (coordinatesInString($text) as $point) {
        $key = $point['latitude'] . ',' . $point['longitude'];
        if (!array_filter($candidates, static fn($candidate) => $candidate['latitude'] . ',' . $candidate['longitude'] === $key)) $candidates[] = $point + ['confidence' => 'low', 'source' => 'Koordinatenpaar im Seitentext'];
    }
    foreach ($candidates as $index => $candidate) {
        $needle = (string)$candidate['latitude'];
        $position = strpos($text, $needle);
        $context = $position === false ? '' : lowerUtf8(subUtf8($text, max(0, $position - 100), 220));
        if ($entry === null && preg_match('/einstieg|klettersteigbeginn/u', $context)) { $entry = array_merge($candidate, ['confidence' => 'medium']); unset($candidates[$index]); }
        elseif ($summit === null && preg_match('/gipfel|ausstieg|klettersteigende/u', $context)) { $summit = array_merge($candidate, ['confidence' => 'medium']); unset($candidates[$index]); }
    }
    return [$entry, $summit, array_values($candidates)];
}

function extractData(string $html, string $sourceUrl): array {
    [$title, $metaDescription, $text, $anchors, $jsonLd] = pageContent($html);
    $warnings = [];
    $name = $title !== '' ? preg_replace('/\s*[|·–-]\s*(Bergsteigen\.com|AlpinVerse|Bergwelten|Klettersteig\.de).*$/iu', '', $title) : null;
    $difficulty = parseDifficulty($text);
    $approach = parseMinutes($text, ['Zustieg', 'Zustiegszeit', 'Zustiegsdauer', 'Gehzeit zum Einstieg']);
    $climb = parseMinutes($text, ['Kletterzeit', 'Steigzeit', 'Kletterdauer']);
    $duration = parseMinutes($text, ['Gesamtdauer', 'Gesamtzeit', 'Gehzeit gesamt', 'Zeitbedarf', 'Dauer']);
    $ascent = parseElevation($text, ['Höhenmeter', 'Höhenunterschied', 'Aufstieg', 'Hm']);
    $summitElevation = parseElevation($text, ['Gipfelhöhe', 'Gipfel', 'Ausstiegshöhe', 'Ausstieg']);
    $description = $metaDescription !== '' ? subUtf8($metaDescription, 0, 700) : null;
    [$entryGps, $summitGps, $gpsCandidates] = findCoordinates($html, $text, $anchors);
    $region = null;
    if (preg_match('/(?:Gebirgsgruppe|Gebirge|Region)\s*:?\s*([\p{L}0-9][\p{L}0-9 ,\-]{2,70})/iu', $text, $match)) $region = trim(preg_split('/\s{2,}|\b(?:Schwierigkeit|Ausgangspunkt|Dauer|Höhenmeter)\b/iu', $match[1])[0]);
    $country = null;
    foreach (['Österreich' => '/Österreich|Austria/iu', 'Deutschland' => '/Deutschland|Bayern|Bavaria/iu', 'Italien' => '/Italien|Italia/iu', 'Schweiz' => '/Schweiz|Switzerland/iu', 'Slowenien' => '/Slowenien|Slovenia/iu'] as $countryName => $pattern) {
        if (preg_match($pattern, $text)) { $country = $countryName; break; }
    }
    if (!$entryGps && !$summitGps && $gpsCandidates) $warnings[] = 'Koordinaten wurden gefunden, lassen sich aber keinem Einstieg oder Gipfel sicher zuordnen. Sie werden nicht automatisch in GPS-Felder übernommen.';
    if (!$entryGps && !$summitGps) $warnings[] = 'Keine eindeutig zuordenbaren Einstieg- oder Gipfelkoordinaten gefunden.';
    if (!$difficulty) $warnings[] = 'Schwierigkeit konnte nicht eindeutig erkannt werden.';
    $confidence = [
        'name' => $name ? 'medium' : 'unknown',
        'difficulty' => $difficulty ? 'medium' : 'unknown',
        'region' => $region ? 'low' : 'unknown',
        'country' => $country ? 'low' : 'unknown',
        'entryGps' => $entryGps['confidence'] ?? 'unknown',
        'summitGps' => $summitGps['confidence'] ?? 'unknown',
    ];
    return [
        'success' => true,
        'sourceUrl' => $sourceUrl,
        'sourceTitle' => $title,
        'data' => [
            'name' => $name ?: null, 'difficulty' => $difficulty, 'range' => $region, 'country' => $country,
            'description' => $description, 'ascentMeters' => $ascent,
            'approachMinutes' => $approach, 'climbMinutes' => $climb, 'durationMinutes' => $duration,
            'entry' => ['latitude' => $entryGps['latitude'] ?? null, 'longitude' => $entryGps['longitude'] ?? null, 'elevation' => null, 'confidence' => $confidence['entryGps'], 'source' => $entryGps['source'] ?? null],
            'summit' => ['latitude' => $summitGps['latitude'] ?? null, 'longitude' => $summitGps['longitude'] ?? null, 'elevation' => $summitElevation, 'confidence' => $confidence['summitGps'], 'source' => $summitGps['source'] ?? null],
            'gpsCandidates' => $gpsCandidates,
        ],
        'confidence' => $confidence,
        'rawText' => $text,
        'warnings' => $warnings,
    ];
}

try {
    if (!extension_loaded('curl')) respond(503, ['success' => false, 'error' => 'Auf dem Webspace ist die PHP-cURL-Erweiterung nicht aktiviert.']);
    [$html, $finalUrl] = fetchHtml($inputUrl, $config);
    respond(200, extractData($html, $finalUrl));
} catch (Throwable $error) {
    $status = $error instanceof ImportException ? $error->status : ($error instanceof RuntimeException ? 422 : 500);
    respond($status, ['success' => false, 'error' => $error->getMessage()]);
}

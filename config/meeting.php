<?php

return [
    'capacity' => 8,
    'turn_urls' => array_values(array_filter(explode(',', env('TURN_URLS', '')))),
    'turn_secret' => env('TURN_SECRET', ''),
    'stun_url' => env('STUN_URL', ''),
];

<?php

return [
    'default' => env('BROADCAST_CONNECTION', 'pusher'),
    'connections' => [
        'pusher' => [
            'driver' => 'pusher',
            'key' => env('PUSHER_APP_KEY'),
            'secret' => env('PUSHER_APP_SECRET'),
            'app_id' => env('PUSHER_APP_ID'),
            'client_options' => [
                'connect_timeout' => 3,
                'timeout' => 5,
            ],
            'options' => array_filter([
                'cluster' => env('PUSHER_APP_CLUSTER'),
                'useTLS' => true,
                'timeout' => 5,
                'host' => env('PUSHER_HOST'),
                'port' => env('PUSHER_PORT'),
                'scheme' => env('PUSHER_SCHEME'),
            ], fn ($value) => $value !== null && $value !== ''),
        ],
    ],
];

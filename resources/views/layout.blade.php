<!doctype html>
<html lang="{{ app()->getLocale() }}" dir="{{ app()->getLocale() === 'ar' ? 'rtl' : 'ltr' }}">
<head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <script>window.TRANSLATIONS = {!! json_encode(['en' => json_decode(file_get_contents(lang_path('en.json')), true), 'ar' => json_decode(file_get_contents(lang_path('ar.json')), true)], JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) !!};</script>
    <title>@yield('title', __('Gather — A little closer'))</title>
    <link rel="icon" href="{{ asset('favicon.svg') }}" type="image/svg+xml">
    <link rel="stylesheet" href="{{ asset('css/app.css') }}">
    <script src="{{ asset('vendor/jquery-3.7.1.min.js') }}" defer></script>
    <script src="{{ asset('js/app.js') }}" defer></script>
    @stack('head')
    <link rel="stylesheet" href="{{ asset('css/features.css') }}">
</head>
<body class="@yield('body-class')">
@include('partials.icons')
<div class="language-switch"><label class="sr-only" for="language-select">{{ __('Language') }}</label><select id="language-select" aria-label="{{ __('Language') }}"><option value="en" @selected(app()->getLocale()==='en')>English</option><option value="ar" @selected(app()->getLocale()==='ar')>العربية</option></select></div>
@yield('content')
<div class="toast" id="toast" role="status" aria-live="polite"></div>
@stack('scripts')
</body>
</html>

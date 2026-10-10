<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class SetLocale
{
    public function handle(Request $request, Closure $next)
    {
        app()->setLocale(in_array($request->session()->get('locale'), ['en', 'ar']) ? $request->session()->get('locale') : 'en');

        return $next($request);
    }
}

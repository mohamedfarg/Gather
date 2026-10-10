<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\MeetingController;
use App\Http\Controllers\RoomController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::post('/language/{locale}', function (Request $request, string $locale) {
    abort_unless(in_array($locale, ['en', 'ar']), 404);
    $request->session()->put('locale', $locale);

    return response()->json(['locale' => $locale]);
})->name('language');

Route::get('/', [MeetingController::class, 'home'])->name('home');
Route::middleware('guest')->group(function () {
    Route::get('/login', [AuthController::class, 'form'])->name('login');
    Route::get('/register', [AuthController::class, 'form'])->name('register');
    Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:10,1,login');
    Route::post('/register', [AuthController::class, 'register'])->middleware('throttle:5,1,register');
});
Route::post('/logout', [AuthController::class, 'logout'])->middleware('auth')->name('logout');
Route::middleware('auth')->group(function () {
    Route::get('/dashboard', [MeetingController::class, 'dashboard'])->name('dashboard');
    Route::get('/settings', [AuthController::class, 'settings'])->name('settings');
    Route::patch('/settings', [AuthController::class, 'update']);
    Route::post('/meetings', [MeetingController::class, 'store'])->name('meetings.store');
    Route::delete('/meetings/{meeting:code}', [MeetingController::class, 'destroy'])->name('meetings.destroy');
});
Route::get('/join', [MeetingController::class, 'join'])->name('join');
Route::get('/m/{meeting:code}', [RoomController::class, 'show'])->name('room');
Route::prefix('/m/{meeting:code}')->middleware('throttle:600,1,room')->group(function () {
    Route::post('/enter', [RoomController::class, 'enter']);
    Route::get('/poll', [RoomController::class, 'poll']);
    Route::post('/signal', [RoomController::class, 'signal']);
    Route::post('/chat', [RoomController::class, 'chat']);
    Route::post('/reaction', [RoomController::class, 'reaction'])->middleware('throttle:30,1,reactions');
    Route::patch('/state', [RoomController::class, 'state']);
    Route::post('/leave', [RoomController::class, 'leave']);
    Route::post('/control', [RoomController::class, 'control']);
});

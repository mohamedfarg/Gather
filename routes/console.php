<?php

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;

Artisan::command('meetings:prune', function () {
    $signals = DB::table('meeting_events')->where('created_at', '<', now()->subMinutes(10))->delete();
    DB::table('room_activity')->where('created_at', '<', now()->subMinutes(10))->delete();
    $participants = DB::table('participants')->whereIn('status', ['waiting', 'admitted'])->where('last_seen', '<', now()->subMinutes(5))->update(['status' => 'left']);
    $this->info("Pruned {$signals} expired signals; retired {$participants} stale participants.");
})->purpose('Remove expired WebRTC signals and retire disconnected participants');
Schedule::command('meetings:prune')->everyFiveMinutes()->withoutOverlapping();

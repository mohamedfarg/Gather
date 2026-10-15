<?php

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;
use App\Models\Meeting;
use App\Services\RoomRealtime;

Artisan::command('meetings:prune', function () {
    $signals = DB::table('meeting_events')->where('created_at', '<', now()->subMinutes(10))->delete();
    DB::table('room_activity')->where('created_at', '<', now()->subMinutes(10))->delete();
    $realtime = app(RoomRealtime::class);
    $participants = 0;
    if ($realtime->enabled()) {
        $meetingIds = DB::table('participants')->whereIn('status', ['waiting', 'admitted'])
            ->distinct()->pluck('meeting_id');
        foreach (Meeting::whereIn('id', $meetingIds)->get() as $meeting) {
            $online = $realtime->participantIds($meeting);
            if ($online !== null) {
                $participants += DB::table('participants')->where('meeting_id', $meeting->id)
                    ->whereIn('status', ['waiting', 'admitted'])->whereNotIn('id', $online)
                    ->where('created_at', '<', now()->subSeconds(20))
                    ->update(['status' => 'left']);
            }
        }
    } else {
        $participants = DB::table('participants')->whereIn('status', ['waiting', 'admitted'])->where('last_seen', '<', now()->subMinutes(5))->update(['status' => 'left']);
    }
    $this->info("Pruned {$signals} expired signals; retired {$participants} stale participants.");
})->purpose('Remove expired WebRTC signals and retire disconnected participants');
Schedule::command('meetings:prune')->everyFiveMinutes()->withoutOverlapping();

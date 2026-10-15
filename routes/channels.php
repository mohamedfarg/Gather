<?php

use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\DB;
use App\Models\Meeting;

Broadcast::channel('meeting.{code}', function ($user, string $code) {
    $meeting = Meeting::where('code', $code)->first();
    if (! $meeting) return false;
    $participantId = request()->session()->get('rooms.'.$meeting->id);

    return $participantId && DB::table('participants')
        ->where('meeting_id', $meeting->id)->where('id', $participantId)
        ->whereIn('status', ['waiting', 'admitted'])->exists();
});

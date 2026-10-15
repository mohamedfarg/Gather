<?php

namespace App\Services;

use App\Models\Meeting;
use Illuminate\Support\Facades\Broadcast;
use Pusher\Pusher;

class RoomRealtime
{
    public function enabled(): bool
    {
        return config('broadcasting.default') === 'pusher'
            && config('broadcasting.connections.pusher.key')
            && config('broadcasting.connections.pusher.secret')
            && config('broadcasting.connections.pusher.app_id');
    }

    public function client(): Pusher
    {
        return Broadcast::connection('pusher')->getPusher();
    }

    public function participantIds(Meeting $meeting): ?array
    {
        try {
            $presence = $this->client()->getPresenceUsers('presence-meeting.'.$meeting->code);

            return array_map(fn ($member) => (string) $member->id, $presence->users);
        } catch (\Throwable $error) {
            report($error);

            // A Pusher outage must not retire participants who may still be in a call.
            return null;
        }
    }
}

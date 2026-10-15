<?php

namespace App\Events;

use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

class RoomChanged implements ShouldBroadcastNow
{
    public function __construct(public string $code) {}

    public function broadcastOn(): array
    {
        return [new PresenceChannel('meeting.'.$this->code)];
    }

    public function broadcastAs(): string
    {
        return 'room.changed';
    }
}
